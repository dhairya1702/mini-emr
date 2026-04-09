"use client";

import { LogOut, Menu, Plus, Stethoscope } from "lucide-react";

import { AuthUser } from "@/lib/types";

interface AppHeaderProps {
  clinicName: string;
  currentUser: AuthUser | null;
  active: "queue" | "patients" | "history" | "earnings";
  onLogout: () => void;
  onAddPatient?: () => void;
  onOpenSettings?: () => void;
}

export function AppHeader({
  clinicName,
  currentUser,
  active: _active,
  onLogout,
  onAddPatient,
  onOpenSettings,
}: AppHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-[32px] border border-sky-100 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.22)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          {onOpenSettings ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-slate-800 transition hover:bg-sky-50"
            >
              <Menu className="h-4 w-4" />
              Clinic Menu
            </button>
          ) : null}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs tracking-[0.22em] text-sky-700">
              <Stethoscope className="h-3.5 w-3.5" />
              ClinicOS
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-slate-800 sm:text-4xl">
              {clinicName}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
