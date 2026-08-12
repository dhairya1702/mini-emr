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
import { Plus } from "lucide-react";
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
import { DraftInvoiceItem, SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import { api } from "@/lib/api";
import { calculateDraftInvoiceTaxTotals } from "@/lib/billing-tax";
import { trackWhatsAppDelivery } from "@/lib/whatsapp-delivery";
import {
  canMovePatientStatus,
  createEmptyQueueOrder,
  movePatientBetweenQueueColumns,
  QueueOrder,
  reorderQueueColumn,
} from "@/lib/queue-dnd";
import { hasClinicDocumentTemplate, hasUserSignature } from "@/lib/setup-checklist";
import { printBlob } from "@/lib/print";
import {
  createTrainingNote,
  createTrainingPatient,
  createTrainingTimeline,
  readTrainingPatients,
  writeTrainingPatients,
} from "@/lib/training-mode";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { BillingSuggestionsResponse, CatalogItem, CheckInRequest, ConsultationNote, Invoice, Patient, PatientChartVisit, PatientStatus, PatientTimelineEvent, PatientVisitDetail, PaymentStatus, QueueSnapshot, SexAtBirth } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];
const QUEUE_REFRESH_INTERVAL_MS = 15000;
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

function extractMedicineSuggestions(note: ConsultationNote | null, medicineItems: CatalogItem[]) {
  if (!note) {
    return [];
  }

  const noteText = `${note.snapshot_content || note.content || ""}`.trim();
  if (!noteText) {
    return [];
  }

  const normalizedText = noteText.toLowerCase();
  return medicineItems.filter((item) => normalizedText.includes(item.name.toLowerCase()));
}

function extractStructuredPrescriptionItems(
  note: ConsultationNote | null,
  medicineItems: CatalogItem[],
): DraftInvoiceItem[] {
  if (!note) {
    return [];
  }

  const sourceText = `${note.snapshot_content || note.content || ""}`;
  const lines = sourceText.split("\n");
  const headerIndex = lines.findIndex((line) =>
    line.trim().toLowerCase() === "medicine | quantity | schedule | duration | notes",
  );
  if (headerIndex === -1) {
    return [];
  }

  const itemsByName = new Map(medicineItems.map((item) => [item.name.trim().toLowerCase(), item]));
  const structuredItems: DraftInvoiceItem[] = [];

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const rawLine = lines[index].trim();
    if (!rawLine || !rawLine.includes("|")) {
      break;
    }

    const columns = rawLine.split("|").map((column) => column.trim());
    if (columns.length < 2) {
      continue;
    }

    const label = columns[0];
    const quantityText = columns[1] || "1";
    const matchedMedicine = itemsByName.get(label.toLowerCase());
    if (!matchedMedicine) {
      continue;
    }

    const quantityMatch = quantityText.match(/(\d+(?:\.\d+)?)/);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }

    structuredItems.push({
      id: createId(),
      catalog_item_id: matchedMedicine.id,
      item_type: matchedMedicine.item_type,
      label: matchedMedicine.name,
      quantity,
      unit_price: matchedMedicine.default_price,
    });
  }

  return structuredItems;
}

function buildAutoDraftInvoiceItems(
  patient: Patient | null,
  note: ConsultationNote | null,
  serviceItems: CatalogItem[],
  medicineItems: CatalogItem[],
  suggestions: BillingSuggestionsResponse | null,
) {
  if (!patient) {
    return [];
  }

  if (suggestions) {
    return suggestions.suggestions
      .filter((suggestion) => suggestion.status === "auto_add")
      .map((suggestion) => suggestion.catalog_match
        ? {
            id: createId(),
            catalog_item_id: suggestion.catalog_match.catalog_item_id,
            item_type: suggestion.catalog_match.item_type,
            label: suggestion.catalog_match.label,
            quantity: suggestion.catalog_match.quantity,
            unit_price: suggestion.catalog_match.unit_price,
          }
        : {
            id: createId(),
            catalog_item_id: null,
            item_type: "service" as const,
            label: "Consultation",
            quantity: 1,
            unit_price: 0,
          });
  }

  const items: DraftInvoiceItem[] = [];
  const structuredMedicineItems = extractStructuredPrescriptionItems(note, medicineItems);
  const consultationService =
    serviceItems.find((item) => /\bconsult/i.test(item.name)) ?? null;

  items.push(
    consultationService
      ? {
          id: createId(),
          catalog_item_id: consultationService.id,
          item_type: consultationService.item_type,
          label: consultationService.name,
          quantity: 1,
          unit_price: consultationService.default_price,
        }
      : {
          id: createId(),
          catalog_item_id: null,
          item_type: "service",
          label: "Consultation",
          quantity: 1,
          unit_price: 0,
        },
  );

  const medicinesToBill = structuredMedicineItems.length
    ? structuredMedicineItems
    : extractMedicineSuggestions(note, medicineItems).map((medicine) => ({
        id: createId(),
        catalog_item_id: medicine.id,
        item_type: medicine.item_type,
        label: medicine.name,
        quantity: 1,
        unit_price: medicine.default_price,
      }));

  for (const medicine of medicinesToBill) {
    items.push({ ...medicine });
  }

  return items;
}

