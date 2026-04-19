"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Download, ReceiptIndianRupee, Wallet } from "lucide-react";

import { AppHeader } from "@/components/app-header";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Invoice, Patient, PaymentStatus } from "@/lib/types";

type GroupMode = "week" | "month" | "year";

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

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function formatCurrency(value: number) {
  return value.toFixed(2);
}

export default function EarningsPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [mode, setMode] = useState<GroupMode>("week");
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [isExporting, setIsExporting] = useState("");
  const canLoadAdminPageData = useCallback((user: { role: "admin" | "staff" }) => user.role === "admin", []);
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
    auditEvents,
    loadUsers,
    loadAuditEvents,
    catalogItems,
    loadCatalogItems,
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
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    canLoadPageData: canLoadAdminPageData,
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

  const chartData = useMemo(() => {
    const now = new Date();
    if (mode === "week") {
      const weekStart = startOfWeek(now);
      const buckets = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + index);
        return {
          key: date.toISOString(),
          label: date.toLocaleDateString([], { weekday: "short" }),
          fullLabel: date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }),
          total: 0,
          invoiceCount: 0,
        };
      });

      for (const invoice of paidInvoices) {
        const sourceDate = new Date(invoice.paid_at || invoice.created_at);
        const dayIndex = Math.floor(
          (new Date(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate()).getTime() - weekStart.getTime())
            / 86_400_000,
        );
        if (dayIndex >= 0 && dayIndex < 7) {
          buckets[dayIndex].total += invoice.total;
          buckets[dayIndex].invoiceCount += 1;
        }
      }

      return {
        title: "Monday to Sunday collections",
        subtitle: `Week of ${weekStart.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`,
        points: buckets,
      };
    }

    if (mode === "month") {
      const monthStart = startOfMonth(now);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const buckets = Array.from({ length: daysInMonth }, (_, index) => ({
        key: `${index + 1}`,
        label: String(index + 1),
        fullLabel: new Date(now.getFullYear(), now.getMonth(), index + 1).toLocaleDateString([], {
          month: "short",
          day: "numeric",
        }),
        total: 0,
        invoiceCount: 0,
      }));

      for (const invoice of paidInvoices) {
        const sourceDate = new Date(invoice.paid_at || invoice.created_at);
        if (sourceDate >= monthStart && sourceDate.getMonth() === now.getMonth() && sourceDate.getFullYear() === now.getFullYear()) {
          const dayIndex = sourceDate.getDate() - 1;
          buckets[dayIndex].total += invoice.total;
          buckets[dayIndex].invoiceCount += 1;
        }
      }

      return {
        title: "Daily collections this month",
        subtitle: now.toLocaleDateString([], { month: "long", year: "numeric" }),
        points: buckets,
      };
    }

    const yearStart = startOfYear(now);
    const buckets = Array.from({ length: 12 }, (_, index) => ({
      key: `${index}`,
      label: new Date(now.getFullYear(), index, 1).toLocaleDateString([], { month: "short" }),
      fullLabel: new Date(now.getFullYear(), index, 1).toLocaleDateString([], { month: "long", year: "numeric" }),
      total: 0,
      invoiceCount: 0,
    }));

    for (const invoice of paidInvoices) {
      const sourceDate = new Date(invoice.paid_at || invoice.created_at);
      if (sourceDate >= yearStart && sourceDate.getFullYear() === now.getFullYear()) {
        const monthIndex = sourceDate.getMonth();
        buckets[monthIndex].total += invoice.total;
        buckets[monthIndex].invoiceCount += 1;
      }
    }

    return {
      title: "Monthly collections this year",
      subtitle: String(now.getFullYear()),
      points: buckets,
    };
  }, [mode, paidInvoices]);

  const chartGeometry = useMemo(() => {
    const width = 920;
    const height = 260;
    const paddingX = 24;
    const paddingTop = 18;
    const paddingBottom = 42;
    const innerWidth = width - paddingX * 2;
    const innerHeight = height - paddingTop - paddingBottom;
    const maxValue = Math.max(...chartData.points.map((point) => point.total), 0);
    const safeMax = maxValue > 0 ? maxValue : 1;
    const stepX = chartData.points.length > 1 ? innerWidth / (chartData.points.length - 1) : 0;

    const points = chartData.points.map((point, index) => {
      const x = paddingX + stepX * index;
      const y = paddingTop + innerHeight - (point.total / safeMax) * innerHeight;
      return { ...point, x, y };
    });

    const linePath = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
    const areaPath = points.length
      ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + innerHeight} L ${points[0].x} ${paddingTop + innerHeight} Z`
      : "";

    const yTicks = Array.from({ length: 4 }, (_, index) => {
      const value = safeMax * (1 - index / 3);
      const y = paddingTop + innerHeight * (index / 3);
      return { value, y };
    });

    return { width, height, paddingX, paddingTop, paddingBottom, innerHeight, points, linePath, areaPath, yTicks };
  }, [chartData]);

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
    payment_status: PaymentStatus;
    amount_paid?: number | null;
  }): Promise<Invoice> {
    const invoice = await api.createInvoice(payload);
    setInvoices((current) => [invoice, ...current]);
    return invoice;
  }

  async function handleExport(
    kind: "invoices" | "patients" | "visits",
    loader: () => Promise<Blob>,
  ) {
    setIsExporting(kind);
    setExportError("");
    setExportStatus("");
    try {
      const blob = await loader();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${kind}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportStatus(`${kind[0].toUpperCase()}${kind.slice(1)} export downloaded.`);
    } catch (loadError) {
      setExportError(loadError instanceof Error ? loadError.message : `Failed to export ${kind}.`);
    } finally {
      setIsExporting("");
    }
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

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExport("invoices", handleExportInvoicesCsv)}
            disabled={isExporting === "invoices"}
            className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            {isExporting === "invoices" ? "Preparing..." : "Export"}
          </button>
        </div>

        {exportError ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {exportError}
          </div>
        ) : null}
        {exportStatus ? (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {exportStatus}
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

        <section className="mt-6 space-y-4">
          <div className="rounded-[32px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Earnings</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">Collection graph</h2>
                <p className="mt-2 text-sm text-slate-500">{chartData.title} · {chartData.subtitle}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["week", "month", "year"] as GroupMode[]).map((option) => (
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
                    {option === "week" ? "Weekly" : option === "month" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-sky-100 bg-[linear-gradient(180deg,rgba(240,249,255,0.9),rgba(255,255,255,1))] p-4">
              {paidInvoices.length ? (
                <div>
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-600">Collected amount</p>
                    <p className="text-sm text-slate-500">
                      Peak {formatCurrency(Math.max(...chartData.points.map((point) => point.total), 0))}
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <svg
                      viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                      className="min-w-[760px]"
                      role="img"
                      aria-label="Collections chart"
                    >
                      {chartGeometry.yTicks.map((tick) => (
                        <g key={`${tick.value}-${tick.y}`}>
                          <line
                            x1={chartGeometry.paddingX}
                            y1={tick.y}
                            x2={chartGeometry.width - chartGeometry.paddingX}
                            y2={tick.y}
                            stroke="rgba(148,163,184,0.18)"
                            strokeDasharray="4 6"
                          />
                          <text x={chartGeometry.paddingX} y={tick.y - 6} fontSize="11" fill="#64748b">
                            {formatCurrency(tick.value)}
                          </text>
                        </g>
                      ))}

                      <path d={chartGeometry.areaPath} fill="rgba(14,165,233,0.12)" />
                      <path
                        d={chartGeometry.linePath}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {chartGeometry.points.map((point) => (
                        <g key={point.key}>
                          <circle cx={point.x} cy={point.y} r="5" fill="#ffffff" stroke="#0ea5e9" strokeWidth="3" />
                          <text x={point.x} y={chartGeometry.height - 12} textAnchor="middle" fontSize="11" fill="#64748b">
                            {point.label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {chartData.points
                      .filter((point) => point.total > 0)
                      .slice(-3)
                      .reverse()
                      .map((point) => (
                        <div key={point.key} className="rounded-[20px] border border-sky-100 bg-white/85 px-4 py-3">
                          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{point.fullLabel}</p>
                          <p className="mt-2 text-lg font-semibold text-slate-900">{formatCurrency(point.total)}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {point.invoiceCount} paid invoice{point.invoiceCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
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
        onLoadUsers={loadUsers}
        auditEvents={auditEvents}
        onLoadAuditEvents={loadAuditEvents}
        patients={patients.filter((patient) => patient.status === "done" && !patient.billed)}
        catalogItems={catalogItems}
        onLoadCatalogItems={loadCatalogItems}
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
        onExportPatientsCsv={handleExportPatientsCsv}
        onExportVisitsCsv={handleExportVisitsCsv}
        onExportInvoicesCsv={handleExportInvoicesCsv}
        onCheckInAppointment={async (appointmentId, options) => {
          const checkedInPatient = options?.existingPatientId
            ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId)
            : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
          setPatients((current) => [checkedInPatient, ...current]);
          return {
            id: appointmentId,
            checked_in_at: new Date().toISOString(),
            checked_in_patient_id: checkedInPatient.id,
          };
        }}
        onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
        onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
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
