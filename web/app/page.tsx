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

import { AddPatientModal } from "@/components/add-patient-modal";
import { AppHeader } from "@/components/app-header";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PatientCard } from "@/components/patient-card";
import { PatientColumn } from "@/components/patient-column";
import { api } from "@/lib/api";
import {
  canMovePatientStatus,
  createEmptyQueueOrder,
  movePatientBetweenQueueColumns,
  QueueOrder,
  reorderQueueColumn,
} from "@/lib/queue-dnd";
import { hasClinicDocumentTemplate, hasUserSignature } from "@/lib/setup-checklist";
import {
  createTrainingNote,
  createTrainingPatient,
  createTrainingTimeline,
  readTrainingPatients,
  trainingQueueOrderStorageKey,
  writeTrainingPatients,
} from "@/lib/training-mode";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { Patient, PatientChartVisit, PatientStatus, PatientVisitDetail } from "@/lib/types";

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

export default function HomePage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "consultation" | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
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
    isTrainingMode,
    trainingScope,
    enterTrainingMode,
    exitTrainingMode,
    resetTrainingMode,
    handleLogout,
    handleSaveClinicSettings,
    applyClinicSettings,
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

  function handleCloseSettingsDrawer() {
    setIsSettingsOpen(false);
  }

  function handleClosePatientModal() {
    setIsModalOpen(false);
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
    date_of_birth?: string | null;
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
        date_of_birth: payload.date_of_birth ?? null,
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
          date_of_birth: payload.date_of_birth ?? null,
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
          date_of_birth: payload.date_of_birth ?? null,
          age: payload.age,
          weight: payload.weight,
          height: payload.height,
          temperature: payload.temperature,
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
      date_of_birth: payload.date_of_birth ?? null,
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
        date_of_birth: payload.date_of_birth ?? null,
        age: payload.age,
        weight: payload.weight,
        height: payload.height,
        temperature: payload.temperature,
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
      date_of_birth?: string | null;
      age: number | null;
      weight: number | null;
      height: number | null;
      temperature: number | null;
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

  async function handleLoadPatientVisits(patientId: string): Promise<PatientChartVisit[]> {
    if (isTrainingMode) {
      const patient = patients.find((entry) => entry.id === patientId);
      return patient
        ? createTrainingTimeline(patient)
            .filter((event) => event.type === "visit_recorded")
            .map((event) => ({
              id: String(event.entity_id || ""),
              patient_id: patient.id,
              reason: String((event.details?.reason as string | undefined) || patient.reason || ""),
              created_at: event.timestamp,
            }))
        : [];
    }
    return api.listPatientChartVisits(patientId);
  }

  async function handleLoadPatientVisitDetail(patientId: string, visitId: string): Promise<PatientVisitDetail> {
    if (isTrainingMode) {
      const patient = patients.find((entry) => entry.id === patientId);
      if (!patient) {
        throw new Error("Training patient not found.");
      }
      const visit = createTrainingTimeline(patient).find(
        (event) => event.type === "visit_recorded" && String(event.entity_id || "") === visitId,
      );
      if (!visit) {
        throw new Error("Training visit not found.");
      }
      return {
        visit_id: visitId,
        reason: String((visit.details?.reason as string | undefined) || patient.reason || ""),
        timestamp: visit.timestamp,
        consultation_note: null,
        attachments: [],
        timeline: [],
      };
    }
    return api.getPatientVisitDetail(patientId, visitId);
  }

  if (isRedirectingToLogin) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
          Redirecting to login...
        </div>
      </main>
    );
  }

  if (!isAuthReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[20px] border border-[#dbe7ef] bg-white px-8 py-7 text-sm text-slate-600 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
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
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {isTrainingMode ? (
          <div className="mb-4 flex flex-col gap-3 rounded-[18px] border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-900 shadow-[0_16px_45px_rgba(251,191,36,0.12)] sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Training Mode</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetTrainingMode}
                className="rounded-xl border border-amber-300 bg-white px-4 py-2 font-medium text-amber-900 transition hover:bg-amber-100"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={exitTrainingMode}
                className="rounded-xl bg-amber-500 px-4 py-2 font-medium text-white transition hover:bg-amber-600"
              >
                Exit
              </button>
            </div>
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
        open={isModalOpen}
        onClose={handleClosePatientModal}
        onSubmit={handleCreatePatient}
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
        onLoadVisits={handleLoadPatientVisits}
        onLoadVisitDetail={handleLoadPatientVisitDetail}
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
            return { content: response.content, noteId: response.noteId, status: response.status, usedFallback: false, warning: null };
          }
          const response = await api.generateNote(payload);
          return {
            content: response.content,
            noteId: response.note_id,
            status: response.status,
            usedFallback: response.used_fallback,
            warning: response.warning,
          };
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
