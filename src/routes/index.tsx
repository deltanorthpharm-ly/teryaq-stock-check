import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Copy,
  Loader2,
  Lock,
  LogOut,
  PackageSearch,
  Search,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";

import {
  getSession,
  getStatus,
  login,
  logout,
  searchStock,
  StockCheckApiError,
  type StockCheckItem,
  type StatusResponse,
} from "../lib/stockCheckApi";

const PAGE_SIZE = 20;

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
type SearchState = "idle" | "loading" | "success" | "empty" | "offline" | "error";

function formatLyd(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "غير متوفر";
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number(value))} د.ل`;
}

function formatCheckTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ar-LY", { hour: "2-digit", minute: "2-digit" });
}

function replyFor(item: StockCheckItem) {
  if (item.availability === "available") {
    return `متوفر حاليًا في صيدلية الترياق الشافي\nالسعر: ${formatLyd(item.sellingPrice)}`;
  }
  return "الصنف غير متوفر حاليًا في صيدلية الترياق الشافي.";
}

function StockLookupPage() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [pin, setPin] = useState("");
  const [loginMessage, setLoginMessage] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [items, setItems] = useState<StockCheckItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const lastCheckText = useMemo(
    () => formatCheckTime(status?.lastSuccessfulCheck || status?.serverTime),
    [status],
  );

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
    if (auth !== "authenticated") return;
    getStatus()
      .then(setStatus)
      .catch((error) => {
        setStatus({
          success: false,
          live: false,
          message: error instanceof Error ? error.message : "تعذر التحقق من المخزون حاليًا",
        });
      });
  }, [auth]);

  function notify(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 1600);
  }

  async function copyText(text: string, successMessage: string) {
    await navigator.clipboard.writeText(text);
    notify(successMessage);
  }

  async function handleLogin() {
    setLoginMessage("");
    setLoginLoading(true);
    try {
      const session = await login(pin);
      if (session.authenticated) {
        setPin("");
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
    setItems([]);
    setQuery("");
    setSubmittedQuery("");
    setSearchState("idle");
    setStatus(null);
  }

  async function runSearch(nextPage = 1) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setMessage("");
    setSearchState(nextPage === 1 ? "loading" : "success");
    try {
      const result = await searchStock(trimmed, nextPage, PAGE_SIZE);
      setStatus({
        success: true,
        live: result.live,
        lastSuccessfulCheck: result.lastSuccessfulCheck,
      });
      setSubmittedQuery(trimmed);
      setPage(result.page);
      setTotalCount(result.totalCount);
      setHasMore(result.hasMore);
      setItems((current) => (nextPage === 1 ? result.rows : [...current, ...result.rows]));
      if (result.queryTooShort) {
        setMessage("اكتب حرفين على الأقل للبحث بالاسم، أو أدخل باركود/كود كامل.");
        setSearchState("empty");
      } else {
        setSearchState(result.rows.length || nextPage > 1 ? "success" : "empty");
      }
    } catch (error) {
      const apiError = error instanceof StockCheckApiError ? error : null;
      const text = error instanceof Error ? error.message : "تعذر تنفيذ البحث.";
      if (apiError?.status === 401) {
        setAuth("locked");
        setMessage("انتهت الجلسة. أدخل رمز الدخول مرة أخرى.");
      } else if (apiError?.status === 503) {
        setSearchState("offline");
      } else {
        setSearchState("error");
      }
      setMessage(text);
      if (apiError?.payload && typeof apiError.payload === "object" && "lastSuccessfulCheck" in apiError.payload) {
        setStatus({
          success: false,
          live: false,
          message: text,
          lastSuccessfulCheck: String((apiError.payload as { lastSuccessfulCheck?: unknown }).lastSuccessfulCheck || ""),
        });
      }
    }
  }

  if (auth === "checking") {
    return (
      <main dir="rtl" className="flex min-h-screen items-center justify-center bg-background px-5">
        <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          جارٍ التحقق من الجلسة...
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
              onKeyDown={(event) => event.key === "Enter" && runSearch(1)}
              inputMode="search"
              placeholder="ابحث باسم الصنف أو الباركود"
              className="h-13 w-full rounded-xl border-2 border-border bg-background py-3.5 pr-11 pl-3 text-[15px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
          <button
            onClick={() => runSearch(1)}
            disabled={!query.trim() || searchState === "loading"}
            className="mt-2 h-12 w-full rounded-xl bg-primary text-sm font-extrabold text-primary-foreground disabled:opacity-60 active:scale-[0.99]"
          >
            {searchState === "loading" ? "جارٍ البحث..." : "بحث"}
          </button>
        </div>

        <ConnectionBar status={status} lastCheckText={lastCheckText} />
      </div>

      <section className="px-4 pt-3">
        {searchState === "idle" && (
          <StateBlock
            icon={<PackageSearch className="h-7 w-7" />}
            title="ابدأ بالبحث"
            body="اكتب اسم الصنف أو الباركود لعرض التوفر والكمية وسعر البيع من المخزون الحالي."
          />
        )}

        {searchState === "loading" && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ التحقق من المخزون...
            </div>
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-[76px] animate-pulse rounded-xl border border-border bg-muted" />
            ))}
          </div>
        )}

        {searchState === "empty" && (
          <StateBlock
            icon={<PackageSearch className="h-7 w-7" />}
            title="لا توجد نتائج"
            body={message || "لم يتم العثور على صنف مطابق. تحقق من الاسم أو جرّب الباركود."}
          />
        )}

        {searchState === "offline" && (
          <OfflineBlock message={message} lastCheckText={lastCheckText} />
        )}

        {searchState === "error" && (
          <StateBlock
            icon={<AlertTriangle className="h-7 w-7" />}
            title="تعذر تنفيذ البحث"
            body={message || "حاول مرة أخرى بعد قليل."}
          />
        )}

        {searchState === "success" && (
          <div className="space-y-2">
            <p className="px-1 text-[11px] font-bold text-muted-foreground">
              يعرض {items.length} من {totalCount} نتيجة لـ "{submittedQuery}"
            </p>
            {items.map((item) => (
              <ResultCard key={`${item.itemCode}-${item.barcode}`} item={item} onCopy={copyText} />
            ))}
            {hasMore && (
              <button
                onClick={() => runSearch(page + 1)}
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

function ConnectionBar({ status, lastCheckText }: { status: StatusResponse | null; lastCheckText: string }) {
  const online = status?.live === true;
  return (
    <div className={`mt-2 flex w-full items-center justify-between px-4 py-1.5 text-[11px] font-bold ${online ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
      <span className="flex items-center gap-1.5">
        {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        {online ? "متصل بالمخزون" : "تعذر التحقق من المخزون حاليًا"}
      </span>
      {lastCheckText && <span className="text-muted-foreground">آخر اتصال ناجح: {lastCheckText}</span>}
    </div>
  );
}

