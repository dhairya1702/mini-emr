"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, FileText, Mail, PenLine, Settings2, UserPlus, Users } from "lucide-react";

import { AddPatientModal } from "@/components/add-patient-modal";
import { AppHeader } from "@/components/app-header";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PatientColumn } from "@/components/patient-column";
import { SetupStepModal } from "@/components/setup/setup-step-modal";
import { api } from "@/lib/api";
import { buildClinicSetupChecklist, ClinicSetupStep, ClinicSetupStepKey, hasClinicDocumentTemplate, hasUserSignature } from "@/lib/setup-checklist";
import { findNextSetupStep as findNextSetupStepFromChecklist, setupQueryForStep, setupStepFromQuery } from "@/lib/setup-flow";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient, PatientStatus, PatientTimelineEvent } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];
const queueOrderStorageKey = "clinic_queue_order_v1";
const QUEUE_REFRESH_INTERVAL_MS = 5000;

type QueueOrder = Record<PatientStatus, string[]>;

function createEmptyQueueOrder(): QueueOrder {
  return {
    waiting: [],
    consultation: [],
    done: [],
  };
}

function loadQueueOrder(): QueueOrder {
  if (typeof window === "undefined") {
    return createEmptyQueueOrder();
  }

  try {
    const raw = window.localStorage.getItem(queueOrderStorageKey);
    if (!raw) {
      return createEmptyQueueOrder();
    }
    const parsed = JSON.parse(raw) as Partial<Record<PatientStatus, unknown>>;
    return {
      waiting: Array.isArray(parsed.waiting) ? parsed.waiting.map(String) : [],
      consultation: Array.isArray(parsed.consultation) ? parsed.consultation.map(String) : [],
      done: Array.isArray(parsed.done) ? parsed.done.map(String) : [],
    };
  } catch {
    return createEmptyQueueOrder();
  }
}

function getOrderedPatientsForStatus(
  patients: Patient[],
  status: PatientStatus,
  orderedIds: string[],
) {
  const visiblePatients = patients.filter(
    (patient) => patient.status === status && (status !== "done" || !patient.billed),
  );
  const positionById = new Map(orderedIds.map((id, index) => [id, index]));
  const fallbackById = new Map(visiblePatients.map((patient, index) => [patient.id, index]));

  return [...visiblePatients].sort((left, right) => {
    const leftPosition = positionById.get(left.id);
    const rightPosition = positionById.get(right.id);

    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined) {
      return -1;
    }
    if (rightPosition !== undefined) {
      return 1;
    }
    return (fallbackById.get(left.id) ?? 0) - (fallbackById.get(right.id) ?? 0);
  });
}

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function setupStepIcon(stepKey: ClinicSetupStepKey) {
  switch (stepKey) {
    case "signature":
      return PenLine;
    case "sender_email":
      return Mail;
    case "first_staff_user":
      return UserPlus;
    case "first_patient":
      return Users;
    case "document_template":
      return FileText;
    default:
      return Settings2;
  }
}

