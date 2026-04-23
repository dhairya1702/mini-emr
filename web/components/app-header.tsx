"use client";

import { LogOut, Menu, Plus } from "lucide-react";
import Link from "next/link";

import { AuthUser } from "@/lib/types";

interface AppHeaderProps {
  clinicName: string;
  currentUser: AuthUser | null;
  active: "queue" | "patients" | "history" | "earnings" | "billing" | "users" | "audit" | "inventory";
  onLogout: () => void;
  onAddPatient?: () => void;
  onOpenSettings?: () => void;
}

export function AppHeader({
  clinicName,
  currentUser,
  active,
  onLogout,
  onAddPatient,
  onOpenSettings,
}: AppHeaderProps) {
  const navItems = [
    { href: "/", label: "Queue", key: "queue" },
    { href: "/patients", label: "Patients", key: "patients" },
    { href: "/history", label: "History", key: "history" },
    { href: "/billing", label: "Billing", key: "billing" },
    { href: "/inventory", label: "Inventory", key: "inventory" },
    { href: "/users", label: "Users", key: "users" },
    { href: "/audit", label: "Audit", key: "audit" },
    { href: "/earnings", label: "Earnings", key: "earnings" },
  ] as const;

  return (
    <div className="mb-6 rounded-[32px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.18)] backdrop-blur">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="flex justify-start">
          {onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 transition hover:border-sky-300 hover:bg-sky-50"
            >
              <Menu className="h-4 w-4" />
              Menu
            </button>
          ) : null}
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="inline-block text-3xl font-semibold tracking-tight text-slate-800 transition hover:text-sky-600 sm:text-4xl"
          >
            {clinicName}
          </Link>
          <p className="mt-1 text-sm text-slate-500">Clinic operations dashboard</p>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-3 lg:justify-end">
          {currentUser ? (
            <div className="rounded-full border border-sky-200 bg-sky-50/80 px-4 py-2 text-sm font-medium text-sky-700">
              {currentUser.role === "admin" ? "Admin" : "Staff"}
            </div>
          ) : null}
          {onAddPatient ? (
            <button
              type="button"
              onClick={onAddPatient}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-600"
            >
              <Plus className="h-4 w-4" />
              Add Patient
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-sky-50"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>

      <nav className="mt-5 flex flex-wrap gap-2 border-t border-sky-100 pt-4" aria-label="Primary">
        {navItems.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`rounded-full px-3.5 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-sky-500 text-white shadow-[0_10px_24px_rgba(14,165,233,0.22)]"
                  : "border border-sky-100 bg-sky-50/70 text-slate-600 hover:border-sky-200 hover:bg-white hover:text-slate-800"
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
