import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import emailjs from "@emailjs/browser";
import {
  SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME, BUSINESS, INVOICE_PREFIX, STAFF_USERS,
  EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, NOTIFY_EMAIL,
} from "./config.js";

if (EMAILJS_PUBLIC_KEY) {
  try { emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY }); } catch (e) {}
}

/** Sends a follow-up reminder email when an appointment is booked.
 *  Silently does nothing if EmailJS isn't configured yet (see SETUP-GUIDE.md). */
async function sendFollowUpEmail(customerName, mobile, dateStr, time, serviceNames) {
  if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || !NOTIFY_EMAIL) return;
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: NOTIFY_EMAIL,
      customer_name: customerName || "Walk-in",
      customer_mobile: mobile || "",
      appointment_date: fmtDate(dateStr),
      appointment_time: time || "",
      services: serviceNames || "",
    });
  } catch (e) {
    console.error("Follow-up email failed:", e);
  }
}

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const PAYMENT_MODES = ["Cash", "Benefit Pay", "Bank Transfer", "Scan to Pay"];
const SALE_MODES = [...PAYMENT_MODES, "Credit"];
const EXPENSE_CATEGORIES = [
  "Shop Rent", "Electricity Bill", "LMRA Monthly Fees", "Visa Fees",
  "Visa Renewal Fees", "License Renewal", "Staff Salary",
  "Customer Snacks", "Product Purchase", "Other"
];
const GOV_CATEGORIES = ["LMRA Monthly Fees", "Visa Fees", "Visa Renewal Fees", "License Renewal"];
const APPT_STATUS = ["Booked", "Completed", "Cancelled", "No Show"];
const NAV_ADMIN = [
  { key: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "customers", label: "Customers", icon: "users" },
  { key: "appointments", label: "Appointments", icon: "calendar" },
  { key: "sales", label: "Sales & Payments", icon: "wallet" },
  { key: "credit", label: "Credit (Unpaid)", icon: "credit" },
  { key: "expenses", label: "Expenses & Bills", icon: "receipt" },
  { key: "suppliers", label: "Suppliers", icon: "truck" },
  { key: "purchases", label: "Product Purchases", icon: "package" },
  { key: "staff", label: "Staff & Salary", icon: "staff" },
  { key: "loans", label: "Loans (Sadaque)", icon: "handcoins" },
  { key: "reports", label: "Reports", icon: "file" },
  { key: "whatsapp", label: "WhatsApp Offers", icon: "whatsapp" },
  { key: "permissions", label: "Staff Permissions", icon: "lock" },
];
/* Sections staff can be granted access to, beyond Sales & Payments (always on). */
const GRANTABLE_TABS = [
  { key: "customers", label: "Customers", icon: "users" },
  { key: "appointments", label: "Appointments", icon: "calendar" },
  { key: "whatsapp", label: "WhatsApp Offers", icon: "whatsapp" },
  { key: "reports", label: "Reports", icon: "file" },
  { key: "expenses", label: "Expenses & Bills", icon: "receipt" },
];

