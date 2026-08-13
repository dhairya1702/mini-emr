"use client";

import { FormEvent, useState } from "react";
import { Bell, CalendarDays, LogOut, Menu, Search } from "lucide-react";
import Link from "next/link";

import { AuthUser } from "@/lib/types";
import { canUseBilling, canUseInventory, canViewEarnings } from "@/lib/permissions";

interface AppHeaderProps {
  clinicName: string;
  currentUser: AuthUser | null;
  active?: "queue" | "appointments" | "patients" | "care-programs" | "history" | "earnings" | "billing" | "users" | "audit" | "inventory" | "account" | "case-study";
  onLogout: () => void;
  onOpenSettings?: () => void;
  timezone?: string;
  checkInCount?: number;
  hasUnseenCheckIns?: boolean;
  onOpenCheckIns?: () => void;
}

function initialsForUser(user: AuthUser | null) {
  const source = user?.name.trim() || user?.identifier || "ClinicOS";
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatClinicDate(timezone?: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: timezone || undefined,
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date());
  }
}

export function AppHeader({
  clinicName,
  currentUser,
  active,
  onLogout,
  onOpenSettings,
  timezone,
  checkInCount = 0,
  hasUnseenCheckIns = false,
  onOpenCheckIns,
}: AppHeaderProps) {
  const [globalSearch, setGlobalSearch] = useState("");
  const navItems = [
    { href: "/", label: "Queue", key: "queue" },
    { href: "/appointments", label: "Appointments", key: "appointments" },
    { href: "/patients", label: "Patients", key: "patients" },
    { href: "/billing", label: "Billing", key: "billing", canView: canUseBilling },
    { href: "/inventory", label: "Inventory", key: "inventory", canView: canUseInventory },
    { href: "/history", label: "History", key: "history" },
    { href: "/earnings", label: "Earnings", key: "earnings", canView: canViewEarnings },
  ].filter((item) => !item.canView || item.canView(currentUser?.role));

  function handleGlobalSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = globalSearch.trim();
    if (!query) return;
    const destination = active === "history" ? "/history" : "/patients";
    window.location.replace(`${destination}?q=${encodeURIComponent(query)}`);
  }

  return (
    <header className="mb-[18px] rounded-[20px] border border-[#dbe7ef] bg-white/95 px-[18px] py-3.5 shadow-[0_14px_38px_rgba(64,131,181,0.10)] backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-3 lg:gap-4">
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Open menu"
            title="Menu"
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-800 transition hover:border-[#9fc7e1] hover:bg-[#edf5fa] active:scale-[0.98]"
          >
            <Menu className="h-[18px] w-[18px]" />
          </button>
        ) : null}

        <Link href="/" replace className="min-w-0 rounded-xl focus:outline-none focus:ring-4 focus:ring-[#d8ebf7]">
          <span className="block max-w-[280px] truncate text-xl font-bold tracking-[-0.02em] text-[#1f2b3d]">
            {clinicName}
          </span>
        </Link>

        <form onSubmit={handleGlobalSearch} className="order-last flex min-w-0 basis-full items-center gap-2.5 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] px-3.5 py-2.5 text-[#8595a8] transition focus-within:border-[#6daed8] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#d8ebf7] lg:order-none lg:ml-2 lg:max-w-[420px] lg:flex-1 lg:basis-auto">
            <Search className="h-4 w-4 shrink-0" />
            <label htmlFor="global-patient-search" className="sr-only">Search patients and history</label>
            <input
              id="global-patient-search"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search patients and history…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#1f2b3d] outline-none placeholder:text-[#8595a8]"
            />
        </form>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {onOpenCheckIns ? (
            <button
              type="button"
              onClick={onOpenCheckIns}
              aria-label={`Open check-in requests${checkInCount ? `, ${checkInCount} pending` : ""}`}
              className={`hidden items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition sm:inline-flex motion-reduce:animate-none ${
                checkInCount
                  ? "check-in-alert-active border-red-600 bg-red-600 text-white shadow-[0_0_0_5px_rgba(220,38,38,0.24),0_0_28px_rgba(220,38,38,0.68)] hover:bg-red-700"
                  : "border-[#bfe0f5] bg-[#ecf6fd] text-[#2a6fa8]"
              } ${hasUnseenCheckIns ? "animate-pulse" : ""}`}
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Check-ins</span>
              {checkInCount ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-red-700 ring-2 ring-red-200">
                  {checkInCount > 99 ? "99+" : checkInCount}
                </span>
              ) : null}
            </button>
          ) : (
            <span className="hidden items-center gap-1.5 rounded-xl border border-[#bfe0f5] bg-[#ecf6fd] px-3 py-2 text-xs font-semibold text-[#2a6fa8] sm:inline-flex">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatClinicDate(timezone)}
            </span>
          )}
          {currentUser ? (
            <span className="hidden rounded-xl border border-[#dbe7ef] bg-[#edf5fa] px-3 py-2 text-xs font-semibold capitalize text-[#2a6fa8] sm:inline-flex">
              {currentUser.role}
            </span>
          ) : null}
          <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#34557a] to-[#5b86b3] text-xs font-semibold text-white">
            {initialsForUser(currentUser)}
          </span>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Logout"
            title="Logout"
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-700 transition hover:bg-[#edf5fa] active:scale-[0.98]"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <nav className="mt-3 flex gap-1.5 overflow-x-auto border-t border-[#dbe7ef] pt-3" aria-label="Primary">
        {navItems.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              replace
              className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium transition active:scale-[0.98] ${
                isActive
                  ? "bg-[#2f8fd3] text-white shadow-[0_8px_18px_rgba(47,143,211,0.22)]"
                  : "text-black hover:bg-[#edf5fa] hover:text-black"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