function ResultCard({
  item,
  onCopy,
}: {
  item: StockCheckItem;
  onCopy: (text: string, successMessage: string) => Promise<void>;
}) {
  const available = item.availability === "available";
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

      <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2">
        <button
          onClick={() => onCopy(replyFor(item), "تم نسخ الرد")}
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
        {replyFor(item)}
      </p>
    </article>
  );
}

function OfflineBlock({ message, lastCheckText }: { message: string; lastCheckText: string }) {
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-center">
      <AlertTriangle className="mx-auto h-7 w-7 text-danger" />
      <p className="mt-2 text-sm font-extrabold text-danger">تعذر التحقق من المخزون حاليًا</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {message || "لا يمكن تأكيد التوفر أو الكمية الآن. لا تعتمد على أي قيمة سابقة."}
      </p>
      {lastCheckText && <p className="mt-1 text-[11px] font-bold text-muted-foreground">آخر اتصال ناجح: {lastCheckText}</p>}
    </div>
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
            {loading ? "جارٍ الدخول..." : "دخول"}
          </button>

          {message && (
            <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-danger-soft py-2 text-xs font-bold text-danger">
              <AlertTriangle className="h-4 w-4" />
              {message}
            </p>
          )}
        </form>

        <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground">
          أداة مخصصة لخدمة الزبائن فقط. لا تعرض أسعار الشراء أو الأرباح أو الموردين أو الفواتير.
        </p>
      </div>
    </main>
  );
}
