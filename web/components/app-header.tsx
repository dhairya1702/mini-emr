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
  void active;
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-[32px] border border-sky-100 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.22)]">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <div className="flex justify-start">
          {onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 transition hover:bg-sky-50"
            >
              <Menu className="h-4 w-4" />
              Menu
            </button>
          ) : null}
        </div>

        <div className="text-center">
          <Link
            href="/"
            className="inline-block text-3xl font-semibold text-slate-800 transition hover:text-sky-600 sm:text-4xl"
          >
            {clinicName}
          </Link>
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
    </div>
  );
}