/* Invoice numbers like CBL1923-0000001BH-2026 */
function nextInvoiceNo(sales, dateStr) {
  const year = new Date(dateStr || todayStr()).getFullYear();
  const suffix = `BH-${year}`;
  let max = 0;
  sales.forEach((s) => {
    if (s.invoiceNo && s.invoiceNo.endsWith(suffix)) {
      const match = s.invoiceNo.match(/-(\d{7})BH-/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    }
  });
  const seq = String(max + 1).padStart(7, "0");
  return `${INVOICE_PREFIX}-${seq}${suffix}`;
}



const ENTITIES = {
  customers: "customers", staff: "staff", services: "services",
  appointments: "appointments", sales: "sales", expenses: "expenses",
  suppliers: "suppliers", purchases: "purchases",
  supplierPayments: "supplier_payments", loans: "loans",
  salarySlips: "salary_slips", permissions: "permissions",
};

const DEFAULT_SERVICES = [
  { id: "svc1", name: "Hair Cut", price: 5, duration: 30 },
  { id: "svc2", name: "Hair Color", price: 15, duration: 90 },
  { id: "svc3", name: "Facial", price: 10, duration: 45 },
  { id: "svc4", name: "Manicure", price: 6, duration: 30 },
  { id: "svc5", name: "Pedicure", price: 7, duration: 40 },
  { id: "svc6", name: "Threading", price: 2, duration: 15 },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtMoney = (n) => `BHD ${Number(n || 0).toFixed(3)}`;
const monthLabel = (m, y) => new Date(y, m, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

/** Green = visited within 30 days, Yellow = 31–90 days, Red = 90+ days or never visited. */
function customerStatusDot(lastVisit) {
  if (!lastVisit) return { color: "#B23A3A", label: "Not visited yet" };
  const days = daysBetween(lastVisit, todayStr());
  if (days <= 30) return { color: "#4E7C59", label: `Regular — last visit ${days}d ago` };
  if (days <= 90) return { color: "#C9A15A", label: `Slowing down — last visit ${days}d ago` };
  return { color: "#B23A3A", label: `Not coming — last visit ${days}d ago` };
}
const waNumber = (mobile) => {
  let n = (mobile || "").replace(/[^0-9]/g, "");
  if (n.length === 8) n = "973" + n;
  return n;
};
const waLink = (mobile, text) => `https://wa.me/${waNumber(mobile)}?text=${encodeURIComponent(text)}`;

const NUM_WORDS_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const NUM_WORDS_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function intToWords(n) {
  if (n === 0) return "";
  if (n < 20) return NUM_WORDS_ONES[n];
  if (n < 100) return NUM_WORDS_TENS[Math.floor(n / 10)] + (n % 10 ? " " + NUM_WORDS_ONES[n % 10] : "");
  if (n < 1000) return NUM_WORDS_ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + intToWords(n % 100) : "");
  if (n < 1000000) return intToWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + intToWords(n % 1000) : "");
  return String(n);
}
function numberToWordsBHD(amount) {
  const n = Math.max(0, Number(amount) || 0);
  const dinars = Math.floor(n);
  const fils = Math.round((n - dinars) * 1000);
  let out = dinars === 0 ? "Zero Dinars" : `${intToWords(dinars)} Dinar${dinars === 1 ? "" : "s"}`;
  if (fils > 0) out += ` and ${intToWords(fils)} Fils`;
  return out + " Only";
}

/* ------------------------------------------------------------------ */
/* Supabase-backed persistent list hook                               */
/* Mirrors the old [data, setData, loaded] API so every screen below  */
/* works unchanged, but now reads/writes a shared Supabase table and  */
/* stays in sync in real time across every device that opens the app. */
/* ------------------------------------------------------------------ */

async function syncDiff(supabase, entity, prevList, nextList) {
  const prevMap = Object.fromEntries(prevList.map((x) => [x.id, x]));
  const nextMap = Object.fromEntries(nextList.map((x) => [x.id, x]));
  const inserts = nextList.filter((x) => !prevMap[x.id]);
  const updates = nextList.filter(
    (x) => prevMap[x.id] && JSON.stringify(prevMap[x.id]) !== JSON.stringify(x)
  );
  const deletes = prevList.filter((x) => !nextMap[x.id]);

  for (const item of inserts) {
    await supabase.from("records").insert({ id: item.id, entity, data: item });
  }
  for (const item of updates) {
    await supabase.from("records").update({ data: item, updated_at: new Date().toISOString() }).eq("id", item.id);
  }
  for (const item of deletes) {
    await supabase.from("records").delete().eq("id", item.id);
  }
}

function useSupabaseList(supabase, entity, seedData) {
  const [data, setDataState] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data: rows, error } = await supabase
        .from("records")
        .select("*")
        .eq("entity", entity)
        .order("created_at", { ascending: true });

      if (!active) return;

      if (error) {
        console.error("Load failed for", entity, error);
        setLoaded(true);
        return;
      }

      if (rows && rows.length > 0) {
        setDataState(rows.map((r) => r.data));
      } else if (seedData && seedData.length) {
        for (const item of seedData) {
          await supabase.from("records").insert({ id: item.id, entity, data: item });
        }
        if (active) setDataState(seedData);
      }
      if (active) setLoaded(true);
    })();

    const channel = supabase
      .channel(`records-${entity}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "records", filter: `entity=eq.${entity}` },
        (payload) => {
          setDataState((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((x) => x.id !== payload.old.id);
            }
            const incoming = payload.new.data;
            const exists = prev.some((x) => x.id === incoming.id);
            if (exists) return prev.map((x) => (x.id === incoming.id ? incoming : x));
            return [...prev, incoming];
          });
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [entity]);

  const setData = useCallback(
    (updater) => {
      setDataState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        syncDiff(supabase, entity, prev, next);
        return next;
      });
    },
    [entity]
  );

  return [data, setData, loaded];
}

/* ------------------------------------------------------------------ */
/* Small shared UI                                                    */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Icons (emoji-based, zero external dependency)                      */
/* ------------------------------------------------------------------ */

const ICONS = {
  dashboard: "📊", users: "👥", calendar: "📅", wallet: "💰", credit: "💳",
  receipt: "🧾", truck: "🚚", package: "📦", staff: "🧑‍💼", file: "📄",
  handcoins: "🤝", printer: "🖨️", whatsapp: "💬", add: "➕", edit: "✏️",
  delete: "🗑️", close: "✖️", search: "🔍", phone: "📞", check: "✅",
  cancel: "❌", clock: "⏰", up: "📈", down: "📉", warning: "⚠️",
  sparkle: "✨", menu: "☰", cash: "💵", chevron: "▶️", star: "⭐", upload: "📥", lock: "🔒",
};

function AppIcon({ name, size = 16, className = "" }) {
  return (
    <span
      className={className}
      style={{ fontSize: size, lineHeight: 1, display: "inline-block", verticalAlign: "middle" }}
    >
      {ICONS[name] || "•"}
    </span>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div
        className={`cbl-card mt-4 w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl bg-white p-5 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="cbl-heading text-lg text-[#2B2320]">{title}</h3>
          <button onClick={onClose} className="rounded-full p-1 text-[#2B2320]/50 hover:bg-black/5">
            <AppIcon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-[#2B2320]/80">
        {label}{required && <span className="text-[#D6336C]"> *</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-[#f5d3e0] bg-[#FFF6F8] px-3 py-2 text-sm text-[#2B2320] outline-none focus:border-[#D6336C] focus:ring-1 focus:ring-[#D6336C]";

function TextInput({ className = "", ...props }) { return <input {...props} className={`${inputCls} ${className}`} />; }
function Select({ children, className = "", ...props }) { return <select {...props} className={`${inputCls} ${className}`}>{children}</select>; }
function TextArea({ className = "", ...props }) { return <textarea {...props} className={`${inputCls} min-h-[70px] ${className}`} />; }

function Btn({ children, onClick, variant = "primary", type = "button", size = "md", className = "" }) {
  const base = "inline-flex items-center gap-1.5 rounded-lg font-medium transition active:scale-[0.98]";
  const sizes = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm";
  const variants = {
    primary: "text-white",
    ghost: "bg-transparent text-[#D6336C] hover:bg-[#D6336C]/10",
    danger: "bg-[#B23A3A]/10 text-[#B23A3A] hover:bg-[#B23A3A]/20",
    outline: "border border-[#D6336C]/30 text-[#D6336C] hover:bg-[#D6336C]/5",
  };
  const style = variant === "primary" ? { background: "linear-gradient(135deg,#D6336C,#A61E5C)" } : {};
  return (
    <button type={type} onClick={onClick} style={style} className={`${base} ${sizes} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
}

function Empty({ icon, text, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#f5d3e0] py-14 text-center">
      <AppIcon name={icon} size={28} className="mb-2 text-[#D6336C]/40" />
      <p className="text-sm text-[#2B2320]/50">{text}</p>
      {action}
    </div>
  );
}

function StatCard({ label, value, icon, tone = "rose", sub }) {
  const tones = {
    rose: "from-[#D6336C] to-[#A61E5C]",
    gold: "from-[#C9A15A] to-[#A9803D]",
    green: "from-[#4E7C59] to-[#3A5E43]",
    amber: "from-[#C97B2E] to-[#A5621F]",
    red: "from-[#B23A3A] to-[#8E2C2C]",
  };
  return (
    <div className="cbl-card relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm">
      <div className={`absolute -right-4 -top-4 h-16 w-16 rounded-full bg-gradient-to-br ${tones[tone]} opacity-10`} />
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-[#2B2320]/45">{label}</span>
        <div className={`rounded-lg bg-gradient-to-br ${tones[tone]} p-1.5 text-white`}><AppIcon name={icon} size={14} /></div>
      </div>
      <div className="cbl-heading text-xl text-[#2B2320]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[#2B2320]/45">{sub}</div>}
    </div>
  );
}

function Th({ children, ...rest }) { return <th {...rest} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[#2B2320]/50">{children}</th>; }
function Td({ children, className = "", ...rest }) { return <td {...rest} className={`whitespace-nowrap px-3 py-2 text-sm text-[#2B2320]/85 ${className}`}>{children}</td>; }

function Pill({ children, tone = "gray" }) {
  const tones = {
    gray: "bg-black/5 text-[#2B2320]/60",
    green: "bg-[#4E7C59]/10 text-[#4E7C59]",
    red: "bg-[#B23A3A]/10 text-[#B23A3A]",
    amber: "bg-[#C97B2E]/10 text-[#C97B2E]",
    rose: "bg-[#D6336C]/10 text-[#D6336C]",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function SectionHeader({ title, desc, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="cbl-heading text-2xl text-[#2B2320]">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-[#2B2320]/50">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function confirmDelete(msg) { return window.confirm(msg || "Delete this record? This cannot be undone."); }

/* ================================================================== */
/* MAIN APP                                                            */
/* ================================================================== */

export default function App({ supabase, currentUser, onLogout }) {
  const [navOpen, setNavOpen] = useState(false);
  const isStaff = currentUser.role === "staff";

  const [customers, setCustomers, lCust] = useSupabaseList(supabase, ENTITIES.customers, []);
  const [staff, setStaff, lStaff] = useSupabaseList(supabase, ENTITIES.staff, []);
  const [services, setServices, lServ] = useSupabaseList(supabase, ENTITIES.services, DEFAULT_SERVICES);
  const [appointments, setAppointments, lAppt] = useSupabaseList(supabase, ENTITIES.appointments, []);
  const [sales, setSales, lSales] = useSupabaseList(supabase, ENTITIES.sales, []);
  const [expenses, setExpenses, lExp] = useSupabaseList(supabase, ENTITIES.expenses, []);
  const [suppliers, setSuppliers, lSupp] = useSupabaseList(supabase, ENTITIES.suppliers, []);
  const [purchases, setPurchases, lPurch] = useSupabaseList(supabase, ENTITIES.purchases, []);
  const [supplierPayments, setSupplierPayments, lSp] = useSupabaseList(supabase, ENTITIES.supplierPayments, []);
  const [loans, setLoans, lLoans] = useSupabaseList(supabase, ENTITIES.loans, []);
  const [salarySlips, setSalarySlips, lSlips] = useSupabaseList(supabase, ENTITIES.salarySlips, []);
  const [permissions, setPermissions, lPerms] = useSupabaseList(supabase, ENTITIES.permissions, []);

  const allLoaded = lCust && lStaff && lServ && lAppt && lSales && lExp && lSupp && lPurch && lSp && lLoans && lSlips && lPerms;

  const myPerms = useMemo(() => {
    if (!isStaff) return null;
    return permissions.find((p) => p.username === currentUser.username) || {};
  }, [permissions, isStaff, currentUser.username]);

  const canAccess = useCallback((key) => {
    if (!isStaff) return true;
    if (key === "sales") return true;
    return !!(myPerms && myPerms[key]);
  }, [isStaff, myPerms]);

  const NAV = isStaff
    ? [{ key: "sales", label: "Sales & Payments", icon: "wallet" }, ...GRANTABLE_TABS.filter((t) => canAccess(t.key))]
    : NAV_ADMIN;

  const [tab, setTab] = useState(isStaff ? "sales" : "dashboard");

  const custMap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);
  const staffMap = useMemo(() => Object.fromEntries(staff.map(s => [s.id, s])), [staff]);
  const svcMap = useMemo(() => Object.fromEntries(services.map(s => [s.id, s])), [services]);
  const suppMap = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers]);

  // ---- Admin notifications: fires when someone else adds a sale ----
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const prevSalesIds = useRef(null);

  useEffect(() => {
    if (currentUser.role !== "admin" || !lSales) return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [currentUser.role, lSales]);

  useEffect(() => {
    if (currentUser.role !== "admin" || !lSales) return;
    const ids = new Set(sales.map((s) => s.id));
    if (prevSalesIds.current) {
      const added = sales.filter((s) => !prevSalesIds.current.has(s.id) && s.addedBy && s.addedBy !== currentUser.name);
      added.forEach((s) => {
        const text = `${s.addedBy} added a sale: ${custMap[s.customerId]?.name || "Walk-in"} — ${fmtMoney(s.amount)}`;
        setNotifications((prev) => [{ id: s.id, text, time: new Date().toISOString() }, ...prev].slice(0, 30));
        if ("Notification" in window && Notification.permission === "granted") {
          try { new Notification("Cherrys Beauty Lounge", { body: text }); } catch (e) {}
        }
      });
    }
    prevSalesIds.current = ids;
  }, [sales, currentUser, lSales, custMap]);

  // customer visit stats: derived from completed appointments + sales
  const customerStats = useMemo(() => {
    const map = {};
    customers.forEach(c => { map[c.id] = { visits: 0, lastVisit: null, nextAppt: null }; });
    appointments.forEach(a => {
      if (!map[a.customerId]) return;
      if (a.status === "Completed") {
        map[a.customerId].visits += 1;
        if (!map[a.customerId].lastVisit || a.date > map[a.customerId].lastVisit) map[a.customerId].lastVisit = a.date;
      }
      if (a.status === "Booked" && a.date >= todayStr()) {
        const cur = map[a.customerId].nextAppt;
        if (!cur || a.date < cur.date || (a.date === cur.date && a.time < cur.time)) map[a.customerId].nextAppt = a;
      }
    });
    sales.forEach(s => {
      if (!map[s.customerId]) return;
      if (!map[s.customerId].lastVisit || s.date > map[s.customerId].lastVisit) map[s.customerId].lastVisit = s.date;
    });
    return map;
  }, [customers, appointments, sales]);

  const nav = allLoaded ? tab : "loading";

  return (
    <div className="cbl-root min-h-screen w-full" style={{ background: "radial-gradient(1200px 600px at 100% -10%, #FDEFF4 0%, transparent 60%), radial-gradient(900px 500px at -10% 10%, #FCE9F1 0%, transparent 55%), #FFF9FA" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');
        .cbl-root { font-family: 'Inter', sans-serif; }
        .cbl-heading { font-family: 'Playfair Display', serif; }
        .cbl-card { border: 1px solid #f6e1ea; box-shadow: 0 1px 2px rgba(214,51,108,0.04); }
        @media print {
          @page { size: A4; margin: 12mm; }
          body * { visibility: hidden; }
          #report-print, #report-print *, #salary-slip-print, #salary-slip-print * { visibility: visible; }
          #report-print, #salary-slip-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      {!allLoaded ? (
        <div className="flex h-screen items-center justify-center">
          <div className="flex items-center gap-2 text-[#D6336C]"><AppIcon name="sparkle" className="animate-pulse" size={20} /> Loading Cherrys Beauty Lounge…</div>
        </div>
      ) : (
        <div className="flex">
          {/* Sidebar */}
          <aside className={`no-print fixed z-40 flex h-screen w-64 shrink-0 flex-col overflow-y-auto bg-gradient-to-b from-[#E0447C] via-[#B0225F] to-[#5C1140] text-white transition-transform md:static md:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
            <div className="border-b border-white/10 px-5 py-6">
              <img src="./assets/logo-light-text.png" alt="Cherrys Beauty Lounge" className="h-9 w-auto object-contain" />
            </div>
            <nav className="flex-1 px-3 py-4">
              {NAV.map(item => {
                const active = tab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => { setTab(item.key); setNavOpen(false); }}
                    className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${active ? "bg-white/15 font-semibold text-white" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                  >
                    <AppIcon name={item.icon} size={16} />{item.label}
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-white/10 px-4 py-4">
              <div className="mb-2 text-xs text-white/60">Signed in as</div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{currentUser.name}</div>
                  <div className="text-[10px] uppercase tracking-wide text-[#E8C888]">{currentUser.role}</div>
                </div>
              </div>
              <button onClick={onLogout} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium hover:bg-white/20">
                <AppIcon name="close" size={12} /> Log out
              </button>
            </div>
          </aside>
          {navOpen && <div className="no-print fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} />}

          {/* Main */}
          <main className="min-h-screen w-full flex-1 md:ml-0">
            <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-[#efe6e0] bg-[#FFF6F8]/90 px-4 py-3 backdrop-blur">
              <button onClick={() => setNavOpen(true)} className="rounded-lg p-2 text-[#D6336C] hover:bg-black/5 md:hidden"><AppIcon name="menu" size={20} /></button>
              <img src="./assets/logo-dark-text.png" alt="Cherrys Beauty Lounge" className="h-6 w-auto object-contain md:hidden" />
              <div className="ml-auto">
                {currentUser.role === "admin" && (
                  <div className="relative">
                    <button onClick={() => setNotifOpen((v) => !v)} className="relative rounded-full p-2 text-[#D6336C] hover:bg-[#D6336C]/10">
                      <AppIcon name="whatsapp" size={18} />
                      {notifications.length > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#B23A3A] text-[9px] font-bold text-white">
                          {notifications.length > 9 ? "9+" : notifications.length}
                        </span>
                      )}
                    </button>
                    {notifOpen && (
                      <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-[#f5d3e0] bg-white p-3 shadow-xl">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-sm font-semibold text-[#2B2320]">Notifications</div>
                          {notifications.length > 0 && <button onClick={() => setNotifications([])} className="text-xs text-[#D6336C]">Clear</button>}
                        </div>
                        {notifications.length === 0 ? (
                          <p className="text-xs text-[#2B2320]/50">No new activity yet — you'll see it here when staff add a sale.</p>
                        ) : (
                          <div className="max-h-72 space-y-2 overflow-y-auto">
                            {notifications.map((n) => (
                              <div key={n.id + n.time} className="rounded-lg bg-[#FFF6F8] p-2 text-xs">
                                <div className="text-[#2B2320]/80">{n.text}</div>
                                <div className="mt-0.5 text-[10px] text-[#2B2320]/40">{new Date(n.time).toLocaleTimeString()}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
              {tab === "dashboard" && !isStaff && <Dashboard {...{ customers, appointments, sales, expenses, custMap, staffMap, svcMap, customerStats, setTab }} />}
              {tab === "customers" && canAccess("customers") && <CustomersTab {...{ customers, setCustomers, customerStats, staff }} />}
              {tab === "appointments" && canAccess("appointments") && <AppointmentsTab {...{ appointments, setAppointments, customers, setCustomers, staff, services, custMap, staffMap, svcMap, setTab, setSales, currentUser }} />}
              {tab === "sales" && <SalesTab {...{ sales, setSales, customers, setCustomers, staff, services, custMap, staffMap, svcMap, currentUser }} />}
              {tab === "credit" && !isStaff && <CreditTab {...{ sales, setSales, custMap, currentUser }} />}
              {tab === "expenses" && canAccess("expenses") && <ExpensesTab {...{ expenses, setExpenses, staff }} />}
              {tab === "suppliers" && !isStaff && <SuppliersTab {...{ suppliers, setSuppliers, purchases, supplierPayments, setTab }} />}
              {tab === "purchases" && !isStaff && <PurchasesTab {...{ purchases, setPurchases, suppliers, suppMap, supplierPayments, setSupplierPayments }} />}
              {tab === "staff" && !isStaff && <StaffTab {...{ staff, setStaff, salarySlips, setSalarySlips }} />}
              {tab === "loans" && !isStaff && <LoansTab {...{ loans, setLoans }} />}
              {tab === "reports" && canAccess("reports") && <ReportsTab {...{ sales, expenses, custMap, suppliers, suppMap, purchases, supplierPayments, staff, salarySlips }} />}
              {tab === "whatsapp" && canAccess("whatsapp") && <WhatsAppTab {...{ customers, customerStats }} />}
              {tab === "permissions" && !isStaff && <PermissionsTab {...{ permissions, setPermissions }} />}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* DASHBOARD                                                           */
/* ================================================================== */

function ProgressRing({ percent, color, size = 84, label, value }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{ width: size, height: size, background: `conic-gradient(${color} ${clamped * 3.6}deg, #F1E3E9 0deg)` }}
      >
        <div className="flex flex-col items-center justify-center rounded-full bg-white" style={{ width: size - 14, height: size - 14 }}>
          <span className="cbl-heading text-base text-[#2B2320]">{value}</span>
        </div>
      </div>
      <span className="mt-2 text-center text-[11px] text-[#2B2320]/55">{label}</span>
    </div>
  );
}

function Dashboard({ customers, appointments, sales, expenses, custMap, staffMap, svcMap, customerStats, setTab }) {
  const today = todayStr();
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const todaysAppts = appointments.filter(a => a.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const monthRevenue = sales.filter(s => s.date.startsWith(monthPrefix)).reduce((sum, s) => sum + Number(s.amount), 0);
  const monthExpenses = expenses.filter(e => e.date.startsWith(monthPrefix)).reduce((sum, e) => sum + Number(e.amount), 0);
  const outstandingCredit = sales.filter(s => (s.amountPaid || 0) < s.amount).reduce((sum, s) => sum + (s.amount - (s.amountPaid || 0)), 0);

  const withStatus = customers.map((c) => ({ c, dot: customerStatusDot(customerStats[c.id]?.lastVisit) }));
  const regularCount = withStatus.filter((x) => x.dot.color === "#4E7C59").length;
  const slowingCount = withStatus.filter((x) => x.dot.color === "#C9A15A" ).length;
  const inactiveCount = withStatus.filter((x) => x.dot.color === "#B23A3A" && customerStats[x.c.id]?.lastVisit).length;
  const inactive = customers.filter(c => {
    const lv = customerStats[c.id]?.lastVisit;
    if (!lv) return false;
    return daysBetween(lv, today) >= 30;
  });
  const neverVisited = customers.filter(c => !customerStats[c.id]?.lastVisit);
  const net = monthRevenue - monthExpenses;
  const regularPct = customers.length ? Math.round((regularCount / customers.length) * 100) : 0;

  const itemNames = (a) => (a.items && a.items.length ? a.items.map((it) => it.name).join(", ") : svcMap[a.serviceId]?.name || "Service");

  return (
    <div>
      {/* Hero banner */}
      <div className="mb-5 overflow-hidden rounded-[28px] p-6 text-white shadow-lg sm:p-7" style={{ background: "linear-gradient(120deg,#E0447C 0%,#B0225F 55%,#5C1140 100%)" }}>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-[#F5DBA0]">Welcome back</div>
            <h2 className="cbl-heading mt-1 text-2xl sm:text-3xl">Cherrys Beauty Lounge</h2>
            <div className="mt-1 text-sm text-white/70">{fmtDate(today)}</div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
              <div className="text-[10px] uppercase tracking-wide text-white/60">This Month Net</div>
              <div className="cbl-heading text-xl">{fmtMoney(net)}</div>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
              <div className="text-[10px] uppercase tracking-wide text-white/60">Today's Appointments</div>
              <div className="cbl-heading text-xl">{todaysAppts.length}</div>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
              <div className="text-[10px] uppercase tracking-wide text-white/60">Outstanding Credit</div>
              <div className="cbl-heading text-xl">{fmtMoney(outstandingCredit)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Customer health ring card */}
        <div className="cbl-card rounded-[24px] bg-white p-5 shadow-sm">
          <h3 className="cbl-heading mb-4 text-base text-[#2B2320]">Customer Health</h3>
          <div className="flex items-center justify-around">
            <ProgressRing percent={regularPct} color="#4E7C59" value={regularCount} label="Regular" />
            <ProgressRing percent={customers.length ? (slowingCount / customers.length) * 100 : 0} color="#C9A15A" value={slowingCount} label="Slowing down" />
            <ProgressRing percent={customers.length ? (inactiveCount / customers.length) * 100 : 0} color="#B23A3A" value={inactiveCount} label="Not coming" />
          </div>
          <div className="mt-4 text-center text-xs text-[#2B2320]/45">{customers.length} total customers</div>
        </div>

        {/* Money card */}
        <div className="cbl-card rounded-[24px] p-5 shadow-sm" style={{ background: "linear-gradient(160deg,#FFF6F8,#FCE9F1)" }}>
          <h3 className="cbl-heading mb-4 text-base text-[#2B2320]">This Month</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-[#2B2320]/70"><span className="h-2 w-2 rounded-full bg-[#4E7C59]"></span>Sales</span>
              <span className="font-semibold text-[#2B2320]">{fmtMoney(monthRevenue)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-[#2B2320]/70"><span className="h-2 w-2 rounded-full bg-[#B23A3A]"></span>Expenses</span>
              <span className="font-semibold text-[#2B2320]">{fmtMoney(monthExpenses)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5 text-white" style={{ background: "linear-gradient(135deg,#D6336C,#A61E5C)" }}>
              <span className="text-sm">Net Profit</span>
              <span className="cbl-heading">{fmtMoney(net)}</span>
            </div>
          </div>
        </div>

        {/* Quick stats stack */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total Customers" value={customers.length} icon="users" tone="rose" />
          <StatCard label="Today's Appts" value={todaysAppts.length} icon="calendar" tone="gold" />
          <StatCard label="Regulars" value={regularCount} icon="star" tone="green" sub="within 30 days" />
          <StatCard label="Credit Due" value={fmtMoney(outstandingCredit)} icon="credit" tone="amber" />
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="cbl-card rounded-[24px] bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="cbl-heading text-base text-[#2B2320]">Today's Appointments</h3>
            <button onClick={() => setTab("appointments")} className="flex items-center text-xs font-medium text-[#D6336C]">View all <AppIcon name="chevron" size={14} /></button>
          </div>
          {todaysAppts.length === 0 ? (
            <Empty icon="calendar" text="No appointments booked for today." />
          ) : (
            <div className="space-y-2">
              {todaysAppts.map(a => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl bg-[#FFF6F8] px-3 py-2.5 text-sm">
                  <div className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: a.status === "Completed" ? "#4E7C59" : a.status === "Cancelled" || a.status === "No Show" ? "#B23A3A" : "#D6336C" }}></div>
                  <div className="flex-1">
                    <div className="font-medium text-[#2B2320]">{a.time} — {custMap[a.customerId]?.name || "Walk-in"}</div>
                    <div className="text-xs text-[#2B2320]/50">{itemNames(a)} with {staffMap[a.staffId]?.name}</div>
                  </div>
                  <Pill tone={a.status === "Completed" ? "green" : a.status === "Cancelled" || a.status === "No Show" ? "red" : "rose"}>{a.status}</Pill>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cbl-card rounded-[24px] bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="cbl-heading text-base text-[#2B2320]">Customers to Win Back</h3>
            <button onClick={() => setTab("whatsapp")} className="flex items-center text-xs font-medium text-[#D6336C]">Send offer <AppIcon name="chevron" size={14} /></button>
          </div>
          {inactive.length === 0 ? (
            <Empty icon="star" text="Everyone's visiting regularly — nice work!" />
          ) : (
            <div className="space-y-2">
              {inactive.slice(0, 8).map(c => (
                <div key={c.id} className="flex items-center gap-3 rounded-xl bg-[#FFF6F8] px-3 py-2.5 text-sm">
                  <div className="h-8 w-1.5 shrink-0 rounded-full bg-[#C97B2E]"></div>
                  <div className="flex-1">
                    <div className="font-medium text-[#2B2320]">{c.name}</div>
                    <div className="text-xs text-[#2B2320]/50">Last visit {fmtDate(customerStats[c.id]?.lastVisit)}</div>
                  </div>
                  <a href={waLink(c.mobile, `Hi ${c.name}, we miss you at Cherrys Beauty Lounge! Come visit us soon for a special treat 💇‍♀️✨`)} target="_blank" rel="noreferrer" className="rounded-full bg-[#4E7C59]/10 p-2 text-[#4E7C59] hover:bg-[#4E7C59]/20">
                    <AppIcon name="whatsapp" size={14} />
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {neverVisited.length > 0 && (
        <div className="mt-5 cbl-card rounded-[24px] bg-white p-5 shadow-sm">
          <h3 className="cbl-heading mb-3 text-base text-[#2B2320]">New Customers, No Visit Yet</h3>
          <div className="flex flex-wrap gap-2">
            {neverVisited.slice(0, 12).map(c => <Pill key={c.id} tone="gray">{c.name}</Pill>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* CUSTOMERS                                                           */
/* ================================================================== */

function CustomersTab({ customers, setCustomers, customerStats, staff }) {
  const [modal, setModal] = useState(null); // {mode, data}
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [importModal, setImportModal] = useState(null); // {raw, rows}

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) || (c.mobile || "").includes(search)
  );

  function openAdd() { setModal({ mode: "add", data: { name: "", mobile: "", tags: "", notes: "" } }); }
  function openEdit(c) { setModal({ mode: "edit", data: { ...c } }); }

  function save(e) {
    e.preventDefault();
    const d = modal.data;
    if (!d.name || !d.mobile) return;
    if (modal.mode === "add") {
      setCustomers([...customers, { ...d, id: uid(), createdAt: todayStr(), log: [] }]);
    } else {
      setCustomers(customers.map(c => c.id === d.id ? d : c));
    }
    setModal(null);
  }

  function del(id) {
    if (!confirmDelete("Delete this customer? Their appointment/sales history will remain but unlinked.")) return;
    setCustomers(customers.filter(c => c.id !== id));
  }

  // ---- Bulk import ----
  function parseContacts(text) {
    const existingMobiles = new Set(customers.map((c) => (c.mobile || "").replace(/[^0-9]/g, "")));
    const seen = new Set();
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      const parts = line.split(/\t|,/).map((p) => p.trim().replace(/^"|"$/g, ""));
      if (parts.length < 2) continue;
      const lower = parts[0].toLowerCase();
      if (lower === "name" || lower === "full name") continue; // skip header row
      let name = "", mobile = "";
      // figure out which column is the phone number vs the name
      const digitsA = parts[0].replace(/[^0-9]/g, "");
      const digitsB = parts[1].replace(/[^0-9]/g, "");
      if (digitsA.length >= 7 && digitsA.length >= parts[0].length - 2) {
        mobile = parts[0]; name = parts[1];
      } else {
        name = parts[0]; mobile = parts[1];
      }
      const cleanMobile = mobile.replace(/[^0-9]/g, "");
      if (!name || cleanMobile.length < 7) continue;
      if (seen.has(cleanMobile) || existingMobiles.has(cleanMobile)) continue;
      seen.add(cleanMobile);
      rows.push({ name, mobile });
    }
    return rows;
  }

  function openImport() { setImportModal({ raw: "", rows: [] }); }

  function handleRawChange(text) {
    setImportModal({ raw: text, rows: parseContacts(text) });
  }

  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => handleRawChange(String(e.target.result || ""));
    reader.readAsText(file);
  }

  function confirmImport() {
    const additions = importModal.rows.map((r) => ({
      id: uid(), name: r.name, mobile: r.mobile, tags: "", notes: "", createdAt: todayStr(), log: [],
    }));
    setCustomers([...customers, ...additions]);
    setImportModal(null);
  }

  function exportCSV() {
    const header = ["Name", "Mobile", "Tags", "Visits", "Last Visit", "Next Appointment"];
    const rows = customers.map((c) => {
      const st = customerStats[c.id] || {};
      return [
        c.name, c.mobile, (c.tags || "").replace(/,/g, ";"),
        st.visits || 0, st.lastVisit || "", st.nextAppt ? `${st.nextAppt.date} ${st.nextAppt.time}` : "",
      ];
    });
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cherrys-customers-${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const detail = detailId ? customers.find(c => c.id === detailId) : null;

  return (
    <div>
      <SectionHeader
        title="Customers"
        desc={`${customers.length} total`}
        action={
          <div className="flex gap-2">
            <Btn variant="outline" onClick={exportCSV}><AppIcon name="file" size={16} /> Export CSV</Btn>
            <Btn variant="outline" onClick={openImport}><AppIcon name="upload" size={16} /> Import Contacts</Btn>
            <Btn onClick={openAdd}><AppIcon name="add" size={16} /> Add Customer</Btn>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#f5d3e0] bg-white px-3 py-2">
        <AppIcon name="search" size={16} className="text-[#2B2320]/40" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or mobile…" className="w-full bg-transparent text-sm outline-none" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-[#2B2320]/60">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#4E7C59" }}></span> Regular (0–30 days)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#C9A15A" }}></span> Slowing down (31–90 days)</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#B23A3A" }}></span> Not coming (90+ days / never)</span>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="users" text="No customers yet. Add your first customer to get started." action={<Btn onClick={openAdd} className="mt-3"><AppIcon name="add" size={14} /> Add Customer</Btn>} />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr>
              <Th>Name</Th><Th>Mobile</Th><Th>Tags</Th><Th>Visits</Th><Th>Last Visit</Th><Th>Next Appt.</Th><Th></Th>
            </tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {filtered.map(c => {
                const st = customerStats[c.id] || {};
                const dot = customerStatusDot(st.lastVisit);
                return (
                  <tr key={c.id} className="hover:bg-[#FFF6F8] cursor-pointer" onClick={() => setDetailId(c.id)}>
                    <Td className="font-medium text-[#2B2320]">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: dot.color }} title={dot.label}></span>
                      {c.name}
                    </Td>
                    <Td>{c.mobile}</Td>
                    <Td>{c.tags ? c.tags.split(",").map((t, i) => <Pill key={i} tone="rose">{t.trim()}</Pill>) : "—"}</Td>
                    <Td>{st.visits || 0}</Td>
                    <Td>{st.lastVisit ? fmtDate(st.lastVisit) : "Never"}</Td>
                    <Td>{st.nextAppt ? `${fmtDate(st.nextAppt.date)} ${st.nextAppt.time}` : "—"}</Td>
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <a href={waLink(c.mobile, `Hi ${c.name}, this is Cherrys Beauty Lounge!`)} target="_blank" rel="noreferrer" className="rounded p-1.5 text-[#4E7C59] hover:bg-[#4E7C59]/10"><AppIcon name="whatsapp" size={14} /></a>
                        <button onClick={() => openEdit(c)} className="rounded p-1.5 text-[#2B2320]/50 hover:bg-black/5"><AppIcon name="edit" size={14} /></button>
                        <button onClick={() => del(c.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.mode === "add" ? "Add Customer" : "Edit Customer"} onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <Field label="Name" required><TextInput value={modal.data.name} onChange={e => setModal({ ...modal, data: { ...modal.data, name: e.target.value } })} required /></Field>
            <Field label="Mobile Number" required><TextInput value={modal.data.mobile} onChange={e => setModal({ ...modal, data: { ...modal.data, mobile: e.target.value } })} placeholder="e.g. 33123456" required /></Field>
            <Field label="Tags (comma separated)"><TextInput value={modal.data.tags} onChange={e => setModal({ ...modal, data: { ...modal.data, tags: e.target.value } })} placeholder="VIP, Bridal, Colour client" /></Field>
            <Field label="Notes"><TextArea value={modal.data.notes} onChange={e => setModal({ ...modal, data: { ...modal.data, notes: e.target.value } })} /></Field>
            <Btn type="submit" className="w-full justify-center">Save Customer</Btn>
          </form>
        </Modal>
      )}

      {importModal && (
        <Modal title="Import Contacts" onClose={() => setImportModal(null)} wide>
          <p className="mb-3 text-sm text-[#2B2320]/60">
            Paste a contact list below (one per line, name and mobile separated by a comma or tab —
            this is what you get exporting from Google Contacts, Excel, or your phone as a .csv file),
            or upload a .csv/.txt file directly. Duplicate mobile numbers already in your customer list are skipped automatically.
          </p>
          <Field label="Upload a file (optional)">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
              className="w-full text-sm"
            />
          </Field>
          <Field label="Or paste contacts here">
            <TextArea
              value={importModal.raw}
              onChange={(e) => handleRawChange(e.target.value)}
              placeholder={"Fatima Ahmed, 33112233\nSara Khalid, 39445566"}
              className="min-h-[120px]"
            />
          </Field>

          {importModal.raw && (
            <div className="mb-3 rounded-lg bg-[#FFF6F8] p-3">
              <div className="mb-2 text-sm font-medium text-[#2B2320]">
                {importModal.rows.length} new contact{importModal.rows.length === 1 ? "" : "s"} ready to import
              </div>
              {importModal.rows.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {importModal.rows.map((r, i) => (
                        <tr key={i} className="border-b border-white/60">
                          <Td className="font-medium">{r.name}</Td>
                          <Td>{r.mobile}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <Btn className="w-full justify-center" onClick={confirmImport} disabled={!importModal.rows.length}>
            <AppIcon name="upload" size={16} /> Import {importModal.rows.length || ""} Contact{importModal.rows.length === 1 ? "" : "s"}
          </Btn>
        </Modal>
      )}

      {detail && <CustomerDetail customer={detail} onClose={() => setDetailId(null)} onSave={(d) => setCustomers(customers.map(c => c.id === d.id ? d : c))} stats={customerStats[detail.id]} />}
    </div>
  );
}

function CustomerDetail({ customer, onClose, onSave, stats }) {
  const [note, setNote] = useState("");
  const log = customer.log || [];

  function addNote() {
    if (!note.trim()) return;
    const entry = { date: new Date().toISOString(), text: note.trim() };
    onSave({ ...customer, log: [entry, ...log] });
    setNote("");
  }

  return (
    <Modal title={customer.name} onClose={onClose} wide>
      <div className="mb-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-[#FFF6F8] p-2"><div className="cbl-heading text-lg">{stats?.visits || 0}</div><div className="text-[10px] uppercase text-[#2B2320]/45">Visits</div></div>
        <div className="rounded-lg bg-[#FFF6F8] p-2"><div className="cbl-heading text-sm">{stats?.lastVisit ? fmtDate(stats.lastVisit) : "Never"}</div><div className="text-[10px] uppercase text-[#2B2320]/45">Last Visit</div></div>
        <div className="rounded-lg bg-[#FFF6F8] p-2"><div className="cbl-heading text-sm">{stats?.nextAppt ? fmtDate(stats.nextAppt.date) : "—"}</div><div className="text-[10px] uppercase text-[#2B2320]/45">Next Appt.</div></div>
      </div>
      <div className="mb-2 flex items-center gap-2 text-sm text-[#2B2320]/70"><AppIcon name="phone" size={14} /> {customer.mobile}
        <a href={waLink(customer.mobile, `Hi ${customer.name}, this is Cherrys Beauty Lounge!`)} target="_blank" rel="noreferrer" className="ml-auto rounded-full bg-[#4E7C59]/10 px-3 py-1 text-xs font-medium text-[#4E7C59]">Message on WhatsApp</a>
      </div>
      {customer.notes && <p className="mb-3 rounded-lg bg-[#FFF6F8] p-2 text-sm text-[#2B2320]/70">{customer.notes}</p>}

      <h4 className="cbl-heading mb-2 text-sm text-[#2B2320]">Conversation / Visit Notes</h4>
      <div className="mb-2 flex gap-2">
        <TextInput value={note} onChange={e => setNote(e.target.value)} placeholder="Log a note, call, or WhatsApp chat summary…" />
        <Btn onClick={addNote}>Add</Btn>
      </div>
      <div className="max-h-40 space-y-2 overflow-y-auto">
        {log.length === 0 && <p className="text-xs text-[#2B2320]/40">No notes logged yet.</p>}
        {log.map((l, i) => (
          <div key={i} className="rounded-lg bg-[#FFF6F8] p-2 text-xs">
            <div className="text-[#2B2320]/40">{new Date(l.date).toLocaleString()}</div>
            <div className="text-[#2B2320]/80">{l.text}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* APPOINTMENTS                                                        */
/* ================================================================== */

function generateSlots() {
  const slots = [];
  for (let h = 10; h <= 20; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 20 && m > 0) continue;
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}
const SLOTS = generateSlots();

function AppointmentsTab({ appointments, setAppointments, customers, setCustomers, staff, services, custMap, staffMap, svcMap, setTab, setSales, currentUser }) {
  const [date, setDate] = useState(todayStr());
  const [modal, setModal] = useState(null);

  const dayAppts = appointments.filter(a => a.date === date).sort((a, b) => a.time.localeCompare(b.time));
  const itemsOf = (a) => a.items && a.items.length ? a.items : (a.serviceId && svcMap[a.serviceId] ? [{ name: svcMap[a.serviceId].name, price: svcMap[a.serviceId].price }] : []);
  const totalOf = (a) => itemsOf(a).reduce((sum, it) => sum + Number(it.price || 0), 0);

  function openAdd() {
    setModal({
      date, time: SLOTS[0], staffId: staff[0]?.id || "",
      items: [{ name: services[0]?.name || "", price: services[0]?.price ?? "" }],
      customerId: "", newCustomerName: "", newCustomerMobile: "", notes: "",
    });
  }

  function bookedSlotsFor(staffId, dt) {
    return new Set(appointments.filter(a => a.staffId === staffId && a.date === dt && a.status !== "Cancelled").map(a => a.time));
  }

  function updateItem(i, field, value) {
    const items = [...modal.items];
    items[i] = { ...items[i], [field]: value };
    if (field === "name") {
      const match = services.find((s) => s.name.toLowerCase() === value.toLowerCase());
      if (match && !items[i].priceTouched) items[i].price = match.price;
    }
    if (field === "price") items[i].priceTouched = true;
    setModal({ ...modal, items });
  }
  function addItemRow() { setModal({ ...modal, items: [...modal.items, { name: "", price: "" }] }); }
  function removeItemRow(i) { setModal({ ...modal, items: modal.items.filter((_, idx) => idx !== i) }); }

  function save(e) {
    e.preventDefault();
    let customerId = modal.customerId;
    let updatedCustomers = customers;
    let customerName = custMap[customerId]?.name;
    let customerMobile = custMap[customerId]?.mobile;
    if (!customerId) {
      if (!modal.newCustomerName || !modal.newCustomerMobile) { alert("Search for an existing customer or enter a new customer's name & mobile."); return; }
      const nc = { id: uid(), name: modal.newCustomerName, mobile: modal.newCustomerMobile, tags: "", notes: "", createdAt: todayStr(), log: [] };
      updatedCustomers = [...customers, nc];
      setCustomers(updatedCustomers);
      customerId = nc.id;
      customerName = nc.name;
      customerMobile = nc.mobile;
    }
    const items = modal.items.filter((it) => it.name.trim());
    if (items.length === 0) { alert("Add at least one service."); return; }
    const taken = bookedSlotsFor(modal.staffId, modal.date);
    if (taken.has(modal.time)) { if (!window.confirm("This staff member already has an appointment at this time. Book anyway?")) return; }
    setAppointments([...appointments, { id: uid(), date: modal.date, time: modal.time, staffId: modal.staffId, items, customerId, status: "Booked", notes: modal.notes }]);
    sendFollowUpEmail(customerName, customerMobile, modal.date, modal.time, items.map((it) => it.name).join(", "));
    setModal(null);
  }

  function setStatus(a, status) {
    setAppointments(appointments.map(x => x.id === a.id ? { ...x, status } : x));
  }

  function del(id) {
    if (!confirmDelete("Delete this appointment?")) return;
    setAppointments(appointments.filter(a => a.id !== id));
  }

  function convertToSale(a) {
    const items = itemsOf(a);
    const amount = totalOf(a);
    const description = items.map((it) => it.name).join(", ") || "Service";
    setSales(prev => {
      const invoiceNo = nextInvoiceNo(prev, a.date);
      return [...prev, {
        id: uid(), invoiceNo, date: a.date, customerId: a.customerId, staffId: a.staffId,
        description, amount, amountPaid: amount,
        payments: [{ date: a.date, amount, mode: "Cash" }], addedBy: currentUser?.name || "—",
      }];
    });
    setTab("sales");
  }

  return (
    <div>
      <SectionHeader
        title="Appointments"
        desc="Slot-wise booking by service and staff"
        action={<Btn onClick={openAdd}><AppIcon name="add" size={16} /> Book Appointment</Btn>}
      />

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-[#2B2320]/60">Date</label>
        <TextInput type="date" value={date} onChange={e => setDate(e.target.value)} className="w-auto" />
        <Btn variant="outline" size="sm" onClick={() => setDate(todayStr())}>Today</Btn>
      </div>

      {staff.length === 0 && <div className="mb-4 rounded-lg bg-[#C97B2E]/10 px-3 py-2 text-sm text-[#C97B2E]">Add staff members first (Staff & Salary tab) so customers can choose who serves them.</div>}

      {dayAppts.length === 0 ? (
        <Empty icon="calendar" text={`No appointments on ${fmtDate(date)}.`} action={<Btn onClick={openAdd} className="mt-3"><AppIcon name="add" size={14} /> Book Appointment</Btn>} />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr>
              <Th>Time</Th><Th>Customer</Th><Th>Mobile</Th><Th>Service(s)</Th><Th>Total</Th><Th>Staff</Th><Th>Status</Th><Th></Th>
            </tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {dayAppts.map(a => (
                <tr key={a.id} className="hover:bg-[#FFF6F8]">
                  <Td className="font-medium">{a.time}</Td>
                  <Td>{custMap[a.customerId]?.name || "—"}</Td>
                  <Td>{custMap[a.customerId]?.mobile}</Td>
                  <Td>{itemsOf(a).map((it) => it.name).join(", ")}</Td>
                  <Td>{fmtMoney(totalOf(a))}</Td>
                  <Td>{staffMap[a.staffId]?.name}</Td>
                  <Td><Pill tone={a.status === "Completed" ? "green" : a.status === "Cancelled" || a.status === "No Show" ? "red" : "rose"}>{a.status}</Pill></Td>
                  <Td>
                    <div className="flex gap-1">
                      {a.status === "Booked" && <>
                        <button title="Mark completed" onClick={() => setStatus(a, "Completed")} className="rounded p-1.5 text-[#4E7C59] hover:bg-[#4E7C59]/10"><AppIcon name="check" size={14} /></button>
                        <button title="No show" onClick={() => setStatus(a, "No Show")} className="rounded p-1.5 text-[#C97B2E] hover:bg-[#C97B2E]/10"><AppIcon name="clock" size={14} /></button>
                        <button title="Cancel" onClick={() => setStatus(a, "Cancelled")} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="cancel" size={14} /></button>
                      </>}
                      {a.status === "Completed" && <Btn size="sm" variant="outline" onClick={() => convertToSale(a)}>Add to Sales</Btn>}
                      <button onClick={() => del(a.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Book Appointment" onClose={() => setModal(null)} wide>
          <form onSubmit={save}>
            <Field label="Customer" required>
              <CustomerPicker customers={customers} value={modal.customerId} onChange={(id) => setModal({ ...modal, customerId: id })} />
            </Field>
            {!modal.customerId && (
              <div className="mb-3 grid grid-cols-2 gap-3 rounded-lg bg-[#FFF6F8] p-3">
                <Field label="New Customer Name"><TextInput value={modal.newCustomerName} onChange={e => setModal({ ...modal, newCustomerName: e.target.value })} /></Field>
                <Field label="New Customer Mobile"><TextInput value={modal.newCustomerMobile} onChange={e => setModal({ ...modal, newCustomerMobile: e.target.value })} /></Field>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required><TextInput type="date" value={modal.date} onChange={e => setModal({ ...modal, date: e.target.value })} required /></Field>
              <Field label="Time Slot" required>
                <Select value={modal.time} onChange={e => setModal({ ...modal, time: e.target.value })}>
                  {SLOTS.map(s => {
                    const taken = bookedSlotsFor(modal.staffId, modal.date).has(s);
                    return <option key={s} value={s}>{s}{taken ? " (busy)" : ""}</option>;
                  })}
                </Select>
              </Field>
            </div>
            <Field label="Staff (customer's choice)" required>
              <Select value={modal.staffId} onChange={e => setModal({ ...modal, staffId: e.target.value })} required>
                <option value="">Select staff</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>

            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-[#2B2320]/80">Services</span>
              <button type="button" onClick={addItemRow} className="text-xs font-medium text-[#D6336C]">+ Add another service</button>
            </div>
            <datalist id="service-suggestions">
              {services.map((s) => <option key={s.id} value={s.name} />)}
            </datalist>
            {modal.items.map((it, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <input
                  list="service-suggestions"
                  value={it.name}
                  onChange={(e) => updateItem(i, "name", e.target.value)}
                  placeholder="Type a service name…"
                  className={inputCls + " flex-1"}
                />
                <input
                  type="number" step="0.001" value={it.price}
                  onChange={(e) => updateItem(i, "price", e.target.value)}
                  placeholder="Price"
                  className={inputCls + " w-28"}
                />
                {modal.items.length > 1 && (
                  <button type="button" onClick={() => removeItemRow(i)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button>
                )}
              </div>
            ))}
            <div className="mb-3 text-right text-sm text-[#2B2320]/60">
              Total: <span className="font-semibold text-[#2B2320]">{fmtMoney(modal.items.reduce((s, it) => s + Number(it.price || 0), 0))}</span>
            </div>

            <Field label="Notes"><TextArea value={modal.notes} onChange={e => setModal({ ...modal, notes: e.target.value })} /></Field>
            <div className="mb-3 rounded-lg bg-[#4E7C59]/10 px-3 py-2 text-xs text-[#4E7C59]">
              A follow-up reminder email will be sent automatically for this appointment date, if email notifications are set up.
            </div>
            <Btn type="submit" className="w-full justify-center">Confirm Booking</Btn>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== */
/* SALES                                                                */
/* ================================================================== */

function CustomerPicker({ customers, value, onChange, onNewCustomer }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === value);

  useEffect(() => { if (selected) setQuery(""); }, [value]);

  const results = query.trim()
    ? customers.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || (c.mobile || "").includes(query)).slice(0, 8)
    : [];

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center justify-between rounded-lg border border-[#f5d3e0] bg-[#FFF6F8] px-3 py-2 text-sm">
          <span><span className="font-medium">{selected.name}</span> — {selected.mobile}</span>
          <button type="button" onClick={() => onChange("")} className="text-xs text-[#D6336C]">Change</button>
        </div>
      ) : (
        <>
          <TextInput
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search by name or mobile…"
          />
          {open && query.trim() && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-[#f5d3e0] bg-white shadow-lg">
              {results.length === 0 ? (
                <div className="p-3 text-sm text-[#2B2320]/50">No match — you can add them as a new customer below.</div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { onChange(c.id); setOpen(false); }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[#FFF6F8]"
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-[#2B2320]/50">{c.mobile}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SalesTab({ sales, setSales, customers, setCustomers, staff, services, custMap, staffMap, svcMap, currentUser }) {
  const [modal, setModal] = useState(null);
  const [filterMode, setFilterMode] = useState("All");
  const isAdmin = !currentUser || currentUser.role === "admin";

  function openAdd() {
    setModal({
      date: todayStr(), customerId: "", newCustomerName: "", newCustomerMobile: "",
      staffId: staff[0]?.id || "", description: services[0]?.name || "", amount: services[0]?.price || "",
      saleMode: "Cash",
    });
  }

  function save(e) {
    e.preventDefault();
    let customerId = modal.customerId;
    let updatedCustomers = customers;
    if (!customerId) {
      if (!modal.newCustomerName || !modal.newCustomerMobile) { alert("Search for an existing customer or enter a new customer's name & mobile."); return; }
      const nc = { id: uid(), name: modal.newCustomerName, mobile: modal.newCustomerMobile, tags: "", notes: "", createdAt: todayStr(), log: [] };
      updatedCustomers = [...customers, nc];
      setCustomers(updatedCustomers);
      customerId = nc.id;
    }
    if (!modal.amount) return;
    const amount = Number(modal.amount);
    const isCredit = modal.saleMode === "Credit";
    const invoiceNo = nextInvoiceNo(sales, modal.date);
    const payments = isCredit ? [] : [{ date: modal.date, amount, mode: modal.saleMode }];
    setSales([...sales, {
      id: uid(), invoiceNo, date: modal.date, customerId, staffId: modal.staffId,
      description: modal.description, amount, amountPaid: isCredit ? 0 : amount,
      payments, addedBy: currentUser?.name || "—",
    }]);
    setModal(null);
  }

  function del(id) { if (confirmDelete("Delete this sale record?")) setSales(sales.filter(s => s.id !== id)); }

  const filtered = filterMode === "All" ? sales : filterMode === "Credit" ? sales.filter(s => s.amountPaid < s.amount) : sales.filter(s => (s.payments || []).some(p => p.mode === filterMode));
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  const total = filtered.reduce((sum, s) => sum + Number(s.amount), 0);
  const byMode = PAYMENT_MODES.map(m => ({
    mode: m,
    total: sales.reduce((sum, s) => sum + (s.payments || []).filter(p => p.mode === m).reduce((ps, p) => ps + Number(p.amount), 0), 0),
  }));

  return (
    <div>
      <SectionHeader title="Sales & Payments" desc="Every service sold, who added it, and how it was paid" action={<Btn onClick={openAdd}><AppIcon name="add" size={16} /> Record Sale</Btn>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {byMode.map(b => <StatCard key={b.mode} label={b.mode} value={fmtMoney(b.total)} icon="wallet" tone="rose" />)}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {["All", ...SALE_MODES].map(m => (
          <button key={m} onClick={() => setFilterMode(m)} className={`rounded-full px-3 py-1 text-xs font-medium ${filterMode === m ? "bg-[#D6336C] text-white" : "bg-white text-[#2B2320]/60 border border-[#f5d3e0]"}`}>{m}</button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <Empty icon="wallet" text="No sales recorded yet." action={<Btn onClick={openAdd} className="mt-3"><AppIcon name="add" size={14} /> Record Sale</Btn>} />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr>
              <Th>Invoice #</Th><Th>Date</Th><Th>Customer</Th><Th>Service</Th><Th>Staff</Th><Th>Amount</Th><Th>Status</Th><Th>Added By</Th><Th></Th>
            </tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {sorted.map(s => {
                const balance = s.amount - (s.amountPaid || 0);
                const status = balance <= 0 ? "Paid" : (s.amountPaid || 0) > 0 ? "Partial" : "Credit";
                return (
                  <tr key={s.id} className="hover:bg-[#FFF6F8]">
                    <Td className="font-mono text-xs">{s.invoiceNo || "—"}</Td>
                    <Td>{fmtDate(s.date)}</Td>
                    <Td className="font-medium">{custMap[s.customerId]?.name || "—"}</Td>
                    <Td>{s.description}</Td>
                    <Td>{staffMap[s.staffId]?.name || "—"}</Td>
                    <Td>{fmtMoney(s.amount)}</Td>
                    <Td><Pill tone={status === "Paid" ? "green" : status === "Partial" ? "amber" : "red"}>{status}</Pill></Td>
                    <Td>{s.addedBy || "—"}</Td>
                    <Td>{isAdmin && <button onClick={() => del(s.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button>}</Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr className="border-t border-[#fbe8ef] font-semibold"><Td colSpan={5}>Total</Td><Td>{fmtMoney(total)}</Td><Td /><Td /><Td /></tr></tfoot>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Record Sale" onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <Field label="Date" required><TextInput type="date" value={modal.date} onChange={e => setModal({ ...modal, date: e.target.value })} required /></Field>
            <Field label="Customer" required>
              <CustomerPicker customers={customers} value={modal.customerId} onChange={(id) => setModal({ ...modal, customerId: id })} />
            </Field>
            {!modal.customerId && (
              <div className="mb-3 grid grid-cols-2 gap-3 rounded-lg bg-[#FFF6F8] p-3">
                <Field label="New Customer Name"><TextInput value={modal.newCustomerName} onChange={e => setModal({ ...modal, newCustomerName: e.target.value })} /></Field>
                <Field label="New Customer Mobile"><TextInput value={modal.newCustomerMobile} onChange={e => setModal({ ...modal, newCustomerMobile: e.target.value })} /></Field>
              </div>
            )}
            <Field label="Staff">
              <Select value={modal.staffId} onChange={e => setModal({ ...modal, staffId: e.target.value })}>
                <option value="">—</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Service / Description" required><TextInput value={modal.description} onChange={e => setModal({ ...modal, description: e.target.value })} required /></Field>
            <Field label="Amount (BHD)" required><TextInput type="number" step="0.001" value={modal.amount} onChange={e => setModal({ ...modal, amount: e.target.value })} required /></Field>
            <Field label="Payment Mode" required>
              <Select value={modal.saleMode} onChange={e => setModal({ ...modal, saleMode: e.target.value })}>
                {SALE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            {modal.saleMode === "Credit" && (
              <div className="mb-3 rounded-lg bg-[#C97B2E]/10 px-3 py-2 text-xs text-[#C97B2E]">
                This records the sale as unpaid. It'll show under Credit (Unpaid) — settle it there whenever the customer pays, in full or in installments.
              </div>
            )}
            <Btn type="submit" className="w-full justify-center">Save Sale</Btn>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== */
/* CREDIT                                                               */
/* ================================================================== */

function CreditTab({ sales, setSales, custMap, currentUser }) {
  const [payModal, setPayModal] = useState(null);
  const [historyId, setHistoryId] = useState(null);
  const unpaid = sales.filter(s => (s.amountPaid || 0) < s.amount).sort((a, b) => a.date.localeCompare(b.date));
  const total = unpaid.reduce((sum, s) => sum + (s.amount - (s.amountPaid || 0)), 0);

  function openPay(s) {
    setPayModal({ saleId: s.id, date: todayStr(), amount: (s.amount - (s.amountPaid || 0)).toFixed(3), mode: "Cash" });
  }

  function savePayment(e) {
    e.preventDefault();
    const amt = Number(payModal.amount);
    if (!amt || amt <= 0) return;
    setSales(sales.map((s) => {
      if (s.id !== payModal.saleId) return s;
      const payments = [...(s.payments || []), { date: payModal.date, amount: amt, mode: payModal.mode, recordedBy: currentUser?.name }];
      const amountPaid = Math.min(s.amount, (s.amountPaid || 0) + amt);
      return { ...s, payments, amountPaid };
    }));
    setPayModal(null);
  }

  const historySale = historyId ? sales.find((s) => s.id === historyId) : null;

  return (
    <div>
      <SectionHeader title="Credit (Unpaid) Record" desc={`Outstanding: ${fmtMoney(total)} across ${unpaid.length} invoice(s)`} />
      {unpaid.length === 0 ? (
        <Empty icon="credit" text="No outstanding credit. Everyone's paid up!" />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Invoice #</Th><Th>Date</Th><Th>Customer</Th><Th>Mobile</Th><Th>Total</Th><Th>Paid</Th><Th>Balance</Th><Th>Status</Th><Th>Days</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {unpaid.map(s => {
                const paid = s.amountPaid || 0;
                const balance = s.amount - paid;
                const status = paid > 0 ? "Partial" : "Unpaid";
                return (
                  <tr key={s.id} className="hover:bg-[#FFF6F8]">
                    <Td className="font-mono text-xs">{s.invoiceNo || "—"}</Td>
                    <Td>{fmtDate(s.date)}</Td>
                    <Td className="font-medium">{custMap[s.customerId]?.name}</Td>
                    <Td>{custMap[s.customerId]?.mobile}</Td>
                    <Td>{fmtMoney(s.amount)}</Td>
                    <Td>{fmtMoney(paid)}</Td>
                    <Td className="font-semibold">{fmtMoney(balance)}</Td>
                    <Td><Pill tone={status === "Partial" ? "amber" : "red"}>{status}</Pill></Td>
                    <Td><Pill tone={daysBetween(s.date, todayStr()) > 14 ? "red" : "amber"}>{daysBetween(s.date, todayStr())}d</Pill></Td>
                    <Td>
                      <div className="flex gap-1">
                        <Btn size="sm" onClick={() => openPay(s)}>Record Payment</Btn>
                        {(s.payments || []).length > 0 && (
                          <button onClick={() => setHistoryId(s.id)} className="rounded p-1.5 text-[#2B2320]/50 hover:bg-black/5" title="Payment history"><AppIcon name="clock" size={14} /></button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {payModal && (
        <Modal title="Record Payment" onClose={() => setPayModal(null)}>
          <form onSubmit={savePayment}>
            <Field label="Date" required><TextInput type="date" value={payModal.date} onChange={e => setPayModal({ ...payModal, date: e.target.value })} required /></Field>
            <Field label="Amount Received (BHD)" required><TextInput type="number" step="0.001" value={payModal.amount} onChange={e => setPayModal({ ...payModal, amount: e.target.value })} required /></Field>
            <p className="mb-3 text-xs text-[#2B2320]/50">You can enter less than the full balance to record a partial / installment payment — the remaining balance stays on Credit.</p>
            <Field label="Payment Mode" required>
              <Select value={payModal.mode} onChange={e => setPayModal({ ...payModal, mode: e.target.value })}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
            </Field>
            <Btn type="submit" className="w-full justify-center">Save Payment</Btn>
          </form>
        </Modal>
      )}

      {historySale && (
        <Modal title={`Payment History — ${historySale.invoiceNo || ""}`} onClose={() => setHistoryId(null)}>
          <div className="mb-3 text-sm text-[#2B2320]/60">
            {custMap[historySale.customerId]?.name} · Total {fmtMoney(historySale.amount)} · Paid {fmtMoney(historySale.amountPaid || 0)}
          </div>
          <div className="space-y-2">
            {(historySale.payments || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-[#FFF6F8] px-3 py-2 text-sm">
                <span>{fmtDate(p.date)} — {p.mode}{p.recordedBy ? ` (by ${p.recordedBy})` : ""}</span>
                <span className="font-medium">{fmtMoney(p.amount)}</span>
              </div>
            ))}
            {(historySale.payments || []).length === 0 && <p className="text-sm text-[#2B2320]/40">No payments recorded yet.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== */
/* EXPENSES                                                             */
/* ================================================================== */

function ExpensesTab({ expenses, setExpenses, staff }) {
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState("All");

  function openAdd() { setModal({ date: todayStr(), category: EXPENSE_CATEGORIES[0], amount: "", notes: "", staffId: "", basicSalary: "", houseAllowance: "", transportAllowance: "" }); }

  function applyStaffDefaults(modalState, staffId) {
    const s = staff.find((x) => x.id === staffId);
    if (!s) return { ...modalState, staffId };
    return { ...modalState, staffId, basicSalary: s.basicSalary || 0, houseAllowance: s.houseAllowance || 0, transportAllowance: s.transportAllowance || 0 };
  }

  function save(e) {
    e.preventDefault();
    const isSalary = modal.category === "Staff Salary";
    const amount = isSalary
      ? Number(modal.basicSalary || 0) + Number(modal.houseAllowance || 0) + Number(modal.transportAllowance || 0)
      : Number(modal.amount || 0);
    if (!amount) return;
    const record = { id: uid(), date: modal.date, category: modal.category, amount, notes: modal.notes };
    if (isSalary) {
      record.staffId = modal.staffId;
      record.basicSalary = Number(modal.basicSalary || 0);
      record.houseAllowance = Number(modal.houseAllowance || 0);
      record.transportAllowance = Number(modal.transportAllowance || 0);
    }
    setExpenses([...expenses, record]);
    setModal(null);
  }
  function del(id) { if (confirmDelete("Delete this expense?")) setExpenses(expenses.filter(x => x.id !== id)); }

  const staffMap = Object.fromEntries((staff || []).map((s) => [s.id, s]));
  const filtered = filter === "All" ? expenses : filter === "Government & Bills" ? expenses.filter(e => GOV_CATEGORIES.includes(e.category) || e.category === "Shop Rent" || e.category === "Electricity Bill") : expenses.filter(e => e.category === filter);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  const total = sorted.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div>
      <SectionHeader title="Expenses & Bills" desc="Rent, electricity, government fees, salaries, snacks & more" action={<Btn onClick={openAdd}><AppIcon name="add" size={16} /> Add Expense</Btn>} />

      <div className="mb-3 flex flex-wrap gap-2">
        {["All", "Government & Bills", ...EXPENSE_CATEGORIES].map(c => (
          <button key={c} onClick={() => setFilter(c)} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === c ? "bg-[#D6336C] text-white" : "bg-white text-[#2B2320]/60 border border-[#f5d3e0]"}`}>{c}</button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <Empty icon="receipt" text="No expenses recorded for this filter." action={<Btn onClick={openAdd} className="mt-3"><AppIcon name="add" size={14} /> Add Expense</Btn>} />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Date</Th><Th>Category</Th><Th>Details</Th><Th>Amount</Th><Th>Notes</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {sorted.map(e => (
                <tr key={e.id} className="hover:bg-[#FFF6F8]">
                  <Td>{fmtDate(e.date)}</Td>
                  <Td><Pill tone={GOV_CATEGORIES.includes(e.category) ? "amber" : "gray"}>{e.category}</Pill></Td>
                  <Td className="text-xs text-[#2B2320]/60">
                    {e.category === "Staff Salary" && e.staffId
                      ? `${staffMap[e.staffId]?.name || "—"} · Basic ${fmtMoney(e.basicSalary)} + House ${fmtMoney(e.houseAllowance)} + Transport ${fmtMoney(e.transportAllowance)}`
                      : "—"}
                  </Td>
                  <Td>{fmtMoney(e.amount)}</Td>
                  <Td className="max-w-xs truncate">{e.notes}</Td>
                  <Td><button onClick={() => del(e.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button></Td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-[#fbe8ef] font-semibold"><Td>Total</Td><Td /><Td /><Td>{fmtMoney(total)}</Td><Td /><Td /></tr></tfoot>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Add Expense" onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <Field label="Date" required><TextInput type="date" value={modal.date} onChange={e => setModal({ ...modal, date: e.target.value })} required /></Field>
            <Field label="Category" required>
              <Select value={modal.category} onChange={e => setModal({ ...modal, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>

            {modal.category === "Staff Salary" ? (
              <>
                <Field label="Staff Member" required>
                  <Select value={modal.staffId} onChange={e => setModal(applyStaffDefaults(modal, e.target.value))} required>
                    <option value="">Select staff</option>
                    {(staff || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Basic Salary (BHD)" required><TextInput type="number" step="0.001" value={modal.basicSalary} onChange={e => setModal({ ...modal, basicSalary: e.target.value })} required /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="House Allowance (BHD)"><TextInput type="number" step="0.001" value={modal.houseAllowance} onChange={e => setModal({ ...modal, houseAllowance: e.target.value })} /></Field>
                  <Field label="Transport Allowance (BHD)"><TextInput type="number" step="0.001" value={modal.transportAllowance} onChange={e => setModal({ ...modal, transportAllowance: e.target.value })} /></Field>
                </div>
                <div className="mb-3 rounded-lg bg-[#FFF6F8] p-3 text-sm">
                  Total: <span className="cbl-heading text-base text-[#D6336C]">{fmtMoney(Number(modal.basicSalary || 0) + Number(modal.houseAllowance || 0) + Number(modal.transportAllowance || 0))}</span>
                </div>
              </>
            ) : (
              <Field label="Amount (BHD)" required><TextInput type="number" step="0.001" value={modal.amount} onChange={e => setModal({ ...modal, amount: e.target.value })} required /></Field>
            )}

            <Field label="Notes"><TextArea value={modal.notes} onChange={e => setModal({ ...modal, notes: e.target.value })} /></Field>
            <Btn type="submit" className="w-full justify-center">Save Expense</Btn>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== */
/* SUPPLIERS                                                            */
/* ================================================================== */

function SuppliersTab({ suppliers, setSuppliers, purchases, supplierPayments, setTab }) {
  const [modal, setModal] = useState(null);
  function openAdd() { setModal({ name: "", phone: "", address: "" }); }
  function save(e) {
    e.preventDefault();
    if (!modal.name) return;
    if (modal.id) setSuppliers(suppliers.map(s => s.id === modal.id ? modal : s));
    else setSuppliers([...suppliers, { ...modal, id: uid() }]);
    setModal(null);
  }
  function del(id) { if (confirmDelete("Delete this supplier?")) setSuppliers(suppliers.filter(s => s.id !== id)); }

  function balanceFor(id) {
    const bought = purchases.filter(p => p.supplierId === id).reduce((s, p) => s + Number(p.amount), 0);
    const paid = supplierPayments.filter(p => p.supplierId === id).reduce((s, p) => s + Number(p.amount), 0);
    return bought - paid;
  }

  return (
    <div>
      <SectionHeader title="Suppliers" desc="Add suppliers here first, before recording purchases" action={<Btn onClick={openAdd}><AppIcon name="add" size={16} /> Add Supplier</Btn>} />
      {suppliers.length === 0 ? (
        <Empty icon="truck" text="No suppliers added yet. Add a supplier before recording product purchases." action={<Btn onClick={openAdd} className="mt-3"><AppIcon name="add" size={14} /> Add Supplier</Btn>} />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Name</Th><Th>Phone</Th><Th>Address</Th><Th>Balance Owed</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {suppliers.map(s => (
                <tr key={s.id} className="hover:bg-[#FFF6F8]">
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{s.phone}</Td>
                  <Td>{s.address}</Td>
                  <Td><Pill tone={balanceFor(s.id) > 0 ? "amber" : "green"}>{fmtMoney(balanceFor(s.id))}</Pill></Td>
                  <Td>
                    <div className="flex gap-1">
                      <button onClick={() => setModal(s)} className="rounded p-1.5 text-[#2B2320]/50 hover:bg-black/5"><AppIcon name="edit" size={14} /></button>
                      <button onClick={() => del(s.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4"><Btn variant="outline" onClick={() => setTab("purchases")}>Go to Product Purchases <AppIcon name="chevron" size={14} /></Btn></div>

      {modal && (
        <Modal title={modal.id ? "Edit Supplier" : "Add Supplier"} onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <Field label="Supplier Name" required><TextInput value={modal.name} onChange={e => setModal({ ...modal, name: e.target.value })} required /></Field>
            <Field label="Phone"><TextInput value={modal.phone} onChange={e => setModal({ ...modal, phone: e.target.value })} /></Field>
            <Field label="Address"><TextArea value={modal.address} onChange={e => setModal({ ...modal, address: e.target.value })} /></Field>
            <Btn type="submit" className="w-full justify-center">Save Supplier</Btn>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== */
/* PURCHASES (products from suppliers) + SUPPLIER PAYMENTS             */
/* ================================================================== */

function PurchasesTab({ purchases, setPurchases, suppliers, suppMap, supplierPayments, setSupplierPayments }) {
  const [modal, setModal] = useState(null);
  const [payModal, setPayModal] = useState(null);

  function openAdd() {
    if (suppliers.length === 0) { alert("Add a supplier first in the Suppliers tab."); return; }
    setModal({ supplierId: suppliers[0].id, invoiceNumber: "", invoiceDate: todayStr(), inputDate: todayStr(), amount: "", items: "" });
  }
  function save(e) {
    e.preventDefault();
    if (!modal.amount || !modal.invoiceNumber) return;
    setPurchases([...purchases, { ...modal, id: uid(), date: modal.invoiceDate, amount: Number(modal.amount) }]);
    setModal(null);
  }
  function del(id) { if (confirmDelete("Delete this purchase record?")) setPurchases(purchases.filter(p => p.id !== id)); }

  function openPay() {
    if (suppliers.length === 0) { alert("Add a supplier first."); return; }
    setPayModal({ supplierId: suppliers[0].id, date: todayStr(), amount: "", ref: "" });
  }
  function savePay(e) {
    e.preventDefault();
    if (!payModal.amount) return;
    setSupplierPayments([...supplierPayments, { ...payModal, id: uid(), amount: Number(payModal.amount) }]);
    setPayModal(null);
  }
  function delPay(id) { if (confirmDelete("Delete this payment record?")) setSupplierPayments(supplierPayments.filter(p => p.id !== id)); }

  const sortedPurchases = [...purchases].sort((a, b) => b.date.localeCompare(a.date));
  const sortedPayments = [...supplierPayments].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <SectionHeader title="Product Purchases" desc="What you bought from each supplier, and what you've paid them" action={
        <div className="flex gap-2"><Btn variant="outline" onClick={openPay}><AppIcon name="cash" size={16} /> Record Payment</Btn><Btn onClick={openAdd}><AppIcon name="add" size={16} /> Add Purchase</Btn></div>
      } />

      <h3 className="cbl-heading mb-2 text-base text-[#2B2320]">Purchases</h3>
      {sortedPurchases.length === 0 ? (
        <Empty icon="package" text="No product purchases recorded yet." />
      ) : (
        <div className="cbl-card mb-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Invoice Date</Th><Th>Entered On</Th><Th>Supplier</Th><Th>Invoice #</Th><Th>Amount</Th><Th>Items</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {sortedPurchases.map(p => (
                <tr key={p.id} className="hover:bg-[#FFF6F8]">
                  <Td>{fmtDate(p.invoiceDate || p.date)}</Td>
                  <Td>{fmtDate(p.inputDate || p.date)}</Td>
                  <Td className="font-medium">{suppMap[p.supplierId]?.name || "—"}</Td>
                  <Td>{p.invoiceNumber}</Td>
                  <Td>{fmtMoney(p.amount)}</Td>
                  <Td className="max-w-xs truncate">{p.items}</Td>
                  <Td><button onClick={() => del(p.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="cbl-heading mb-2 text-base text-[#2B2320]">Supplier Payments</h3>
      {sortedPayments.length === 0 ? (
        <Empty icon="cash" text="No payments to suppliers recorded yet." />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Date</Th><Th>Supplier</Th><Th>Amount</Th><Th>Reference</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {sortedPayments.map(p => (
                <tr key={p.id} className="hover:bg-[#FFF6F8]">
                  <Td>{fmtDate(p.date)}</Td>
                  <Td className="font-medium">{suppMap[p.supplierId]?.name || "—"}</Td>
                  <Td>{fmtMoney(p.amount)}</Td>
                  <Td>{p.ref}</Td>
                  <Td><button onClick={() => delPay(p.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Add Purchase" onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <Field label="Supplier" required>
              <Select value={modal.supplierId} onChange={e => setModal({ ...modal, supplierId: e.target.value })}>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Invoice Number" required><TextInput value={modal.invoiceNumber} onChange={e => setModal({ ...modal, invoiceNumber: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice Date" required><TextInput type="date" value={modal.invoiceDate} onChange={e => setModal({ ...modal, invoiceDate: e.target.value })} required /></Field>
              <Field label="Input Date (entered today)" required><TextInput type="date" value={modal.inputDate} onChange={e => setModal({ ...modal, inputDate: e.target.value })} required /></Field>
            </div>
            <Field label="Amount (BHD)" required><TextInput type="number" step="0.001" value={modal.amount} onChange={e => setModal({ ...modal, amount: e.target.value })} required /></Field>
            <Field label="Items / Notes"><TextArea value={modal.items} onChange={e => setModal({ ...modal, items: e.target.value })} /></Field>
            <Btn type="submit" className="w-full justify-center">Save Purchase</Btn>
          </form>
        </Modal>
      )}

      {payModal && (
        <Modal title="Record Supplier Payment" onClose={() => setPayModal(null)}>
          <form onSubmit={savePay}>
            <Field label="Supplier" required>
              <Select value={payModal.supplierId} onChange={e => setPayModal({ ...payModal, supplierId: e.target.value })}>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Date" required><TextInput type="date" value={payModal.date} onChange={e => setPayModal({ ...payModal, date: e.target.value })} required /></Field>
            <Field label="Amount (BHD)" required><TextInput type="number" step="0.001" value={payModal.amount} onChange={e => setPayModal({ ...payModal, amount: e.target.value })} required /></Field>
            <Field label="Reference / Invoice #"><TextInput value={payModal.ref} onChange={e => setPayModal({ ...payModal, ref: e.target.value })} /></Field>
            <Btn type="submit" className="w-full justify-center">Save Payment</Btn>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== */
/* STAFF & SALARY SLIPS                                                */
/* ================================================================== */

function StaffTab({ staff, setStaff, salarySlips, setSalarySlips }) {
  const [modal, setModal] = useState(null);
  const [slipModal, setSlipModal] = useState(null);
  const [printSlip, setPrintSlip] = useState(null);

  function grossOf(s) { return Number(s.basicSalary || 0) + Number(s.houseAllowance || 0) + Number(s.transportAllowance || 0); }

  function openAdd() { setModal({ name: "", role: "", mobile: "", basicSalary: "", houseAllowance: "", transportAllowance: "" }); }
  function save(e) {
    e.preventDefault();
    if (!modal.name) return;
    const clean = {
      ...modal,
      basicSalary: Number(modal.basicSalary || 0),
      houseAllowance: Number(modal.houseAllowance || 0),
      transportAllowance: Number(modal.transportAllowance || 0),
    };
    if (modal.id) setStaff(staff.map(s => s.id === modal.id ? clean : s));
    else setStaff([...staff, { ...clean, id: uid() }]);
    setModal(null);
  }
  function del(id) { if (confirmDelete("Delete this staff member?")) setStaff(staff.filter(s => s.id !== id)); }

  function openSlip(s) {
    const now = new Date();
    setSlipModal({
      staffId: s.id, month: now.getMonth(), year: now.getFullYear(),
      basicSalary: s.basicSalary || 0, houseAllowance: s.houseAllowance || 0, transportAllowance: s.transportAllowance || 0,
      bonus: 0, deductions: 0,
    });
  }
  function saveSlip(e) {
    e.preventDefault();
    const gross = Number(slipModal.basicSalary || 0) + Number(slipModal.houseAllowance || 0) + Number(slipModal.transportAllowance || 0);
    const net = gross + Number(slipModal.bonus || 0) - Number(slipModal.deductions || 0);
    setSalarySlips([...salarySlips, {
      id: uid(), ...slipModal,
      basicSalary: Number(slipModal.basicSalary || 0), houseAllowance: Number(slipModal.houseAllowance || 0),
      transportAllowance: Number(slipModal.transportAllowance || 0), bonus: Number(slipModal.bonus || 0),
      deductions: Number(slipModal.deductions || 0), netPay: net, generatedDate: todayStr(),
    }]);
    setSlipModal(null);
  }
  function delSlip(id) { if (confirmDelete("Delete this salary slip?")) setSalarySlips(salarySlips.filter(s => s.id !== id)); }

  const staffMap = Object.fromEntries(staff.map(s => [s.id, s]));
  const sortedSlips = [...salarySlips].sort((a, b) => (b.year - a.year) || (b.month - a.month));

  return (
    <div>
      <SectionHeader title="Staff & Salary" desc="Team members and monthly salary slips" action={<Btn onClick={openAdd}><AppIcon name="add" size={16} /> Add Staff</Btn>} />

      {staff.length === 0 ? (
        <Empty icon="staff" text="No staff added yet." action={<Btn onClick={openAdd} className="mt-3"><AppIcon name="add" size={14} /> Add Staff</Btn>} />
      ) : (
        <div className="cbl-card mb-6 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Name</Th><Th>Role</Th><Th>Mobile</Th><Th>Basic</Th><Th>House Allow.</Th><Th>Transport Allow.</Th><Th>Total</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {staff.map(s => (
                <tr key={s.id} className="hover:bg-[#FFF6F8]">
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{s.role}</Td>
                  <Td>{s.mobile}</Td>
                  <Td>{fmtMoney(s.basicSalary)}</Td>
                  <Td>{fmtMoney(s.houseAllowance)}</Td>
                  <Td>{fmtMoney(s.transportAllowance)}</Td>
                  <Td className="font-semibold">{fmtMoney(grossOf(s))}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <Btn size="sm" variant="outline" onClick={() => openSlip(s)}>Generate Slip</Btn>
                      <button onClick={() => setModal(s)} className="rounded p-1.5 text-[#2B2320]/50 hover:bg-black/5"><AppIcon name="edit" size={14} /></button>
                      <button onClick={() => del(s.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="cbl-heading mb-2 text-base text-[#2B2320]">Salary Slips</h3>
      {sortedSlips.length === 0 ? (
        <Empty icon="file" text="No salary slips generated yet." />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Staff</Th><Th>Month</Th><Th>Gross</Th><Th>Bonus</Th><Th>Deductions</Th><Th>Net Pay</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {sortedSlips.map(s => (
                <tr key={s.id} className="hover:bg-[#FFF6F8]">
                  <Td className="font-medium">{staffMap[s.staffId]?.name || "—"}</Td>
                  <Td>{monthLabel(s.month, s.year)}</Td>
                  <Td>{fmtMoney(Number(s.basicSalary || 0) + Number(s.houseAllowance || 0) + Number(s.transportAllowance || 0))}</Td>
                  <Td>{fmtMoney(s.bonus)}</Td>
                  <Td>{fmtMoney(s.deductions)}</Td>
                  <Td className="font-semibold">{fmtMoney(s.netPay)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <button onClick={() => setPrintSlip(s)} className="rounded p-1.5 text-[#D6336C] hover:bg-[#D6336C]/10"><AppIcon name="printer" size={14} /></button>
                      <button onClick={() => delSlip(s.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal.id ? "Edit Staff" : "Add Staff"} onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <Field label="Name" required><TextInput value={modal.name} onChange={e => setModal({ ...modal, name: e.target.value })} required /></Field>
            <Field label="Role"><TextInput value={modal.role} onChange={e => setModal({ ...modal, role: e.target.value })} placeholder="e.g. Hair Stylist" /></Field>
            <Field label="Mobile"><TextInput value={modal.mobile} onChange={e => setModal({ ...modal, mobile: e.target.value })} /></Field>
            <Field label="Basic Salary (BHD)" required><TextInput type="number" step="0.001" value={modal.basicSalary} onChange={e => setModal({ ...modal, basicSalary: e.target.value })} required /></Field>
            <Field label="House Allowance (BHD)"><TextInput type="number" step="0.001" value={modal.houseAllowance} onChange={e => setModal({ ...modal, houseAllowance: e.target.value })} /></Field>
            <Field label="Transport Allowance (BHD)"><TextInput type="number" step="0.001" value={modal.transportAllowance} onChange={e => setModal({ ...modal, transportAllowance: e.target.value })} /></Field>
            <div className="mb-3 rounded-lg bg-[#FFF6F8] p-3 text-sm">
              Total: <span className="cbl-heading text-base text-[#D6336C]">{fmtMoney(Number(modal.basicSalary || 0) + Number(modal.houseAllowance || 0) + Number(modal.transportAllowance || 0))}</span>
            </div>
            <Btn type="submit" className="w-full justify-center">Save Staff</Btn>
          </form>
        </Modal>
      )}

      {slipModal && (
        <Modal title="Generate Salary Slip" onClose={() => setSlipModal(null)}>
          <form onSubmit={saveSlip}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Month" required>
                <Select value={slipModal.month} onChange={e => setSlipModal({ ...slipModal, month: Number(e.target.value) })}>
                  {Array.from({ length: 12 }).map((_, i) => <option key={i} value={i}>{new Date(2000, i, 1).toLocaleDateString("en-GB", { month: "long" })}</option>)}
                </Select>
              </Field>
              <Field label="Year" required><TextInput type="number" value={slipModal.year} onChange={e => setSlipModal({ ...slipModal, year: Number(e.target.value) })} required /></Field>
            </div>
            <Field label="Basic Salary (BHD)" required><TextInput type="number" step="0.001" value={slipModal.basicSalary} onChange={e => setSlipModal({ ...slipModal, basicSalary: e.target.value })} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="House Allowance (BHD)"><TextInput type="number" step="0.001" value={slipModal.houseAllowance} onChange={e => setSlipModal({ ...slipModal, houseAllowance: e.target.value })} /></Field>
              <Field label="Transport Allowance (BHD)"><TextInput type="number" step="0.001" value={slipModal.transportAllowance} onChange={e => setSlipModal({ ...slipModal, transportAllowance: e.target.value })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bonus (BHD)"><TextInput type="number" step="0.001" value={slipModal.bonus} onChange={e => setSlipModal({ ...slipModal, bonus: e.target.value })} /></Field>
              <Field label="Deductions (BHD)"><TextInput type="number" step="0.001" value={slipModal.deductions} onChange={e => setSlipModal({ ...slipModal, deductions: e.target.value })} /></Field>
            </div>
            <div className="mb-3 rounded-lg bg-[#FFF6F8] p-3 text-sm">
              Net Pay: <span className="cbl-heading text-base text-[#D6336C]">
                {fmtMoney(Number(slipModal.basicSalary || 0) + Number(slipModal.houseAllowance || 0) + Number(slipModal.transportAllowance || 0) + Number(slipModal.bonus || 0) - Number(slipModal.deductions || 0))}
              </span>
            </div>
            <Btn type="submit" className="w-full justify-center">Save Slip</Btn>
          </form>
        </Modal>
      )}

      {printSlip && <SalarySlipPrint slip={printSlip} staffName={staffMap[printSlip.staffId]?.name} onClose={() => setPrintSlip(null)} />}
    </div>
  );
}

function SalarySlipPrint({ slip, staffName, onClose }) {
  const gross = Number(slip.basicSalary || 0) + Number(slip.houseAllowance || 0) + Number(slip.transportAllowance || 0);
  return (
    <Modal title="Salary Slip" onClose={onClose} wide>
      <div id="salary-slip-print" className="rounded-xl border border-[#f5d3e0] p-6">
        <div className="mb-4 text-center">
          <img src="./assets/logo-dark-text.png" alt="Cherrys Beauty Lounge" className="mx-auto mb-2 h-9 w-auto object-contain" />
          <div className="text-xs text-[#2B2320]/50">Salary Slip — {monthLabel(slip.month, slip.year)}</div>
        </div>
        <div className="mb-4 flex justify-between text-sm"><span>Employee</span><span className="font-medium">{staffName}</span></div>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-[#fbe8ef]"><td className="py-2">Basic Salary</td><td className="py-2 text-right">{fmtMoney(slip.basicSalary)}</td></tr>
            <tr className="border-b border-[#fbe8ef]"><td className="py-2">House Allowance</td><td className="py-2 text-right">{fmtMoney(slip.houseAllowance)}</td></tr>
            <tr className="border-b border-[#fbe8ef]"><td className="py-2">Transport Allowance</td><td className="py-2 text-right">{fmtMoney(slip.transportAllowance)}</td></tr>
            <tr className="border-b border-[#fbe8ef] font-medium"><td className="py-2">Gross Salary</td><td className="py-2 text-right">{fmtMoney(gross)}</td></tr>
            <tr className="border-b border-[#fbe8ef]"><td className="py-2">Bonus</td><td className="py-2 text-right">{fmtMoney(slip.bonus)}</td></tr>
            <tr className="border-b border-[#fbe8ef]"><td className="py-2">Deductions</td><td className="py-2 text-right">-{fmtMoney(slip.deductions)}</td></tr>
            <tr className="font-semibold"><td className="py-2">Net Pay</td><td className="py-2 text-right">{fmtMoney(slip.netPay)}</td></tr>
          </tbody>
        </table>
        <div className="mt-6 text-center text-xs text-[#2B2320]/40">Generated on {fmtDate(slip.generatedDate)}</div>
      </div>
      <Btn className="mt-4 w-full justify-center" onClick={() => window.print()}><AppIcon name="printer" size={16} /> Print Slip</Btn>
    </Modal>
  );
}

/* ================================================================== */
/* LOANS                                                                */
/* ================================================================== */

function LoansTab({ loans, setLoans }) {
  const [modal, setModal] = useState(null);
  function openAdd() { setModal({ direction: "to", date: todayStr(), amount: "", notes: "" }); }
  function save(e) {
    e.preventDefault();
    if (!modal.amount) return;
    setLoans([...loans, { ...modal, id: uid(), amount: Number(modal.amount) }]);
    setModal(null);
  }
  function del(id) { if (confirmDelete("Delete this loan record?")) setLoans(loans.filter(l => l.id !== id)); }

  const toSadaque = loans.filter(l => l.direction === "to").reduce((s, l) => s + l.amount, 0);
  const fromSadaque = loans.filter(l => l.direction === "from").reduce((s, l) => s + l.amount, 0);
  const sorted = [...loans].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <SectionHeader title="Loans with Sadaque" desc="Track money given to or received from Sadaque for the business" action={<Btn onClick={openAdd}><AppIcon name="add" size={16} /> Add Loan Entry</Btn>} />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Paid to Sadaque" value={fmtMoney(toSadaque)} icon="handcoins" tone="rose" />
        <StatCard label="Received from Sadaque" value={fmtMoney(fromSadaque)} icon="handcoins" tone="green" />
        <StatCard label="Net Balance" value={fmtMoney(fromSadaque - toSadaque)} icon="cash" tone={fromSadaque - toSadaque >= 0 ? "green" : "amber"} sub={fromSadaque - toSadaque >= 0 ? "Owed to business" : "Business owes Sadaque"} />
      </div>

      {sorted.length === 0 ? (
        <Empty icon="handcoins" text="No loan records yet." />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th>Date</Th><Th>Direction</Th><Th>Amount</Th><Th>Notes</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {sorted.map(l => (
                <tr key={l.id} className="hover:bg-[#FFF6F8]">
                  <Td>{fmtDate(l.date)}</Td>
                  <Td><Pill tone={l.direction === "to" ? "rose" : "green"}>{l.direction === "to" ? "Loan to Sadaque" : "Loan from Sadaque"}</Pill></Td>
                  <Td>{fmtMoney(l.amount)}</Td>
                  <Td className="max-w-xs truncate">{l.notes}</Td>
                  <Td><button onClick={() => del(l.id)} className="rounded p-1.5 text-[#B23A3A] hover:bg-[#B23A3A]/10"><AppIcon name="delete" size={14} /></button></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title="Add Loan Entry" onClose={() => setModal(null)}>
          <form onSubmit={save}>
            <Field label="Direction" required>
              <Select value={modal.direction} onChange={e => setModal({ ...modal, direction: e.target.value })}>
                <option value="to">Loan Payment to Sadaque</option>
                <option value="from">Loan Received from Sadaque</option>
              </Select>
            </Field>
            <Field label="Date" required><TextInput type="date" value={modal.date} onChange={e => setModal({ ...modal, date: e.target.value })} required /></Field>
            <Field label="Amount (BHD)" required><TextInput type="number" step="0.001" value={modal.amount} onChange={e => setModal({ ...modal, amount: e.target.value })} required /></Field>
            <Field label="Notes"><TextArea value={modal.notes} onChange={e => setModal({ ...modal, notes: e.target.value })} /></Field>
            <Btn type="submit" className="w-full justify-center">Save Entry</Btn>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ================================================================== */
/* STAFF PERMISSIONS                                                    */
/* ================================================================== */

function PermissionsTab({ permissions, setPermissions }) {
  const staffAccounts = STAFF_USERS.filter((u) => u.role === "staff");

  function getPerm(username) {
    return permissions.find((p) => p.username === username) || { username, customers: false, appointments: false, whatsapp: false, reports: false, expenses: false };
  }

  function toggle(username, key) {
    const current = getPerm(username);
    const updated = { ...current, [key]: !current[key] };
    const exists = permissions.some((p) => p.username === username);
    if (exists) setPermissions(permissions.map((p) => (p.username === username ? updated : p)));
    else setPermissions([...permissions, { ...updated, id: uid() }]);
  }

  return (
    <div>
      <SectionHeader
        title="Staff Permissions"
        desc="Sales & Payments is always available to staff. Choose which other sections each person can also open."
      />
      {staffAccounts.length === 0 ? (
        <Empty icon="staff" text="No staff accounts found. Add them in config.js under STAFF_USERS first." />
      ) : (
        <div className="space-y-4">
          {staffAccounts.map((u) => {
            const perm = getPerm(u.username);
            return (
              <div key={u.username} className="cbl-card rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-[#2B2320]">{u.name}</div>
                    <div className="text-xs text-[#2B2320]/45">@{u.username}</div>
                  </div>
                  <Pill tone="rose">Sales & Payments — always on</Pill>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {GRANTABLE_TABS.map((t) => (
                    <label key={t.key} className="flex cursor-pointer items-center gap-2 text-sm text-[#2B2320]/80">
                      <input
                        type="checkbox"
                        checked={!!perm[t.key]}
                        onChange={() => toggle(u.username, t.key)}
                        className="h-4 w-4 accent-[#D6336C]"
                      />
                      <AppIcon name={t.icon} size={14} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-4 rounded-lg bg-[#C9A15A]/10 px-3 py-2 text-xs text-[#8a6a2f]">
        Changes apply the next time that staff member opens or reloads the app.
      </div>
    </div>
  );
}

/* ================================================================== */
/* REPORTS                                                              */
/* ================================================================== */

function ReportsTab({ sales, expenses, custMap, suppliers, suppMap, purchases, supplierPayments, staff, salarySlips }) {
  const now = new Date();
  const [type, setType] = useState("dailyInvoice");
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [day, setDay] = useState(todayStr());
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const reportRows = useMemo(() => {
    if (type === "dailyInvoice") return sales.filter(s => s.date === day);
    if (type === "sales") return sales.filter(s => s.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
    if (type === "expenses") return expenses.filter(e => e.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
    if (type === "credit") return sales.filter(s => (s.amountPaid || 0) < s.amount);
    if (type === "supplierPayments") return supplierPayments.filter(p => p.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
    return [];
  }, [type, prefix, day, sales, expenses, supplierPayments]);

  const total = reportRows.reduce((s, r) => s + Number(r.amount), 0);
  const titles = {
    dailyInvoice: "Daily Sales Report", sales: "Monthly Sales Report", expenses: "Monthly Expense Report",
    credit: "Credit (Non-Paid) Report", supplierPayments: "Supplier Payments Report",
  };

  const modeTotals = type === "dailyInvoice"
    ? PAYMENT_MODES.reduce((acc, m) => {
        acc[m] = reportRows.reduce((sum, s) => sum + (s.payments || []).filter(p => p.mode === m && p.date === day).reduce((ps, p) => ps + Number(p.amount), 0), 0);
        return acc;
      }, {})
    : {};

  return (
    <div>
      <SectionHeader title="Reports" desc="Generate and print business reports, including your daily sales invoice" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={e => setType(e.target.value)} className="w-auto">
          <option value="dailyInvoice">Daily Sales Report (invoice style)</option>
          <option value="sales">Monthly Sales Report</option>
          <option value="expenses">Monthly Expense Report</option>
          <option value="credit">Credit (Non-Paid) Report</option>
          <option value="supplierPayments">Supplier Payments Report</option>
        </Select>
        {type === "dailyInvoice" && <TextInput type="date" value={day} onChange={e => setDay(e.target.value)} className="w-auto" />}
        {type !== "credit" && type !== "dailyInvoice" && <>
          <Select value={month} onChange={e => setMonth(Number(e.target.value))} className="w-auto">
            {Array.from({ length: 12 }).map((_, i) => <option key={i} value={i}>{new Date(2000, i, 1).toLocaleDateString("en-GB", { month: "long" })}</option>)}
          </Select>
          <TextInput type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-24" />
        </>}
        <Btn onClick={() => window.print()}><AppIcon name="printer" size={16} /> Print</Btn>
      </div>

      {type === "dailyInvoice" ? (
        <div id="report-print" className="cbl-card overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-start justify-between border-b-2 border-[#2B2320] p-5">
            <img src="./assets/logo-dark-text.png" alt="Cherrys Beauty Lounge" className="h-14 w-auto object-contain" />
            <div className="rounded bg-[#2B2320] px-3 py-1.5 text-right text-sm font-medium text-white" dir="rtl">{BUSINESS.nameArabic}</div>
          </div>
          <div className="p-5">
            <div className="mb-4 text-center text-lg font-bold tracking-wide text-[#2B2320]">DAILY SALES REPORT</div>
            <div className="mb-3 flex justify-between text-sm">
              <div><span className="font-semibold">NO.</span> {nextInvoiceNo(sales, day)}</div>
              <div><span className="font-semibold">DATE:</span> {fmtDate(day)}</div>
            </div>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#2B2320] text-white">
                  <th className="border border-[#2B2320] px-2 py-1.5 text-left">SL NO</th>
                  <th className="border border-[#2B2320] px-2 py-1.5 text-left">DESCRIPTION</th>
                  <th className="border border-[#2B2320] px-2 py-1.5 text-right">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.length === 0 ? (
                  <tr><td colSpan={3} className="border border-[#2B2320] px-2 py-6 text-center text-[#2B2320]/40">No sales recorded for this date.</td></tr>
                ) : reportRows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="border border-[#2B2320] px-2 py-1.5">{i + 1}</td>
                    <td className="border border-[#2B2320] px-2 py-1.5">{custMap[r.customerId]?.name || "—"} — {r.description}</td>
                    <td className="border border-[#2B2320] px-2 py-1.5 text-right">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 6 - reportRows.length) }).map((_, i) => (
                  <tr key={"blank" + i}>
                    <td className="border border-[#2B2320] px-2 py-3">&nbsp;</td>
                    <td className="border border-[#2B2320] px-2 py-3">&nbsp;</td>
                    <td className="border border-[#2B2320] px-2 py-3">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-1 flex items-stretch border border-t-0 border-[#2B2320] text-sm">
              <div className="flex-1 border-r border-[#2B2320] p-2">In Words: {numberToWordsBHD(total)}</div>
              <div className="w-40 p-2 text-right font-semibold">G_Total: {fmtMoney(total)}</div>
            </div>

            <div className="mt-5 flex items-end justify-between text-sm">
              <div>
                <div className="mb-2 font-semibold">Payment Method:</div>
                {PAYMENT_MODES.map((m) => (
                  <div key={m} className="mb-1.5 flex items-center gap-2">
                    <span className="w-28">{m}</span>
                    <span className="flex-1 border-b border-[#2B2320]/60"></span>
                    <span className="w-20 text-right">{fmtMoney(modeTotals[m] || 0)}</span>
                  </div>
                ))}
              </div>
              <div className="text-right">
                <div className="mb-8 text-xs text-[#2B2320]/50">Total: {fmtMoney(total)}</div>
                <div className="border-t border-[#2B2320] pt-1 text-xs">Cherrys Beauty Lounge</div>
              </div>
            </div>
          </div>
          <div className="bg-[#2B2320] px-5 py-3 text-center text-[10px] text-white/80">
            {BUSINESS.cr} &nbsp;·&nbsp; Mobile {BUSINESS.phone} &nbsp;·&nbsp; {BUSINESS.email} &nbsp;·&nbsp; {BUSINESS.address}
          </div>
        </div>
      ) : (
        <div id="report-print" className="cbl-card overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b-2 border-[#2B2320] p-5">
            <img src="./assets/logo-dark-text.png" alt="Cherrys Beauty Lounge" className="h-10 w-auto object-contain" />
            <div className="text-right">
              <div className="text-sm font-semibold text-[#2B2320]">{titles[type]}</div>
              <div className="text-xs text-[#2B2320]/50">{type !== "credit" && monthLabel(month, year)}</div>
            </div>
          </div>
          <div className="p-5">
          {reportRows.length === 0 ? <Empty icon="file" text="No records for this period." /> : (
            <table className="w-full text-sm">
              <thead><tr className="bg-[#2B2320] text-white">
                {(type === "sales" || type === "credit") && <th className="border border-[#2B2320] px-2 py-1.5 text-left">Invoice #</th>}
                <th className="border border-[#2B2320] px-2 py-1.5 text-left">Date</th>
                {type === "sales" && <><th className="border border-[#2B2320] px-2 py-1.5 text-left">Customer</th><th className="border border-[#2B2320] px-2 py-1.5 text-left">Service</th><th className="border border-[#2B2320] px-2 py-1.5 text-left">Added By</th></>}
                {type === "expenses" && <th className="border border-[#2B2320] px-2 py-1.5 text-left">Category</th>}
                {type === "credit" && <><th className="border border-[#2B2320] px-2 py-1.5 text-left">Customer</th><th className="border border-[#2B2320] px-2 py-1.5 text-left">Balance Due</th></>}
                {type === "supplierPayments" && <th className="border border-[#2B2320] px-2 py-1.5 text-left">Supplier</th>}
                <th className="border border-[#2B2320] px-2 py-1.5 text-right">Amount</th>
              </tr></thead>
              <tbody>
                {reportRows.map(r => (
                  <tr key={r.id}>
                    {(type === "sales" || type === "credit") && <td className="border border-[#2B2320] px-2 py-1.5 font-mono text-xs">{r.invoiceNo || "—"}</td>}
                    <td className="border border-[#2B2320] px-2 py-1.5">{fmtDate(r.date)}</td>
                    {type === "sales" && <><td className="border border-[#2B2320] px-2 py-1.5">{custMap[r.customerId]?.name}</td><td className="border border-[#2B2320] px-2 py-1.5">{r.description}</td><td className="border border-[#2B2320] px-2 py-1.5">{r.addedBy || "—"}</td></>}
                    {type === "expenses" && <td className="border border-[#2B2320] px-2 py-1.5">{r.category}</td>}
                    {type === "credit" && <><td className="border border-[#2B2320] px-2 py-1.5">{custMap[r.customerId]?.name}</td><td className="border border-[#2B2320] px-2 py-1.5">{fmtMoney(r.amount - (r.amountPaid || 0))}</td></>}
                    {type === "supplierPayments" && <td className="border border-[#2B2320] px-2 py-1.5">{suppMap[r.supplierId]?.name}</td>}
                    <td className="border border-[#2B2320] px-2 py-1.5 text-right">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td className="border border-[#2B2320] px-2 py-1.5" colSpan={type === "sales" ? 4 : type === "credit" ? 3 : type === "expenses" ? 1 : 1}>Total</td><td className="border border-[#2B2320] px-2 py-1.5 text-right">{fmtMoney(total)}</td></tr></tfoot>
            </table>
          )}
          <div className="mt-6 text-center text-xs text-[#2B2320]/40">Printed on {fmtDate(todayStr())}</div>
          </div>
          <div className="bg-[#2B2320] px-5 py-3 text-center text-[10px] text-white/80">
            {BUSINESS.cr} &nbsp;·&nbsp; Mobile {BUSINESS.phone} &nbsp;·&nbsp; {BUSINESS.email} &nbsp;·&nbsp; {BUSINESS.address}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* WHATSAPP OFFERS                                                     */
/* ================================================================== */

function WhatsAppTab({ customers, customerStats }) {
  const [message, setMessage] = useState("✨ Special offer at Cherrys Beauty Lounge! Visit us this week and enjoy 20% off on all services. Book your slot now!");
  const [selected, setSelected] = useState(() => new Set(customers.map(c => c.id)));
  const [audience, setAudience] = useState("all");

  const toggle = (id) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  let audienceList = customers;
  if (audience === "regular") audienceList = customers.filter(c => (customerStats[c.id]?.visits || 0) >= 3);
  if (audience === "inactive") audienceList = customers.filter(c => customerStats[c.id]?.lastVisit && daysBetween(customerStats[c.id].lastVisit, todayStr()) >= 30);

  useEffect(() => { setSelected(new Set(audienceList.map(c => c.id))); }, [audience, customers.length]);

  return (
    <div>
      <SectionHeader title="WhatsApp Offers" desc="Compose one message, then send it to each selected customer's WhatsApp" />

      <div className="mb-4 rounded-lg bg-[#C9A15A]/10 px-3 py-2 text-xs text-[#8a6a2f]">
        True one-click bulk WhatsApp broadcasting needs the official WhatsApp Business API (Meta business verification + a paid provider). Without that, each message below opens as a pre-filled WhatsApp chat you tap "Send" on — fast, but one tap per customer rather than one tap for everyone.
      </div>

      <div className="cbl-card mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <Field label="Offer Message"><TextArea value={message} onChange={e => setMessage(e.target.value)} className="min-h-[90px]" /></Field>
        <div className="flex flex-wrap gap-2">
          {[["all", "All Customers"], ["regular", "Regular Customers"], ["inactive", "Inactive 30+ days"]].map(([k, l]) => (
            <button key={k} onClick={() => setAudience(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${audience === k ? "bg-[#D6336C] text-white" : "bg-white text-[#2B2320]/60 border border-[#f5d3e0]"}`}>{l}</button>
          ))}
        </div>
      </div>

      {audienceList.length === 0 ? (
        <Empty icon="whatsapp" text="No customers match this audience." />
      ) : (
        <div className="cbl-card overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full">
            <thead className="border-b border-[#fbe8ef]"><tr><Th></Th><Th>Name</Th><Th>Mobile</Th><Th></Th></tr></thead>
            <tbody className="divide-y divide-[#fbe8ef]">
              {audienceList.map(c => (
                <tr key={c.id} className="hover:bg-[#FFF6F8]">
                  <Td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></Td>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.mobile}</Td>
                  <Td>
                    {selected.has(c.id) && (
                      <a href={waLink(c.mobile, message)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#4E7C59]/10 px-3 py-1 text-xs font-medium text-[#4E7C59] hover:bg-[#4E7C59]/20">
                        <AppIcon name="whatsapp" size={12} /> Send
                      </a>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* LOGIN                                                                */
/* Each staff member has their own username + PIN. This is a light,    */
/* client-side lock — the data itself is protected by your Supabase    */
/* anon key + RLS policy. For real per-user security later, this can   */
/* be upgraded to Supabase Auth.                                       */
/* ================================================================== */

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);

  function submit(e) {
    e.preventDefault();
    const match = STAFF_USERS.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase() && u.pin === pin
    );
    if (match) {
      try { sessionStorage.setItem("cbl_user", JSON.stringify(match)); } catch (e2) {}
      onLogin(match);
    } else {
      setErr(true);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "radial-gradient(1200px 700px at 15% 10%, #F0678F 0%, transparent 55%), radial-gradient(1000px 700px at 90% 90%, #7A1B4A 0%, transparent 55%), linear-gradient(160deg,#E0447C 0%,#B0225F 45%,#4A0E29 100%)" }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');`}</style>
      <form onSubmit={submit} className="relative w-full max-w-sm rounded-[28px] bg-white/95 p-8 text-center shadow-2xl backdrop-blur">
        <div className="pointer-events-none absolute inset-3 rounded-[20px] border border-[#E8C888]/50"></div>
        <img src="./assets/logo-dark-text.png" alt={APP_NAME} className="mx-auto mb-5 h-12 w-auto object-contain" />
        <div className="mx-auto mb-5 h-px w-16 bg-gradient-to-r from-transparent via-[#D6336C] to-transparent"></div>
        <p className="mb-6 text-xs uppercase tracking-[0.2em] text-[#2B2320]/40" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Sign In</p>

        <div className="mb-3 text-left">
          <label className="mb-1 block text-xs font-medium text-[#2B2320]/60">Username</label>
          <input
            value={username}
            onChange={(e) => { setUsername(e.target.value); setErr(false); }}
            autoFocus
            autoCapitalize="none"
            className="w-full rounded-lg border border-[#f5d3e0] bg-[#FFF6F8] px-3 py-2.5 text-sm outline-none focus:border-[#D6336C]"
            placeholder="e.g. staff1"
          />
        </div>
        <div className="mb-5 text-left">
          <label className="mb-1 block text-xs font-medium text-[#2B2320]/60">PIN</label>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setErr(false); }}
            className="w-full rounded-lg border border-[#f5d3e0] bg-[#FFF6F8] px-3 py-2.5 text-center text-lg tracking-[0.4em] outline-none focus:border-[#D6336C]"
          />
        </div>
        {err && <p className="mb-3 text-xs text-[#B23A3A]">Username or PIN not recognized.</p>}
        <button type="submit" className="w-full rounded-lg py-2.5 text-sm font-medium text-white shadow-md" style={{ background: "linear-gradient(135deg,#D6336C,#A61E5C)" }}>
          Sign In
        </button>
        <p className="mt-5 text-[10px] text-[#2B2320]/30">Cherrys Beauty Lounge · Internal Team Access</p>
      </form>
    </div>
  );
}

/* ================================================================== */
/* BOOTSTRAP                                                            */
/* ================================================================== */

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: { params: { eventsPerSecond: 5 } },
});

function Root() {
  const [user, setUser] = useState(() => {
    try {
      const raw = sessionStorage.getItem("cbl_user");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  });

  function logout() {
    try { sessionStorage.removeItem("cbl_user"); } catch (e) {}
    setUser(null);
  }

  if (!user) return <LoginScreen onLogin={setUser} />;
  return <App supabase={supabase} currentUser={user} onLogout={logout} />;
}

const rootEl = document.getElementById("root");
if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR-PROJECT")) {
  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;padding:24px;text-align:center;background:#FFF6F8;color:#2B2320;">
      <div style="max-width:420px;">
        <div style="font-size:32px;margin-bottom:8px;">⚙️</div>
        <h1 style="margin:0 0 8px;">Setup needed</h1>
        <p style="opacity:.7;font-size:14px;">Open <code>config.js</code> and paste in your Supabase Project URL and anon key. See SETUP-GUIDE.md for step-by-step instructions.</p>
      </div>
    </div>`;
} else {
  createRoot(rootEl).render(<Root />);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
