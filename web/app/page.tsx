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
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AddPatientModal } from "@/components/add-patient-modal";
import { AppHeader } from "@/components/app-header";
import { ConsultationDrawer } from "@/components/consultation-drawer";
import { LazySettingsDrawer } from "@/components/lazy-settings-drawer";
import { PatientDetailsDrawer } from "@/components/patient-details-drawer";
import { PatientCard } from "@/components/patient-card";
import { PatientColumn } from "@/components/patient-column";
import { DraftInvoiceItem, SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import { api } from "@/lib/api";
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
  trainingQueueOrderStorageKey,
  writeTrainingPatients,
} from "@/lib/training-mode";
import { useClinicShellPage } from "@/lib/use-clinic-shell-page";
import { CatalogItem, ConsultationNote, Invoice, Patient, PatientChartVisit, PatientStatus, PatientVisitDetail, PaymentStatus } from "@/lib/types";

const statusOrder: PatientStatus[] = ["waiting", "consultation", "done"];
const QUEUE_REFRESH_INTERVAL_MS = 5000;

function loadQueueOrder(storageKey: string, persistent: boolean): QueueOrder {
  if (typeof window === "undefined") {
    return createEmptyQueueOrder();
  }

  try {
    const storage = persistent ? window.localStorage : window.sessionStorage;
    const raw = storage.getItem(storageKey);
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
) {
  if (!patient) {
    return [];
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
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [drawerMode, setDrawerMode] = useState<"details" | "consultation" | null>(null);
  const [billingPatientId, setBillingPatientId] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [queueOrder, setQueueOrder] = useState<QueueOrder>(() => createEmptyQueueOrder());
  const [draggedPatient, setDraggedPatient] = useState<Patient | null>(null);
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
  const [isInvoiceDirty, setIsInvoiceDirty] = useState(false);
  const [selectedPatientNotes, setSelectedPatientNotes] = useState<ConsultationNote[]>([]);
  const [isBillingNotesLoading, setIsBillingNotesLoading] = useState(false);
  const [hasSeededBillingDraft, setHasSeededBillingDraft] = useState(false);
  const [customItemLabel, setCustomItemLabel] = useState("");
  const [customItemQuantity, setCustomItemQuantity] = useState("1");
  const [customItemUnitPrice, setCustomItemUnitPrice] = useState("");
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
    return api.listQueuePatients();
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
    handleFinalizeInvoice,
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
  const workspaceMode = clinicSettings?.workspace_mode ?? "team";
  const isSoloWorkspace = workspaceMode === "solo";
  const queueOrderStorageKey = useMemo(() => (
    isTrainingMode && trainingScope
      ? trainingQueueOrderStorageKey(trainingScope)
      : currentUser
        ? `clinic_queue_order_v2:${currentUser.org_id}:${currentUser.id}`
        : "clinic_queue_order_v2:anonymous"
  ), [currentUser, isTrainingMode, trainingScope]);

  useEffect(() => {
    const nextQueueOrder = loadQueueOrder(queueOrderStorageKey, isTrainingMode);
    hydratingQueueOrderRef.current = JSON.stringify(nextQueueOrder);
    loadedQueueOrderKeyRef.current = queueOrderStorageKey;
    setQueueOrder(nextQueueOrder);
  }, [isTrainingMode, queueOrderStorageKey]);

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
    const storage = isTrainingMode ? window.localStorage : window.sessionStorage;
    storage.setItem(queueOrderStorageKey, serializedQueueOrder);
  }, [isTrainingMode, queueOrder, queueOrderStorageKey]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || isTrainingMode) {
      return;
    }

    let active = true;

    async function refreshPatients() {
      try {
        const nextPatients = await api.listQueuePatients();
        if (active) {
          setPatients(nextPatients);
        }
      } catch {
        // Keep the current queue stable if a background refresh fails.
      }
    }

    void refreshPatients();

    const intervalId = isSoloWorkspace
      ? null
      : window.setInterval(() => {
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
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAuthReady, isRedirectingToLogin, isSoloWorkspace, isTrainingMode]);

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
    if (!catalogItems.length) {
      void loadCatalogItems();
    }
  }, [catalogItems.length, currentUser, isAuthReady, loadCatalogItems]);

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
  const activeQueuePatients = useMemo(() => {
    const orderedIds = [...queueOrder.waiting, ...queueOrder.consultation, ...queueOrder.done];
    const activePatients = patients.filter((patient) => !patient.billed);
    const positionById = new Map(orderedIds.map((id, index) => [id, index]));
    const fallbackById = new Map(activePatients.map((patient, index) => [patient.id, index]));

    return [...activePatients].sort((left, right) => {
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
  }, [patients, queueOrder]);
  const billingPatients = useMemo(
    () => patients.filter((patient) => patient.status === "done" && !patient.billed),
    [patients],
  );
  const selectedBillingPatient = useMemo(
    () => billingPatients.find((patient) => patient.id === billingPatientId) ?? null,
    [billingPatientId, billingPatients],
  );
  const serviceItems = useMemo(() => catalogItems.filter((item) => item.item_type === "service"), [catalogItems]);
  const medicineItems = useMemo(() => catalogItems.filter((item) => item.item_type === "medicine"), [catalogItems]);
  const latestConsultationNote = useMemo(() => selectedPatientNotes[0] ?? null, [selectedPatientNotes]);
  const autoDraftInvoiceItems = useMemo(
    () => buildAutoDraftInvoiceItems(selectedBillingPatient, latestConsultationNote, serviceItems, medicineItems),
    [latestConsultationNote, medicineItems, selectedBillingPatient, serviceItems],
  );
  const invoiceSubtotal = useMemo(
    () => invoiceItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
    [invoiceItems],
  );
  const normalizedAmountPaid = useMemo(
    () => (paymentStatus === "paid" ? invoiceSubtotal : paymentStatus === "unpaid" ? 0 : Number(amountPaidInput || "0")),
    [amountPaidInput, invoiceSubtotal, paymentStatus],
  );
  const balanceDue = useMemo(() => Math.max(invoiceSubtotal - normalizedAmountPaid, 0), [invoiceSubtotal, normalizedAmountPaid]);

  function handleCloseSettingsDrawer() {
    setIsSettingsOpen(false);
  }

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
    if (!billingPatientId || isBillingNotesLoading || hasSeededBillingDraft || isInvoiceDirty) {
      return;
    }
    setInvoiceItems(autoDraftInvoiceItems);
    setSavedInvoice(null);
    setIsInvoiceDirty(false);
    setBillingError("");
    setBillingStatus(
      autoDraftInvoiceItems.length
        ? `Added consultation and ${Math.max(autoDraftInvoiceItems.length - 1, 0)} medicine item${Math.max(autoDraftInvoiceItems.length - 1, 0) === 1 ? "" : "s"} from the latest consultation.`
        : "",
    );
    setAmountPaidInput("");
    setHasSeededBillingDraft(true);
  }, [autoDraftInvoiceItems, billingPatientId, hasSeededBillingDraft, isBillingNotesLoading, isInvoiceDirty]);

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
  }

  function openBillingWorkspace(patientId: string) {
    setBillingPatientId(patientId);
    resetBillingWorkspaceState();
    setSelectedPatient(null);
    setDrawerMode(null);
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

  async function transitionPatientStatus(patient: Patient, nextStatus: PatientStatus) {
    if (currentUser?.role !== "admin" && nextStatus === "consultation") {
      throw new Error("Only admins can start or continue consultation.");
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
      await api.updatePatientStatus(patient.id, nextStatus);
      setError("");
      return { ...patient, status: nextStatus };
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

  function handlePatientChartUpdated(updated: Patient) {
    setPatients((current) =>
      current.map((patient) => (patient.id === updated.id ? updated : patient)),
    );
    setSelectedPatient((current) => (current?.id === updated.id ? updated : current));
  }

  function addCustomInvoiceItem() {
    const label = customItemLabel.trim();
    const quantity = Number(customItemQuantity);
    const unitPrice = Number(customItemUnitPrice);

    if (!label) {
      setBillingError("Enter a label for the custom item.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setBillingError("Custom item quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setBillingError("Custom item price must be zero or more.");
      return;
    }

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
      setBillingStatus(savedInvoice ? "Invoice draft updated." : "Invoice draft created.");
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
    if (!selectedBillingPatient.email.trim()) {
      setBillingError("This patient does not have an email address saved.");
      return;
    }
    setIsSendingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice = await ensureSavedInvoice();
      const result = await handleSendInvoice({ invoice_id: invoice.id, recipient_email: selectedBillingPatient.email });
      setBillingStatus(result.message);
      setSavedInvoice(result.invoice);
      await completeBillingWorkflow(true);
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to mark invoice as shared.");
    } finally {
      setIsSendingInvoice(false);
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
    } catch (finalizeError) {
      setBillingError(finalizeError instanceof Error ? finalizeError.message : "Failed to complete invoice.");
    } finally {
      setIsFinalizingInvoice(false);
    }
  }

  function handleOpenPatient(patient: Patient) {
    setSelectedPatient(patient);
    setDrawerMode("details");
  }

  async function handleStartConsultation(patient: Patient) {
    try {
      const workingPatient = patient.status === "waiting"
        ? await transitionPatientStatus(patient, "consultation")
        : patient;
      setSelectedPatient(workingPatient);
      setDrawerMode("consultation");
    } catch {
      return;
    }
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

  const patientChartActionLabel = selectedPatient
    ? selectedPatient.status === "waiting"
      ? "Start consultation"
      : selectedPatient.status === "consultation"
        ? "Continue consultation"
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

        {isSoloWorkspace ? (
          <section className="flex min-h-0 flex-1 flex-col rounded-[18px] border border-[#bfd7e8] bg-white/95 p-4 shadow-[0_14px_38px_rgba(64,131,181,0.09)]">
            <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Today</h2>
                <p className="text-sm text-slate-500">{activeQueuePatients.length} patients</p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                aria-label="Add patient"
                title="Add patient"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#edf5fa] text-[#2a6fa8] transition hover:bg-[#dbeaf4]"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="space-y-3">
                {activeQueuePatients.length ? activeQueuePatients.map((patient) => (
                  <PatientCard
                    key={patient.id}
                    patient={patient}
                    onOpen={handleOpenPatient}
                    onAdvance={handleAdvancePatient}
                    onRemoveFromQueue={handleRemoveFromQueue}
                  />
                )) : (
                  <div className="rounded-[14px] border border-dashed border-[#bfd7e8] bg-[#f5f9fc] px-4 py-8 text-center">
                    <p className="text-sm font-medium text-slate-600">No patients in today&apos;s queue.</p>
                    <p className="mt-1 text-xs text-slate-500">New arrivals and follow-through work will appear here.</p>
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
        onPatientUpdated={handlePatientChartUpdated}
        onClose={() => {
          setSelectedPatient(null);
          setDrawerMode(null);
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
              setSelectedPatient(null);
              setDrawerMode(null);
            }
          } catch {
            return;
          }
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

      {billingPatientId && selectedBillingPatient ? (
        <div className="fixed inset-0 z-30 bg-slate-950/35 p-3 backdrop-blur-sm sm:p-5">
          <div className="mx-auto flex h-full max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-[#dbe7ef] bg-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4 border-b border-[#dbe7ef] px-5 py-4 sm:px-7">
              <div className="min-w-0 flex-1">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Billing</p>
                <h2 className="mt-2 truncate text-3xl font-semibold text-slate-900">{selectedBillingPatient.name}</h2>
                <p className="mt-2 text-sm text-slate-500">{selectedBillingPatient.reason}</p>
              </div>
              <button
                type="button"
                onClick={closeBillingWorkspace}
                className="rounded-xl border border-[#dbe7ef] p-2 text-slate-500 transition hover:text-slate-800"
                aria-label="Close billing"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
              <SettingsDrawerBillingPanel
                patients={[selectedBillingPatient]}
                selectedBillingPatientId={billingPatientId}
                selectedBillingPatient={selectedBillingPatient}
                showPatientSelector={false}
                serviceItems={serviceItems}
                medicineItems={medicineItems}
                invoiceItems={invoiceItems}
                invoiceSubtotal={invoiceSubtotal}
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
                savedInvoice={savedInvoice}
                customItemLabel={customItemLabel}
                customItemQuantity={customItemQuantity}
                customItemUnitPrice={customItemUnitPrice}
                onSelectPatient={() => undefined}
                onAddCatalogItem={addCatalogItemToInvoice}
                onCustomItemLabelChange={setCustomItemLabel}
                onCustomItemQuantityChange={setCustomItemQuantity}
                onCustomItemUnitPriceChange={setCustomItemUnitPrice}
                onAddCustomItem={addCustomInvoiceItem}
                onUpdateInvoiceItem={updateInvoiceItem}
                onRemoveInvoiceItem={removeInvoiceItem}
                onCreateBill={handleCreateBill}
                onPaymentStatusChange={(status) => {
                  setPaymentStatus(status);
                  setAmountPaidInput(status === "partial" ? invoiceSubtotal.toFixed(2) : "");
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
              />
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
