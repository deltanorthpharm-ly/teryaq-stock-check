import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Search,
  LogOut,
  Copy,
  ShieldCheck,
  Wifi,
  WifiOff,
  Loader2,
  PackageSearch,
  Lock,
  AlertTriangle,
  Eye,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "استعلام المخزون | صيدلية الترياق الشافي" },
      {
        name: "description",
        content:
          "أداة خدمة الزبائن للاستعلام السريع عن توفر الصنف والكمية وسعر البيع في صيدلية الترياق الشافي.",
      },
      { property: "og:title", content: "استعلام المخزون | أداة خدمة الزبائن" },
      {
        property: "og:description",
        content: "استعلام سريع عن التوفر والكمية وسعر البيع لموظفي خدمة الزبائن.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StockLookupPage,
});

/* ------------------------------------------------------------------ *
 * DESIGN PHASE ONLY
 * No backend, no database, no inventory logic.
 * The "معاينة التصميم" mode below renders clearly-labelled placeholder
 * layout samples so the design can be reviewed. It is never presented
 * as live stock data.
 * ------------------------------------------------------------------ */

type Access = "locked" | "granted" | "denied";
type Link = "online" | "offline";
type View = "idle" | "loading" | "results" | "empty" | "offline";

type Sample = {
  name: string;
  price: string;
  qty: string;
  unit: string;
  detail: string;
  state: "available" | "limited" | "out";
};

const LAYOUT_SAMPLES: Sample[] = [
  {
    name: "اسم الصنف — عيار ١",
    price: "—",
    qty: "—",
    unit: "علبة",
    detail: "شكل صيدلاني · حجم العبوة · الشركة",
    state: "available",
  },
  {
    name: "اسم الصنف — عيار ٢",
    price: "—",
    qty: "—",
    unit: "علبة",
    detail: "شكل صيدلاني · حجم العبوة · الشركة",
    state: "limited",
  },
  {
    name: "اسم الصنف — شكل آخر",
    price: "—",
    qty: "—",
    unit: "شريط",
    detail: "شكل صيدلاني · حجم العبوة · الشركة",
    state: "out",
  },
];

const STATE_META = {
  available: { label: "متوفر", cls: "text-ok bg-ok-soft border-ok/25" },
  limited: { label: "كمية محدودة", cls: "text-warn bg-warn-soft border-warn/25" },
  out: { label: "غير متوفر", cls: "text-danger bg-danger-soft border-danger/25" },
} as const;

