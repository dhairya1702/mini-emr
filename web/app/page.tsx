"use client";

import {
  closestCorners,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, FileText, Mail, PenLine, Settings2, UserPlus, Users } from "lucide-react";

import { AddPatientModal } from "@/components/add-patient-modal";
import { AppHeader } from "@/components/app-header";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PatientCard } from "@/components/patient-card";
import { PatientColumn } from "@/components/patient-column";
import { SetupStepModal } from "@/components/setup/setup-step-modal";
import { api } from "@/lib/api";
import {
  canMovePatientStatus,
  createEmptyQueueOrder,
  movePatientBetweenQueueColumns,
  QueueOrder,
  reorderQueueColumn,
} from "@/lib/queue-dnd";
import { buildClinicSetupChecklist, ClinicSetupStep, ClinicSetupStepKey, hasClinicDocumentTemplate, hasUserSignature } from "@/lib/setup-checklist";
import { findNextSetupStep as findNextSetupStepFromChecklist, setupQueryForStep, setupStepFromQuery } from "@/lib/setup-flow";
import {
  createTrainingNote,
  createTrainingPatient,
  createTrainingTimeline,
  readTrainingPatients,
  trainingQueueOrderStorageKey,
  writeTrainingPatients,
} from "@/lib/training-mode";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient, PatientStatus, PatientTimelineEvent } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];
const liveQueueOrderStorageKey = "clinic_queue_order_v1";
const QUEUE_REFRESH_INTERVAL_MS = 5000;

