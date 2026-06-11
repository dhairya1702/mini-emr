"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MobileShell } from "@/components/mobile/mobile-shell";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import type { PatientVisit } from "@/lib/types";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MobileHistoryPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [visits, setVisits] = useState<PatientVisit[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser) {
      return;
    }
    let active = true;
    setIsLoading(true);
    api.listPatientVisits()
      .then((rows) => {
        if (active) {
          setVisits(rows);
          setError("");
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load history.");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  return (
    <MobileShell title="History" subtitle={`${visits.length} visits`}>
      {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      {isLoading ? (
        <p className="clinic-empty-state">Loading history...</p>
      ) : (
        <div className="grid gap-3">
          {visits.map((visit) => (
            <Link
              key={visit.id}
              href={`/m/patient/${visit.patient_id}`}
              className="rounded-[18px] border border-[#dbe7ef] bg-white p-4 shadow-[0_12px_30px_rgba(47,61,50,0.08)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-800">{visit.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{visit.reason}</p>
                </div>
                <p className="text-right text-xs font-semibold text-slate-500">{formatDate(visit.created_at)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </MobileShell>
  );
}
