import type { UserRole } from "@/lib/types";
import { canManageClinicSettings, canUseBilling, canUseClinicalTools, canUseInventory, canViewAudit, canViewEarnings } from "@/lib/permissions";

export type MobileNavItemKey =
  | "queue"
  | "appointments"
  | "patients"
  | "qr-code"
  | "care-programs"
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
  canView?: (role: UserRole | null | undefined) => boolean;
};

export const mobileNavItems: MobileNavItem[] = [
  { key: "queue", href: "/m", label: "Queue" },
  { key: "appointments", href: "/m/appointments", label: "Appointments" },
  { key: "patients", href: "/m/patients", label: "Patients" },
  { key: "qr-code", href: "/qr-code", label: "QR Code" },
  { key: "care-programs", href: "/care-programs", label: "Care Programs", canView: canUseClinicalTools },
  { key: "billing", href: "/m/billing", label: "Billing", canView: canUseBilling },
  { key: "inventory", href: "/m/inventory", label: "Inventory", canView: canUseInventory },
  { key: "history", href: "/m/history", label: "History" },
  { key: "generate-letter", href: "/m/generate-letter", label: "Generate Letter", canView: canUseClinicalTools },
  { key: "earnings", href: "/m/earnings", label: "Earnings", canView: canViewEarnings },
  { key: "case-study", href: "/m/case-study", label: "Case Study", canView: canUseClinicalTools },
  { key: "users", href: "/m/users", label: "Users" },
  { key: "clinic", href: "/m/clinic", label: "Clinic", canView: canManageClinicSettings },
  { key: "account", href: "/m/account", label: "Account" },
  { key: "audit", href: "/m/audit", label: "Audit", canView: canViewAudit },
  { key: "training", href: "/m/training", label: "Training Mode" },
  { key: "about", href: "/m/about", label: "About" },
];

export function getVisibleMobileNavItems(role: UserRole | null | undefined) {
  return mobileNavItems.filter((item) => !item.canView || item.canView(role));
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
