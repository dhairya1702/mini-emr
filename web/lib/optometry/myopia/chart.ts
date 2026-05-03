import { MYOPIA_REFERENCE_BAND } from "@/lib/myopia-reference";
import { MyopiaHistory, MyopiaMeasurementRecord } from "@/lib/types";

import {
  estimateTreatmentEffectiveness,
  estimateUntreatedAnnualElongation,
} from "@/lib/optometry/myopia/shared";

type ModeledPoint = {
  age: number;
  right: number;
  left: number;
};

const CHART_WIDTH = 760;
const CHART_HEIGHT = 260;
const CHART_PADDING = { top: 20, right: 28, bottom: 40, left: 56 };

function buildPath(values: Array<{ x: number; y: number }>) {
  return values.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function buildModeledPoints(records: MyopiaMeasurementRecord[], ages: number[], treated: boolean) {
  const baselineRecord = records[0] ?? null;
  if (!baselineRecord) {
    return [];
  }

  return ages.map((ageValue) => {
    let cumulativeGrowth = 0;
    let currentAge = baselineRecord.age_years;

    while (currentAge < ageValue - 0.001) {
      const nextAge = Math.min(ageValue, currentAge + 0.5);
      const segmentYears = nextAge - currentAge;
      const untreatedAnnual = estimateUntreatedAnnualElongation(currentAge + segmentYears / 2);
      const treatedAnnual = treated
        ? untreatedAnnual * (1 - estimateTreatmentEffectiveness(
          [...records].reverse().find((record) => record.age_years <= currentAge + 0.001)?.treatment_type ?? baselineRecord.treatment_type,
        ))
        : untreatedAnnual;
      cumulativeGrowth += treatedAnnual * segmentYears;
      currentAge = nextAge;
    }

    return {
      age: ageValue,
      right: baselineRecord.axial_length_right_mm + cumulativeGrowth,
      left: baselineRecord.axial_length_left_mm + cumulativeGrowth,
    };
  });
}

export type MyopiaChartHoverPoint = {
  x: number;
  y: number;
  title: string;
  value: string;
};

export type MyopiaChartModel = {
  chartWidth: number;
  chartHeight: number;
  chartPadding: typeof CHART_PADDING;
  latestRecord: MyopiaMeasurementRecord | null;
  myopiaRecords: MyopiaMeasurementRecord[];
  yTicks: number[];
  referenceBandPath: string;
  rightLinePath: string;
  leftLinePath: string;
  untreatedRightPath: string;
  untreatedLeftPath: string;
  treatedRightPath: string;
  treatedLeftPath: string;
  projectedRightPath: string;
  projectedLeftPath: string;
  projectedSixMonthRight: number | null;
  projectedSixMonthLeft: number | null;
  projectedTwelveMonthRight: number | null;
  projectedTwelveMonthLeft: number | null;
  modeledUntreatedPoints: ModeledPoint[];
  modeledTreatedPoints: ModeledPoint[];
  expectedUntreatedDelta: ModeledPoint | null;
  expectedTreatedDelta: ModeledPoint | null;
  efficacyRight: number | null;
  efficacyLeft: number | null;
  overlayVersion: string;
  xForAge: (age: number) => number;
  yForMm: (mm: number) => number;
};

export function buildMyopiaChartModel(history: MyopiaHistory | null): MyopiaChartModel | null {
  const myopiaRecords = history?.records ?? [];
  if (!myopiaRecords.length) {
    return null;
  }

  const latestRecord = myopiaRecords[myopiaRecords.length - 1] ?? null;
  const projectedSixMonthRight = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_right_mm + history.annualized_growth.right_mm * 0.5
    : null;
  const projectedSixMonthLeft = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_left_mm + history.annualized_growth.left_mm * 0.5
    : null;
  const projectedTwelveMonthRight = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_right_mm + history.annualized_growth.right_mm
    : null;
  const projectedTwelveMonthLeft = latestRecord && history?.annualized_growth
    ? latestRecord.axial_length_left_mm + history.annualized_growth.left_mm
    : null;

  const ages = myopiaRecords.map((record) => record.age_years);
  const mmValues = myopiaRecords.flatMap((record) => [record.axial_length_right_mm, record.axial_length_left_mm]);
  const referenceLower = MYOPIA_REFERENCE_BAND.map((entry) => entry.lower_mm);
  const referenceUpper = MYOPIA_REFERENCE_BAND.map((entry) => entry.upper_mm);
  const projectedAges = latestRecord && history?.annualized_growth
    ? [latestRecord.age_years + 0.5, latestRecord.age_years + 1.0]
    : [];
  const modeledAges = [
    ...myopiaRecords.map((record) => record.age_years),
    ...projectedAges,
  ];
  const modeledUntreatedPoints = buildModeledPoints(myopiaRecords, modeledAges, false);
  const modeledTreatedPoints = buildModeledPoints(myopiaRecords, modeledAges, true);
  const baselineRecord = myopiaRecords[0] ?? null;
  const projectedValues = [
    projectedSixMonthRight,
    projectedSixMonthLeft,
    projectedTwelveMonthRight,
    projectedTwelveMonthLeft,
    ...modeledUntreatedPoints.flatMap((point) => [point.right, point.left]),
    ...modeledTreatedPoints.flatMap((point) => [point.right, point.left]),
  ].filter((value): value is number => value !== null);
  const minAge = Math.min(...ages, MYOPIA_REFERENCE_BAND[0]!.age);
  const maxAge = Math.max(
    ...ages,
    ...projectedAges,
    MYOPIA_REFERENCE_BAND[MYOPIA_REFERENCE_BAND.length - 1]!.age,
  );
  const minMm = Math.floor((Math.min(...mmValues, ...referenceLower) - 0.2) * 10) / 10;
  const maxMm = Math.ceil((Math.max(...mmValues, ...referenceUpper, ...projectedValues) + 0.2) * 10) / 10;
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const xForAge = (age: number) => CHART_PADDING.left + ((age - minAge) / Math.max(maxAge - minAge, 1)) * plotWidth;
  const yForMm = (mm: number) => CHART_PADDING.top + (1 - (mm - minMm) / Math.max(maxMm - minMm, 0.001)) * plotHeight;
  const referenceBandPathTop = buildPath(MYOPIA_REFERENCE_BAND.map((entry) => ({
    x: xForAge(entry.age),
    y: yForMm(entry.upper_mm),
  })));
  const referenceBandPathBottom = [...MYOPIA_REFERENCE_BAND]
    .reverse()
    .map((entry) => `L ${xForAge(entry.age)} ${yForMm(entry.lower_mm)}`)
    .join(" ");
  const referenceBandPath = `${referenceBandPathTop} ${referenceBandPathBottom} Z`;
  const rightLinePath = buildPath(myopiaRecords.map((record) => ({
    x: xForAge(record.age_years),
    y: yForMm(record.axial_length_right_mm),
  })));
  const leftLinePath = buildPath(myopiaRecords.map((record) => ({
    x: xForAge(record.age_years),
    y: yForMm(record.axial_length_left_mm),
  })));
  const untreatedRightPath = buildPath(modeledUntreatedPoints.map((point) => ({ x: xForAge(point.age), y: yForMm(point.right) })));
  const untreatedLeftPath = buildPath(modeledUntreatedPoints.map((point) => ({ x: xForAge(point.age), y: yForMm(point.left) })));
  const treatedRightPath = buildPath(modeledTreatedPoints.map((point) => ({ x: xForAge(point.age), y: yForMm(point.right) })));
  const treatedLeftPath = buildPath(modeledTreatedPoints.map((point) => ({ x: xForAge(point.age), y: yForMm(point.left) })));
  const yTicks = Array.from({ length: 5 }, (_, index) => minMm + ((maxMm - minMm) / 4) * index);
  const projectedRightPath = latestRecord && projectedSixMonthRight !== null && projectedTwelveMonthRight !== null
    ? `M ${xForAge(latestRecord.age_years)} ${yForMm(latestRecord.axial_length_right_mm)} L ${xForAge(latestRecord.age_years + 0.5)} ${yForMm(projectedSixMonthRight)} L ${xForAge(latestRecord.age_years + 1)} ${yForMm(projectedTwelveMonthRight)}`
    : "";
  const projectedLeftPath = latestRecord && projectedSixMonthLeft !== null && projectedTwelveMonthLeft !== null
    ? `M ${xForAge(latestRecord.age_years)} ${yForMm(latestRecord.axial_length_left_mm)} L ${xForAge(latestRecord.age_years + 0.5)} ${yForMm(projectedSixMonthLeft)} L ${xForAge(latestRecord.age_years + 1)} ${yForMm(projectedTwelveMonthLeft)}`
    : "";
  const expectedUntreatedDelta = baselineRecord && latestRecord
    ? modeledUntreatedPoints.find((point) => Math.abs(point.age - latestRecord.age_years) < 0.001) ?? null
    : null;
  const expectedTreatedDelta = baselineRecord && latestRecord
    ? modeledTreatedPoints.find((point) => Math.abs(point.age - latestRecord.age_years) < 0.001) ?? null
    : null;
  const efficacyRight = expectedUntreatedDelta && baselineRecord && latestRecord
    ? ((expectedUntreatedDelta.right - latestRecord.axial_length_right_mm) / Math.max(expectedUntreatedDelta.right - baselineRecord.axial_length_right_mm, 0.001)) * 100
    : null;
  const efficacyLeft = expectedUntreatedDelta && baselineRecord && latestRecord
    ? ((expectedUntreatedDelta.left - latestRecord.axial_length_left_mm) / Math.max(expectedUntreatedDelta.left - baselineRecord.axial_length_left_mm, 0.001)) * 100
    : null;

  return {
    chartWidth: CHART_WIDTH,
    chartHeight: CHART_HEIGHT,
    chartPadding: CHART_PADDING,
    latestRecord,
    myopiaRecords,
    yTicks,
    referenceBandPath,
    rightLinePath,
    leftLinePath,
    untreatedRightPath,
    untreatedLeftPath,
    treatedRightPath,
    treatedLeftPath,
    projectedRightPath,
    projectedLeftPath,
    projectedSixMonthRight,
    projectedSixMonthLeft,
    projectedTwelveMonthRight,
    projectedTwelveMonthLeft,
    modeledUntreatedPoints,
    modeledTreatedPoints,
    expectedUntreatedDelta,
    expectedTreatedDelta,
    efficacyRight,
    efficacyLeft,
    overlayVersion: history?.overlay_version ?? "clinic-reference-v1",
    xForAge,
    yForMm,
  };
}
