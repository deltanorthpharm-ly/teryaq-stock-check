import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  Loader2,
  Lock,
  LogOut,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  fetchInventoryPage,
  getSession,
  getStatus,
  login,
  logout,
  searchStock,
  StockCheckApiError,
  type StockCheckItem,
  type StatusResponse,
} from "../lib/stockCheckApi";
import { loadStockCheckCache, saveStockCheckCache } from "../lib/stockCheckCache";

const SEARCH_PAGE_SIZE = 20;
const SYNC_PAGE_SIZE = 300;
const LOCAL_PAGE_SIZE = 100;
const RESYNC_INTERVAL_MS = 30_000;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "استعلام المخزون | صيدلية الترياق الشافي" },
      {
        name: "description",
        content: "أداة خدمة الزبائن للاستعلام عن توفر الأصناف وسعر البيع.",
      },
      { property: "og:title", content: "استعلام المخزون | صيدلية الترياق الشافي" },
      { property: "og:description", content: "بحث آمن ومحدود في مخزون الصيدلية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StockLookupPage,
});

type AuthState = "checking" | "locked" | "authenticated";
type SyncState = "idle" | "loading-cache" | "syncing" | "live" | "offline" | "error";
type SearchState = "idle" | "loading" | "success" | "empty" | "error";

