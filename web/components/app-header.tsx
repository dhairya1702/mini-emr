"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";

import { AuthUser } from "@/lib/types";

interface AppHeaderProps {
  clinicName: string;
  currentUser: AuthUser | null;
  active: "queue" | "patients" | "history" | "earnings" | "billing" | "users" | "audit" | "inventory" | "account" | "case-study";
  onLogout: () => void;
  onOpenSettings?: () => void;
}

export function AppHeader({
  clinicName,
  currentUser,
  active,
  onLogout,
  onOpenSettings,
}: AppHeaderProps) {
  const navItems = [
    { href: "/", label: "Queue", key: "queue" },
    { href: "/patients", label: "Patients", key: "patients" },
    { href: "/history", label: "History", key: "history" },
    { href: "/billing", label: "Billing", key: "billing" },
    { href: "/inventory", label: "Inventory", key: "inventory" },
    { href: "/users", label: "Users", key: "users" },
    { href: "/account", label: "Account", key: "account" },
    { href: "/case-study", label: "Case Study", key: "case-study" },
    { href: "/audit", label: "Audit", key: "audit" },
    { href: "/earnings", label: "Earnings", key: "earnings" },
  ] as const;

  return (
    <div className="mb-5 rounded-[18px] border border-[#dbe7ef] bg-white/95 p-4 shadow-[0_16px_42px_rgba(64,131,181,0.1)] backdrop-blur">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="flex justify-start">
          {onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Open menu"
              title="Menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-800 transition hover:border-[#9fc7e1] hover:bg-[#edf5fa]"
            >
              <Menu className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="inline-block text-2xl font-semibold tracking-tight text-slate-800 transition hover:text-[#2f8fd3] sm:text-3xl"
          >
            {clinicName}
          </Link>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-3 lg:justify-end">
          {currentUser ? (
            <div className="rounded-xl border border-[#dbe7ef] bg-[#edf5fa] px-3 py-2 text-sm font-medium text-[#2a6fa8]">
              {currentUser.role === "admin" ? "Admin" : "Staff"}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            aria-label="Logout"
            title="Logout"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-700 transition hover:bg-[#edf5fa]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="mt-4 flex flex-wrap gap-1.5 border-t border-[#dbe7ef] pt-3" aria-label="Primary">
        {navItems.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-[#2f8fd3] text-white shadow-[0_8px_18px_rgba(47,143,211,0.2)]"
                  : "text-slate-600 hover:bg-[#edf5fa] hover:text-slate-800"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
