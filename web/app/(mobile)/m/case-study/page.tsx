"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileAdminGate } from "@/components/mobile/mobile-admin-gate";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { api } from "@/lib/api";
import type { CaseStudy, Patient } from "@/lib/types";

export default function MobileCaseStudyPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || currentUser?.role !== "admin") return;
    let active = true;
    setIsLoading(true);
    Promise.all([api.listPatients({ limit: 6 }), api.listCaseStudies()])
      .then(([patientPage, caseStudyRows]) => {
        if (!active) return;
        setPatients(patientPage.items);
        setCaseStudies(caseStudyRows);
        setError("");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load case studies.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  return (
    <MobileAdminGate title="Case Study">
      <MobileShell title="Case Study">
        {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        {isLoading ? (
          <p className="clinic-empty-state">Loading case studies...</p>
        ) : (
          <div className="grid gap-4">
            <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
              <h1 className="text-xl font-semibold text-slate-900">Case Study</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">Select a recent patient to open their chart, then use the desktop case-study authoring workflow when you need the full editor.</p>
              <div className="mt-4 grid gap-3">
                {patients.slice(0, 6).map((patient) => (
                  <Link key={patient.id} href={`/m/patient/${patient.id}`} className="rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] px-4 py-3">
                    <p className="font-semibold text-slate-900">{patient.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{patient.reason}</p>
                  </Link>
                ))}
              </div>
            </section>
            <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5">
              <h2 className="text-lg font-semibold text-slate-900">Saved studies</h2>
              <div className="mt-4 grid gap-3">
                {caseStudies.slice(0, 8).map((study) => (
                  <div key={study.id} className="rounded-xl border border-[#dbe7ef] px-4 py-3">
                    <p className="font-semibold text-slate-900">{study.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{study.status}</p>
                  </div>
                ))}
                {!caseStudies.length ? <p className="text-sm text-slate-500">No saved case studies yet.</p> : null}
              </div>
            </section>
          </div>
        )}
      </MobileShell>
    </MobileAdminGate>
  );
}