function formatLyd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "غير متوفر";
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number(value))} د.ل`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ar-LY", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalize(value: string | number | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function isNumericQuery(value: string) {
  return /^\d+$/.test(value.trim());
}

function localSearch(items: StockCheckItem[], query: string) {
  const term = normalize(query);
  if (!term) return items;

  return items
    .map((item) => {
      const name = normalize(item.name);
      const barcode = normalize(item.barcode);
      const code = normalize(item.itemCode);
      let rank = Number.POSITIVE_INFINITY;

      if (barcode === term) rank = 0;
      else if (barcode.startsWith(term)) rank = 1;
      else if (code === term) rank = 2;
      else if (name.startsWith(term)) rank = 3;
      else if (name.includes(term) || barcode.includes(term) || code.includes(term)) rank = 4;

      return { item, rank };
    })
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name, "ar"))
    .map((entry) => entry.item);
}

function isSafeItemShape(item: StockCheckItem) {
  const keys = Object.keys(item).sort();
  const allowed = [
    "availability",
    "barcode",
    "formattedQuantity",
    "itemCode",
    "name",
    "quantity",
    "sellingPrice",
    "unit",
  ].sort();
  return keys.every((key, index) => key === allowed[index]) && keys.length === allowed.length;
}

function replyFor(item: StockCheckItem, offline: boolean) {
  if (!offline) {
    if (item.availability === "available") {
      return `متوفر حاليًا في صيدلية الترياق الشافي\nالسعر: ${formatLyd(item.sellingPrice)}`;
    }
    return "الصنف غير متوفر حاليًا في صيدلية الترياق الشافي.";
  }

  if (item.availability === "available") {
    return `حسب آخر تحديث لدينا، كان الصنف متوفرًا في صيدلية الترياق الشافي.\nالسعر المسجل في آخر تحديث: ${formatLyd(item.sellingPrice)}\nيرجى تأكيد التوفر قبل الاعتماد.`;
  }

  return "حسب آخر تحديث لدينا، كان الصنف غير متوفر في صيدلية الترياق الشافي.\nيرجى تأكيد التوفر قبل الاعتماد.";
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function StockLookupPage() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [pin, setPin] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [inventory, setInventory] = useState<StockCheckItem[]>([]);
  const [inventoryTotal, setInventoryTotal] = useState(0);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const [syncProgress, setSyncProgress] = useState({ loaded: 0, total: 0 });
  const [searchItems, setSearchItems] = useState<StockCheckItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchMessage, setSearchMessage] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(LOCAL_PAGE_SIZE);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const initialisedRef = useRef(false);
  const syncingRef = useRef(false);
  const searchSequenceRef = useRef(0);
  const offline = syncState === "offline" || status?.live === false;
  const canUseLocalSearch = offline || !query.trim();

  const localResults = useMemo(() => localSearch(inventory, query), [inventory, query]);
  const activeResults = query.trim() && !canUseLocalSearch ? searchItems : localResults;
  const activeTotal = query.trim() && !canUseLocalSearch ? searchTotal : localResults.length;
  const visibleItems = activeResults.slice(0, visibleLimit);
  const hasLocalMore = visibleItems.length < activeResults.length;
  const lastSyncText = formatDateTime(lastSuccessfulSync || status?.lastSuccessfulCheck);

  const setOfflineState = useCallback((message: string, lastCheck?: string | null) => {
    setSyncState("offline");
    setSyncMessage(message || "تعذر التحقق من المخزون حاليًا");
    setStatus({
      success: false,
      live: false,
      message,
      lastSuccessfulCheck: lastCheck || lastSuccessfulSync,
    });
  }, [lastSuccessfulSync]);

  const syncInventory = useCallback(async (options: { manual?: boolean } = {}) => {
    if (syncingRef.current) return false;
    syncingRef.current = true;
    setSyncState("syncing");
    setSyncMessage(options.manual ? "جاري تحديث المخزون..." : "");
    setSyncProgress({ loaded: 0, total: inventoryTotal || 0 });

    try {
      let nextPage = 1;
      let hasMore = true;
      let totalCount = 0;
      let lastCheck: string | null = null;
      const synced: StockCheckItem[] = [];

      while (hasMore) {
        const result = await fetchInventoryPage(nextPage, SYNC_PAGE_SIZE);
        totalCount = result.totalCount;
        lastCheck = result.lastSuccessfulCheck || lastCheck;
        synced.push(...result.rows.filter(isSafeItemShape));
        hasMore = result.hasMore;

        setInventory([...synced]);
        setInventoryTotal(totalCount);
        setSyncProgress({ loaded: synced.length, total: totalCount });
        setStatus({
          success: true,
          live: true,
          lastSuccessfulCheck: lastCheck,
        });

        nextPage += 1;
      }

      const completedAt = lastCheck || new Date().toISOString();
      setLastSuccessfulSync(completedAt);
      setInventoryTotal(totalCount);
      setSyncState("live");
      setSyncMessage("");
      await saveStockCheckCache({
        items: synced,
        totalCount,
        lastSuccessfulSync: completedAt,
      });
      return true;
    } catch (error) {
      const apiError = error instanceof StockCheckApiError ? error : null;
      const text = error instanceof Error ? error.message : "تعذر تحديث المخزون.";

      if (apiError?.status === 401) {
        setAuth("locked");
        setInventory([]);
        setSearchItems([]);
        setSearchState("idle");
        setSyncState("idle");
        setSyncMessage("انتهت الجلسة. أدخل رمز الدخول مرة أخرى.");
      } else {
        const lastCheck =
          apiError?.payload && typeof apiError.payload === "object" && "lastSuccessfulCheck" in apiError.payload
            ? String((apiError.payload as { lastSuccessfulCheck?: unknown }).lastSuccessfulCheck || lastSuccessfulSync || "")
            : lastSuccessfulSync;
        setOfflineState(text, lastCheck);
      }
      return false;
    } finally {
      syncingRef.current = false;
    }
  }, [inventoryTotal, lastSuccessfulSync, setOfflineState]);

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((session) => {
        if (cancelled) return;
        setAuth(session.authenticated ? "authenticated" : "locked");
      })
      .catch(() => {
        if (!cancelled) setAuth("locked");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (auth !== "authenticated" || initialisedRef.current) return;
    initialisedRef.current = true;

    let cancelled = false;

    async function initialise() {
      setSyncState("loading-cache");
      const cached = await loadStockCheckCache().catch(() => null);
      if (cancelled) return;

      if (cached) {
        setInventory(cached.items);
        setInventoryTotal(cached.totalCount);
        setLastSuccessfulSync(cached.lastSuccessfulSync);
        setSyncProgress({ loaded: cached.items.length, total: cached.totalCount });
      }

      const synced = await syncInventory();
      if (!synced && cached && !cancelled) {
        setInventory(cached.items);
        setInventoryTotal(cached.totalCount);
        setLastSuccessfulSync(cached.lastSuccessfulSync);
      }
    }

    initialise();

    return () => {
      cancelled = true;
    };
  }, [auth, syncInventory]);

  useEffect(() => {
    if (auth !== "authenticated") return undefined;

    const interval = window.setInterval(async () => {
      if (syncingRef.current) return;
      try {
        const nextStatus = await getStatus();
        if (nextStatus.live && syncState === "offline") {
          await syncInventory();
        } else if (nextStatus.live) {
          setStatus(nextStatus);
        } else {
          setOfflineState(nextStatus.message || "تعذر التحقق من المخزون حاليًا", nextStatus.lastSuccessfulCheck);
        }
      } catch (error) {
        setOfflineState(error instanceof Error ? error.message : "تعذر التحقق من المخزون حاليًا");
      }
    }, RESYNC_INTERVAL_MS);

    const onOnline = () => {
      if (syncState === "offline") {
        syncInventory();
      }
    };

    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, [auth, setOfflineState, syncInventory, syncState]);

  useEffect(() => {
    setVisibleLimit(LOCAL_PAGE_SIZE);
    const trimmed = query.trim();

    if (!trimmed) {
      setSearchState("idle");
      setSearchItems([]);
      setSearchTotal(0);
      setSearchHasMore(false);
      setSearchMessage("");
      return undefined;
    }

    if (canUseLocalSearch || (!isNumericQuery(trimmed) && trimmed.length < 2)) {
      setSearchState(localSearch(inventory, trimmed).length ? "success" : "empty");
      setSearchMessage(
        !isNumericQuery(trimmed) && trimmed.length < 2
          ? "اكتب حرفين على الأقل للبحث بالاسم، أو أدخل باركود/كود رقمي."
          : "",
      );
      return undefined;
    }

    const sequence = searchSequenceRef.current + 1;
    searchSequenceRef.current = sequence;
    setSearchState("loading");
    setSearchMessage("");

    const timer = window.setTimeout(() => {
      searchStock(trimmed, 1, SEARCH_PAGE_SIZE)
        .then((result) => {
          if (searchSequenceRef.current !== sequence) return;
          setSearchItems(result.rows);
          setSearchTotal(result.totalCount);
          setSearchPage(result.page);
          setSearchHasMore(result.hasMore);
          setSearchState(result.rows.length ? "success" : "empty");
          setStatus({
            success: true,
            live: result.live,
            lastSuccessfulCheck: result.lastSuccessfulCheck,
          });
        })
        .catch((error) => {
          if (searchSequenceRef.current !== sequence) return;
          const apiError = error instanceof StockCheckApiError ? error : null;
          const text = error instanceof Error ? error.message : "تعذر تنفيذ البحث.";

          if (apiError?.status === 401) {
            setAuth("locked");
            setSearchState("idle");
            setSearchMessage("انتهت الجلسة. أدخل رمز الدخول مرة أخرى.");
          } else {
            setSearchState("error");
            setSearchMessage(text);
            const lastCheck =
              apiError?.payload && typeof apiError.payload === "object" && "lastSuccessfulCheck" in apiError.payload
                ? String((apiError.payload as { lastSuccessfulCheck?: unknown }).lastSuccessfulCheck || lastSuccessfulSync || "")
                : lastSuccessfulSync;
            setOfflineState(text, lastCheck);
          }
        });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [canUseLocalSearch, inventory, lastSuccessfulSync, query, setOfflineState]);

  function notify(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 1600);
  }

  async function copyText(text: string, successMessage: string) {
    await writeClipboard(text);
    notify(successMessage);
  }

  async function loadMoreSearchResults() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchState("loading");
    try {
      const result = await searchStock(trimmed, searchPage + 1, SEARCH_PAGE_SIZE);
      setSearchItems((current) => [...current, ...result.rows]);
      setSearchTotal(result.totalCount);
      setSearchPage(result.page);
      setSearchHasMore(result.hasMore);
      setSearchState("success");
    } catch (error) {
      setSearchState("error");
      setSearchMessage(error instanceof Error ? error.message : "تعذر تحميل المزيد.");
    }
  }

  async function handleLogin() {
    setLoginMessage("");
    setLoginLoading(true);
    try {
      const session = await login(pin);
      if (session.authenticated) {
        setPin("");
        initialisedRef.current = false;
        setAuth("authenticated");
        return;
      }
      setLoginMessage("تعذر فتح الجلسة.");
    } catch (error) {
      setLoginMessage(error instanceof Error ? error.message : "رمز الدخول غير صحيح.");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    setAuth("locked");
    setInventory([]);
    setInventoryTotal(0);
    setSearchItems([]);
    setQuery("");
    setSearchState("idle");
    setSyncState("idle");
    setStatus(null);
    initialisedRef.current = false;
  }

  if (auth === "checking") {
    return (
      <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          جاري التحقق من الجلسة...
        </div>
      </main>
    );
  }

  if (auth !== "authenticated") {
    return (
      <AccessScreen
        pin={pin}
        setPin={setPin}
        loading={loginLoading}
        message={loginMessage}
        onSubmit={handleLogin}
      />
    );
  }

  const showInitialLoading = syncState === "loading-cache" || (syncState === "syncing" && inventory.length === 0);
  const noResults = query.trim() && activeResults.length === 0 && searchState !== "loading";
  const showInventoryEmpty = !query.trim() && !showInitialLoading && inventory.length === 0;

  return (
    <main dir="rtl" className="min-h-screen bg-background pb-10">
      <div className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 pt-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold text-foreground">استعلام المخزون</h1>
            <p className="truncate text-xs text-muted-foreground">صيدلية الترياق الشافي</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground active:scale-95"
          >
            <LogOut className="h-4 w-4" />
            خروج
          </button>
        </header>

        <div className="px-4 pt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 right-3 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              inputMode="search"
              placeholder="ابحث باسم الصنف أو الباركود أو الكود"
              className="h-13 w-full rounded-xl border-2 border-border bg-background py-3.5 pr-11 pl-3 text-[15px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground focus:border-primary"
            />
          </div>

          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <p className="min-w-0 truncate text-[11px] font-bold text-muted-foreground">
              {syncState === "syncing"
                ? `جاري المزامنة: ${syncProgress.loaded} / ${syncProgress.total || "..."}`
                : `تم تحميل ${inventory.length} من ${inventoryTotal || inventory.length} صنف`}
            </p>
            <button
              onClick={() => syncInventory({ manual: true })}
              disabled={syncState === "syncing"}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-extrabold text-muted-foreground disabled:opacity-60 active:scale-95"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncState === "syncing" ? "animate-spin" : ""}`} />
              تحديث
            </button>
          </div>
        </div>

        <ConnectionBar status={status} syncState={syncState} lastSyncText={lastSyncText} />
      </div>

      <section className="space-y-3 px-4 pt-3">
        {offline && (
          <OfflineBanner message={syncMessage} lastSyncText={lastSyncText} />
        )}

        {showInitialLoading && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل المخزون...
            </div>
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-[92px] animate-pulse rounded-xl border border-border bg-muted" />
            ))}
          </div>
        )}

        {showInventoryEmpty && (
          <StateBlock
            icon={<PackageSearch className="h-7 w-7" />}
            title="لا توجد بيانات محفوظة"
            body="سجّل الدخول أثناء اتصال المنظومة حتى يتم تحميل المخزون لأول مرة."
          />
        )}

        {noResults && (
          <StateBlock
            icon={<PackageSearch className="h-7 w-7" />}
            title="لا توجد نتائج"
            body={searchMessage || "لم يتم العثور على صنف مطابق. تحقق من الاسم أو جرّب الباركود."}
          />
        )}

        {searchState === "error" && !offline && (
          <StateBlock
            icon={<AlertTriangle className="h-7 w-7" />}
            title="تعذر تنفيذ البحث"
            body={searchMessage || "حاول مرة أخرى بعد قليل."}
          />
        )}

        {activeResults.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-1 text-[11px] font-bold text-muted-foreground">
              <span>
                {query.trim()
                  ? `يعرض ${visibleItems.length} من ${activeTotal} نتيجة`
                  : `يعرض ${visibleItems.length} من ${activeTotal} صنف`}
              </span>
              {searchState === "loading" && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  بحث مباشر
                </span>
              )}
            </div>

            {visibleItems.map((item) => (
              <ResultCard
                key={`${item.itemCode || "item"}-${item.barcode || item.name}`}
                item={item}
                offline={offline}
                onCopy={copyText}
              />
            ))}

            {(hasLocalMore || (query.trim() && !canUseLocalSearch && searchHasMore)) && (
              <button
                onClick={() => {
                  if (query.trim() && !canUseLocalSearch && searchHasMore && visibleItems.length >= searchItems.length) {
                    loadMoreSearchResults();
                    return;
                  }
                  setVisibleLimit((current) => current + LOCAL_PAGE_SIZE);
                }}
                className="h-11 w-full rounded-lg border border-border text-xs font-extrabold text-muted-foreground active:scale-[0.99]"
              >
                تحميل المزيد
              </button>
            )}
          </div>
        )}
      </section>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

