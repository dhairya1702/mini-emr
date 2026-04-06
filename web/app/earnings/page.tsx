"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ReceiptIndianRupee, Wallet } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Invoice, Patient } from "@/lib/types";

type GroupMode = "day" | "week" | "month";

function startOfWeek(date: Date) {
  const result = new Date(date);
  const day = result.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + offset);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatCurrency(value: number) {
  return value.toFixed(2);
}

export default function EarningsPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mode, setMode] = useState<GroupMode>("day");
  const loadPageData = useCallback(async () => {
    const [dataInvoices, historyPatients] = await Promise.all([
      api.listInvoices(),
      api.listPatients(),
    ]);
    return {
      invoices: dataInvoices,
      patients: historyPatients,
    };
  }, []);
  const onPageData = useCallback((data: { invoices: Invoice[]; patients: Patient[] }) => {
    setInvoices(data.invoices);
    setPatients(data.patients);
  }, []);
  const {
    currentUser,
    users,
    catalogItems,
    followUps,
    clinicSettings,
    error,
    isAuthReady,
    isRedirectingToLogin,
    handleLogout,
    handleSaveClinicSettings,
    handleAddStaffUser,
    handleCreateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
  } = useClinicShellPage({
    canLoadPageData: (user) => user.role === "admin",
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  useEffect(() => {
    if (isAuthReady && currentUser?.role === "staff") {
      router.replace("/");
    }
  }, [currentUser, isAuthReady, router]);

  const patientNames = useMemo(
    () => Object.fromEntries(patients.map((patient) => [patient.id, patient.name])),
    [patients],
  );

  const paidInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) => invoice.payment_status === "paid")
        .sort((left, right) => (right.paid_at || right.created_at).localeCompare(left.paid_at || left.created_at)),
    [invoices],
  );

  const groupedEarnings = useMemo(() => {
    const buckets = new Map<string, { label: string; invoiceCount: number; total: number }>();

    for (const invoice of paidInvoices) {
      const sourceDate = new Date(invoice.paid_at || invoice.created_at);
      const bucketDate =
        mode === "day"
          ? new Date(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate())
          : mode === "week"
            ? startOfWeek(sourceDate)
            : startOfMonth(sourceDate);
      const key = bucketDate.toISOString();
      const label =
        mode === "day"
          ? bucketDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
          : mode === "week"
            ? `Week of ${bucketDate.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
            : bucketDate.toLocaleDateString([], { month: "long", year: "numeric" });
      const current = buckets.get(key) ?? { label, invoiceCount: 0, total: 0 };
      current.invoiceCount += 1;
      current.total += invoice.total;
      buckets.set(key, current);
    }

    return Array.from(buckets.entries())
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([key, value]) => ({ key, ...value }));
  }, [mode, paidInvoices]);

  const summary = useMemo(() => {
    const now = new Date();
    const todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekKey = startOfWeek(now).toISOString();
    const monthKey = startOfMonth(now).toISOString();

    let today = 0;
    let week = 0;
    let month = 0;
    let total = 0;

    for (const invoice of paidInvoices) {
      const sourceDate = new Date(invoice.paid_at || invoice.created_at);
      const dayStart = new Date(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate()).toISOString();
      const weekStart = startOfWeek(sourceDate).toISOString();
      const monthStart = startOfMonth(sourceDate).toISOString();

      total += invoice.total;
      if (dayStart === todayKey) today += invoice.total;
      if (weekStart === weekKey) week += invoice.total;
      if (monthStart === monthKey) month += invoice.total;
    }

    return { today, week, month, total };
  }, [paidInvoices]);

  async function handleCreateInvoice(payload: {
    patient_id: string;
    items: Array<{
      catalog_item_id?: string | null;
      item_type: "service" | "medicine";
      label: string;
      quantity: number;
      unit_price: number;
    }>;
    payment_status: "paid";
  }): Promise<Invoice> {
    const invoice = await api.createInvoice(payload);
    setInvoices((current) => [invoice, ...current]);
    return invoice;
  }

  if (isRedirectingToLogin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">
          Redirecting to login...
        </div>
      </main>
    );
  }

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">
          Loading ClinicOS...
        </div>
      </main>
    );
  }

  if (currentUser?.role === "staff") {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_20px_60px_rgba(125,211,252,0.18)]">
          Redirecting to queue...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="earnings"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-[28px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.14)]">
            <div className="flex items-center gap-3 text-sky-700">
              <CalendarDays className="h-5 w-5" />
              <p className="text-sm font-medium">Today</p>
            </div>
            <p className="mt-4 text-3xl font-semibold text-slate-900">{formatCurrency(summary.today)}</p>
          </div>
          <div className="rounded-[28px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.14)]">
            <div className="flex items-center gap-3 text-sky-700">
              <CalendarDays className="h-5 w-5" />
              <p className="text-sm font-medium">This Week</p>
            </div>
            <p className="mt-4 text-3xl font-semibold text-slate-900">{formatCurrency(summary.week)}</p>
          </div>
          <div className="rounded-[28px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.14)]">
            <div className="flex items-center gap-3 text-sky-700">
              <CalendarDays className="h-5 w-5" />
              <p className="text-sm font-medium">This Month</p>
            </div>
            <p className="mt-4 text-3xl font-semibold text-slate-900">{formatCurrency(summary.month)}</p>
          </div>
          <div className="rounded-[28px] border border-emerald-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.14)]">
            <div className="flex items-center gap-3 text-emerald-700">
              <Wallet className="h-5 w-5" />
              <p className="text-sm font-medium">Total Earnings</p>
            </div>
            <p className="mt-4 text-3xl font-semibold text-slate-900">{formatCurrency(summary.total)}</p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[32px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Earnings</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Collected revenue</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["day", "week", "month"] as GroupMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      mode === option
                        ? "border border-sky-300 bg-sky-500 text-white"
                        : "border border-sky-200 bg-sky-50/70 text-slate-700 hover:bg-sky-100"
                    }`}
                  >
                    {option === "day" ? "Daily" : option === "week" ? "Weekly" : "Monthly"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {groupedEarnings.length ? groupedEarnings.map((bucket) => (
                <div key={bucket.key} className="rounded-[24px] border border-sky-100 bg-sky-50/30 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{bucket.label}</p>
                      <p className="mt-1 text-xs text-slate-500">{bucket.invoiceCount} paid invoice{bucket.invoiceCount === 1 ? "" : "s"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Collected</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(bucket.total)}</p>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="rounded-[28px] border border-dashed border-sky-300 bg-sky-50/20 px-6 py-16 text-center text-sm text-slate-500">
                  No paid invoices yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[32px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
            <div className="flex items-center gap-3">
              <ReceiptIndianRupee className="h-5 w-5 text-sky-700" />
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Recent Bills</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">Latest paid invoices</h2>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {paidInvoices.length ? paidInvoices.slice(0, 10).map((invoice) => (
                <div key={invoice.id} className="rounded-[24px] border border-sky-100 bg-sky-50/30 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {patientNames[invoice.patient_id] || "Patient"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Paid on {new Date(invoice.paid_at || invoice.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        {invoice.items.length} item{invoice.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <p className="text-lg font-semibold text-slate-900">{formatCurrency(invoice.total)}</p>
                  </div>
                </div>
              )) : (
                <div className="rounded-[28px] border border-dashed border-sky-300 bg-sky-50/20 px-6 py-16 text-center text-sm text-slate-500">
                  No earnings data yet.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <SettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={currentUser}
        users={users}
        patients={patients.filter((patient) => patient.status === "done" && !patient.billed)}
        catalogItems={catalogItems}
        followUps={followUps}
        onClose={() => setIsSettingsOpen(false)}
        onSaveClinic={handleSaveClinicSettings}
        onAddUser={handleAddStaffUser}
        onCreateCatalogItem={handleCreateCatalogItem}
        onAdjustCatalogStock={handleAdjustCatalogStock}
        onDeleteCatalogItem={handleDeleteCatalogItem}
        onGenerateLetter={handleGenerateLetter}
        onGenerateLetterPdf={(payload) => api.generateLetterPdf(payload)}
        onSendLetter={handleSendLetter}
        onCreateInvoice={handleCreateInvoice}
        onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
        onSendInvoice={async (payload) => {
          const message = await handleSendInvoice(payload);
          setInvoices((current) =>
            current.map((invoice) =>
              invoice.id === payload.invoice_id
                ? { ...invoice, sent_at: new Date().toISOString() }
                : invoice,
            ),
          );
          return message;
        }}
        onBillingComplete={(patientId) => {
          setPatients((current) =>
            current.map((patient) =>
              patient.id === patientId ? { ...patient, billed: true } : patient,
            ),
          );
          setIsSettingsOpen(false);
        }}
      />
    </main>
  );
}
