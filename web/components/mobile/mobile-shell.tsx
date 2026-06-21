"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarClock,
  CreditCard,
  FilePenLine,
  FileText,
  GraduationCap,
  History,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  Stethoscope,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { ReactNode, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { getVisibleMobileNavItems, isMobileNavItemActive, MobileNavItemKey } from "@/lib/mobile/navigation";

const iconByNavKey: Record<MobileNavItemKey, typeof LayoutDashboard> = {
  queue: LayoutDashboard,
  appointments: CalendarClock,
  patients: Search,
  billing: CreditCard,
  inventory: Stethoscope,
  history: History,
  "generate-letter": FilePenLine,
  earnings: BarChart3,
  "case-study": FileText,
  users: UserPlus,
  clinic: Building2,
  account: User,
  audit: Settings2,
  training: GraduationCap,
  about: Info,
};

export function MobileShell({
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { clinicSettings, currentUser, handleLogout } = useClinicShell();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navItems = getVisibleMobileNavItems(currentUser?.role);

  return (
    <main className="clinic-page text-slate-800">
      <header className="sticky top-0 z-30 -mx-4 -mt-5 border-b border-[#dbe7ef] bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 lg:-mx-8">
        <div className="relative mx-auto flex max-w-2xl items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setIsMenuOpen(true)}
            className="clinic-icon-button h-11 w-11 rounded-xl"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            href="/m"
            className="absolute left-1/2 max-w-[52%] -translate-x-1/2 truncate text-center text-base font-semibold uppercase tracking-[0.18em] text-slate-900"
          >
            {clinicSettings?.clinic_name || "Clinic EMR"}
          </Link>
          {action ?? (
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50"
              aria-label="Logout"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[44rem] px-2 py-5 sm:px-4">{children}</div>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={() => setIsMenuOpen(false)}>
          <aside
            className="min-h-full w-[82vw] max-w-[320px] border-r border-[#dbe7ef] bg-white px-5 py-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-slate-800">{currentUser?.name || "Doctor"}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{clinicSettings?.clinic_name || "Clinic EMR"}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="clinic-icon-button"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="mt-8 grid gap-2">
              {navItems.map((item) => {
                const Icon = iconByNavKey[item.key];
                const isActive = isMobileNavItemActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold ${
                      isActive
                        ? "bg-[#2f8fd3] text-white"
                        : "text-slate-700 hover:bg-[#edf5fa]"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={handleLogout}
              className="mt-8 flex w-full items-center gap-3 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              <LogOut className="h-5 w-5" />
              Logout
            </button>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