function ConnectionBar({
  status,
  syncState,
  lastSyncText,
}: {
  status: StatusResponse | null;
  syncState: SyncState;
  lastSyncText: string;
}) {
  const online = status?.live === true && syncState !== "offline";
  const syncing = syncState === "syncing" || syncState === "loading-cache";

  return (
    <div
      className={`mt-2 flex w-full items-center justify-between gap-2 px-4 py-1.5 text-[11px] font-bold ${
        online ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {syncing ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : online ? (
          <Wifi className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {syncing ? "جاري مزامنة المخزون" : online ? "متصل بالمخزون" : "غير متصل بالمنظومة"}
        </span>
      </span>
      {lastSyncText && <span className="shrink-0 text-muted-foreground">آخر تحديث: {lastSyncText}</span>}
    </div>
  );
}

function OfflineBanner({ message, lastSyncText }: { message: string; lastSyncText: string }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-danger">غير متصل بالمنظومة</p>
          <p className="mt-0.5 text-xs font-bold text-muted-foreground">البيانات المعروضة هي آخر نسخة محفوظة</p>
          {lastSyncText && <p className="mt-0.5 text-[11px] text-muted-foreground">آخر تحديث ناجح: {lastSyncText}</p>}
          {message && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{message}</p>}
        </div>
      </div>
    </div>
  );
}

function ResultCard({
  item,
  offline,
  onCopy,
}: {
  item: StockCheckItem;
  offline: boolean;
  onCopy: (text: string, successMessage: string) => Promise<void>;
}) {
  const available = item.availability === "available";
  const reply = replyFor(item, offline);

  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-extrabold text-foreground">{item.name}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {item.barcode ? `باركود: ${item.barcode}` : "بدون باركود"}
            {item.itemCode ? ` · كود: ${item.itemCode}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-extrabold ${
            available ? "border-ok/25 bg-ok-soft text-ok" : "border-danger/25 bg-danger-soft text-danger"
          }`}
        >
          {available ? "متوفر" : "غير متوفر"}
        </span>
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-xl font-black text-foreground">{formatLyd(item.sellingPrice)}</p>
        <p className="text-xs font-bold text-muted-foreground">
          الرصيد: {item.formattedQuantity || `${item.quantity} ${item.unit || "وحدة"}`}
        </p>
      </div>

      {offline && (
        <p className="mt-2 rounded-md border border-danger/20 bg-danger-soft px-2 py-1 text-[11px] font-bold text-danger">
          هذا التوفر من آخر تحديث محفوظ وليس تحققًا مباشرًا.
        </p>
      )}

      <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2">
        <button
          onClick={() => onCopy(reply, "تم نسخ الرد")}
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-extrabold text-primary-foreground active:scale-[0.99]"
        >
          <Copy className="h-4 w-4" />
          نسخ الرد
        </button>
        <button
          onClick={() => onCopy(item.name, "تم نسخ اسم الصنف")}
          className="h-11 rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground active:scale-[0.99]"
        >
          نسخ الاسم
        </button>
      </div>

      <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-[11px] leading-5 text-muted-foreground whitespace-pre-line">
        {reply}
      </p>
    </article>
  );
}

function StateBlock({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="mt-3 text-sm font-extrabold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function AccessScreen({
  pin,
  setPin,
  loading,
  message,
  onSubmit,
}: {
  pin: string;
  setPin: (value: string) => void;
  loading: boolean;
  message: string;
  onSubmit: () => void;
}) {
  return (
    <main dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-center text-xl font-black text-foreground">استعلام المخزون</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">أداة خدمة الزبائن</p>

        <form
          className="mt-6 rounded-2xl border border-border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label className="text-xs font-bold text-muted-foreground">رمز الدخول</label>
          <div className="relative mt-1.5">
            <Lock className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              placeholder="••••••"
              className="h-12 w-full rounded-xl border-2 border-border bg-background pr-10 pl-3 text-center text-lg font-bold tracking-[0.4em] text-foreground outline-none focus:border-primary"
            />
          </div>
          <button
            type="submit"
            disabled={!pin || loading}
            className="mt-3 h-12 w-full rounded-xl bg-primary text-sm font-extrabold text-primary-foreground disabled:opacity-60 active:scale-[0.99]"
          >
            {loading ? "جاري الدخول..." : "دخول"}
          </button>

          {message && (
            <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-danger-soft py-2 text-xs font-bold text-danger">
              <AlertTriangle className="h-4 w-4" />
              {message}
            </p>
          )}
        </form>

        <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div className="rounded-xl border border-border bg-card p-3">
            <CheckCircle2 className="mb-1 h-4 w-4 text-ok" />
            سعر البيع والتوفر فقط
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <Database className="mb-1 h-4 w-4 text-primary" />
            متصل ببيانات الصيدلية
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground">
          أداة مخصصة لخدمة الزبائن فقط. لا تعرض أسعار الشراء أو الأرباح أو الموردين أو الفواتير.
        </p>
      </div>
    </main>
  );
}
