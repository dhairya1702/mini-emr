"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppMenuDrawer } from "@/components/app-menu-drawer";
import { MyopiaOfferingEditor } from "@/components/care-programs/myopia-offering-editor";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import type { CareProgramOffering } from "@/lib/types";

export default function MyopiaCareConfigurationPage() {
  const router = useRouter();
  const { clinicSettings, currentUser, handleLogout, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [offering, setOffering] = useState<CareProgramOffering | null>(null);
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
      .then((rows) => setOffering(rows[0] || null))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load Myopia Care."))
      .finally(() => setIsLoading(false));
  }, [currentUser, isAuthReady, isRedirectingToLogin, router]);

  if (!isAuthReady || isRedirectingToLogin || isLoading) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Loading Myopia Care...</main>;
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
        <button type="button" onClick={() => router.push("/care-programs/manage")} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#2a6fa8]">
          <ArrowLeft className="h-4 w-4" />
          Manage programs
        </button>
        <div className="mb-5">
          <h1 className="text-xl font-semibold text-slate-900">Myopia Care configuration</h1>
          <p className="mt-1 text-sm text-slate-500">Set the clinic’s offer, pricing and review schedule.</p>
        </div>
        {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {offering ? <MyopiaOfferingEditor offering={offering} onSaved={setOffering} /> : null}
      </div>
      <AppMenuDrawer open={isMenuOpen} currentUser={currentUser} onClose={() => setIsMenuOpen(false)} />
    </main>
  );
}
