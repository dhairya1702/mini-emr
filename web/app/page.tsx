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
import { Plus, Stethoscope, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddPatientModal } from "@/components/add-patient-modal";
import { AppHeader } from "@/components/app-header";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PendingCheckIns } from "@/components/pending-check-ins";
import { PatientCard } from "@/components/patient-card";
import { PatientColumn } from "@/components/patient-column";
import { MultiDoctorQueueBoard } from "@/components/multi-doctor-queue-board";
import { BillingWorkspace } from "@/features/dashboard/billing/billing-workspace";
import type { BillingWorkflowGateway } from "@/features/dashboard/billing/use-billing-workflow";
import { api } from "@/lib/api";
import { canUseBilling, canUseClinicalTools } from "@/lib/permissions";
import {
  canMovePatientStatus,
  createEmptyQueueOrder,
  movePatientBetweenQueueColumns,
  QueueOrder,
  reorderQueueColumn,
} from "@/lib/queue-dnd";
import { connectDashboardEvents, type DashboardRealtimeEvent } from "@/lib/realtime";
import { hasClinicDocumentTemplate, hasUserSignature } from "@/lib/setup-checklist";
import {
  createTrainingNote,
  createTrainingPatient,
  createTrainingTimeline,
  readTrainingPatients,
  writeTrainingPatients,
} from "@/lib/training-mode";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { CheckInRequest, Patient, PatientChartVisit, PatientStatus, PatientTimelineEvent, PatientVisitDetail, QueueProvider, QueueSnapshot, SexAtBirth } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];
const QUEUE_REFRESH_INTERVAL_MS = 60000;
const QUEUE_REFRESH_MAX_BACKOFF_MS = 60000;

