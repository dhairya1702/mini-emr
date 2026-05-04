"use client";

import { useState } from "react";

import { MyopiaHistory } from "@/lib/types";
import { buildMyopiaChartModel } from "@/lib/optometry/myopia/chart";

export function MyopiaProgressionChart({ history }: { history: MyopiaHistory | null }) {
  const [hoveredPoint, setHoveredPoint] = useState<{
    x: number;
    y: number;
    title: string;
    value: string;
  } | null>(null);
  const model = buildMyopiaChartModel(history);

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
    <div className="rounded-[24px] border border-sky-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">Axial length trend with reference band</p>
        <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{model.overlayVersion}</p>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${model.chartWidth} ${model.chartHeight}`} className="min-w-[720px]">
          <rect x="0" y="0" width={model.chartWidth} height={model.chartHeight} rx="20" fill="#f8fbff" />
          {model.yTicks.map((tick) => (
            <g key={tick}>
              <line x1={model.chartPadding.left} y1={model.yForMm(tick)} x2={model.chartWidth - model.chartPadding.right} y2={model.yForMm(tick)} stroke="#dbeafe" strokeDasharray="4 6" />
              <text x={model.chartPadding.left - 10} y={model.yForMm(tick) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                {tick.toFixed(1)}
              </text>
            </g>
          ))}
          <path d={model.referenceBandPath} fill="rgba(125, 211, 252, 0.18)" stroke="none" />
          {model.untreatedRightPath ? (
            <path d={model.untreatedRightPath} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="4 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
          ) : null}
          {model.untreatedLeftPath ? (
            <path d={model.untreatedLeftPath} fill="none" stroke="#059669" strokeWidth="2" strokeDasharray="4 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.25" />
          ) : null}
          {model.treatedRightPath ? (
            <path d={model.treatedRightPath} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="10 6" strokeLinecap="round" strokeLinejoin="round" opacity="0.55" />
          ) : null}
          {model.treatedLeftPath ? (
            <path d={model.treatedLeftPath} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="10 6" strokeLinecap="round" strokeLinejoin="round" opacity="0.35" />
          ) : null}
          <path d={model.rightLinePath} fill="none" stroke="#0f766e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={model.leftLinePath} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {model.projectedRightPath ? (
            <path d={model.projectedRightPath} fill="none" stroke="#0f766e" strokeWidth="2.5" strokeDasharray="8 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
          ) : null}
          {model.projectedLeftPath ? (
            <path d={model.projectedLeftPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeDasharray="8 8" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
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
                fill="#2563eb"
                onMouseEnter={() => setHoveredPoint({
                  x: model.xForAge(record.age_years),
                  y: model.yForMm(record.axial_length_left_mm),
                  title: `OS · age ${record.age_years.toFixed(1)}y`,
                  value: `${record.axial_length_left_mm.toFixed(2)} mm`,
                })}
                onMouseLeave={() => setHoveredPoint(null)}
              />
              <text x={model.xForAge(record.age_years)} y={model.chartHeight - 12} textAnchor="middle" className="fill-slate-500 text-[11px]">
                {record.age_years.toFixed(1)}y
              </text>
            </g>
          ))}
          {model.modeledUntreatedPoints.map((point) => (
            <circle
              key={`untreated-${point.age}`}
              cx={model.xForAge(point.age)}
              cy={model.yForMm(point.right)}
              r="4.5"
              fill="#ffffff"
              stroke="#059669"
              strokeWidth="2"
              opacity="0.85"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(point.age),
                y: model.yForMm(point.right),
                title: `Expected untreated OD · age ${point.age.toFixed(1)}y`,
                value: `${point.right.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ))}
          {model.modeledUntreatedPoints.map((point) => (
            <circle
              key={`untreated-os-${point.age}`}
              cx={model.xForAge(point.age)}
              cy={model.yForMm(point.left)}
              r="4.5"
              fill="#ffffff"
              stroke="#10b981"
              strokeWidth="2"
              opacity="0.65"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(point.age),
                y: model.yForMm(point.left),
                title: `Expected untreated OS · age ${point.age.toFixed(1)}y`,
                value: `${point.left.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ))}
          {model.modeledTreatedPoints.map((point) => (
            <circle
              key={`treated-${point.age}`}
              cx={model.xForAge(point.age)}
              cy={model.yForMm(point.right)}
              r="4.5"
              fill="#ffffff"
              stroke="#7c3aed"
              strokeWidth="2"
              opacity="0.85"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(point.age),
                y: model.yForMm(point.right),
                title: `Expected treated OD · age ${point.age.toFixed(1)}y`,
                value: `${point.right.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
          ))}
          {model.modeledTreatedPoints.map((point) => (
            <circle
              key={`treated-os-${point.age}`}
              cx={model.xForAge(point.age)}
              cy={model.yForMm(point.left)}
              r="4.5"
              fill="#ffffff"
              stroke="#8b5cf6"
              strokeWidth="2"
              opacity="0.65"
              onMouseEnter={() => setHoveredPoint({
                x: model.xForAge(point.age),
                y: model.yForMm(point.left),
                title: `Expected treated OS · age ${point.age.toFixed(1)}y`,
                value: `${point.left.toFixed(2)} mm`,
              })}
              onMouseLeave={() => setHoveredPoint(null)}
            />
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
              stroke="#2563eb"
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
              stroke="#2563eb"
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
              <text x={tooltipX + 12} y={tooltipY + 36} className="fill-sky-100 text-[12px]">
                {hoveredPoint.value}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-teal-700" /> OD</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> OS</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-sky-200" /> Reference band</span>
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-emerald-600" /> Expected untreated</span>
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-violet-600" /> Expected treated</span>
        <span className="inline-flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-slate-500" /> Projection</span>
      </div>
    </div>
  );
}
