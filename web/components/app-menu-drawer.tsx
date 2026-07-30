"use client";

import {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardList,
  CreditCard,
  FilePenLine,
  FileText,
  GraduationCap,
  History,
  Info,
  LayoutDashboard,
  Search,
  QrCode,
  Settings2,
  Stethoscope,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import type { AuthUser } from "@/lib/types";

interface AppMenuDrawerProps {
  open: boolean;
  currentUser: AuthUser | null;
  onClose: () => void;
}

export function AppMenuDrawer({ open, currentUser, onClose }: AppMenuDrawerProps) {
  const pathname = usePathname();
  const router = useRouter();
  if (!open) return null;

  const items = [
    { href: "/", label: "Queue", icon: LayoutDashboard },
    { href: "/appointments", label: "Appointments", icon: CalendarClock },
    { href: "/patients", label: "Patients", icon: Search },
    { href: "/qr-code", label: "QR Code", icon: QrCode },
    { href: "/care-programs", label: "Care Programs", icon: ClipboardList, adminOnly: true },
    { href: "/billing", label: "Billing", icon: CreditCard, adminOnly: true },
    { href: "/inventory", label: "Inventory", icon: Stethoscope, adminOnly: true },
    { href: "/history", label: "History", icon: History },
    { href: "/generate-letter", label: "Generate Letter", icon: FilePenLine, adminOnly: true },
    { href: "/earnings", label: "Earnings", icon: BarChart3, adminOnly: true },
    { href: "/case-study", label: "Case Study", icon: FileText, adminOnly: true },
    { href: "/users", label: "Users", icon: UserPlus, adminOnly: true },
    { href: "/clinic", label: "Clinic", icon: Building2, adminOnly: true },
    { href: "/account", label: "Account", icon: User },
    { href: "/audit", label: "Audit", icon: Settings2, adminOnly: true },
    { href: "/training", label: "Training Mode", icon: GraduationCap },
    { href: "/about", label: "About", icon: Info },
  ].filter((item) => !item.adminOnly || currentUser?.role === "admin");

  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-slate-900/10 backdrop-blur-[1px]" />
      <aside className="absolute inset-y-0 left-0 w-[min(86vw,292px)] border-r border-[#dbe7ef] bg-[#f8fbfd] shadow-[0_20px_60px_rgba(64,131,181,0.14)]">
        <div className="flex h-full flex-col p-4">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-slate-900">Menu</h2>
            <button type="button" onClick={onClose} aria-label="Close menu" className="rounded-xl border border-[#bfd7e8] bg-white p-2 text-slate-700 transition hover:bg-[#edf5fa]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-4">
            {items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => {
                    onClose();
                    if (!active) router.push(item.href);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm font-medium transition ${
                    active ? "bg-white text-[#2a6fa8] shadow-[0_8px_24px_rgba(64,131,181,0.08)]" : "text-slate-700 hover:bg-white/80"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
    </div>
  );
}