function applyQueueOrder(patients: Patient[], order: QueueOrder, changedAt: string) {
  const placement = new Map<string, { status: PatientStatus; position: number }>();
  for (const status of statusOrder) {
    order[status].forEach((patientId, index) => placement.set(patientId, { status, position: index + 1 }));
  }
  return patients.map((patient) => {
    const next = placement.get(patient.id);
    if (!next) return patient;
    return {
      ...patient,
      status: next.status,
      queue_position: next.position,
      stage_entered_at: patient.status === next.status ? patient.stage_entered_at : changedAt,
    };
  });
}

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function HomePage() {
  const router = useRouter();
  const {
    queuePatients: patients,
    queueProviders,
    queueRevision,
    setQueuePatients: setPatients,
    applyQueueSnapshot,
    loadQueueSnapshot,
    loadDashboardStatus,
  } = useClinicShell();
  const [workspaceLocation, setWorkspaceLocation] = useState(() => {
    if (typeof window === "undefined") return { kind: "", patientId: "" };
    const params = new URLSearchParams(window.location.search);
    return { kind: params.get("workspace") || "", patientId: params.get("patient") || "" };
  });
  const workspaceKind = workspaceLocation.kind;
  const workspacePatientId = workspaceLocation.patientId;
  const workspaceOpenedInAppRef = useRef(false);
  const workspaceTransitionRef = useRef(false);
  const [checkInRequests, setCheckInRequests] = useState<CheckInRequest[]>([]);
  const [checkInCount, setCheckInCount] = useState(0);
  const [isCheckInRequestsLoading, setIsCheckInRequestsLoading] = useState(false);
  const [checkInRequestsError, setCheckInRequestsError] = useState("");
  const [pendingCheckInRequestId, setPendingCheckInRequestId] = useState("");
  const [isCheckInDrawerOpen, setIsCheckInDrawerOpen] = useState(false);
  const [hasUnseenCheckIns, setHasUnseenCheckIns] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "consultation" | null>(null);
  const [billingPatientId, setBillingPatientId] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [assignDoctorPatient, setAssignDoctorPatient] = useState<Patient | null>(null);
  const [draggedPatient, setDraggedPatient] = useState<Patient | null>(null);
  const [isQueueMutationPending, setIsQueueMutationPending] = useState(false);
  const [queueClock, setQueueClock] = useState(() => Date.now());
  const queueRefreshInFlightRef = useRef(false);
  const queueRefreshFailureCountRef = useRef(0);
  const nextQueueRefreshAllowedAtRef = useRef(0);
  const latestQueueRevisionRef = useRef("");
  const loadedQueueRevisionRef = useRef("");
  const queueRefreshQueuedRef = useRef(false);
  const refreshQueueSnapshotRef = useRef<() => void>(() => undefined);
  const isQueueMutationPendingRef = useRef(false);
  const isDraggingPatientRef = useRef(false);
  const isSoloWorkspaceRef = useRef(false);
  const isCheckInDrawerOpenRef = useRef(false);
  const checkInStatusInFlightRef = useRef(false);
  const checkInRequestsInFlightRef = useRef(false);
  const checkInRequestsRefreshQueuedRef = useRef(false);
  const checkInStatusRefreshQueuedRef = useRef(false);
  const checkInStatusFailureCountRef = useRef(0);
  const nextCheckInStatusAllowedAtRef = useRef(0);
  const lastCheckInStatusAttemptAtRef = useRef(0);
  const checkInStatusRevisionRef = useRef("");
  const loadedCheckInRequestsRevisionRef = useRef("");
  const hasLoadedCheckInStatusRef = useRef(false);
  const hasLoadedCheckInRequestsRef = useRef(false);
  const checkInStatusGenerationRef = useRef(0);
  const refreshDashboardStatusRef = useRef<(force?: boolean) => void>(() => undefined);
  const lastRealtimeStatusRefreshAtRef = useRef(0);
  const selectedPatientRef = useRef<Patient | null>(null);
  const drawerModeRef = useRef<"details" | "consultation" | null>(null);
  const finishConsultationWorkspaceRef = useRef<() => void>(() => undefined);
  selectedPatientRef.current = selectedPatient;
  drawerModeRef.current = drawerMode;
  finishConsultationWorkspaceRef.current = finishConsultationWorkspace;
  if (queueRevision) loadedQueueRevisionRef.current = queueRevision;
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
      return Promise.resolve({ revision: "training", patients: readTrainingPatients(context.trainingScope), providers: [] });
    }
    return loadQueueSnapshot();
  }, [loadQueueSnapshot]);
  const onPageData = useCallback((data: QueueSnapshot) => {
    applyQueueSnapshot(data);
    const currentSelectedPatient = selectedPatientRef.current;
    if (currentSelectedPatient) {
      const refreshedPatient = data.patients.find((patient) => patient.id === currentSelectedPatient.id) ?? null;
      if (refreshedPatient) {
        setSelectedPatient(refreshedPatient);
        if (drawerModeRef.current === "consultation" && refreshedPatient.status === "done") {
          workspaceTransitionRef.current = true;
          setSelectedPatient(null);
          setDrawerMode(null);
          finishConsultationWorkspaceRef.current();
        }
      } else if (drawerModeRef.current === "consultation") {
        workspaceTransitionRef.current = true;
        setSelectedPatient(null);
        setDrawerMode(null);
        finishConsultationWorkspaceRef.current();
      }
    }
    loadedQueueRevisionRef.current = data.revision;
    if (
      latestQueueRevisionRef.current
      && latestQueueRevisionRef.current !== data.revision
    ) {
      window.setTimeout(() => refreshQueueSnapshotRef.current(), 0);
    }
  }, [applyQueueSnapshot]);
  const {
    currentUser,
    users,
    auditEvents,
    loadUsers,
    loadAuditEvents,
    catalogItems,
    loadCatalogItems,
    isCatalogLoaded,
    isCatalogLoading,
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
    handleFinalizeInvoice,
    handleGenerateLetter,
    handleSendLetter,
    handleSendLetterWhatsApp,
    handleSendInvoice,
    handleSendInvoiceWhatsApp,
    handleExportPatientsCsv,
    handleExportVisitsCsv,
    handleExportInvoicesCsv,
  } = useClinicShellPage({
    loadPageData,
    onPageData,
  });
  const clinicName = clinicSettings?.clinic_name || "ClinicOS";
  const workspaceMode = clinicSettings?.workspace_mode ?? "team";
  const isSoloWorkspace = workspaceMode === "solo";
  const isMultiDoctorWorkspace = workspaceMode === "multi_doctor";
  const canAssignDoctors = isMultiDoctorWorkspace && !isTrainingMode && (currentUser?.role === "admin" || currentUser?.role === "staff");
  isQueueMutationPendingRef.current = isQueueMutationPending;
  isDraggingPatientRef.current = Boolean(draggedPatient);
  isSoloWorkspaceRef.current = isSoloWorkspace;

  useEffect(() => {
    function syncWorkspaceFromLocation() {
      const params = new URLSearchParams(window.location.search);
      setWorkspaceLocation({
        kind: params.get("workspace") || "",
        patientId: params.get("patient") || "",
      });
    }
    window.addEventListener("popstate", syncWorkspaceFromLocation);
    return () => window.removeEventListener("popstate", syncWorkspaceFromLocation);
  }, []);

  useEffect(() => {
    if (!workspaceKind || !workspacePatientId) {
      setSelectedPatient(null);
      setDrawerMode(null);
      setBillingPatientId("");
      return;
    }
    const workspacePatient = patients.find((entry) => entry.id === workspacePatientId);
    if (!workspacePatient) return;
    if (workspaceKind === "chart" || workspaceKind === "consultation") {
      setSelectedPatient(workspacePatient);
      setDrawerMode(workspaceKind === "chart" ? "details" : "consultation");
      setBillingPatientId("");
      return;
    }
    if (workspaceKind === "billing") {
      setBillingPatientId(workspacePatient.id);
      setSelectedPatient(null);
      setDrawerMode(null);
    }
  }, [patients, workspaceKind, workspacePatientId]);

  function pushWorkspace(kind: "chart" | "consultation" | "billing", patientId: string, replaceCurrent = false) {
    workspaceOpenedInAppRef.current = true;
    setWorkspaceLocation({ kind, patientId });
    const target = `/?workspace=${kind}&patient=${encodeURIComponent(patientId)}`;
    const nextHistoryState = { ...(window.history.state || {}), clinicWorkspace: kind } as Record<string, unknown>;
    if (kind === "consultation") nextHistoryState.consultationDepth = 0;
    else delete nextHistoryState.consultationDepth;
    if (replaceCurrent) {
      window.history.replaceState(nextHistoryState, "", target);
    } else {
      window.history.pushState(nextHistoryState, "", target);
    }
  }

  function closeConsultationWorkspace() {
    const consultationDepth = Number(window.history.state?.consultationDepth);
    if (workspaceOpenedInAppRef.current && Number.isFinite(consultationDepth) && consultationDepth >= 0) {
      workspaceOpenedInAppRef.current = false;
      window.history.go(-(consultationDepth + 1));
      return;
    }
    closeWorkspace();
  }

  function finishConsultationWorkspace() {
    const consultationDepth = Number(window.history.state?.consultationDepth);
    workspaceOpenedInAppRef.current = false;
    if (Number.isFinite(consultationDepth) && consultationDepth >= 0 && window.history.length > consultationDepth + 1) {
      window.history.go(-(consultationDepth + 2));
      return;
    }
    setWorkspaceLocation({ kind: "", patientId: "" });
    router.replace("/");
  }

  function closeWorkspace() {
    if (workspaceOpenedInAppRef.current) {
      workspaceOpenedInAppRef.current = false;
      router.back();
      return;
    }
    setWorkspaceLocation({ kind: "", patientId: "" });
    router.replace("/");
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => setQueueClock(Date.now()), 60000);
    return () => window.clearInterval(intervalId);
  }, []);

  const refreshCheckInRequests = useCallback(async (revision = checkInStatusRevisionRef.current) => {
    if (checkInRequestsInFlightRef.current) {
      checkInRequestsRefreshQueuedRef.current = true;
      return;
    }
    checkInRequestsInFlightRef.current = true;
    checkInRequestsRefreshQueuedRef.current = false;
    const generation = checkInStatusGenerationRef.current;
    const requestedRevision = revision;
    let succeeded = false;
    setIsCheckInRequestsLoading(true);
    setCheckInRequestsError("");
    try {
      const rows = await api.listCheckInRequests();
      if (generation !== checkInStatusGenerationRef.current) return;
      setCheckInRequests(rows);
      if (!hasLoadedCheckInStatusRef.current) setCheckInCount(rows.length);
      hasLoadedCheckInRequestsRef.current = true;
      loadedCheckInRequestsRevisionRef.current = requestedRevision;
      succeeded = true;
    } catch (requestError) {
      setCheckInRequestsError(
        requestError instanceof Error ? requestError.message : "Failed to load check-in requests.",
      );
    } finally {
      checkInRequestsInFlightRef.current = false;
      setIsCheckInRequestsLoading(false);
      const stillStale = Boolean(
        checkInStatusRevisionRef.current
        && loadedCheckInRequestsRevisionRef.current !== checkInStatusRevisionRef.current
      );
      if (
        succeeded
        && isCheckInDrawerOpenRef.current
        && (checkInRequestsRefreshQueuedRef.current || stillStale)
      ) {
        checkInRequestsRefreshQueuedRef.current = false;
        window.setTimeout(
          () => void refreshCheckInRequests(checkInStatusRevisionRef.current),
          0,
        );
      }
    }
  }, []);

  const refreshQueueSnapshot = useCallback(async () => {
    if (
      isSoloWorkspaceRef.current
      || isQueueMutationPendingRef.current
      || isDraggingPatientRef.current
    ) {
      queueRefreshQueuedRef.current = true;
      return;
    }
    if (queueRefreshInFlightRef.current) {
      queueRefreshQueuedRef.current = true;
      return;
    }
    if (Date.now() < nextQueueRefreshAllowedAtRef.current) return;

    queueRefreshInFlightRef.current = true;
    try {
      const snapshot = await loadQueueSnapshot(true);
      loadedQueueRevisionRef.current = snapshot.revision;
      queueRefreshFailureCountRef.current = 0;
      nextQueueRefreshAllowedAtRef.current = 0;
    } catch {
      queueRefreshFailureCountRef.current += 1;
      nextQueueRefreshAllowedAtRef.current = Date.now() + Math.min(
        QUEUE_REFRESH_INTERVAL_MS * (2 ** (queueRefreshFailureCountRef.current - 1)),
        QUEUE_REFRESH_MAX_BACKOFF_MS,
      );
    } finally {
      queueRefreshInFlightRef.current = false;
      const stillStale = Boolean(
        latestQueueRevisionRef.current
        && loadedQueueRevisionRef.current !== latestQueueRevisionRef.current
      );
      if (queueRefreshQueuedRef.current || stillStale) {
        queueRefreshQueuedRef.current = false;
        if (Date.now() >= nextQueueRefreshAllowedAtRef.current) {
          window.setTimeout(() => refreshQueueSnapshotRef.current(), 0);
        }
      }
    }
  }, [loadQueueSnapshot]);
  refreshQueueSnapshotRef.current = refreshQueueSnapshot;

  const refreshDashboardStatus = useCallback(async (force = false) => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (checkInStatusInFlightRef.current) {
      if (force) checkInStatusRefreshQueuedRef.current = true;
      return;
    }

    const now = Date.now();
    if (
      !force
      && (
        now - lastCheckInStatusAttemptAtRef.current < QUEUE_REFRESH_INTERVAL_MS
        || now < nextCheckInStatusAllowedAtRef.current
      )
    ) {
      return;
    }

    checkInStatusInFlightRef.current = true;
    lastCheckInStatusAttemptAtRef.current = now;
    const generation = checkInStatusGenerationRef.current;
    try {
      const status = await loadDashboardStatus(force);
      if (generation !== checkInStatusGenerationRef.current) return;

      const previousRevision = checkInStatusRevisionRef.current;
      const isFirstStatus = !hasLoadedCheckInStatusRef.current;
      latestQueueRevisionRef.current = status.queue_revision;
      checkInStatusRevisionRef.current = status.check_in_revision;
      hasLoadedCheckInStatusRef.current = true;
      checkInStatusFailureCountRef.current = 0;
      nextCheckInStatusAllowedAtRef.current = 0;
      setCheckInCount(status.pending_check_in_count);

      if (
        !isSoloWorkspaceRef.current
        && loadedQueueRevisionRef.current
        && loadedQueueRevisionRef.current !== status.queue_revision
      ) {
        void refreshQueueSnapshotRef.current();
      }

      if (
        status.pending_check_in_count > 0
        && (isFirstStatus || previousRevision !== status.check_in_revision)
        && !isCheckInDrawerOpenRef.current
      ) {
        setHasUnseenCheckIns(true);
      }

      if (
        isCheckInDrawerOpenRef.current
        && (
          !hasLoadedCheckInRequestsRef.current
          || loadedCheckInRequestsRevisionRef.current !== status.check_in_revision
        )
      ) {
        void refreshCheckInRequests(status.check_in_revision);
      }
    } catch {
      checkInStatusFailureCountRef.current += 1;
      nextCheckInStatusAllowedAtRef.current = Date.now() + Math.min(
        QUEUE_REFRESH_INTERVAL_MS * (2 ** (checkInStatusFailureCountRef.current - 1)),
        QUEUE_REFRESH_MAX_BACKOFF_MS,
      );
    } finally {
      checkInStatusInFlightRef.current = false;
      if (checkInStatusRefreshQueuedRef.current) {
        checkInStatusRefreshQueuedRef.current = false;
        window.setTimeout(() => refreshDashboardStatusRef.current(true), 0);
      }
    }
  }, [loadDashboardStatus, refreshCheckInRequests]);
  refreshDashboardStatusRef.current = refreshDashboardStatus;

  const openCheckInDrawer = useCallback(() => {
    isCheckInDrawerOpenRef.current = true;
    setIsCheckInDrawerOpen(true);
    setHasUnseenCheckIns(false);
    if (
      !hasLoadedCheckInRequestsRef.current
      || loadedCheckInRequestsRevisionRef.current !== checkInStatusRevisionRef.current
    ) {
      void refreshCheckInRequests();
    }
    void refreshDashboardStatus(true);
  }, [refreshCheckInRequests, refreshDashboardStatus]);

  const closeCheckInDrawer = useCallback(() => {
    isCheckInDrawerOpenRef.current = false;
    setIsCheckInDrawerOpen(false);
  }, []);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser || isTrainingMode) {
      setCheckInRequests([]);
      setCheckInCount(0);
      setCheckInRequestsError("");
      setIsCheckInRequestsLoading(false);
      setHasUnseenCheckIns(false);
      checkInStatusGenerationRef.current += 1;
      checkInStatusRevisionRef.current = "";
      loadedCheckInRequestsRevisionRef.current = "";
      hasLoadedCheckInStatusRef.current = false;
      hasLoadedCheckInRequestsRef.current = false;
      checkInRequestsRefreshQueuedRef.current = false;
      lastCheckInStatusAttemptAtRef.current = 0;
      nextCheckInStatusAllowedAtRef.current = 0;
      latestQueueRevisionRef.current = "";
      loadedQueueRevisionRef.current = "";
      queueRefreshQueuedRef.current = false;
      queueRefreshFailureCountRef.current = 0;
      nextQueueRefreshAllowedAtRef.current = 0;
      return;
    }
    void refreshDashboardStatus();
    const intervalId = window.setInterval(
      () => void refreshDashboardStatus(),
      QUEUE_REFRESH_INTERVAL_MS,
    );
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void refreshDashboardStatus();
    }
    function handleFocus() {
      void refreshDashboardStatus();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin, isTrainingMode, refreshDashboardStatus]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser || isTrainingMode) {
      return;
    }

    let active = true;
    function requestRealtimeRefresh() {
      if (!active) return;
      const now = Date.now();
      if (now - lastRealtimeStatusRefreshAtRef.current < 1000) return;
      lastRealtimeStatusRefreshAtRef.current = now;
      refreshDashboardStatusRef.current(true);
    }

    function handleDashboardEvent(event: DashboardRealtimeEvent) {
      if (event.changed.some((item) => item === "queue" || item === "check_ins")) {
        requestRealtimeRefresh();
      }
    }

    const source = connectDashboardEvents({
      onOpen: requestRealtimeRefresh,
      onDashboard: handleDashboardEvent,
    });

    return () => {
      active = false;
      source?.close();
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin, isTrainingMode]);

  async function approveCheckIn(requestId: string, existingPatientId?: string) {
    setPendingCheckInRequestId(requestId);
    setError("");
    try {
      const patient = await api.approveCheckInRequest(requestId, {
        existing_patient_id: existingPatientId || null,
        force_new: !existingPatientId,
      });
      setPatients((current) => [...current.filter((row) => row.id !== patient.id), patient]);
      setCheckInRequests((current) => current.filter((row) => row.id !== requestId));
      setCheckInCount((current) => Math.max(0, current - 1));
      checkInStatusGenerationRef.current += 1;
      loadedCheckInRequestsRevisionRef.current = "";
      void refreshDashboardStatus(true);
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "Failed to approve check-in.");
      void refreshCheckInRequests();
      void refreshDashboardStatus(true);
    } finally {
      setPendingCheckInRequestId("");
    }
  }

  async function rejectCheckIn(requestId: string) {
    setPendingCheckInRequestId(requestId);
    setError("");
    try {
      await api.rejectCheckInRequest(requestId);
      setCheckInRequests((current) => current.filter((row) => row.id !== requestId));
      setCheckInCount((current) => Math.max(0, current - 1));
      checkInStatusGenerationRef.current += 1;
      loadedCheckInRequestsRevisionRef.current = "";
      void refreshDashboardStatus(true);
    } catch (rejectionError) {
      setError(rejectionError instanceof Error ? rejectionError.message : "Failed to reject check-in.");
      void refreshCheckInRequests();
      void refreshDashboardStatus(true);
    } finally {
      setPendingCheckInRequestId("");
    }
  }

  useEffect(() => {
    if (
      isAuthReady
      && !isRedirectingToLogin
      && !isTrainingMode
      && !isSoloWorkspace
      && !isQueueMutationPending
      && !draggedPatient
      && queueRefreshQueuedRef.current
    ) {
      void refreshQueueSnapshot();
    }
  }, [draggedPatient, isAuthReady, isQueueMutationPending, isRedirectingToLogin, isSoloWorkspace, isTrainingMode, refreshQueueSnapshot]);

  const groupedPatients = useMemo(() => {
    return statusOrder.reduce<Record<PatientStatus, Patient[]>>(
      (accumulator, status) => {
        accumulator[status] = patients
          .filter((patient) => patient.status === status && (status !== "done" || !patient.billed))
          .sort((left, right) => {
            const priorityDifference = (left.queue_priority === "urgent" ? 0 : 1) - (right.queue_priority === "urgent" ? 0 : 1);
            return priorityDifference || left.queue_position - right.queue_position;
          });
        return accumulator;
      },
      {
        waiting: [],
        consultation: [],
        done: [],
      },
    );
  }, [patients]);
  const activeQueuePatients = useMemo(() => {
    const activePatients = patients.filter((patient) => !patient.billed);
    return [...activePatients].sort((left, right) => {
      const priorityDifference = (left.queue_priority === "urgent" ? 0 : 1) - (right.queue_priority === "urgent" ? 0 : 1);
      return priorityDifference || new Date(left.last_visit_at).getTime() - new Date(right.last_visit_at).getTime();
    });
  }, [patients]);
  const doctorQueueProviders = useMemo(
    () => queueProviders.filter((provider) => provider.active && (provider.role === "admin" || provider.role === "doctor")),
    [queueProviders],
  );

  const billingPatients = useMemo(
    () => patients.filter((patient) => patient.status === "done" && !patient.billed),
    [patients],
  );
  const selectedBillingPatient = useMemo(
    () => billingPatients.find((patient) => patient.id === billingPatientId) ?? null,
    [billingPatientId, billingPatients],
  );
  const billingGateway = useMemo<BillingWorkflowGateway>(() => ({
    loadPatientNotes: (patientId) => api.listPatientNotes(patientId),
    loadBillingSuggestions: (noteId) => api.getNoteBillingSuggestions(noteId),
    createInvoice: handleCreateInvoice,
    generateInvoicePdf: (invoiceId) => api.generateInvoicePdf(invoiceId),
    finalizeInvoice: handleFinalizeInvoice,
    sendInvoice: handleSendInvoice,
    sendInvoiceWhatsApp: handleSendInvoiceWhatsApp,
  }), [handleCreateInvoice, handleFinalizeInvoice, handleSendInvoice, handleSendInvoiceWhatsApp]);

  function handleCloseSettingsDrawer() {
    setIsSettingsOpen(false);
  }

  function handleClosePatientModal() {
    setIsModalOpen(false);
  }

  function openBillingWorkspace(patientId: string) {
    if (workspaceKind === "consultation") {
      workspaceTransitionRef.current = true;
    }
    setBillingPatientId(patientId);
    setSelectedPatient(null);
    setDrawerMode(null);
    pushWorkspace("billing", patientId, Boolean(workspaceKind));
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
    sex_at_birth?: SexAtBirth | null;
    gender_identity?: string;
    age: number | null;
    weight: number | null;
    height: number | null;
    temperature: number | null;
    scheduled_for?: string;
    assigned_doctor_id?: string | null;
    photo?: File | null;
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
        sex_at_birth: payload.sex_at_birth ?? null,
        gender_identity: payload.gender_identity ?? "",
        age: payload.age,
        weight: payload.weight,
        height: payload.height,
        temperature: payload.temperature,
        assigned_doctor_id: payload.assigned_doctor_id ?? null,
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
          sex_at_birth: payload.sex_at_birth ?? null,
          gender_identity: payload.gender_identity ?? "",
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
        let updated = await api.createPatientVisit(payload.existingPatientId, {
          name: payload.name,
          phone: payload.phone,
          email: payload.email,
          address: payload.address,
          reason: payload.reason,
          date_of_birth: payload.date_of_birth ?? null,
          sex_at_birth: payload.sex_at_birth ?? null,
          gender_identity: payload.gender_identity ?? "",
          age: payload.age,
          weight: payload.weight,
          height: payload.height,
          temperature: payload.temperature,
          assigned_doctor_id: payload.assigned_doctor_id ?? null,
        });
        if (payload.photo) {
          try {
            updated = await api.uploadPatientProfilePhoto(updated.id, payload.photo);
          } catch (photoError) {
            setError(photoError instanceof Error ? photoError.message : "The visit was added, but the photo upload failed.");
          }
        }
        setPatients((current) => [updated, ...current.filter((patient) => patient.id !== updated.id)]);
        if (!payload.photo) setError("");
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
      queue_priority: "normal",
      stage_entered_at: new Date().toISOString(),
      queue_position: groupedPatients.waiting.length + 1,
      assigned_doctor_id: payload.assigned_doctor_id ?? null,
      assigned_doctor: queueProviders.find((provider) => provider.id === payload.assigned_doctor_id) ?? null,
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      reason: payload.reason,
      date_of_birth: payload.date_of_birth ?? null,
      sex_at_birth: payload.sex_at_birth ?? null,
      gender_identity: payload.gender_identity ?? "",
      age: payload.age,
      weight: payload.weight,
      height: payload.height,
      temperature: payload.temperature,
    };

    setPatients((current) => [optimisticPatient, ...current]);
    try {
      let created = await api.createPatient({
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        address: payload.address,
        reason: payload.reason,
        date_of_birth: payload.date_of_birth ?? null,
        sex_at_birth: payload.sex_at_birth ?? null,
        gender_identity: payload.gender_identity ?? "",
        age: payload.age,
        weight: payload.weight,
        height: payload.height,
        temperature: payload.temperature,
        assigned_doctor_id: payload.assigned_doctor_id ?? null,
      });
      if (payload.photo) {
        try {
          created = await api.uploadPatientProfilePhoto(created.id, payload.photo);
        } catch (photoError) {
          setError(photoError instanceof Error ? photoError.message : "The patient was added, but the photo upload failed.");
        }
      }
      setPatients((current) =>
        current.map((patient) => (patient.id === optimisticPatient.id ? created : patient)),
      );
      void refreshDashboardStatus(true);
      if (!payload.photo) setError("");
    } catch (createError) {
      setPatients((current) => current.filter((patient) => patient.id !== optimisticPatient.id));
      setError(createError instanceof Error ? createError.message : "Failed to add patient.");
      throw createError;
    }
  }

  async function transitionPatientStatus(patient: Patient, nextStatus: PatientStatus) {
    if (!canUseClinicalTools(currentUser?.role) && nextStatus === "consultation") {
      throw new Error("Only admins and doctors can start or continue consultation.");
    }
    const previousStatus = patient.status;
    if (isTrainingMode) {
      const updatedPatient = {
        ...patient,
        status: nextStatus,
        stage_entered_at: new Date().toISOString(),
        queue_position: groupedPatients[nextStatus].length + 1,
        last_visit_at: new Date().toISOString(),
      };
      commitTrainingPatients((current) =>
        current.map((entry) => (entry.id === patient.id ? updatedPatient : entry)),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(updatedPatient);
      }
      setError("");
      return updatedPatient;
    }

    setPatients((current) =>
      current.map((entry) =>
        entry.id === patient.id ? {
          ...entry,
          status: nextStatus,
          ...(isMultiDoctorWorkspace && nextStatus === "consultation" && !entry.assigned_doctor_id && currentUser && canUseClinicalTools(currentUser.role)
            ? {
              assigned_doctor_id: currentUser.id,
              assigned_doctor: queueProviders.find((provider) => provider.id === currentUser.id) ?? {
                id: currentUser.id,
                name: currentUser.name || currentUser.identifier,
                role: currentUser.role,
                active: true,
              },
            }
            : {}),
        } : entry,
      ),
    );
    if (selectedPatient?.id === patient.id) {
      setSelectedPatient({ ...patient, status: nextStatus });
    }

    try {
      const saved = await api.updatePatientStatus(patient.id, nextStatus);
      setPatients((current) => current.map((entry) => (entry.id === patient.id ? saved : entry)));
      if (selectedPatient?.id === patient.id) setSelectedPatient(saved);
      setError("");
      void refreshDashboardStatus(true);
      return saved;
    } catch (updateError) {
      setPatients((current) =>
        current.map((entry) =>
          entry.id === patient.id ? { ...entry, status: previousStatus } : entry,
        ),
      );
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient({ ...patient, status: previousStatus });
      }
      const message = updateError instanceof Error ? updateError.message : "Failed to update status.";
      setError(message);
      throw new Error(message);
    }
  }

  async function handleAdvancePatient(patient: Patient, nextStatus: PatientStatus) {
    try {
      await transitionPatientStatus(patient, nextStatus);
    } catch {
      return;
    }
  }

  async function handleTogglePriority(patient: Patient) {
    const previousPatients = patients;
    const nextPriority = patient.queue_priority === "urgent" ? "normal" : "urgent";
    const optimistic = {
      ...patient,
      queue_priority: nextPriority,
      queue_position: 0,
    } as Patient;
    if (isTrainingMode) {
      commitTrainingPatients((current) => current.map((entry) => entry.id === patient.id ? optimistic : entry));
      setError("");
      return;
    }
    setPatients((current) => current.map((entry) => entry.id === patient.id ? optimistic : entry));
    setIsQueueMutationPending(true);
    try {
      const saved = await api.updatePatient(patient.id, { queue_priority: nextPriority });
      setPatients((current) => current.map((entry) => entry.id === patient.id ? saved : entry));
      if (selectedPatient?.id === patient.id) setSelectedPatient(saved);
      setError("");
      void refreshDashboardStatus(true);
    } catch (priorityError) {
      setPatients(previousPatients);
      setError(priorityError instanceof Error ? priorityError.message : "Failed to update queue priority.");
    } finally {
      setIsQueueMutationPending(false);
    }
  }

  function statusFromDroppableId(overId: string): PatientStatus | null {
    if ((statusOrder as string[]).includes(overId)) {
      return overId as PatientStatus;
    }
    return patients.find((patient) => patient.id === overId)?.status ?? null;
  }

  function providerIdFromDroppableId(overId: string): string | null {
    if (overId.startsWith("provider:")) {
      const value = overId.slice("provider:".length);
      return value === "unassigned" ? "" : value;
    }
    const patient = patients.find((entry) => entry.id === overId);
    return patient ? patient.assigned_doctor_id || "" : null;
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
    if (isMultiDoctorWorkspace) {
      if (!patient) {
        return;
      }
      const targetProviderId = providerIdFromDroppableId(overId);
      if (targetProviderId === null || targetProviderId === (patient.assigned_doctor_id || "")) {
        return;
      }
      const previousPatients = patients;
      const nextProvider = queueProviders.find((provider) => provider.id === targetProviderId) ?? null;
      const optimisticPatient = {
        ...patient,
        assigned_doctor_id: targetProviderId || null,
        assigned_doctor: nextProvider,
      };
      setPatients((current) => current.map((entry) => entry.id === activeId ? optimisticPatient : entry));
      if (selectedPatient?.id === activeId) setSelectedPatient(optimisticPatient);
      setIsQueueMutationPending(true);
      try {
        const saved = await api.updatePatient(activeId, { assigned_doctor_id: targetProviderId || null });
        setPatients((current) => current.map((entry) => entry.id === activeId ? saved : entry));
        if (selectedPatient?.id === activeId) setSelectedPatient(saved);
        setError("");
        void refreshDashboardStatus(true);
      } catch (updateError) {
        setPatients(previousPatients);
        if (selectedPatient?.id === activeId) setSelectedPatient(patient);
        setError(updateError instanceof Error ? updateError.message : "Failed to assign doctor.");
      } finally {
        setIsQueueMutationPending(false);
      }
      return;
    }
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
      const nextQueueOrder = reorderQueueColumn(visibleQueueOrder, sourceStatus, activeId, overId);
      const changedAt = new Date().toISOString();
      const previousPatients = patients;
      const optimisticPatients = applyQueueOrder(patients, nextQueueOrder, changedAt);
      if (isTrainingMode) {
        commitTrainingPatients(() => optimisticPatients);
        setError("");
        return;
      }
      setPatients(optimisticPatients);
      setIsQueueMutationPending(true);
      try {
        const saved = await api.updateQueueOrder(nextQueueOrder);
        setPatients(saved);
        setError("");
        void refreshDashboardStatus(true);
      } catch (updateError) {
        setPatients(previousPatients);
        setError(updateError instanceof Error ? updateError.message : "Failed to save queue order.");
      } finally {
        setIsQueueMutationPending(false);
      }
      return;
    }

    const previousPatients = patients;
    const targetPatient = patients.find((entry) => entry.id === overId);
    const nextQueueOrder = movePatientBetweenQueueColumns(
      visibleQueueOrder,
      sourceStatus,
      targetStatus,
      activeId,
      targetPatient?.id,
    );
    const changedAt = new Date().toISOString();
    const optimisticPatients = applyQueueOrder(patients, nextQueueOrder, changedAt);
    const movedPatient = optimisticPatients.find((entry) => entry.id === patient.id) ?? patient;

    if (isTrainingMode) {
      commitTrainingPatients(() => optimisticPatients);
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(movedPatient);
      }
      setError("");
      return;
    }

    setPatients(optimisticPatients);
    if (selectedPatient?.id === patient.id) {
      setSelectedPatient(movedPatient);
    }

    try {
      setIsQueueMutationPending(true);
      const saved = await api.updateQueueOrder(nextQueueOrder);
      setPatients(saved);
      const savedPatient = saved.find((entry) => entry.id === patient.id);
      if (savedPatient && selectedPatient?.id === patient.id) setSelectedPatient(savedPatient);
      setError("");
      void refreshDashboardStatus(true);
    } catch (updateError) {
      setPatients(previousPatients);
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(patient);
      }
      setError(updateError instanceof Error ? updateError.message : "Failed to update status.");
    } finally {
      setIsQueueMutationPending(false);
    }
  }

  function handleDragCancel() {
    setDraggedPatient(null);
  }

  function openAssignDoctorModal(patient: Patient) {
    if (!canAssignDoctors) {
      return;
    }
    setAssignDoctorPatient(patient);
  }

  async function handleAssignDoctor(patient: Patient, providerId: string) {
    if (!canAssignDoctors) {
      return;
    }
    const previousPatients = patients;
    const nextProvider = queueProviders.find((provider) => provider.id === providerId) ?? null;
    const optimisticPatient: Patient = {
      ...patient,
      assigned_doctor_id: providerId || null,
      assigned_doctor: nextProvider,
    };
    setPatients((current) => current.map((entry) => entry.id === patient.id ? optimisticPatient : entry));
    if (selectedPatient?.id === patient.id) {
      setSelectedPatient(optimisticPatient);
    }
    setIsQueueMutationPending(true);
    try {
      const saved = await api.updatePatient(patient.id, { assigned_doctor_id: providerId || null });
      setPatients((current) => current.map((entry) => entry.id === patient.id ? saved : entry));
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(saved);
      }
      setAssignDoctorPatient(null);
      setError("");
      void refreshDashboardStatus(true);
    } catch (updateError) {
      setPatients(previousPatients);
      if (selectedPatient?.id === patient.id) {
        setSelectedPatient(patient);
      }
      setError(updateError instanceof Error ? updateError.message : "Failed to assign doctor.");
    } finally {
      setIsQueueMutationPending(false);
    }
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
      void refreshDashboardStatus(true);
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
      void refreshDashboardStatus(true);
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

  function handlePatientChartUpdated(updated: Patient) {
    setPatients((current) =>
      current.map((patient) => (patient.id === updated.id ? updated : patient)),
    );
    setSelectedPatient((current) => (current?.id === updated.id ? updated : current));
  }

  function closeBillingWorkspace() {
    setBillingPatientId("");
    setSelectedPatient(null);
    setDrawerMode(null);
    closeWorkspace();
  }

  async function handleBillingCompleted(
    patientId: string,
    options?: { refreshDashboard?: boolean },
  ) {
    setPatients((current) => current.map((patient) => (
      patient.id === patientId ? { ...patient, billed: true } : patient
    )));
    closeBillingWorkspace();
    if (options?.refreshDashboard) {
      void refreshDashboardStatus(true);
    }
  }

  function handleOpenPatient(patient: Patient) {
    setSelectedPatient(patient);
    setDrawerMode("details");
    pushWorkspace("chart", patient.id);
  }

  async function handleStartConsultation(patient: Patient) {
    try {
      const latestPatient = patient.status === "waiting"
        ? await transitionPatientStatus(patient, "consultation")
        : isTrainingMode
          ? patient
          : await api.getPatient(patient.id);
      setPatients((current) =>
        current.map((entry) => (entry.id === latestPatient.id ? latestPatient : entry)),
      );
      setSelectedPatient(latestPatient);
      setDrawerMode("consultation");
      pushWorkspace("consultation", latestPatient.id);
    } catch {
      return;
    }
  }

  async function handleLoadPatientVisits(patientId: string): Promise<PatientChartVisit[]> {
    if (isTrainingMode) {
      const patient = patients.find((entry) => entry.id === patientId);
      const trainingVisits = patient
        ? createTrainingTimeline(patient).filter((event) => event.type === "visit_recorded")
        : [];
      return patient
        ? trainingVisits.map((event, index) => ({
              id: String(event.entity_id || ""),
              patient_id: patient.id,
              visit_number: trainingVisits.length - index,
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
        optometry_history: null,
        attachments: [],
        timeline: [],
      };
    }
    return api.getPatientVisitDetail(patientId, visitId);
  }

  async function handleLoadPatientTimeline(patientId: string): Promise<PatientTimelineEvent[]> {
    if (isTrainingMode) {
      const patient = patients.find((entry) => entry.id === patientId);
      return patient ? createTrainingTimeline(patient) : [];
    }
    return api.getPatientTimeline(patientId);
  }

  const patientChartActionLabel = selectedPatient
    ? selectedPatient.status === "waiting"
      ? "Start consultation"
      : selectedPatient.status === "consultation"
        ? "Continue Consultation"
        : !selectedPatient.billed && canUseBilling(currentUser?.role)
          ? "Open billing"
          : null
    : null;
  const patientChartActionDisabled = selectedPatient
    ? (selectedPatient.status === "waiting" || selectedPatient.status === "consultation") && !canUseClinicalTools(currentUser?.role)
    : false;

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
    <main className="h-screen overflow-hidden px-4 py-5 sm:px-6 lg:px-6">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col">
        <AppHeader
          clinicName={clinicName}
          currentUser={currentUser}
          active="queue"
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
          timezone={clinicSettings?.timezone}
          checkInCount={checkInCount}
          hasUnseenCheckIns={hasUnseenCheckIns}
          onOpenCheckIns={openCheckInDrawer}
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

        {!isTrainingMode ? (
          <PendingCheckIns
            requests={checkInRequests}
            pendingCount={checkInCount}
            pendingRequestId={pendingCheckInRequestId}
            isLoading={isCheckInRequestsLoading}
            error={checkInRequestsError}
            variant="drawer"
            isOpen={isCheckInDrawerOpen}
            onClose={closeCheckInDrawer}
            onRetry={() => void refreshCheckInRequests()}
            onUseExisting={(requestId, patientId) => void approveCheckIn(requestId, patientId)}
            onCreateNew={(requestId) => void approveCheckIn(requestId)}
            onReject={(requestId) => void rejectCheckIn(requestId)}
          />
        ) : null}

        {isSoloWorkspace ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-[#bfd7e8] bg-white/80 shadow-[0_14px_38px_rgba(64,131,181,0.10)]">
            <div className="flex shrink-0 items-center gap-3 border-b border-[#dbe7ef] bg-[#f3faff] px-[18px] py-3.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#2f8fd3] ring-4 ring-[#d8ebf7]" />
              <h2 className="text-[15px] font-bold text-[#1f2b3d]">Today</h2>
              <span className="ml-auto inline-flex min-w-7 items-center justify-center rounded-full border border-[#bfe0f5] bg-[#ecf6fd] px-2 py-1 text-xs font-bold text-[#2a6fa8]">
                {activeQueuePatients.length}
              </span>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                aria-label="Add patient"
                title="Add patient"
                className="inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-[9px] border border-[#bfe0f5] bg-[#ecf6fd] px-2.5 text-xs font-semibold text-[#2a6fa8] transition hover:bg-[#d8ebf7] active:scale-95"
              >
                <Plus className="h-4 w-4" />
                <span>Add patient</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
              <div className="space-y-3">
                {activeQueuePatients.length ? activeQueuePatients.map((patient) => (
                  <PatientCard
                    key={patient.id}
                    patient={patient}
                    onOpen={handleOpenPatient}
                    onAdvance={handleAdvancePatient}
                    onRemoveFromQueue={handleRemoveFromQueue}
                    onTogglePriority={handleTogglePriority}
                    onOpenBilling={(patient) => openBillingWorkspace(patient.id)}
                    canAdvance={canUseClinicalTools(currentUser?.role)}
                    now={queueClock}
                  />
                )) : (
                  <div className="rounded-[16px] border border-dashed border-[#bfd7e8] bg-[#f3f8fb] px-4 py-10 text-center">
                    <p className="text-sm font-semibold text-[#5b6b80]">No patients in today&apos;s queue</p>
                    <p className="mt-1 text-xs text-[#8595a8]">New arrivals will appear here.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : isMultiDoctorWorkspace ? (
          <MultiDoctorQueueBoard
            patients={patients}
            providers={queueProviders}
            draggedPatient={draggedPatient}
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={(event) => {
              void handleDragEnd(event);
            }}
            onDragCancel={handleDragCancel}
            onOpen={handleOpenPatient}
            onAdvance={handleAdvancePatient}
            onRemoveFromQueue={handleRemoveFromQueue}
            onTogglePriority={handleTogglePriority}
            onOpenBilling={(patient) => openBillingWorkspace(patient.id)}
            onAssignDoctor={openAssignDoctorModal}
            onAddPatient={() => setIsModalOpen(true)}
            canAdvance={() => canUseClinicalTools(currentUser?.role)}
            canAssignDoctor={canAssignDoctors}
            now={queueClock}
          />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={(event) => {
              void handleDragEnd(event);
            }}
            onDragCancel={handleDragCancel}
          >
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto xl:grid-cols-3 xl:overflow-hidden">
              <PatientColumn
                status="waiting"
                title="Waiting"
                patients={groupedPatients.waiting}
                onOpen={handleOpenPatient}
                onAdvance={handleAdvancePatient}
                onRemoveFromQueue={handleRemoveFromQueue}
                onTogglePriority={handleTogglePriority}
                onOpenBilling={(patient) => openBillingWorkspace(patient.id)}
                onAddPatient={() => setIsModalOpen(true)}
                canAdvance={() => canUseClinicalTools(currentUser?.role)}
                now={queueClock}
              />
              <PatientColumn
                status="consultation"
                title="Consultation"
                patients={groupedPatients.consultation}
                onOpen={handleOpenPatient}
                onAdvance={handleAdvancePatient}
                onRemoveFromQueue={handleRemoveFromQueue}
                onTogglePriority={handleTogglePriority}
                onOpenBilling={(patient) => openBillingWorkspace(patient.id)}
                canAdvance={() => canUseClinicalTools(currentUser?.role)}
                now={queueClock}
              />
              <PatientColumn
                status="done"
                title="Billing"
                patients={groupedPatients.done}
                onOpen={handleOpenPatient}
                onAdvance={handleAdvancePatient}
                onRemoveFromQueue={handleRemoveFromQueue}
                onTogglePriority={handleTogglePriority}
                onOpenBilling={(patient) => openBillingWorkspace(patient.id)}
                now={queueClock}
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
                    now={queueClock}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <AddPatientModal
        open={isModalOpen}
        onClose={handleClosePatientModal}
        onSubmit={handleCreatePatient}
        providers={queueProviders}
        showProviderSelector={isMultiDoctorWorkspace}
      />

      <AssignDoctorModal
        patient={assignDoctorPatient ? patients.find((patient) => patient.id === assignDoctorPatient.id) ?? assignDoctorPatient : null}
        providers={doctorQueueProviders}
        isSaving={isQueueMutationPending}
        onAssign={(patient, providerId) => {
          void handleAssignDoctor(patient, providerId);
        }}
        onClose={() => setAssignDoctorPatient(null)}
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
          onSendLetterWhatsApp={handleSendLetterWhatsApp}
          onCreateInvoice={handleCreateInvoice}
          onGenerateInvoicePdf={(invoiceId) => api.generateInvoicePdf(invoiceId)}
          onSendInvoice={handleSendInvoice}
          onSendInvoiceWhatsApp={handleSendInvoiceWhatsApp}
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
        workflowActionLabel={patientChartActionLabel}
        workflowActionDisabled={patientChartActionDisabled}
        onWorkflowAction={selectedPatient
          ? () => (
            selectedPatient.status === "waiting" || selectedPatient.status === "consultation"
              ? handleStartConsultation(selectedPatient)
              : openBillingWorkspace(selectedPatient.id)
          )
          : null}
        isTrainingMode={isTrainingMode}
        canAssignDoctor={canAssignDoctors}
        onAssignDoctor={openAssignDoctorModal}
        canRefer={canUseClinicalTools(currentUser?.role)}
        onLoadVisits={handleLoadPatientVisits}
        onLoadVisitDetail={handleLoadPatientVisitDetail}
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
        onPatientUpdated={handlePatientChartUpdated}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
          closeConsultationWorkspace();
        }}
      />

      <ConsultationDrawer
        patient={drawerMode === "consultation" ? selectedPatient : null}
        currentUser={currentUser}
        clinicSpecialty={clinicSettings?.clinic_specialty ?? null}
        clinicTimeZone={clinicSettings?.timezone ?? "UTC"}
        emailConfigured={Boolean(clinicSettings?.email_configured)}
        hasUserSignature={hasUserSignature(currentUser)}
        hasClinicDocumentTemplate={hasClinicDocumentTemplate(clinicSettings)}
        isTrainingMode={isTrainingMode}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
          if (workspaceTransitionRef.current) {
            workspaceTransitionRef.current = false;
            return;
          }
          closeWorkspace();
        }}
        onDone={async (patient, followUp) => {
          if (followUp && !isTrainingMode) {
            await api.createFollowUp(patient.id, followUp);
          }
          try {
            const donePatient = await transitionPatientStatus(patient, "done");
            if (isSoloWorkspace && !isTrainingMode) {
              openBillingWorkspace(donePatient.id);
            } else {
              workspaceTransitionRef.current = true;
              setSelectedPatient(null);
              setDrawerMode(null);
              finishConsultationWorkspace();
            }
          } catch {
            return;
          }
        }}
        onGenerate={async (payload) => {
          if (isTrainingMode) {
            const response = createTrainingNote(payload);
            return {
              content: response.content,
              noteId: response.noteId,
              status: response.status,
              usedFallback: false,
              warning: null,
              extractions: { services_performed: [], medications_prescribed: [] },
            };
          }
          const response = await api.generateNote(payload);
          return {
            content: response.content,
            noteId: response.note_id,
            status: response.status,
            usedFallback: response.used_fallback,
            warning: response.warning,
            extractions: response.extractions,
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
        onSendWhatsApp={async (payload) => {
          if (isTrainingMode) {
            throw new Error("Disabled in Training Mode. Nothing is sent or saved to the clinic.");
          }
          return api.sendNoteWhatsApp(payload);
        }}
      />

      {billingPatientId && selectedBillingPatient ? (
        <BillingWorkspace
          key={selectedBillingPatient.id}
          patient={selectedBillingPatient}
          catalogItems={catalogItems}
          isCatalogLoaded={isCatalogLoaded}
          isCatalogLoading={isCatalogLoading}
          loadCatalogItems={loadCatalogItems}
          gateway={billingGateway}
          onCompleted={handleBillingCompleted}
          onClose={closeBillingWorkspace}
        />
      ) : null}
    </main>
  );
}

function AssignDoctorModal({
  patient,
  providers,
  isSaving,
  onAssign,
  onClose,
}: {
  patient: Patient | null;
  providers: QueueProvider[];
  isSaving: boolean;
  onAssign: (patient: Patient, providerId: string) => void;
  onClose: () => void;
}) {
  if (!patient) {
    return null;
  }

  const assignedDoctorId = patient.assigned_doctor_id || "";
  const options = [{ id: "", name: "Unassigned", role: "Needs doctor" }, ...providers];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className="mx-auto mt-[8vh] w-full max-w-xl rounded-[20px] border border-[#bfd7e8] bg-white p-5 shadow-[0_32px_90px_rgba(15,23,42,0.20)] sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#edf5fa] text-[#2f8fd3]">
            <Stethoscope className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#6c7d91]">Assign Doctor</p>
            <h2 className="mt-1 truncate text-2xl font-black text-[#0f172a]">{patient.name}</h2>
            <p className="mt-1 text-sm font-medium text-[#5b6b80]">
              Choose the doctor queue this patient should move to.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#bfd7e8] bg-white text-[#344154] transition hover:bg-[#edf5fa]"
            aria-label="Close assign doctor"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {options.map((provider) => {
            const selected = provider.id === assignedDoctorId;
            return (
              <button
                key={provider.id || "unassigned"}
                type="button"
                disabled={isSaving || selected || (provider.id !== "" && !providers.length)}
                onClick={() => onAssign(patient, provider.id)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  selected
                    ? "border-[#2f8fd3] bg-[#ecf6fd] text-[#1f2b3d]"
                    : "border-[#dbe7ef] bg-white text-[#1f2b3d] hover:border-[#9fc7e1] hover:bg-[#f7fbfe]"
                } disabled:cursor-not-allowed disabled:opacity-65`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{provider.name}</span>
                  <span className="mt-0.5 block text-xs font-semibold capitalize text-[#6c7d91]">{provider.role}</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  selected ? "bg-white text-[#2a6fa8]" : "bg-[#f3f8fb] text-[#6c7d91]"
                }`}>
                  {selected ? "Current" : "Assign"}
                </span>
              </button>
            );
          })}
          {!providers.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              No doctor users are active yet. Add a Doctor role user first, or keep this patient unassigned.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
