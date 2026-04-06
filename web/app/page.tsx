"use client";

import { useCallback, useMemo, useState } from "react";

import { AddPatientModal } from "@/components/add-patient-modal";
import { AppHeader } from "@/components/app-header";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PatientColumn } from "@/components/patient-column";
import { SettingsDrawer } from "@/components/settings-drawer";
import { api } from "@/lib/api";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Invoice, Patient, PatientStatus, PatientTimelineEvent } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];

export default function HomePage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "consultation" | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const loadPageData = useCallback(() => api.listPatients(), []);
  const onPageData = useCallback((data: Patient[]) => {
    setPatients(data);
  }, []);
  const {
    currentUser,
    users,
    catalogItems,
    followUps,
    setFollowUps,
    clinicSettings,
    error,
    setError,
    isAuthReady,
    isRedirectingToLogin,
    handleLogout,
    handleSaveClinicSettings,
    handleAddStaffUser,
    handleCreateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleCreateInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";

  const groupedPatients = useMemo(() => {
    return statusOrder.reduce<Record<PatientStatus, Patient[]>>(
      (accumulator, status) => {
        accumulator[status] = patients.filter(
          (patient) => patient.status === status && !(status === "done" && patient.billed),
        );
        return accumulator;
      },
      {
        waiting: [],
        consultation: [],
        done: [],
      },
    );
  }, [patients]);

  async function handleCreatePatient(payload: {
    name: string;
    phone: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) {
    const optimisticPatient: Patient = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: "waiting",
      billed: false,
      ...payload,
    };

    setPatients((current) => [optimisticPatient, ...current]);
    try {
      const created = await api.createPatient(payload);
      setPatients((current) =>
        current.map((patient) => (patient.id === optimisticPatient.id ? created : patient)),
      );
      setError("");
    } catch (createError) {
      setPatients((current) => current.filter((patient) => patient.id !== optimisticPatient.id));
      setError(createError instanceof Error ? createError.message : "Failed to add patient.");
      throw createError;
    }
  }

  async function handleAdvancePatient(patient: Patient, nextStatus: PatientStatus) {
    if (currentUser?.role !== "admin" && nextStatus === "consultation") {
      setError("Only admins can start or continue consultation.");
      return;
    }
    const previousStatus = patient.status;
    setPatients((current) =>
      current.map((entry) =>
        entry.id === patient.id ? { ...entry, status: nextStatus } : entry,
      ),
    );
    if (selectedPatient?.id === patient.id) {
      setSelectedPatient({ ...patient, status: nextStatus });
    }

    try {
      await api.updatePatientStatus(patient.id, nextStatus);
      setError("");
    } catch (updateError) {
      setPatients((current) =>
        current.map((entry) =>
          entry.id === patient.id ? { ...entry, status: previousStatus } : entry,
        ),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient({ ...patient, status: previousStatus });
      }
      setError(updateError instanceof Error ? updateError.message : "Failed to update status.");
    }
  }

  async function handleUpdatePatient(
    patientId: string,
    payload: {
      name: string;
      phone: string;
      reason: string;
      age: number;
      weight: number;
      height: number | null;
      temperature: number;
    },
  ) {
    const previousPatients = patients;
    const updatedPatient = patients.find((patient) => patient.id === patientId);
    if (!updatedPatient) {
      return;
    }

    const optimistic = { ...updatedPatient, ...payload };
    setPatients((current) =>
      current.map((patient) => (patient.id === patientId ? optimistic : patient)),
    );
    if (selectedPatient?.id === patientId) {
      setSelectedPatient(optimistic);
    }

    try {
      const saved = await api.updatePatient(patientId, payload);
      setPatients((current) =>
        current.map((patient) => (patient.id === patientId ? saved : patient)),
      );
      if (selectedPatient?.id === patientId) {
        setSelectedPatient(saved);
      }
      setError("");
    } catch (updateError) {
      setPatients(previousPatients);
      if (selectedPatient?.id === patientId) {
        setSelectedPatient(updatedPatient);
      }
      throw updateError;
    }
  }

  function handleOpenPatient(patient: Patient) {
    setSelectedPatient(patient);
    setDrawerMode(
      patient.status === "consultation" && currentUser?.role === "admin"
        ? "consultation"
        : "details",
    );
  }

  async function handleLoadPatientTimeline(patientId: string): Promise<PatientTimelineEvent[]> {
    return api.getPatientTimeline(patientId);
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

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="queue"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onAddPatient={() => setIsModalOpen(true)}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-3">
          <PatientColumn
            title="Waiting"
            status="waiting"
            patients={groupedPatients.waiting}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
            canAdvance={() => currentUser?.role === "admin"}
          />
          <PatientColumn
            title="In Consultation"
            status="consultation"
            patients={groupedPatients.consultation}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
            canAdvance={() => currentUser?.role === "admin"}
          />
          <PatientColumn
            title="Billing"
            status="done"
            patients={groupedPatients.done}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
          />
        </div>
      </div>

      <AddPatientModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreatePatient}
      />

      <SettingsDrawer
        open={isSettingsOpen}
        settings={clinicSettings}
        currentUser={currentUser}
        users={users}
        patients={groupedPatients.done}
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
        onSendInvoice={handleSendInvoice}
        onBillingComplete={(patientId) => {
          setPatients((current) =>
            current.map((patient) =>
              patient.id === patientId ? { ...patient, billed: true } : patient,
            ),
          );
          setIsSettingsOpen(false);
        }}
      />

      <PatientDetailsDrawer
        patient={drawerMode === "details" ? selectedPatient : null}
        onLoadTimeline={handleLoadPatientTimeline}
        onSave={handleUpdatePatient}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
        }}
      />

      <ConsultationDrawer
        patient={drawerMode === "consultation" ? selectedPatient : null}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
        }}
        onDone={async (patient, followUp) => {
          if (followUp) {
            const createdFollowUp = await api.createFollowUp(patient.id, followUp);
            setFollowUps((current) =>
              [...current, createdFollowUp].sort((left, right) =>
                left.scheduled_for.localeCompare(right.scheduled_for),
              ),
            );
          }
          await handleAdvancePatient(patient, "done");
        }}
        onGenerate={async (payload) => {
          const response = await api.generateNote(payload);
          return response.content;
        }}
        onGeneratePdf={(payload) => api.generateNotePdf(payload)}
        onSend={async (payload) => {
          const response = await api.sendNote(payload);
          return response.message;
        }}
      />
    </main>
  );
}
