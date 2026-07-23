"use client";

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { api } from "@/lib/api";
import { saveRecentPatient } from "@/lib/recent-patients";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient, PatientChartVisit, PatientTimelineEvent, PatientVisitDetail } from "@/lib/types";

export default function PatientChartPage() {
  const params = useParams<{ patientId: string }>();
  const patientId = params.patientId;
  const router = useRouter();
  const [fromHistory] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("from") === "history",
  );
  const backLabel = fromHistory ? "History" : "Patients";
  const backHref = fromHistory ? "/history" : "/patients";

  const [patient, setPatient] = useState<Patient | null>(null);

  const loadPageData = useCallback(async () => {
    return api.getPatient(patientId);
  }, [patientId]);
  const onPageData = useCallback((data: Patient) => {
    setPatient(data);
  }, []);

  const { currentUser, clinicSettings, error, isPageDataLoaded } = useClinicShellPage({
    loadPageData,
    onPageData,
  });

  function rememberRecent(updated: Patient) {
    if (currentUser?.id && currentUser?.org_id) {
      saveRecentPatient({ orgId: currentUser.org_id, userId: currentUser.id, patient: updated });
    }
  }

  async function handleUpdatePatient(
    id: string,
    payload: {
      name: string;
      phone: string;
      email: string;
      address: string;
      reason: string;
      date_of_birth?: string | null;
      age: number | null;
      weight: number | null;
      height: number | null;
      temperature: number | null;
    },
  ) {
    const saved = await api.updatePatient(id, payload);
    setPatient(saved);
    rememberRecent(saved);
  }

  function handlePatientChartUpdated(updated: Patient) {
    setPatient((current) => (current?.id === updated.id ? updated : current));
    rememberRecent(updated);
  }

  async function handleLoadPatientVisits(id: string): Promise<PatientChartVisit[]> {
    return api.listPatientChartVisits(id);
  }

  async function handleLoadPatientVisitDetail(id: string, visitId: string): Promise<PatientVisitDetail> {
    return api.getPatientVisitDetail(id, visitId);
  }

  async function handleLoadPatientTimeline(id: string): Promise<PatientTimelineEvent[]> {
    return api.getPatientTimeline(id);
  }

  function goBack() {
    router.push(backHref);
  }

  if (!patient) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-[#f7fbfd] text-sm text-slate-500">
        {error ? error : isPageDataLoaded ? "Patient not found." : "Loading chart..."}
      </main>
    );
  }

  return (
    <PatientDetailsDrawer
      patient={patient}
      clinicSpecialty={clinicSettings?.clinic_specialty ?? null}
      fullScreen
      fullScreenBackLabel={backLabel}
      readOnly={fromHistory}
      onLoadVisits={handleLoadPatientVisits}
      onLoadVisitDetail={handleLoadPatientVisitDetail}
      onLoadTimeline={handleLoadPatientTimeline}
      onLoadMyopiaHistory={(id) => api.getPatientMyopiaHistory(id)}
      onLoadGrowthHistory={(id) => api.getPatientGrowthHistory(id)}
      onSave={handleUpdatePatient}
      onPatientUpdated={handlePatientChartUpdated}
      onClose={goBack}
    />
  );
}
