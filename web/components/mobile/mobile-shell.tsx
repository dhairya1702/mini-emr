"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, Search, Settings, Stethoscope, UserRound, X } from "lucide-react";
import { ReactNode, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";

const navItems = [
  { href: "/m", label: "Queue", icon: Stethoscope },
  { href: "/m/patients", label: "Patients", icon: UserRound },
  { href: "/m/history", label: "History", icon: Search },
  { href: "/account", label: "Account", icon: Settings },
];

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
          <div className="flex h-11 w-11 items-center justify-center">{action}</div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 py-5">{children}</div>

      {isMenuOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-900/30" onClick={() => setIsMenuOpen(false)}>
          <aside
            className="min-h-full w-[82vw] max-w-[320px] border-r border-[#dbe7ef] bg-white px-5 py-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Mobile EMR</p>
                <p className="mt-1 text-lg font-semibold text-slate-800">{currentUser?.name || "Doctor"}</p>
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
                const Icon = item.icon;
                const isActive = pathname === item.href;
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