export default function HomePage() {
  const router = useRouter();
  const {
    queuePatients: patients,
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
  const [draggedPatient, setDraggedPatient] = useState<Patient | null>(null);
  const [isQueueMutationPending, setIsQueueMutationPending] = useState(false);
  const [queueClock, setQueueClock] = useState(() => Date.now());
  const [invoiceItems, setInvoiceItems] = useState<DraftInvoiceItem[]>([]);
  const [billingError, setBillingError] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [amountPaidInput, setAmountPaidInput] = useState("");
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isFinalizingInvoice, setIsFinalizingInvoice] = useState(false);
  const [isPreparingInvoicePdf, setIsPreparingInvoicePdf] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [isSendingInvoiceWhatsApp, setIsSendingInvoiceWhatsApp] = useState(false);
  const [isInvoiceDirty, setIsInvoiceDirty] = useState(false);
  const [selectedPatientNotes, setSelectedPatientNotes] = useState<ConsultationNote[]>([]);
  const [isBillingNotesLoading, setIsBillingNotesLoading] = useState(false);
  const [billingSuggestions, setBillingSuggestions] = useState<BillingSuggestionsResponse | null>(null);
  const [isBillingSuggestionsLoading, setIsBillingSuggestionsLoading] = useState(false);
  const [hasSeededBillingDraft, setHasSeededBillingDraft] = useState(false);
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [customItemQuantity, setCustomItemQuantity] = useState("1");
  const [customItemUnitPrice, setCustomItemUnitPrice] = useState("");
  const [billingRecipientEmail, setBillingRecipientEmail] = useState("");
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
  const billingCatalogLoadRequestedRef = useRef(false);
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
      return Promise.resolve({ revision: "training", patients: readTrainingPatients(context.trainingScope) });
    }
    return loadQueueSnapshot();
  }, [loadQueueSnapshot]);
  const onPageData = useCallback((data: QueueSnapshot) => {
    applyQueueSnapshot(data);
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

  const billingPatients = useMemo(
    () => patients.filter((patient) => patient.status === "done" && !patient.billed),
    [patients],
  );
  const selectedBillingPatient = useMemo(
    () => billingPatients.find((patient) => patient.id === billingPatientId) ?? null,
    [billingPatientId, billingPatients],
  );
  const serviceItems = useMemo(() => catalogItems.filter((item) => item.item_type === "service" || (item.item_type === "program" && item.is_active !== false)), [catalogItems]);
  const medicineItems = useMemo(() => catalogItems.filter((item) => item.item_type === "medicine"), [catalogItems]);
  const latestConsultationNote = useMemo(() => selectedPatientNotes[0] ?? null, [selectedPatientNotes]);
  const autoDraftInvoiceItems = useMemo(
    () => buildAutoDraftInvoiceItems(selectedBillingPatient, latestConsultationNote, serviceItems, medicineItems, billingSuggestions),
    [billingSuggestions, latestConsultationNote, medicineItems, selectedBillingPatient, serviceItems],
  );

  useEffect(() => {
    if (!latestConsultationNote) {
      setBillingSuggestions(null);
      setIsBillingSuggestionsLoading(false);
      return;
    }
    let active = true;
    setIsBillingSuggestionsLoading(true);
    void api.getNoteBillingSuggestions(latestConsultationNote.id)
      .then((response) => {
        if (active) setBillingSuggestions(response);
      })
      .catch((error) => {
        if (active) {
          setBillingSuggestions(null);
          setBillingError(error instanceof Error ? error.message : "Failed to load billing suggestions.");
        }
      })
      .finally(() => {
        if (active) setIsBillingSuggestionsLoading(false);
      });
    return () => { active = false; };
  }, [latestConsultationNote]);
  const invoiceTaxTotals = useMemo(
    () => calculateDraftInvoiceTaxTotals(invoiceItems, catalogItems),
    [catalogItems, invoiceItems],
  );
  const invoiceSubtotal = invoiceTaxTotals.subtotal;
  const invoiceTotal = invoiceTaxTotals.total;
  const normalizedAmountPaid = useMemo(
    () => (paymentStatus === "paid" ? invoiceTotal : paymentStatus === "unpaid" ? 0 : Number(amountPaidInput || "0")),
    [amountPaidInput, invoiceTotal, paymentStatus],
  );
  const balanceDue = useMemo(() => Math.max(invoiceTotal - normalizedAmountPaid, 0), [invoiceTotal, normalizedAmountPaid]);

  function handleCloseSettingsDrawer() {
    setIsSettingsOpen(false);
  }

  useEffect(() => {
    if (!billingPatientId) {
      billingCatalogLoadRequestedRef.current = false;
      return;
    }
    if (isCatalogLoaded || isCatalogLoading || billingCatalogLoadRequestedRef.current) {
      return;
    }

    billingCatalogLoadRequestedRef.current = true;
    void loadCatalogItems().catch((loadError) => {
      setBillingStatus("");
      setBillingError(loadError instanceof Error ? loadError.message : "Failed to load services and medicines.");
    });
  }, [billingPatientId, isCatalogLoaded, isCatalogLoading, loadCatalogItems]);

  useEffect(() => {
    if (!billingPatientId) {
      setSelectedPatientNotes([]);
      setIsBillingNotesLoading(false);
      return;
    }

    let active = true;
    setIsBillingNotesLoading(true);
    void api.listPatientNotes(billingPatientId)
      .then((notes) => {
        if (active) {
          setSelectedPatientNotes(notes);
          setIsBillingNotesLoading(false);
        }
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setSelectedPatientNotes([]);
        setIsBillingNotesLoading(false);
        setBillingStatus("");
        setBillingError(loadError instanceof Error ? loadError.message : "Failed to load consultation notes.");
      });

    return () => {
      active = false;
    };
  }, [billingPatientId]);

  useEffect(() => {
    if (
      !billingPatientId
      || !isCatalogLoaded
      || isCatalogLoading
      || isBillingNotesLoading
      || isBillingSuggestionsLoading
      || hasSeededBillingDraft
      || isInvoiceDirty
    ) {
      return;
    }
    setInvoiceItems(autoDraftInvoiceItems);
    setSavedInvoice(null);
    setIsInvoiceDirty(false);
    setBillingError("");
    setBillingStatus("");
    setAmountPaidInput("");
    setHasSeededBillingDraft(true);
  }, [
    autoDraftInvoiceItems,
    billingPatientId,
    hasSeededBillingDraft,
    isBillingNotesLoading,
    isBillingSuggestionsLoading,
    isCatalogLoaded,
    isCatalogLoading,
    isInvoiceDirty,
  ]);

  function handleClosePatientModal() {
    setIsModalOpen(false);
  }

  function resetBillingWorkspaceState() {
    setInvoiceItems([]);
    setSavedInvoice(null);
    setPaymentStatus("paid");
    setAmountPaidInput("");
    setBillingError("");
    setBillingStatus("");
    setIsInvoiceDirty(false);
    setSelectedPatientNotes([]);
    setIsBillingNotesLoading(false);
    setHasSeededBillingDraft(false);
    setCustomItemLabel("");
    setCustomItemQuantity("1");
    setCustomItemUnitPrice("");
    setBillingRecipientEmail("");
  }

  function openBillingWorkspace(patientId: string) {
    if (workspaceKind === "consultation") {
      workspaceTransitionRef.current = true;
    }
    const patient = patients.find((entry) => entry.id === patientId);
    billingCatalogLoadRequestedRef.current = false;
    setBillingPatientId(patientId);
    resetBillingWorkspaceState();
    setBillingRecipientEmail(patient?.email ?? "");
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
    if (currentUser?.role !== "admin" && nextStatus === "consultation") {
      throw new Error("Only admins can start or continue consultation.");
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
        entry.id === patient.id ? { ...entry, status: nextStatus } : entry,
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

  function addCustomInvoiceItem() {
    const label = customItemLabel.trim();
    const quantity = Number(customItemQuantity);
    const amount = Number(customItemUnitPrice);

    if (!label) {
      setBillingError("Enter a label for the custom item.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setBillingError("Custom item quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setBillingError("Custom item amount must be zero or more.");
      return;
    }
    const unitPrice = quantity > 0 ? amount / quantity : 0;

    setInvoiceItems((current) => [
      ...current,
      {
        id: createId(),
        catalog_item_id: null,
        item_type: "service",
        label,
        quantity,
        unit_price: unitPrice,
      },
    ]);
    setCustomItemLabel("");
    setCustomItemQuantity("1");
    setCustomItemUnitPrice("");
    setBillingStatus("");
    setBillingError("");
    setIsInvoiceDirty(true);
  }

  function addCatalogItemToInvoice(item: CatalogItem) {
    if (item.track_inventory && item.stock_quantity <= 0) {
      setBillingError(`No stock left for ${item.name}.`);
      return;
    }
    setInvoiceItems((current) => [
      ...current,
      {
        id: createId(),
        catalog_item_id: item.id,
        item_type: item.item_type,
        label: item.name,
        quantity: 1,
        unit_price: item.default_price,
      },
    ]);
    setBillingStatus("");
    setBillingError("");
    setIsInvoiceDirty(true);
  }

  function updateInvoiceItem(itemId: string, patch: Partial<DraftInvoiceItem>) {
    setInvoiceItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
    setBillingStatus("");
    setBillingError("");
    setIsInvoiceDirty(true);
  }

  function removeInvoiceItem(itemId: string) {
    setInvoiceItems((current) => current.filter((item) => item.id !== itemId));
    setBillingStatus("");
    setBillingError("");
    setIsInvoiceDirty(true);
  }

  function buildInvoicePayload() {
    if (!selectedBillingPatient) {
      throw new Error("Select a done patient to bill.");
    }
    if (!invoiceItems.length) {
      throw new Error("Add at least one service or medicine.");
    }
    return {
      invoice_id: savedInvoice?.id ?? null,
      patient_id: selectedBillingPatient.id,
      items: invoiceItems.map((item) => ({
        catalog_item_id: item.catalog_item_id ?? null,
        item_type: item.item_type,
        label: item.label,
        quantity: item.quantity,
        unit_price: item.unit_price,
      })),
      payment_status: paymentStatus,
      amount_paid: paymentStatus === "partial" ? normalizedAmountPaid : undefined,
    } as const;
  }

  async function saveInvoiceDraft() {
    const saved = await handleCreateInvoice(buildInvoicePayload());
    setSavedInvoice(saved);
    setIsInvoiceDirty(false);
    return saved;
  }

  async function ensureSavedInvoice() {
    if (!savedInvoice || isInvoiceDirty) {
      return saveInvoiceDraft();
    }
    return savedInvoice;
  }

  async function handleCreateBill() {
    setIsSavingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      await saveInvoiceDraft();
      setBillingStatus(savedInvoice ? "Invoice Updated" : "Invoice Created");
    } catch (createError) {
      setBillingError(createError instanceof Error ? createError.message : "Failed to create bill.");
    } finally {
      setIsSavingInvoice(false);
    }
  }

  async function handleInvoicePdf(action: "preview" | "print" = "preview") {
    setIsPreparingInvoicePdf(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const blob = await api.generateInvoicePdf(invoice.id);
      if (action === "print") {
        const patientLabel = selectedBillingPatient?.name.replace(/\s+/g, "_") || "patient";
        printBlob(blob, `${patientLabel}_invoice.pdf`);
        setBillingStatus("Print dialog opened.");
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener,noreferrer");
        setBillingStatus("Invoice PDF ready.");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (pdfError) {
      setBillingError(pdfError instanceof Error ? pdfError.message : "Failed to prepare invoice PDF.");
    } finally {
      setIsPreparingInvoicePdf(false);
    }
  }

  function closeBillingWorkspace() {
    setBillingPatientId("");
    setSelectedPatient(null);
    setDrawerMode(null);
    resetBillingWorkspaceState();
    closeWorkspace();
  }

  async function completeBillingWorkflow(markBilled: boolean) {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }

    if (markBilled) {
      setPatients((current) => current.map((patient) => (
        patient.id === selectedBillingPatient.id ? { ...patient, billed: true } : patient
      )));
    }

    closeBillingWorkspace();
  }

  async function handleShareInvoice() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    const recipientEmail = billingRecipientEmail.trim();
    if (!recipientEmail) {
      setBillingError("This patient does not have an email address saved.");
      return;
    }
    setIsSendingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await handleSendInvoice({ invoice_id: invoice.id, recipient_email: recipientEmail });
      setBillingStatus(result.message);
      setSavedInvoice(result.invoice);
      await completeBillingWorkflow(true);
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to mark invoice as shared.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  async function handleShareInvoiceWhatsApp() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    if (!selectedBillingPatient.phone.trim()) {
      setBillingError("This patient does not have a phone number saved.");
      return;
    }
    setIsSendingInvoiceWhatsApp(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await handleSendInvoiceWhatsApp({ invoice_id: invoice.id, recipient_phone: selectedBillingPatient.phone });
      setBillingStatus(result.message);
      trackWhatsAppDelivery(result.delivery, "Invoice", (message, delivery) => {
        if (delivery.status === "failed") {
          setBillingError(message);
          return;
        }
        setBillingStatus(message);
      });
      setSavedInvoice(result.invoice);
      await completeBillingWorkflow(true);
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to send invoice on WhatsApp.");
    } finally {
      setIsSendingInvoiceWhatsApp(false);
    }
  }

  async function handleCompleteInvoice() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    setIsFinalizingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await handleFinalizeInvoice({ invoice_id: invoice.id });
      setSavedInvoice(result.invoice);
      setBillingStatus(result.message);
      await completeBillingWorkflow(true);
      void refreshDashboardStatus(true);
    } catch (finalizeError) {
      setBillingError(finalizeError instanceof Error ? finalizeError.message : "Failed to complete invoice.");
    } finally {
      setIsFinalizingInvoice(false);
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
        : !selectedPatient.billed && currentUser?.role === "admin"
          ? "Open billing"
          : null
    : null;
  const patientChartActionDisabled = selectedPatient
    ? (selectedPatient.status === "waiting" || selectedPatient.status === "consultation") && currentUser?.role !== "admin"
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
                    canAdvance={currentUser?.role === "admin"}
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
                canAdvance={() => currentUser?.role === "admin"}
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
                canAdvance={() => currentUser?.role === "admin"}
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
        canRefer={currentUser?.role === "admin"}
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
        <div className="fixed inset-0 z-30 bg-slate-950/35 p-3 backdrop-blur-sm sm:p-5">
          <div className="mx-auto flex h-full max-h-[96vh] w-full max-w-[min(96vw,1560px)] flex-col overflow-hidden rounded-[20px] border border-[#dbe7ef] bg-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]">
            <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
              <SettingsDrawerBillingPanel
                patients={[selectedBillingPatient]}
                selectedBillingPatientId={billingPatientId}
                selectedBillingPatient={selectedBillingPatient}
                showPatientSelector={false}
                serviceItems={serviceItems}
                medicineItems={medicineItems}
                invoiceItems={invoiceItems}
                invoiceSubtotal={invoiceSubtotal}
                invoiceTaxTotal={invoiceTaxTotals.taxTotal}
                invoiceCgstTotal={invoiceTaxTotals.cgstTotal}
                invoiceSgstTotal={invoiceTaxTotals.sgstTotal}
                invoiceTotal={invoiceTotal}
                amountPaid={normalizedAmountPaid}
                amountPaidInput={amountPaidInput}
                balanceDue={balanceDue}
                paymentStatus={paymentStatus}
                billingError={billingError}
                billingStatus={billingStatus}
                isSavingInvoice={isSavingInvoice}
                isFinalizingInvoice={isFinalizingInvoice}
                isPreparingInvoicePdf={isPreparingInvoicePdf}
                isSendingInvoice={isSendingInvoice}
                isSendingInvoiceWhatsApp={isSendingInvoiceWhatsApp}
                savedInvoice={savedInvoice}
                customItemLabel={customItemLabel}
                customItemQuantity={customItemQuantity}
                customItemUnitPrice={customItemUnitPrice}
                recipientEmail={billingRecipientEmail}
                onSelectPatient={() => undefined}
                onAddCatalogItem={addCatalogItemToInvoice}
                onCustomItemLabelChange={setCustomItemLabel}
                onCustomItemQuantityChange={setCustomItemQuantity}
                onCustomItemUnitPriceChange={setCustomItemUnitPrice}
                onRecipientEmailChange={(value) => {
                  setBillingRecipientEmail(value);
                  setBillingStatus("");
                  setBillingError("");
                }}
                onAddCustomItem={addCustomInvoiceItem}
                onUpdateInvoiceItem={updateInvoiceItem}
                onRemoveInvoiceItem={removeInvoiceItem}
                onCreateBill={handleCreateBill}
                onPaymentStatusChange={(status) => {
                  setPaymentStatus(status);
                  setAmountPaidInput(status === "partial" ? invoiceTotal.toFixed(2) : "");
                  setIsInvoiceDirty(true);
                  setBillingStatus("");
                  setBillingError("");
                }}
                onAmountPaidChange={(value) => {
                  setAmountPaidInput(value);
                  setIsInvoiceDirty(true);
                  setBillingStatus("");
                  setBillingError("");
                }}
                onPreviewPdf={handleInvoicePdf}
                onPrintInvoice={() => handleInvoicePdf("print")}
                onFinalizeInvoice={handleCompleteInvoice}
                onSendInvoice={handleShareInvoice}
                onSendInvoiceWhatsApp={handleShareInvoiceWhatsApp}
                onClose={closeBillingWorkspace}
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
