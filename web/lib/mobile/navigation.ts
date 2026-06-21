import type { UserRole } from "@/lib/types";

export type MobileNavItemKey =
  | "queue"
  | "appointments"
  | "patients"
  | "billing"
  | "inventory"
  | "history"
  | "generate-letter"
  | "earnings"
  | "case-study"
  | "users"
  | "clinic"
  | "account"
  | "audit"
  | "training"
  | "about";

export type MobileNavItem = {
  key: MobileNavItemKey;
  href: string;
  label: string;
  adminOnly?: boolean;
};

export const mobileNavItems: MobileNavItem[] = [
  { key: "queue", href: "/m", label: "Queue" },
  { key: "appointments", href: "/m/appointments", label: "Appointments" },
  { key: "patients", href: "/m/patients", label: "Patients" },
  { key: "billing", href: "/m/billing", label: "Billing", adminOnly: true },
  { key: "inventory", href: "/m/inventory", label: "Inventory", adminOnly: true },
  { key: "history", href: "/m/history", label: "History" },
  { key: "generate-letter", href: "/m/generate-letter", label: "Generate Letter", adminOnly: true },
  { key: "earnings", href: "/m/earnings", label: "Earnings", adminOnly: true },
  { key: "case-study", href: "/m/case-study", label: "Case Study", adminOnly: true },
  { key: "users", href: "/m/users", label: "Users", adminOnly: true },
  { key: "clinic", href: "/m/clinic", label: "Clinic", adminOnly: true },
  { key: "account", href: "/m/account", label: "Account" },
  { key: "audit", href: "/m/audit", label: "Audit", adminOnly: true },
  { key: "training", href: "/m/training", label: "Training Mode" },
  { key: "about", href: "/m/about", label: "About" },
];

export function getVisibleMobileNavItems(role: UserRole | null | undefined) {
  return mobileNavItems.filter((item) => !item.adminOnly || role === "admin");
}

export function isMobileNavItemActive(pathname: string, item: MobileNavItem) {
  if (item.key === "queue") {
    return pathname === "/m" || pathname.startsWith("/m/consultation/");
  }
  if (item.key === "patients") {
    return pathname === item.href || pathname.startsWith("/m/patient/");
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