function loadQueueOrder(storageKey: string): QueueOrder {
  if (typeof window === "undefined") {
    return createEmptyQueueOrder();
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
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
  const [draggedPatient, setDraggedPatient] = useState<Patient | null>(null);
  const loadedQueueOrderKeyRef = useRef("");
  const hydratingQueueOrderRef = useRef("");
  const previousQueueOrderSaveKeyRef = useRef("");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const loadPageData = useCallback((context: {
    isTrainingMode: boolean;
    trainingScope: string | null;
  }) => {
    if (context.isTrainingMode) {
      return Promise.resolve(readTrainingPatients(context.trainingScope));
    }
    return api.listPatients();
  }, []);
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
    isTrainingMode,
    trainingScope,
    enterTrainingMode,
    exitTrainingMode,
    resetTrainingMode,
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
  const queueOrderStorageKey = useMemo(() => (
    isTrainingMode && trainingScope
      ? trainingQueueOrderStorageKey(trainingScope)
      : liveQueueOrderStorageKey
  ), [isTrainingMode, trainingScope]);
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
    const nextQueueOrder = loadQueueOrder(queueOrderStorageKey);
    hydratingQueueOrderRef.current = JSON.stringify(nextQueueOrder);
    loadedQueueOrderKeyRef.current = queueOrderStorageKey;
    setQueueOrder(nextQueueOrder);
  }, [queueOrderStorageKey]);

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
    if (loadedQueueOrderKeyRef.current !== queueOrderStorageKey) {
      return;
    }
    if (previousQueueOrderSaveKeyRef.current !== queueOrderStorageKey) {
      previousQueueOrderSaveKeyRef.current = queueOrderStorageKey;
      return;
    }
    const serializedQueueOrder = JSON.stringify(queueOrder);
    if (hydratingQueueOrderRef.current === serializedQueueOrder) {
      hydratingQueueOrderRef.current = "";
      return;
    }
    window.localStorage.setItem(queueOrderStorageKey, serializedQueueOrder);
  }, [queueOrder, queueOrderStorageKey]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || isTrainingMode) {
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
  }, [isAuthReady, isRedirectingToLogin, isTrainingMode]);

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

  function commitTrainingPatients(updater: Patient[] | ((current: Patient[]) => Patient[])) {
    setPatients((current) => {
      const nextPatients = typeof updater === "function" ? updater(current) : updater;
      writeTrainingPatients(trainingScope, nextPatients);
      return nextPatients;
    });
  }

  function handleResetTrainingMode() {
    resetTrainingMode();
    setPatients([]);
    setQueueOrder(createEmptyQueueOrder());
    setSelectedPatient(null);
    setDrawerMode(null);
    setError("");
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
    if (isTrainingMode) {
      if (payload.entryType === "appointment") {
        setError("Training Mode supports queue practice only. Appointment scheduling is disabled.");
        return;
      }

      const trainingPatient = createTrainingPatient({
        id: payload.existingPatientId,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        reason: payload.reason,
        age: payload.age,
        weight: payload.weight,
        height: payload.height,
        temperature: payload.temperature,
      });

      commitTrainingPatients((current) => [
        trainingPatient,
        ...current.filter((patient) => patient.id !== trainingPatient.id),
      ]);
      setError("");
      return;
    }

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
    if (isTrainingMode) {
      const updatedPatient = {
        ...patient,
        status: nextStatus,
        last_visit_at: new Date().toISOString(),
      };
      commitTrainingPatients((current) =>
        current.map((entry) => (entry.id === patient.id ? updatedPatient : entry)),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(updatedPatient);
      }
      setError("");
      return;
    }

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

  function statusFromDroppableId(overId: string): PatientStatus | null {
    if ((statusOrder as string[]).includes(overId)) {
      return overId as PatientStatus;
    }
    return patients.find((patient) => patient.id === overId)?.status ?? null;
  }

  function handleDragStart(event: DragStartEvent) {
    const patientId = String(event.active.id);
    setDraggedPatient(patients.find((patient) => patient.id === patientId) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setDraggedPatient(null);

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!overId || activeId === overId) {
      return;
    }

    const patient = patients.find((entry) => entry.id === activeId);
    const targetStatus = statusFromDroppableId(overId);
    if (!patient || !targetStatus) {
      return;
    }

    const sourceStatus = patient.status;
    const visibleQueueOrder = statusOrder.reduce<QueueOrder>((accumulator, status) => {
      accumulator[status] = groupedPatients[status].map((entry) => entry.id);
      return accumulator;
    }, createEmptyQueueOrder());

    if (!canMovePatientStatus(currentUser?.role, sourceStatus, targetStatus)) {
      if (sourceStatus !== targetStatus) {
        setError("Only admins can move patients through consultation in order.");
      }
      return;
    }

    if (sourceStatus === targetStatus) {
      setQueueOrder(reorderQueueColumn(visibleQueueOrder, sourceStatus, activeId, overId));
      setError("");
      return;
    }

    const previousPatients = patients;
    const previousQueueOrder = queueOrder;
    const targetPatient = patients.find((entry) => entry.id === overId);
    const nextQueueOrder = movePatientBetweenQueueColumns(
      visibleQueueOrder,
      sourceStatus,
      targetStatus,
      activeId,
      targetPatient?.id,
    );
    const movedPatient = { ...patient, status: targetStatus };

    setQueueOrder(nextQueueOrder);

    if (isTrainingMode) {
      commitTrainingPatients((current) =>
        current.map((entry) => (entry.id === patient.id ? movedPatient : entry)),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(movedPatient);
      }
      setError("");
      return;
    }

    setPatients((current) =>
      current.map((entry) => (entry.id === patient.id ? movedPatient : entry)),
    );
    if (selectedPatient?.id === patient.id) {
      setSelectedPatient(movedPatient);
    }

    try {
      await api.updatePatientStatus(patient.id, targetStatus);
      setError("");
    } catch (updateError) {
      setQueueOrder(previousQueueOrder);
      setPatients(previousPatients);
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(patient);
      }
      setError(updateError instanceof Error ? updateError.message : "Failed to update status.");
    }
  }

  function handleDragCancel() {
    setDraggedPatient(null);
  }

  async function handleRemoveFromQueue(patient: Patient) {
    const previousPatients = patients;
    const previousSelectedPatient = selectedPatient;
    const removedPatient = { ...patient, status: "done" as PatientStatus, billed: true };

    if (isTrainingMode) {
      commitTrainingPatients((current) =>
        current.map((entry) => (entry.id === patient.id ? removedPatient : entry)),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(removedPatient);
      }
      setError("");
      return;
    }

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
    if (isTrainingMode) {
      commitTrainingPatients((current) =>
        current.map((patient) => (patient.id === patientId ? optimistic : patient)),
      );
      if (selectedPatient?.id === patientId) {
        setSelectedPatient(optimistic);
      }
      setError("");
      return;
    }

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
    if (isTrainingMode) {
      const patient = patients.find((entry) => entry.id === patientId);
      return patient ? createTrainingTimeline(patient) : [];
    }
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
    <main className="h-screen overflow-hidden px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col">
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="queue"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {isTrainingMode ? (
          <div className="mb-4 flex flex-col gap-3 rounded-[28px] border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-900 shadow-[0_16px_45px_rgba(251,191,36,0.12)] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Training Mode</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetTrainingMode}
                className="rounded-full border border-amber-300 bg-white px-4 py-2 font-medium text-amber-900 transition hover:bg-amber-100"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={exitTrainingMode}
                className="rounded-full bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600"
              >
                Exit
              </button>
            </div>
          </div>
        ) : null}

        {currentUser?.role === "admin" && isSetupChecklistReady && !checklist.allRequiredComplete && !isTrainingMode ? (
          <div ref={setupChecklistRef}>
            <SetupChecklistCard
              checklist={checklist}
              onOpenStep={openSetupStep}
              highlightedStepKey={highlightedSetupStep}
            />
          </div>
        ) : null}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={(event) => {
            void handleDragEnd(event);
          }}
          onDragCancel={handleDragCancel}
        >
          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden xl:grid-cols-3">
            <PatientColumn
              status="waiting"
              title="Waiting"
              patients={groupedPatients.waiting}
              onOpen={handleOpenPatient}
              onAdvance={handleAdvancePatient}
              onRemoveFromQueue={handleRemoveFromQueue}
              onAddPatient={() => setIsModalOpen(true)}
              canAdvance={() => currentUser?.role === "admin"}
            />
            <PatientColumn
              status="consultation"
              title="Consultation"
              patients={groupedPatients.consultation}
              onOpen={handleOpenPatient}
              onAdvance={handleAdvancePatient}
              onRemoveFromQueue={handleRemoveFromQueue}
              canAdvance={() => currentUser?.role === "admin"}
            />
            <PatientColumn
              status="done"
              title="Billing"
              patients={groupedPatients.done}
              onOpen={handleOpenPatient}
              onAdvance={handleAdvancePatient}
              onRemoveFromQueue={handleRemoveFromQueue}
            />
          </div>
          <DragOverlay>
            {draggedPatient ? (
              <div className="w-[min(320px,80vw)]">
                <PatientCard
                  patient={draggedPatient}
                  onOpen={() => undefined}
                  onAdvance={() => undefined}
                  onRemoveFromQueue={() => undefined}
                  canAdvance={false}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
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
          isTrainingMode={isTrainingMode}
          onEnterTrainingMode={() => {
            enterTrainingMode();
            setIsSettingsOpen(false);
          }}
          onExitTrainingMode={() => {
            exitTrainingMode();
            setIsSettingsOpen(false);
          }}
          onResetTrainingMode={handleResetTrainingMode}
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
        isTrainingMode={isTrainingMode}
        onLoadTimeline={handleLoadPatientTimeline}
        onLoadMyopiaHistory={(patientId) => (
          isTrainingMode
            ? Promise.resolve({
                patient_id: patientId,
                records: [],
                baseline_delta: null,
                last_delta: null,
                annualized_growth: null,
                overlay_version: "training",
              })
            : api.getPatientMyopiaHistory(patientId)
        )}
        onLoadGrowthHistory={(patientId) => (
          isTrainingMode
            ? Promise.resolve({
                patient_id: patientId,
                latest_measurement: null,
                previous_measurement: null,
                interval_change: null,
                trend_summary: "Training Mode growth history is local only.",
                flags: [],
                records: [],
              })
            : api.getPatientGrowthHistory(patientId)
        )}
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
        isTrainingMode={isTrainingMode}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
        }}
        onDone={async (patient, followUp) => {
          if (followUp && !isTrainingMode) {
            await api.createFollowUp(patient.id, followUp);
          }
          await handleAdvancePatient(patient, "done");
        }}
        onGenerate={async (payload) => {
          if (isTrainingMode) {
            const response = createTrainingNote(payload);
            return { content: response.content, noteId: response.noteId, status: response.status };
          }
          const response = await api.generateNote(payload);
          return { content: response.content, noteId: response.note_id, status: response.status };
        }}
        onGeneratePdf={(payload) => {
          if (isTrainingMode) {
            return Promise.reject(new Error("Disabled in Training Mode. Nothing is sent or saved to the clinic."));
          }
          return payload.note_id ? api.generateSavedNotePdf(payload.note_id) : api.generateNotePdf(payload);
        }}
        onSend={async (payload) => {
          if (isTrainingMode) {
            throw new Error("Disabled in Training Mode. Nothing is sent or saved to the clinic.");
          }
          const response = await api.sendNote(payload);
          return response.message;
        }}
      />
    </main>
  );
}
