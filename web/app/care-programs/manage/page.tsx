"use client";

import { ArrowLeft, ArrowRight, ClipboardList } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppMenuDrawer } from "@/components/app-menu-drawer";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import type { CareProgramOffering } from "@/lib/types";

export default function ManageCareProgramsPage() {
  const router = useRouter();
  const { clinicSettings, currentUser, handleLogout, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [offerings, setOfferings] = useState<CareProgramOffering[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser) return;
    if (currentUser.role !== "admin") {
      router.replace("/");
      return;
    }
    api.listCareProgramOfferings()
      .then(setOfferings)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load programs."))
      .finally(() => setIsLoading(false));
  }, [currentUser, isAuthReady, isRedirectingToLogin, router]);

  if (!isAuthReady || isRedirectingToLogin || isLoading) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Loading programs...</main>;
  }

  return (
    <main className="clinic-page">
      <div className="clinic-container">
        <AppHeader
          clinicName={clinicSettings?.clinic_name || "ClinicOS"}
          currentUser={currentUser}
          active="care-programs"
          onOpenSettings={() => setIsMenuOpen(true)}
          onLogout={handleLogout}
          timezone={clinicSettings?.timezone}
        />
        <button
          type="button"
          onClick={() => router.push("/care-programs")}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#2a6fa8]"
        >
          <ArrowLeft className="h-4 w-4" />
          Care Programs
        </button>
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-slate-900">Manage programs</h1>
          <p className="mt-1 text-sm text-slate-500">Configure the care programs offered by this clinic.</p>
        </div>
        {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        <section className="overflow-hidden rounded-lg border border-[#dbe7ef] bg-white">
          {offerings.map((offering) => (
            <button
              key={offering.program_key}
              type="button"
              onClick={() => router.push("/care-programs/manage/myopia-care")}
              className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-[#edf2f5] px-5 py-4 text-left last:border-0 hover:bg-[#f7fbfd]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-sky-50 text-[#2f8fd3]">
                <ClipboardList className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">{offering.name}</span>
                <span className="mt-1 block truncate text-sm text-slate-500">{offering.description}</span>
                <span className="mt-2 block text-xs text-slate-500">
                  Rs {Number(offering.default_price || 0).toFixed(2)} · {offering.definition.duration_days} days
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  offering.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"
                }`}>
                  {offering.is_active ? "Active" : "Inactive"}
                </span>
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </span>
            </button>
          ))}
        </section>
      </div>
      <AppMenuDrawer open={isMenuOpen} currentUser={currentUser} onClose={() => setIsMenuOpen(false)} />
    </main>
  );
}
