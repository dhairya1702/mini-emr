"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type {
  PatientChartVisit,
  PatientSummary,
  PatientTimelineEvent,
  PatientVisitDetail,
} from "@/lib/types";

type UsePatientChartDataOptions = {
  patientId: string;
  isTrainingMode: boolean;
  timelineActive: boolean;
  loadVisits: (patientId: string) => Promise<PatientChartVisit[]>;
  loadVisitDetail: (patientId: string, visitId: string) => Promise<PatientVisitDetail>;
  loadTimeline: (patientId: string) => Promise<PatientTimelineEvent[]>;
  loadSummary?: (patientId: string) => Promise<PatientSummary>;
};

export function usePatientChartData({
  patientId,
  isTrainingMode,
  timelineActive,
  loadVisits,
  loadVisitDetail,
  loadTimeline,
  loadSummary = api.getPatientSummary,
}: UsePatientChartDataOptions) {
  const [visits, setVisits] = useState<PatientChartVisit[]>([]);
  const [isVisitsLoading, setIsVisitsLoading] = useState(false);
  const [visitsError, setVisitsError] = useState("");
  const [visitDetailsById, setVisitDetailsById] = useState<Record<string, PatientVisitDetail>>({});
  const [visitDetailError, setVisitDetailError] = useState("");
  const [loadingVisitDetailId, setLoadingVisitDetailId] = useState("");
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [timeline, setTimeline] = useState<PatientTimelineEvent[]>([]);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [hasLoadedTimeline, setHasLoadedTimeline] = useState(false);
  const loadVisitsRef = useRef(loadVisits);
  const loadVisitDetailRef = useRef(loadVisitDetail);
  const loadTimelineRef = useRef(loadTimeline);
  const loadSummaryRef = useRef(loadSummary);
  loadVisitsRef.current = loadVisits;
  loadVisitDetailRef.current = loadVisitDetail;
  loadTimelineRef.current = loadTimeline;
  loadSummaryRef.current = loadSummary;

  useEffect(() => {
    setVisits([]);
    setIsVisitsLoading(false);
    setVisitsError("");
    setVisitDetailsById({});
    setVisitDetailError("");
    setLoadingVisitDetailId("");
    setSelectedVisitId("");
    setSummary(null);
    setIsSummaryLoading(false);
    setSummaryError("");
    setTimeline([]);
    setIsTimelineLoading(false);
    setTimelineError("");
    setHasLoadedTimeline(false);
  }, [patientId]);

  useEffect(() => {
    if (!patientId || isTrainingMode) return;
    let active = true;
    setIsSummaryLoading(true);
    setSummaryError("");
    void loadSummaryRef.current(patientId)
      .then((result) => {
        if (active) setSummary(result);
      })
      .catch((loadError) => {
        if (!active) return;
        setSummaryError(loadError instanceof Error ? loadError.message : "Failed to load summary.");
      })
      .finally(() => {
        if (active) setIsSummaryLoading(false);
      });
    return () => { active = false; };
  }, [isTrainingMode, patientId]);

  useEffect(() => {
    if (!patientId) return;
    let active = true;
    setIsVisitsLoading(true);
    setVisitsError("");
    void loadVisitsRef.current(patientId)
      .then((rows) => {
        if (!active) return;
        setVisits(rows);
        setSelectedVisitId(rows[0]?.id ?? "");
      })
      .catch((loadError) => {
        if (!active) return;
        setVisits([]);
        setVisitsError(loadError instanceof Error ? loadError.message : "Failed to load visits.");
        setSelectedVisitId("");
      })
      .finally(() => {
        if (active) setIsVisitsLoading(false);
      });
    return () => { active = false; };
  }, [patientId]);

  useEffect(() => {
    if (!patientId || !selectedVisitId || visitDetailsById[selectedVisitId]) return;
    let active = true;
    const visitId = selectedVisitId;
    setLoadingVisitDetailId(visitId);
    setVisitDetailError("");
    void loadVisitDetailRef.current(patientId, visitId)
      .then((detail) => {
        if (active) setVisitDetailsById((current) => ({ ...current, [visitId]: detail }));
      })
      .catch((loadError) => {
        if (!active) return;
        setVisitDetailError(loadError instanceof Error ? loadError.message : "Failed to load visit detail.");
      })
      .finally(() => {
        if (active) setLoadingVisitDetailId((current) => current === visitId ? "" : current);
      });
    return () => { active = false; };
  }, [patientId, selectedVisitId, visitDetailsById]);

  useEffect(() => {
    if (!patientId || !timelineActive || hasLoadedTimeline) return;
    let active = true;
    setIsTimelineLoading(true);
    setTimelineError("");
    void loadTimelineRef.current(patientId)
      .then((rows) => {
        if (!active) return;
        setTimeline(rows);
        setHasLoadedTimeline(true);
      })
      .catch((loadError) => {
        if (!active) return;
        setTimeline([]);
        setTimelineError(loadError instanceof Error ? loadError.message : "Failed to load timeline.");
      })
      .finally(() => {
        if (active) setIsTimelineLoading(false);
      });
    return () => { active = false; };
  }, [hasLoadedTimeline, patientId, timelineActive]);

  const selectedVisit = visits.find((visit) => visit.id === selectedVisitId) ?? visits[0] ?? null;
  const selectedVisitDetail = selectedVisit ? visitDetailsById[selectedVisit.id] ?? null : null;

  function removeAttachmentFromCachedVisits(attachmentId: string) {
    setVisitDetailsById((current) => Object.fromEntries(
      Object.entries(current).map(([visitId, detail]) => [
        visitId,
        {
          ...detail,
          attachments: detail.attachments.filter((row) => row.attachment_id !== attachmentId),
        },
      ]),
    ));
  }

  function invalidateTimeline() {
    setHasLoadedTimeline(false);
    setTimeline([]);
  }

  return {
    visits,
    isVisitsLoading,
    visitsError,
    visitDetailError,
    loadingVisitDetailId,
    selectedVisitId,
    selectedVisit,
    selectedVisitDetail,
    summary,
    isSummaryLoading,
    summaryError,
    timeline,
    isTimelineLoading,
    timelineError,
    selectVisit: setSelectedVisitId,
    removeAttachmentFromCachedVisits,
    invalidateTimeline,
  };
}

export type PatientChartDataWorkflow = ReturnType<typeof usePatientChartData>;
