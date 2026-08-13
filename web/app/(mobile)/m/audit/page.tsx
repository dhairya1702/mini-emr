"use client";

import { useEffect, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { api } from "@/lib/api";
import { canViewAudit } from "@/lib/permissions";
import type { AuditEvent } from "@/lib/types";

function formatDate(value: string) {
  const date = new Date(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function MobileAuditPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !canViewAudit(currentUser?.role)) return;
    let active = true;
    setIsLoading(true);
    api.listAuditEvents({ limit: 100 })
      .then((rows) => {
        if (!active) return;
        setEvents(rows);
        setError("");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load audit events.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  return (
    <MobileShell title="Audit">
      {!isAuthReady || isRedirectingToLogin ? (
        <p className="clinic-empty-state">Loading...</p>
      ) : !canViewAudit(currentUser?.role) ? (
        <p className="clinic-empty-state">Access restricted.</p>
      ) : (
        <>
        {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        {isLoading ? (
          <p className="clinic-empty-state">Loading audit events...</p>
        ) : (
          <div className="grid gap-3">
            {events.map((event) => (
              <section key={event.id} className="rounded-[18px] border border-[#dbe7ef] bg-white p-4 shadow-[0_12px_28px_rgba(64,131,181,0.08)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{event.summary}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{event.entity_type.replaceAll("_", " ")} · {event.action.replaceAll("_", " ")}</p>
                  </div>
                  <p className="text-right text-xs text-slate-500">{formatDate(event.created_at)}</p>
                </div>
              </section>
            ))}
            {!events.length ? <p className="clinic-empty-state">No audit events yet.</p> : null}
          </div>
        )}
        </>
      )}
    </MobileShell>
  );
}
