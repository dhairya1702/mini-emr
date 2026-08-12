"use client";

import { useMemo, useState } from "react";

import { MyopiaHistory } from "@/lib/types";
import { buildMyopiaChartModel } from "@/lib/optometry/myopia/chart";

export function MyopiaProgressionChart({ history }: { history: MyopiaHistory | null }) {
  const [range, setRange] = useState<"1y" | "2y" | "all">("1y");
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    title: string;
    value: string;
  } | null>(null);
  const visibleHistory = useMemo(() => {
    const records = history?.records ?? [];
    if (!history || range === "all" || records.length < 2) {
      return history;
    }
    const latestMeasuredAt = new Date(records[records.length - 1]!.measured_at);
    const cutoff = new Date(latestMeasuredAt);
    cutoff.setFullYear(cutoff.getFullYear() - (range === "1y" ? 1 : 2));
    const visibleRecords = records.filter((record) => new Date(record.measured_at) >= cutoff);
    return { ...history, records: visibleRecords.length ? visibleRecords : records.slice(-1) };
  }, [history, range]);
  const model = buildMyopiaChartModel(visibleHistory);

  if (!model) {
    return null;
  }

  const tooltipWidth = hoveredPoint ? Math.max(150, hoveredPoint.value.length * 7 + 30) : 0;
  const tooltipX = hoveredPoint
    ? Math.min(
      Math.max(hoveredPoint.x - tooltipWidth / 2, model.chartPadding.left),
      model.chartWidth - model.chartPadding.right - tooltipWidth,
    )
    : 0;
  const tooltipY = hoveredPoint ? Math.max(model.chartPadding.top, hoveredPoint.y - 62) : 0;
  const projectedSixMonthAge = model.latestRecord ? model.latestRecord.age_years + 0.5 : null;
  const projectedTwelveMonthAge = model.latestRecord ? model.latestRecord.age_years + 1 : null;
  const projectedSixMonthRight = model.projectedSixMonthRight;
  const projectedSixMonthLeft = model.projectedSixMonthLeft;
  const projectedTwelveMonthRight = model.projectedTwelveMonthRight;
  const projectedTwelveMonthLeft = model.projectedTwelveMonthLeft;

  return (
    <div className="rounded-xl border border-[#dbe7ef] bg-white p-4 text-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">Axial length trend with reference band</p>
        <p className="text-[11px] font-medium text-slate-950">{model.overlayVersion}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium text-slate-950">
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 bg-teal-700" /> OD (Right eye)</span>
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 bg-violet-700" /> OS (Left eye)</span>
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-4 bg-[#dbeafe]" /> Reference band</span>
          <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-white" /> Visit</span>
          <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-slate-950" /> Projected</span>
        </div>
        <div className="inline-flex rounded-lg border border-[#dbe7ef] p-0.5" aria-label="Chart date range">
          {(["1y", "2y", "all"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              aria-pressed={range === option}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${range === option ? "bg-blue-50 text-blue-700 ring-1 ring-blue-500" : "text-slate-950 hover:bg-[#f3f8fb]"}`}
            >
              {option === "all" ? "All" : option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${model.chartWidth} ${model.chartHeight}`} className="mt-2 min-w-[720px]">
          <rect x="0" y="0" width={model.chartWidth} height={model.chartHeight} rx="20" fill="#f8fbff" />
          {model.yTicks.map((tick) => (
            <g key={tick}>
              <line x1={model.chartPadding.left} y1={model.yForMm(tick)} x2={model.chartWidth - model.chartPadding.right} y2={model.yForMm(tick)} stroke="#dbeafe" strokeDasharray="4 6" />
              <text x={model.chartPadding.left - 10} y={model.yForMm(tick) + 4} textAnchor="end" className="fill-slate-950 text-[11px]">
                {tick.toFixed(1)}
              </text>
            </g>
          ))}
          <path d={model.referenceBandPath} fill="rgba(125, 211, 252, 0.18)" stroke="none" />
          <path d={model.rightLinePath} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={model.leftLinePath} fill="none" stroke="#4f46e5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {model.projectedRightPath ? (
            <path d={model.projectedRightPath} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeDasharray="8 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
          ) : null}
          {model.projectedLeftPath ? (
            <path d={model.projectedLeftPath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeDasharray="8 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
          ) : null}
          {model.myopiaRecords.map((record) => (
            <g key={record.id}>
              <circle
                cx={model.xForAge(record.age_years)}
                cy={model.yForMm(record.axial_length_right_mm)}
                r="5.5"
                fill="#0f766e"
                onMouseEnter={() => setHoveredPoint({
                  x: model.xForAge(record.age_years),
                  y: model.yForMm(record.axial_length_right_mm),
                  title: `OD · age ${record.age_years.toFixed(1)}y`,
                  value: `${record.axial_length_right_mm.toFixed(2)} mm`,
                })}
                onMouseLeave={() => setHoveredPoint(null)}
              />
              <circle
                cx={model.xForAge(record.age_years)}
                cy={model.yForMm(record.axial_length_left_mm)}
                r="5.5"
                fill="#4f46e5"
                onMouseEnter={() => setHoveredPoint({
                  x: model.xForAge(record.age_years),
                  y: model.yForMm(record.axial_length_left_mm),
                  title: `OS · age ${record.age_years.toFixed(1)}y`,
                  value: `${record.axial_length_left_mm.toFixed(2)} mm`,
                })}
                onMouseLeave={() => setHoveredPoint(null)}
              />
              <text x={model.xForAge(record.age_years)} y={model.chartHeight - 12} textAnchor="middle" className="fill-slate-950 text-[11px]">
                {new Date(record.measured_at).toLocaleDateString([], { month: "short", year: "2-digit" })}
              </text>
            </g>
          ))}
          {projectedSixMonthAge !== null && projectedSixMonthRight !== null ? (
            <circle
              cx={model.xForAge(projectedSixMonthAge)}
              cy={model.yForMm(projectedSixMonthRight)}
              r="5.5"
              fill="#ffffff"
              stroke="#0f766e"
              strokeWidth="2.5"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(projectedSixMonthAge),
                y: model.yForMm(projectedSixMonthRight),
                title: "Projected OD · 6 months",
                value: `${projectedSixMonthRight.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ) : null}
          {projectedSixMonthAge !== null && projectedSixMonthLeft !== null ? (
            <circle
              cx={model.xForAge(projectedSixMonthAge)}
              cy={model.yForMm(projectedSixMonthLeft)}
              r="5.5"
              fill="#ffffff"
              stroke="#4f46e5"
              strokeWidth="2.5"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(projectedSixMonthAge),
                y: model.yForMm(projectedSixMonthLeft),
                title: "Projected OS · 6 months",
                value: `${projectedSixMonthLeft.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ) : null}
          {projectedTwelveMonthAge !== null && projectedTwelveMonthRight !== null ? (
            <circle
              cx={model.xForAge(projectedTwelveMonthAge)}
              cy={model.yForMm(projectedTwelveMonthRight)}
              r="5.5"
              fill="#ffffff"
              stroke="#0f766e"
              strokeWidth="2.5"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(projectedTwelveMonthAge),
                y: model.yForMm(projectedTwelveMonthRight),
                title: "Projected OD · 12 months",
                value: `${projectedTwelveMonthRight.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ) : null}
          {projectedTwelveMonthAge !== null && projectedTwelveMonthLeft !== null ? (
            <circle
              cx={model.xForAge(projectedTwelveMonthAge)}
              cy={model.yForMm(projectedTwelveMonthLeft)}
              r="5.5"
              fill="#ffffff"
              stroke="#4f46e5"
              strokeWidth="2.5"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(projectedTwelveMonthAge),
                y: model.yForMm(projectedTwelveMonthLeft),
                title: "Projected OS · 12 months",
                value: `${projectedTwelveMonthLeft.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ) : null}
          {hoveredPoint ? (
            <g pointerEvents="none">
              <rect
                x={tooltipX}
                y={tooltipY}
                width={tooltipWidth}
                height="48"
                rx="12"
                fill="#0f172a"
                opacity="0.95"
              />
              <text x={tooltipX + 12} y={tooltipY + 18} className="fill-white text-[11px] font-medium">
                {hoveredPoint.title}
              </text>
              <text x={tooltipX + 12} y={tooltipY + 36} className="fill-white text-[12px]">
                {hoveredPoint.value}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
