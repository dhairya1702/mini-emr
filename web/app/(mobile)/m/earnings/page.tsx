"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Download, ReceiptIndianRupee, Search } from "lucide-react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileAdminGate } from "@/components/mobile/mobile-admin-gate";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { api } from "@/lib/api";
import type { Invoice } from "@/lib/types";

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function MobileEarningsPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin } = useClinicShell();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<GroupMode>("week");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [openingInvoiceId, setOpeningInvoiceId] = useState("");
  const [hoveredPointKey, setHoveredPointKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || currentUser?.role !== "admin") return;
    let active = true;
    setIsLoading(true);
    api.listInvoices({ limit: 500 })
      .then((rows) => {
        if (!active) return;
        setInvoices(rows);
        setError("");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load earnings.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  const paidInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) => invoice.payment_status === "paid" && Boolean(invoice.completed_at))
        .sort((left, right) => (right.paid_at || right.created_at).localeCompare(left.paid_at || left.created_at)),
    [invoices],
  );

  const filteredPaidInvoices = useMemo(() => {
    const query = invoiceSearch.trim().toLowerCase();
    if (!query) return paidInvoices;
    return paidInvoices.filter((invoice) => (invoice.patient_name || "Patient").toLowerCase().includes(query));
  }, [invoiceSearch, paidInvoices]);

  const chartData = useMemo(() => {
    const now = new Date();
    if (mode === "week") {
      const weekStart = startOfWeek(now);
      const points = Array.from({ length: 7 }, (_, index) => {
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
          (new Date(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate()).getTime() - weekStart.getTime()) / 86_400_000,
        );
        if (dayIndex >= 0 && dayIndex < 7) {
          points[dayIndex].total += invoice.total;
          points[dayIndex].invoiceCount += 1;
        }
      }
      return {
        title: "Weekly collections",
        subtitle: `Week of ${weekStart.toLocaleDateString([], { month: "short", day: "numeric" })}`,
        points,
      };
    }

    if (mode === "month") {
      const monthStart = startOfMonth(now);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const points = Array.from({ length: daysInMonth }, (_, index) => ({
        key: `${index + 1}`,
        label: String(index + 1),
        fullLabel: new Date(now.getFullYear(), now.getMonth(), index + 1).toLocaleDateString([], { month: "short", day: "numeric" }),
        total: 0,
        invoiceCount: 0,
      }));
      for (const invoice of paidInvoices) {
        const sourceDate = new Date(invoice.paid_at || invoice.created_at);
        if (sourceDate >= monthStart && sourceDate.getMonth() === now.getMonth() && sourceDate.getFullYear() === now.getFullYear()) {
          points[sourceDate.getDate() - 1].total += invoice.total;
          points[sourceDate.getDate() - 1].invoiceCount += 1;
        }
      }
      return {
        title: "Daily collections",
        subtitle: now.toLocaleDateString([], { month: "long", year: "numeric" }),
        points,
      };
    }

    const yearStart = startOfYear(now);
    const points = Array.from({ length: 12 }, (_, index) => ({
      key: `${index}`,
      label: new Date(now.getFullYear(), index, 1).toLocaleDateString([], { month: "short" }),
      fullLabel: new Date(now.getFullYear(), index, 1).toLocaleDateString([], { month: "long", year: "numeric" }),
      total: 0,
      invoiceCount: 0,
    }));
    for (const invoice of paidInvoices) {
      const sourceDate = new Date(invoice.paid_at || invoice.created_at);
      if (sourceDate >= yearStart && sourceDate.getFullYear() === now.getFullYear()) {
        points[sourceDate.getMonth()].total += invoice.total;
        points[sourceDate.getMonth()].invoiceCount += 1;
      }
    }
    return {
      title: "Monthly collections",
      subtitle: String(now.getFullYear()),
      points,
    };
  }, [mode, paidInvoices]);

  const chartGeometry = useMemo(() => {
    const width = mode === "month" ? 920 : 640;
    const height = 230;
    const paddingLeft = 54;
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
    const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const areaPath = points.length
      ? `${linePath} L ${points[points.length - 1].x} ${paddingTop + innerHeight} L ${points[0].x} ${paddingTop + innerHeight} Z`
      : "";
    const yTicks = Array.from({ length: 4 }, (_, index) => ({
      value: safeMax * (1 - index / 3),
      y: paddingTop + innerHeight * (index / 3),
    }));
    return {
      width,
      height,
      paddingLeft,
      paddingRight,
      paddingTop,
      innerHeight,
      baselineY: paddingTop + innerHeight,
      points,
      linePath,
      areaPath,
      yTicks,
    };
  }, [chartData.points, mode]);

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

  const hoveredPoint = useMemo(
    () => chartGeometry.points.find((point) => point.key === hoveredPointKey) ?? null,
    [chartGeometry.points, hoveredPointKey],
  );

  async function handleExportInvoices() {
    setIsExporting(true);
    setError("");
    try {
      downloadBlob(await api.exportInvoicesCsv(), "invoices.csv");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export invoices.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleOpenInvoice(invoiceId: string) {
    setOpeningInvoiceId(invoiceId);
    setError("");
    try {
      const blob = await api.generateInvoicePdf(invoiceId);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open invoice.");
    } finally {
      setOpeningInvoiceId("");
    }
  }

  return (
    <MobileAdminGate title="Earnings">
      <MobileShell title="Earnings">
        {error ? <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        {isLoading ? (
          <p className="clinic-empty-state">Loading earnings...</p>
        ) : (
          <div className="grid gap-4">
            <section className="grid grid-cols-3 gap-2">
              {[
                ["Today", summary.today],
                ["This week", summary.week],
                ["This month", summary.month],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[16px] border border-[#dbe7ef] bg-white px-3 py-3 shadow-[0_10px_24px_rgba(64,131,181,0.07)]">
                  <div className="flex items-center gap-1.5 text-[#2a6fa8]">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">{label}</p>
                  </div>
                  <p className="mt-2 truncate text-lg font-semibold leading-none text-slate-900">{formatCurrency(Number(value))}</p>
                </div>
              ))}
            </section>

            <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-4 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Earnings</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">Collection graph</h2>
                  <p className="mt-1 text-xs text-slate-500">{chartData.title} · {chartData.subtitle}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                {(["week", "month", "year"] as GroupMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={`rounded-xl px-4 py-2 text-sm font-medium ${
                      mode === option ? "bg-[#2f8fd3] text-white" : "border border-[#bfd7e8] bg-[#f3f8fb] text-slate-700"
                    }`}
                  >
                    {option === "week" ? "Weekly" : option === "month" ? "Monthly" : "Yearly"}
                  </button>
                ))}
              </div>
              <div className="mt-4 rounded-[16px] border border-[#dbe7ef] bg-[linear-gradient(180deg,rgba(240,249,255,0.9),rgba(255,255,255,1))] p-3">
                {paidInvoices.length ? (
                  <div className="relative overflow-x-auto">
                    {hoveredPoint ? (
                      <div
                        className="pointer-events-none absolute z-10 rounded-xl border border-[#bfd7e8] bg-white/95 px-3 py-2 text-xs shadow-[0_14px_34px_rgba(64,131,181,0.12)]"
                        style={{
                          left: `${(hoveredPoint.x / chartGeometry.width) * 100}%`,
                          top: `${Math.max(0, (hoveredPoint.y / chartGeometry.height) * 100 - 12)}%`,
                        }}
                      >
                        <p className="font-semibold text-slate-900">{formatCurrency(hoveredPoint.total)}</p>
                        <p className="text-slate-500">{hoveredPoint.fullLabel}</p>
                      </div>
                    ) : null}
                    <svg viewBox={`0 0 ${chartGeometry.width} ${chartGeometry.height}`} className="min-w-[620px]" role="img" aria-label="Collections chart">
                      <line x1={chartGeometry.paddingLeft} y1={chartGeometry.paddingTop} x2={chartGeometry.paddingLeft} y2={chartGeometry.baselineY} stroke="rgba(148,163,184,0.28)" />
                      <line x1={chartGeometry.paddingLeft} y1={chartGeometry.baselineY} x2={chartGeometry.width - chartGeometry.paddingRight} y2={chartGeometry.baselineY} stroke="rgba(148,163,184,0.28)" />
                      {chartGeometry.yTicks.map((tick) => (
                        <g key={`${tick.value}-${tick.y}`}>
                          <line x1={chartGeometry.paddingLeft} y1={tick.y} x2={chartGeometry.width - chartGeometry.paddingRight} y2={tick.y} stroke="rgba(148,163,184,0.18)" strokeDasharray="4 6" />
                          <text x={chartGeometry.paddingLeft - 8} y={tick.y + 4} textAnchor="end" fontSize="10" fill="#64748b">
                            {formatCurrency(tick.value)}
                          </text>
                        </g>
                      ))}
                      <path d={chartGeometry.areaPath} fill="rgba(47,143,211,0.12)" />
                      <path d={chartGeometry.linePath} fill="none" stroke="#38bdf8" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                      {chartGeometry.points.map((point) => (
                        <g key={point.key} onMouseEnter={() => setHoveredPointKey(point.key)} onMouseLeave={() => setHoveredPointKey(null)}>
                          <circle cx={point.x} cy={point.y} r="10" fill="transparent" />
                          <circle cx={point.x} cy={point.y} r="4.5" fill="#ffffff" stroke="#0ea5e9" strokeWidth="2.5" />
                          <text x={point.x} y={chartGeometry.height - 10} textAnchor="middle" fontSize="10" fill="#64748b">
                            {point.label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                ) : (
                  <p className="rounded-[14px] border border-dashed border-[#bfd7e8] px-4 py-10 text-center text-sm text-slate-500">No paid invoices yet.</p>
                )}
              </div>
            </section>

            <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-4 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
              <div className="flex items-center gap-2">
                <ReceiptIndianRupee className="h-5 w-5 text-[#2a6fa8]" />
                <h2 className="text-lg font-semibold text-slate-900">Latest paid invoices</h2>
              </div>
              <div className="mt-4 flex gap-2">
                <label className="relative block min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={invoiceSearch}
                    onChange={(event) => setInvoiceSearch(event.target.value)}
                    placeholder="Search patient"
                    className="h-11 w-full rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/70 pl-10 pr-4 text-sm text-slate-700 outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleExportInvoices()}
                  disabled={isExporting}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-800 disabled:opacity-60"
                  aria-label="Export invoices"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 overflow-hidden rounded-[16px] border border-[#dbe7ef]">
                {filteredPaidInvoices.length ? (
                  <div>
                    <div className="grid grid-cols-[1fr_auto] bg-[#f3f8fb]/80 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      <p>Patient</p>
                      <p className="text-right">Amount</p>
                    </div>
                    {filteredPaidInvoices.slice(0, 8).map((invoice) => (
                      <button
                        key={invoice.id}
                        type="button"
                        onClick={() => void handleOpenInvoice(invoice.id)}
                        disabled={openingInvoiceId === invoice.id}
                        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-t border-[#dbe7ef] px-4 py-3 text-left disabled:opacity-70"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{invoice.patient_name || "Patient"}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {invoice.items.length} item{invoice.items.length === 1 ? "" : "s"} · {new Date(invoice.paid_at || invoice.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">
                          {openingInvoiceId === invoice.id ? "Opening..." : formatCurrency(invoice.total)}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">
                    {paidInvoices.length ? "No paid invoices match that patient." : "No earnings data yet."}
                  </p>
                )}
              </div>
            </section>
          </div>
        )}
      </MobileShell>
    </MobileAdminGate>
  );
}
