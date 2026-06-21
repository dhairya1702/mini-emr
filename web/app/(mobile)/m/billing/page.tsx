"use client";

import { useEffect, useMemo, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileAdminGate } from "@/components/mobile/mobile-admin-gate";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { api } from "@/lib/api";
import type { Invoice, Patient } from "@/lib/types";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

export default function MobileBillingPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || currentUser?.role !== "admin") {
      return;
    }
    let active = true;
    setIsLoading(true);
    Promise.all([api.listPatients(), api.listInvoices()])
      .then(([patientRows, invoiceRows]) => {
        if (!active) return;
        setPatients(patientRows);
        setInvoices(invoiceRows);
        setError("");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load billing.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  const billablePatients = useMemo(
    () => patients.filter((patient) => patient.status === "done" && !patient.billed),
    [patients],
  );

  return (
    <MobileAdminGate title="Billing">
      <MobileShell title="Billing">
        {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        {isLoading ? (
          <p className="clinic-empty-state">Loading billing...</p>
        ) : (
          <div className="grid gap-4">
            <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
              <h1 className="text-xl font-semibold text-slate-900">Ready for billing</h1>
              <p className="mt-1 text-sm text-slate-500">{billablePatients.length} patient{billablePatients.length === 1 ? "" : "s"}</p>
              <div className="mt-4 grid gap-3">
                {billablePatients.length ? billablePatients.slice(0, 8).map((patient) => (
                  <div key={patient.id} className="rounded-xl border border-[#dbe7ef] bg-[#f7fbfd] px-4 py-3">
                    <p className="font-semibold text-slate-900">{patient.name}</p>
                    <p className="mt-1 text-sm text-slate-600">{patient.reason}</p>
                  </div>
                )) : <p className="text-sm text-slate-500">No completed patients waiting for billing.</p>}
              </div>
            </section>
            <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
              <h2 className="text-lg font-semibold text-slate-900">Recent invoices</h2>
              <div className="mt-4 grid gap-3">
                {invoices.slice(0, 10).map((invoice) => (
                  <div key={invoice.id} className="rounded-xl border border-[#dbe7ef] px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{invoice.patient_name || "Patient"}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{invoice.payment_status}</p>
                      </div>
                      <p className="text-sm font-semibold text-[#2a6fa8]">Rs {money(invoice.total)}</p>
                    </div>
                  </div>
                ))}
                {!invoices.length ? <p className="text-sm text-slate-500">No invoices yet.</p> : null}
              </div>
            </section>
          </div>
        )}
      </MobileShell>
    </MobileAdminGate>
  );
}
