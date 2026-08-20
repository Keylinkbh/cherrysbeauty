// ─────────────────────────────────────────────────────────────
// Cherrys Beauty Lounge — configuration
// ─────────────────────────────────────────────────────────────

export const SUPABASE_URL = "https://gpooqftdulcihoxezvuq.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdwb29xZnRkdWxjaWhveGV6dnVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMTQwMTgsImV4cCI6MjEwMjc5MDAxOH0.EEiVm1D9zGRjaZwVu5KeU4Xmi-3g6ATc-KWVJFXu2_E";

export const APP_NAME = "Cherrys Beauty Lounge";

// Business details, taken from your printed Daily Sales Report template
export const BUSINESS = {
  nameArabic: "جيريز بيوتي لاونج ذ.م.م",
  cr: "CR 164819-1",
  phone: "35590462",
  email: "cherrysbeautylounge@gmail.com",
  address: "Building 40, Avenue 11, Block 226, Busaiteen, Kingdom of Bahrain",
};

// Invoice numbering — produces numbers like CBL1923-0000001BH-2026
export const INVOICE_PREFIX = "CBL1923";

// ─────────────────────────────────────────────────────────────
// Staff logins. Each person gets their own username + PIN.
// role: "admin"  → sees and edits everything, gets notifications
//                  when staff add a sale.
// role: "staff"  → only sees Sales & Payments, can add sales
//                  (not edit/delete). Every sale they add is
//                  tagged with their name automatically.
// ─────────────────────────────────────────────────────────────
export const STAFF_USERS = [
  { username: "sadaque", pin: "1234", role: "admin", name: "Sadaque" },
  { username: "Maria", pin: "3559", role: "staff", name: "Maria" },
  { username: "Eman", pin: "9553", role: "staff", name: "Eman" },
  { username: "Blanche", pin: "5935", role: "staff", name: "Blanche" },
];
