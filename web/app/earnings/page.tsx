"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Download, ReceiptIndianRupee, Search } from "lucide-react";

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
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [openingInvoiceId, setOpeningInvoiceId] = useState("");
  const [hoveredChartPointKey, setHoveredChartPointKey] = useState<string | null>(null);
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
    applyClinicSettings,
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

  const filteredPaidInvoices = useMemo(() => {
    const query = invoiceSearch.trim().toLowerCase();
    if (!query) {
      return paidInvoices;
    }
    return paidInvoices.filter((invoice) =>
      (patientNames[invoice.patient_id] || "Patient").toLowerCase().includes(query),
    );
  }, [invoiceSearch, paidInvoices, patientNames]);

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
    const height = 220;
    const paddingLeft = 58;
    const paddingRight = 18;
    const paddingTop = 18;
    const paddingBottom = 36;
    const innerWidth = width - paddingLeft - paddingRight;
    const innerHeight = height - paddingTop - paddingBottom;
    const maxValue = Math.max(...chartData.points.map((point) => point.total), 0);
    const safeMax = maxValue > 0 ? maxValue : 1;
    const stepX = chartData.points.length > 1 ? innerWidth / (chartData.points.length - 1) : 0;

    const points = chartData.points.map((point, index) => {
      const x = paddingLeft + stepX * index;
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

    return {
      width,
      height,
      paddingLeft,
      paddingRight,
      paddingTop,
      paddingBottom,
      innerHeight,
      points,
      linePath,
      areaPath,
      yTicks,
      baselineY: paddingTop + innerHeight,
    };
  }, [chartData]);

  const hoveredChartPoint = useMemo(
    () => chartGeometry.points.find((point) => point.key === hoveredChartPointKey) ?? null,
    [chartGeometry.points, hoveredChartPointKey],
  );

  const summary = useMemo(() => {
    const now = new Date();
    const todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekKey = startOfWeek(now).toISOString();
    const monthKey = startOfMonth(now).toISOString();

    let today = 0;
    let week = 0;
    let month = 0;
    for (const invoice of paidInvoices) {
      const sourceDate = new Date(invoice.paid_at || invoice.created_at);
      const dayStart = new Date(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate()).toISOString();
      const weekStart = startOfWeek(sourceDate).toISOString();
      const monthStart = startOfMonth(sourceDate).toISOString();

      if (dayStart === todayKey) today += invoice.total;
      if (weekStart === weekKey) week += invoice.total;
      if (monthStart === monthKey) month += invoice.total;
    }

    return { today, week, month };
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

  async function handleOpenInvoice(invoiceId: string) {
    setOpeningInvoiceId(invoiceId);
    try {
      const blob = await api.generateInvoicePdf(invoiceId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (openError) {
      setExportError(openError instanceof Error ? openError.message : "Failed to open invoice.");
    } finally {
      setOpeningInvoiceId("");
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

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-[24px] border border-sky-100 bg-white/95 px-4 py-3.5 shadow-[0_16px_44px_rgba(125,211,252,0.12)]">
            <div className="flex items-center gap-2.5 text-sky-700">
              <CalendarDays className="h-4.5 w-4.5" />
              <p className="text-xs font-medium uppercase tracking-[0.16em]">Today</p>
            </div>
            <p className="mt-2 text-[1.45rem] font-semibold leading-none text-slate-900">{formatCurrency(summary.today)}</p>
          </div>
          <div className="rounded-[24px] border border-sky-100 bg-white/95 px-4 py-3.5 shadow-[0_16px_44px_rgba(125,211,252,0.12)]">
            <div className="flex items-center gap-2.5 text-sky-700">
              <CalendarDays className="h-4.5 w-4.5" />
              <p className="text-xs font-medium uppercase tracking-[0.16em]">This Week</p>
            </div>
            <p className="mt-2 text-[1.45rem] font-semibold leading-none text-slate-900">{formatCurrency(summary.week)}</p>
          </div>
          <div className="rounded-[24px] border border-sky-100 bg-white/95 px-4 py-3.5 shadow-[0_16px_44px_rgba(125,211,252,0.12)]">
            <div className="flex items-center gap-2.5 text-sky-700">
              <CalendarDays className="h-4.5 w-4.5" />
              <p className="text-xs font-medium uppercase tracking-[0.16em]">This Month</p>
            </div>
            <p className="mt-2 text-[1.45rem] font-semibold leading-none text-slate-900">{formatCurrency(summary.month)}</p>
          </div>
        </section>

        <section className="mt-5 space-y-4">
          <div className="rounded-[32px] border border-sky-100 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Earnings</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">Collection graph</h2>
                <p className="mt-1.5 text-sm text-slate-500">{chartData.title} · {chartData.subtitle}</p>
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

            <div className="mt-5 rounded-[28px] border border-sky-100 bg-[linear-gradient(180deg,rgba(240,249,255,0.9),rgba(255,255,255,1))] p-4">
              {paidInvoices.length ? (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-600">Collected amount</p>
                    <p className="text-xs text-slate-500">
                      Peak {formatCurrency(Math.max(...chartData.points.map((point) => point.total), 0))}
                    </p>
                  </div>

                  <div className="relative overflow-x-auto">
                    {hoveredChartPoint ? (
                      <div
                        className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-[18px] border border-sky-200 bg-white/95 px-3 py-2 shadow-[0_14px_34px_rgba(125,211,252,0.22)]"
                        style={{
                          left: `${(hoveredChartPoint.x / chartGeometry.width) * 100}%`,
                          top: `${Math.max(0, (hoveredChartPoint.y / chartGeometry.height) * 100 - 16)}%`,
                        }}
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          {hoveredChartPoint.fullLabel}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {formatCurrency(hoveredChartPoint.total)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {hoveredChartPoint.invoiceCount} paid invoice{hoveredChartPoint.invoiceCount === 1 ? "" : "s"}
                        </p>
                      </div>
                    ) : null}
                    <svg
                      viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`}
                      className="min-w-[720px]"
                      role="img"
                      aria-label="Collections chart"
                    >
                      <line
                        x1={chartGeometry.paddingLeft}
                        y1={chartGeometry.paddingTop}
                        x2={chartGeometry.paddingLeft}
                        y2={chartGeometry.baselineY}
                        stroke="rgba(148,163,184,0.28)"
                      />
                      <line
                        x1={chartGeometry.paddingLeft}
                        y1={chartGeometry.baselineY}
                        x2={chartGeometry.width - chartGeometry.paddingRight}
                        y2={chartGeometry.baselineY}
                        stroke="rgba(148,163,184,0.28)"
                      />

                      {chartGeometry.yTicks.map((tick) => (
                        <g key={`${tick.value}-${tick.y}`}>
                          <line
                            x1={chartGeometry.paddingLeft}
                            y1={tick.y}
                            x2={chartGeometry.width - chartGeometry.paddingRight}
                            y2={tick.y}
                            stroke="rgba(148,163,184,0.18)"
                            strokeDasharray="4 6"
                          />
                          <text x={chartGeometry.paddingLeft - 8} y={tick.y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                            {formatCurrency(tick.value)}
                          </text>
                        </g>
                      ))}

                      <path d={chartGeometry.areaPath} fill="rgba(14,165,233,0.12)" />
                      <path
                        d={chartGeometry.linePath}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {chartGeometry.points.map((point) => (
                        <g
                          key={point.key}
                          onMouseEnter={() => setHoveredChartPointKey(point.key)}
                          onMouseLeave={() => setHoveredChartPointKey((current) => (current === point.key ? null : current))}
                        >
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r="10"
                            fill="transparent"
                          />
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={hoveredChartPointKey === point.key ? "6" : "4.5"}
                            fill="#ffffff"
                            stroke="#0ea5e9"
                            strokeWidth={hoveredChartPointKey === point.key ? "3" : "2.5"}
                          />
                          <text x={point.x} y={chartGeometry.height - 10} textAnchor="middle" fontSize="10" fill="#64748b">
                            {point.label}
                          </text>
                        </g>
                      ))}
                    </svg>
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
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="flex items-center gap-3">
                <ReceiptIndianRupee className="h-5 w-5 text-sky-700" />
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Recent Bills</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">Latest paid invoices</h2>
                </div>
              </div>
              <label className="relative block w-full md:w-[320px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={invoiceSearch}
                  onChange={(event) => setInvoiceSearch(event.target.value)}
                  placeholder="Search patient"
                  className="h-11 w-full rounded-full border border-sky-200 bg-sky-50/70 pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white"
                />
              </label>
            </div>

            <div className="mt-5 overflow-hidden rounded-[26px] border border-sky-100">
              {filteredPaidInvoices.length ? (
                <div>
                  <div className="grid grid-cols-4 gap-6 bg-sky-50/80 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <p>Patient</p>
                    <p>Items</p>
                    <p>Paid On</p>
                    <p className="text-right">Amount</p>
                  </div>
                  {filteredPaidInvoices.slice(0, 12).map((invoice, index) => (
                    <button
                      key={invoice.id}
                      type="button"
                      onClick={() => void handleOpenInvoice(invoice.id)}
                      disabled={openingInvoiceId === invoice.id}
                      className={`grid w-full grid-cols-4 items-center gap-6 px-5 py-3.5 text-left transition hover:bg-sky-50 disabled:cursor-wait disabled:opacity-70 ${
                        index === 0 ? "border-t border-sky-100" : "border-t border-sky-100"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {patientNames[invoice.patient_id] || "Patient"}
                        </p>
                      </div>
                      <p className="text-sm text-slate-600">
                        {invoice.items.length} item{invoice.items.length === 1 ? "" : "s"}
                      </p>
                      <p className="text-sm text-slate-600">
                        {new Date(invoice.paid_at || invoice.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="text-right text-base font-semibold text-slate-900">
                        {openingInvoiceId === invoice.id ? "Opening..." : formatCurrency(invoice.total)}
                      </p>
                    </button>
                  ))}
                </div>
              ) : paidInvoices.length ? (
                <div className="rounded-[28px] border border-dashed border-sky-300 bg-sky-50/20 px-6 py-16 text-center text-sm text-slate-500">
                  No paid invoices match that patient.
                </div>
              ) : (
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
        onClinicSettingsChange={applyClinicSettings}
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