function StockLookupPage() {
  const [access, setAccess] = useState<Access>("locked");
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("idle");
  const [link, setLink] = useState<Link>("online");
  const [preview, setPreview] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const lastCheck = useMemo(
    () =>
      new Date().toLocaleTimeString("ar-LY", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [],
  );

  function notify(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  function runSearch() {
    if (!query.trim()) return;
    setView("loading");
    window.setTimeout(() => {
      if (link === "offline") return setView("offline");
      // No inventory source is connected in this design phase.
      setView(preview ? "results" : "empty");
    }, 700);
  }

  if (access !== "granted") {
    return (
      <AccessScreen
        access={access}
        code={code}
        setCode={setCode}
        onSubmit={() => setAccess(code.trim() ? "denied" : "denied")}
        onDesignEnter={() => setAccess("granted")}
      />
    );
  }

  return (
    <main dir="rtl" className="min-h-screen bg-background pb-10">
      {/* Header + sticky search */}
      <div className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 pt-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold text-foreground">استعلام المخزون</h1>
            <p className="truncate text-xs text-muted-foreground">صيدلية الترياق الشافي</p>
          </div>
          <button
            onClick={() => setAccess("locked")}
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
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              inputMode="search"
              placeholder="ابحث باسم الصنف أو الباركود"
              className="h-13 w-full rounded-xl border-2 border-border bg-background py-3.5 pr-11 pl-3 text-[15px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
          <button
            onClick={runSearch}
            className="mt-2 h-12 w-full rounded-xl bg-primary text-sm font-extrabold text-primary-foreground active:scale-[0.99]"
          >
            بحث
          </button>
        </div>

        <ConnectionBar link={link} lastCheck={lastCheck} onToggle={() => setLink(link === "online" ? "offline" : "online")} />
      </div>

      {/* Design-preview switch (explicitly not real data) */}
      <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-dashed border-border px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          معاينة التصميم — عناصر توضيحية بدون بيانات مخزون
        </span>
        <input
          type="checkbox"
          checked={preview}
          onChange={(e) => setPreview(e.target.checked)}
          className="h-4 w-4 accent-[var(--primary)]"
        />
      </div>

      <section className="px-4 pt-3">
        {view === "idle" && (
          <StateBlock
            icon={<PackageSearch className="h-7 w-7" />}
            title="ابدأ بالبحث"
            body="اكتب اسم الصنف أو امسح الباركود لعرض التوفر والكمية وسعر البيع."
          />
        )}

        {view === "loading" && (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جارٍ التحقق من المخزون…
            </div>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-xl border border-border bg-muted" />
            ))}
          </div>
        )}

        {view === "empty" && (
          <StateBlock
            icon={<PackageSearch className="h-7 w-7" />}
            title="لا توجد نتائج"
            body="لم يتم العثور على صنف مطابق. تحقق من الاسم أو جرّب الباركود."
          />
        )}

        {view === "offline" && (
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-danger" />
            <p className="mt-2 text-sm font-extrabold text-danger">تعذر التحقق من المخزون حاليًا</p>
            <p className="mt-1 text-xs text-muted-foreground">
              لا يمكن تأكيد التوفر أو الكمية الآن. لا تعتمد على أي قيمة سابقة.
            </p>
            <p className="mt-1 text-[11px] font-bold text-muted-foreground">آخر اتصال ناجح: {lastCheck}</p>
          </div>
        )}

        {view === "results" && (
          <div className="space-y-2">
            <p className="pb-1 text-[11px] font-bold text-muted-foreground">
              نموذج عرض النتائج — لا يمثل مخزونًا حقيقيًا
            </p>
            {LAYOUT_SAMPLES.map((s) => (
              <ResultCard key={s.name} item={s} onCopy={notify} />
            ))}
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
  link,
  lastCheck,
  onToggle,
}: {
  link: Link;
  lastCheck: string;
  onToggle: () => void;
}) {
  const online = link === "online";
  return (
    <button
      onClick={onToggle}
      className={`mt-2 flex w-full items-center justify-between px-4 py-1.5 text-[11px] font-bold ${
        online ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"
      }`}
    >
      <span className="flex items-center gap-1.5">
        {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        {online ? "متصل بالمخزون" : "غير متصل بالمخزون"}
      </span>
      <span className="text-muted-foreground">
        {online ? `آخر تحديث: ${lastCheck}` : `آخر اتصال ناجح: ${lastCheck}`}
      </span>
    </button>
  );
}

function ResultCard({ item, onCopy }: { item: Sample; onCopy: (m: string) => void }) {
  const meta = STATE_META[item.state];
  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-extrabold text-foreground">{item.name}</h2>
          <p className="truncate text-[11px] text-muted-foreground">{item.detail}</p>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-extrabold ${meta.cls}`}>
          {meta.label}
        </span>
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <p className="text-xl font-black text-foreground">
          {item.price} <span className="text-sm font-bold text-muted-foreground">د.ل</span>
        </p>
        <p className="text-xs font-bold text-muted-foreground">
          الرصيد: {item.qty} {item.unit}
        </p>
      </div>

      <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2">
        <button
          onClick={() => onCopy("تم نسخ الرد")}
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-extrabold text-primary-foreground active:scale-[0.99]"
        >
          <Copy className="h-4 w-4" />
          نسخ الرد
        </button>
        <button
          onClick={() => onCopy("تم نسخ اسم الصنف")}
          className="h-11 rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground active:scale-[0.99]"
        >
          نسخ الاسم
        </button>
      </div>

      <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
        {item.state === "out"
          ? "الصنف غير متوفر حاليًا في صيدلية الترياق الشافي."
          : "متوفر حاليًا في صيدلية الترياق الشافي — السعر: [سعر البيع] د.ل"}
      </p>
    </article>
  );
}

function StateBlock({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
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
  access,
  code,
  setCode,
  onSubmit,
  onDesignEnter,
}: {
  access: Access;
  code: string;
  setCode: (v: string) => void;
  onSubmit: () => void;
  onDesignEnter: () => void;
}) {
  return (
    <main dir="rtl" className="flex min-h-screen flex-col items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-center text-xl font-black text-foreground">استعلام المخزون</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">أداة خدمة الزبائن</p>

        <div className="mt-6 rounded-2xl border border-border bg-card p-4">
          <label className="text-xs font-bold text-muted-foreground">رمز الدخول</label>
          <div className="relative mt-1.5">
            <Lock className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              type="password"
              inputMode="numeric"
              placeholder="••••••"
              className="h-12 w-full rounded-xl border-2 border-border bg-background pr-10 pl-3 text-center text-lg font-bold tracking-[0.4em] text-foreground outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={onSubmit}
            className="mt-3 h-12 w-full rounded-xl bg-primary text-sm font-extrabold text-primary-foreground active:scale-[0.99]"
          >
            دخول
          </button>

          {access === "denied" && (
            <p className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-danger-soft py-2 text-xs font-bold text-danger">
              <AlertTriangle className="h-4 w-4" />
              جلسة غير مصرح بها — لم يتم ربط نظام الصلاحيات بعد
            </p>
          )}

          <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
            لم يتم تفعيل المصادقة الفعلية في هذه المرحلة (مرحلة تصميم فقط).
          </p>
          <button
            onClick={onDesignEnter}
            className="mt-2 w-full rounded-lg border border-dashed border-border py-2 text-[11px] font-bold text-muted-foreground"
          >
            متابعة لمعاينة التصميم
          </button>
        </div>

        <p className="mt-5 text-center text-[11px] leading-5 text-muted-foreground">
          أداة مخصصة لخدمة الزبائن — لا تعرض الأسعار الشرائية أو الأرباح أو الموردين أو الفواتير.
        </p>
      </div>
    </main>
  );
}