function SetupChecklistCard({
  checklist,
  onOpenStep,
  highlightedStepKey = null,
}: {
  checklist: ReturnType<typeof buildClinicSetupChecklist>;
  onOpenStep: (step: ClinicSetupStep) => void;
  highlightedStepKey?: ClinicSetupStepKey | null;
}) {
  const requiredSteps = checklist.items.filter((step) => step.key !== "document_template");
  const optionalStep = checklist.items.find((step) => step.key === "document_template") ?? null;

  return (
    <section className="mb-4 rounded-[32px] border border-sky-200 bg-white/95 p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Clinic Setup</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Get this clinic ready for a real day</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Follow the operational order below. Each step unlocks the workflows that depend on it, so the clinic does not run into hidden setup failures later.
          </p>
        </div>
        <div className="rounded-[24px] border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm font-medium text-sky-800">
          {checklist.requiredCompleted} of {checklist.requiredTotal} required steps complete
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {requiredSteps.map((step) => {
          const Icon = setupStepIcon(step.key);
          const isComplete = step.status === "complete";
          return (
            <div
              key={step.key}
              className={`flex flex-col gap-4 rounded-[24px] border p-4 md:flex-row md:items-center md:justify-between ${
                isComplete
                  ? "border-emerald-200 bg-emerald-50/70"
                  : highlightedStepKey === step.key
                    ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200"
                    : "border-sky-200 bg-white"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`rounded-2xl p-3 ${isComplete ? "bg-emerald-100 text-emerald-700" : "bg-sky-50 text-sky-700"}`}>
                  {isComplete ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-base font-semibold text-slate-900">{step.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenStep(step)}
                className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition ${
                  isComplete
                    ? "border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                    : "bg-sky-500 text-white hover:bg-sky-600"
                }`}
              >
                {isComplete ? "Review" : "Complete step"}
              </button>
            </div>
          );
        })}
      </div>

      {optionalStep ? (
        <div
          className={`mt-5 rounded-[24px] border p-4 ${
            highlightedStepKey === optionalStep.key
              ? "border-sky-400 bg-sky-50 ring-2 ring-sky-200"
              : "border-slate-200 bg-slate-50/70"
          }`}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white p-3 text-slate-600">
                {optionalStep.status === "complete" ? <CheckCircle2 className="h-5 w-5 text-emerald-700" /> : <CircleDashed className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">{optionalStep.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{optionalStep.description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenStep(optionalStep)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-100"
            >
              {optionalStep.status === "complete" ? "Review template" : "Upload template"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function HomePage() {
  const pathname = usePathname();
  const router = useRouter();
  const setupChecklistRef = useRef<HTMLDivElement | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "consultation" | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [setupQuery, setSetupQuery] = useState("");
  const [activeSetupStep, setActiveSetupStep] = useState<ClinicSetupStepKey | null>(null);
  const [highlightedSetupStep, setHighlightedSetupStep] = useState<ClinicSetupStepKey | null>(null);
  const [queueOrder, setQueueOrder] = useState<QueueOrder>(() => createEmptyQueueOrder());
  const loadPageData = useCallback(() => api.listPatients(), []);
  const onPageData = useCallback((data: Patient[]) => {
    setPatients(data);
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
    setError,
    isAuthReady,
    isRedirectingToLogin,
    isPageDataLoaded,
    isUsersLoaded,
    handleLogout,
    handleSaveClinicSettings,
    applyClinicSettings,
    applyCurrentUser,
    handleAddStaffUser,
    handleCreateCatalogItem,
    handleAdjustCatalogStock,
    handleDeleteCatalogItem,
    handleUpdateUserRole,
    handleDeleteUser,
    handleCreateInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendInvoice,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";
  const isSetupChecklistReady = Boolean(
    currentUser &&
      clinicSettings &&
      isPageDataLoaded &&
      (currentUser.role !== "admin" || isUsersLoaded),
  );
  const checklist = useMemo(
    () =>
      buildClinicSetupChecklist({
        currentUser,
        users,
        patients,
        clinicSettings,
      }),
    [clinicSettings, currentUser, patients, users],
  );

  const updateSetupQuery = useCallback((value?: string) => {
    const next = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    if (value) {
      next.set("setup", value);
    } else {
      next.delete("setup");
    }
    const query = next.toString();
    setSetupQuery(value || "");
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  const findNextSetupStep = useCallback((completedStepKey: ClinicSetupStepKey) => {
    return findNextSetupStepFromChecklist(checklist, completedStepKey);
  }, [checklist]);

  useEffect(() => {
    setQueueOrder(loadQueueOrder());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setSetupQuery(new URLSearchParams(window.location.search).get("setup") || "");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(queueOrderStorageKey, JSON.stringify(queueOrder));
  }, [queueOrder]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin) {
      return;
    }

    let active = true;

    async function refreshPatients() {
      try {
        const nextPatients = await api.listPatients();
        if (active) {
          setPatients(nextPatients);
        }
      } catch {
        // Keep the current queue stable if a background refresh fails.
      }
    }

    void refreshPatients();

    const intervalId = window.setInterval(() => {
      void refreshPatients();
    }, QUEUE_REFRESH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPatients();
      }
    };

    const handleFocus = () => {
      void refreshPatients();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAuthReady, isRedirectingToLogin]);

  useEffect(() => {
    if (!isAuthReady || currentUser?.role !== "admin") {
      return;
    }
    if (!users.length) {
      void loadUsers();
    }
  }, [currentUser, isAuthReady, loadUsers, users.length]);

  useEffect(() => {
    if (!isAuthReady || currentUser?.role !== "admin") {
      return;
    }

    const nextStep = setupStepFromQuery(setupQuery);
    if (!nextStep) {
      return;
    }

    setActiveSetupStep(nextStep);
  }, [currentUser, isAuthReady, setupQuery]);

  const groupedPatients = useMemo(() => {
    return statusOrder.reduce<Record<PatientStatus, Patient[]>>(
      (accumulator, status) => {
        accumulator[status] = getOrderedPatientsForStatus(patients, status, queueOrder[status]);
        return accumulator;
      },
      {
        waiting: [],
        consultation: [],
        done: [],
      },
    );
  }, [patients, queueOrder]);

  const openSetupStep = useCallback((step: ClinicSetupStep) => {
    setActiveSetupStep(step.key);
    setHighlightedSetupStep(null);
    updateSetupQuery(setupQueryForStep(step.key));
  }, [updateSetupQuery]);

  const handleCloseSetupStep = useCallback(() => {
    setActiveSetupStep(null);
    if (setupQuery) {
      updateSetupQuery();
    }
  }, [setupQuery, updateSetupQuery]);

  const handleSetupStepComplete = useCallback(async (stepKey: ClinicSetupStepKey) => {
    if (stepKey === "first_staff_user") {
      await loadUsers();
    }
    if (stepKey === "first_patient") {
      const nextPatients = await api.listPatients();
      setPatients(nextPatients);
    }

    setActiveSetupStep(null);
    setIsModalOpen(false);
    setHighlightedSetupStep(findNextSetupStep(stepKey));
    if (setupQuery) {
      updateSetupQuery();
    }
    window.setTimeout(() => {
      setupChecklistRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [findNextSetupStep, loadUsers, setupQuery, updateSetupQuery]);

  function handleCloseSettingsDrawer() {
    setIsSettingsOpen(false);
  }

  function handleClosePatientModal() {
    setIsModalOpen(false);
    if (activeSetupStep === "first_patient") {
      handleCloseSetupStep();
    }
  }

  async function handleCreatePatient(payload: {
    entryType: "queue" | "appointment";
    existingPatientId?: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    reason: string;
    age: number | null;
    weight: number | null;
    height: number | null;
    temperature: number | null;
    scheduled_for?: string;
  }) {
    if (payload.entryType === "appointment") {
      try {
        await api.createAppointment({
          name: payload.name,
          phone: payload.phone,
          email: payload.email,
          address: payload.address,
          reason: payload.reason,
          age: payload.age,
          weight: payload.weight,
          height: payload.height,
          temperature: payload.temperature,
          scheduled_for: payload.scheduled_for ?? new Date().toISOString(),
        });
        setError("");
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : "Failed to create appointment.");
        throw createError;
      }
      return;
    }

    if (payload.existingPatientId) {
      try {
        const updated = await api.createPatientVisit(payload.existingPatientId, {
          name: payload.name,
          phone: payload.phone,
          email: payload.email,
          address: payload.address,
          reason: payload.reason,
          age: payload.age ?? 0,
          weight: payload.weight ?? 0,
          height: payload.height,
          temperature: payload.temperature ?? 0,
        });
        setPatients((current) => [updated, ...current.filter((patient) => patient.id !== updated.id)]);
        setError("");
      } catch (createError) {
        setError(createError instanceof Error ? createError.message : "Failed to record patient visit.");
        throw createError;
      }
      return;
    }

    const optimisticPatient: Patient = {
      id: createId(),
      created_at: new Date().toISOString(),
      last_visit_at: new Date().toISOString(),
      status: "waiting",
      billed: false,
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      reason: payload.reason,
      age: payload.age,
      weight: payload.weight,
      height: payload.height,
      temperature: payload.temperature,
    };

    setPatients((current) => [optimisticPatient, ...current]);
    try {
      const created = await api.createPatient({
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        reason: payload.reason,
        age: payload.age ?? 0,
        weight: payload.weight ?? 0,
        height: payload.height,
        temperature: payload.temperature ?? 0,
      });
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

  async function handleRemoveFromQueue(patient: Patient) {
    const previousPatients = patients;
    const previousSelectedPatient = selectedPatient;
    const removedPatient = { ...patient, status: "done" as PatientStatus, billed: true };

    setPatients((current) =>
      current.map((entry) =>
        entry.id === patient.id ? removedPatient : entry,
      ),
    );
    if (selectedPatient?.id === patient.id) {
      setSelectedPatient(removedPatient);
    }

    try {
      const saved = await api.updatePatient(
        patient.id,
        {
          status: "done",
          billed: true,
        } as Parameters<typeof api.updatePatient>[1],
      );
      setPatients((current) =>
        current.map((entry) => (entry.id === patient.id ? saved : entry)),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(saved);
      }
      setError("");
    } catch (removeError) {
      setPatients(previousPatients);
      if (previousSelectedPatient?.id === patient.id) {
        setSelectedPatient(previousSelectedPatient);
      }
      setError(removeError instanceof Error ? removeError.message : "Failed to remove patient from queue.");
    }
  }

  async function handleUpdatePatient(
    patientId: string,
    payload: {
      name: string;
      phone: string;
      email: string;
      address: string;
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

        {currentUser?.role === "admin" && isSetupChecklistReady && !checklist.allRequiredComplete ? (
          <div ref={setupChecklistRef}>
            <SetupChecklistCard
              checklist={checklist}
              onOpenStep={openSetupStep}
              highlightedStepKey={highlightedSetupStep}
            />
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-3">
          <PatientColumn
            title="Waiting"
            status="waiting"
            patients={groupedPatients.waiting}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
            onRemoveFromQueue={handleRemoveFromQueue}
            canAdvance={() => currentUser?.role === "admin"}
          />
          <PatientColumn
            title="Consultation"
            status="consultation"
            patients={groupedPatients.consultation}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
            onRemoveFromQueue={handleRemoveFromQueue}
            canAdvance={() => currentUser?.role === "admin"}
          />
          <PatientColumn
            title="Billing"
            status="done"
            patients={groupedPatients.done}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
            onRemoveFromQueue={handleRemoveFromQueue}
          />
        </div>
      </div>

      <AddPatientModal
        open={isModalOpen || activeSetupStep === "first_patient"}
        onClose={handleClosePatientModal}
        onSubmitted={() => {
          if (activeSetupStep === "first_patient") {
            void handleSetupStepComplete("first_patient");
          }
        }}
        onSubmit={handleCreatePatient}
      />

      <SetupStepModal
        stepKey={activeSetupStep}
        settings={clinicSettings}
        currentUser={currentUser}
        onClose={handleCloseSetupStep}
        onComplete={(stepKey) => {
          void handleSetupStepComplete(stepKey);
        }}
        onSaveClinic={handleSaveClinicSettings}
        onClinicSettingsChange={applyClinicSettings}
        onCurrentUserChange={applyCurrentUser}
        onAddUser={handleAddStaffUser}
        onLoadUsers={loadUsers}
      />

      {isSettingsOpen ? (
        <LazySettingsDrawer
          open={isSettingsOpen}
          settings={clinicSettings}
          currentUser={currentUser}
          users={users}
          onLoadUsers={loadUsers}
          auditEvents={auditEvents}
          onLoadAuditEvents={loadAuditEvents}
          patients={groupedPatients.done}
          catalogItems={catalogItems}
          onLoadCatalogItems={loadCatalogItems}
          onClose={handleCloseSettingsDrawer}
          onSaveClinic={handleSaveClinicSettings}
          onClinicSettingsChange={applyClinicSettings}
          onAddUser={handleAddStaffUser}
          onUpdateUserRole={handleUpdateUserRole}
          onDeleteUser={handleDeleteUser}
          onCreateCatalogItem={handleCreateCatalogItem}
          onAdjustCatalogStock={handleAdjustCatalogStock}
          onDeleteCatalogItem={handleDeleteCatalogItem}
          onGenerateLetter={handleGenerateLetter}
          onGenerateLetterPdf={(payload) => api.generateLetterPdf(payload)}
          onSendLetter={handleSendLetter}
          onCreateInvoice={handleCreateInvoice}
          onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
          onSendInvoice={handleSendInvoice}
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
      ) : null}

      <PatientDetailsDrawer
        patient={drawerMode === "details" ? selectedPatient : null}
        clinicSpecialty={clinicSettings?.clinic_specialty ?? null}
        onLoadTimeline={handleLoadPatientTimeline}
        onLoadMyopiaHistory={(patientId) => api.getPatientMyopiaHistory(patientId)}
        onLoadGrowthHistory={(patientId) => api.getPatientGrowthHistory(patientId)}
        onSave={handleUpdatePatient}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
        }}
      />

      <ConsultationDrawer
        patient={drawerMode === "consultation" ? selectedPatient : null}
        currentUser={currentUser}
        clinicSpecialty={clinicSettings?.clinic_specialty ?? null}
        emailConfigured={Boolean(clinicSettings?.email_configured)}
        hasUserSignature={hasUserSignature(currentUser)}
        hasClinicDocumentTemplate={hasClinicDocumentTemplate(clinicSettings)}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
        }}
        onDone={async (patient, followUp) => {
          if (followUp) {
            await api.createFollowUp(patient.id, followUp);
          }
          await handleAdvancePatient(patient, "done");
        }}
        onGenerate={async (payload) => {
          const response = await api.generateNote(payload);
          return { content: response.content, noteId: response.note_id, status: response.status };
        }}
        onGeneratePdf={(payload) => (
          payload.note_id ? api.generateSavedNotePdf(payload.note_id) : api.generateNotePdf(payload)
        )}
        onSend={async (payload) => {
          const response = await api.sendNote(payload);
          return response.message;
        }}
      />
    </main>
  );
}
