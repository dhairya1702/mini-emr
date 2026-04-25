"use client";

import { ChangeEvent, Fragment, FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus2, Eye, Eraser, FileText, Image as ImageIcon, Mail, Paperclip, PenLine, Sparkles, Undo2, X } from "lucide-react";
import NextImage from "next/image";

import { CatalogItem, EyeExamEntry, NoteAsset, Patient, TestScoreEntry } from "@/lib/types";
import { api } from "@/lib/api";

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_ATTACHMENT_SIZE_BYTES = 6 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 6;
const SUPPORTED_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

interface ConsultationDrawerProps {
  patient: Patient | null;
  onClose: () => void;
  onDone: (
    patient: Patient,
    followUp?: { scheduled_for: string; notes: string },
  ) => Promise<void>;
  onGenerate: (payload: {
    note_id?: string;
    patient_id: string;
    symptoms: string;
    diagnosis: string;
    medications: string;
    notes: string;
    blood_pressure_systolic?: number | null;
    blood_pressure_diastolic?: number | null;
    pulse?: number | null;
    spo2?: number | null;
    blood_sugar?: number | null;
    test_scores?: TestScoreEntry[];
    eye_exam?: EyeExamEntry[];
    assets?: NoteAsset[];
  }) => Promise<{ content: string; noteId?: string | null; status?: "draft" | "final" | "sent" | null }>;
  onGeneratePdf: (payload: { note_id?: string; patient_id: string; content: string; assets?: NoteAsset[] }) => Promise<Blob>;
  onSend: (payload: { note_id: string; patient_id: string; recipient_email: string }) => Promise<string>;
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",", 2)[1] || "");
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

function createEmptyForm() {
  return {
    symptoms: "",
    diagnosis: "",
    medications: "",
    notes: "",
    bloodPressureSystolic: "",
    bloodPressureDiastolic: "",
    pulse: "",
    spo2: "",
    bloodSugar: "",
    testScores: [{ id: createId(), label: "", value: "" }],
    eyeExam: [
      { eye: "right", sphere: "", cylinder: "", axis: "", vision: "" },
      { eye: "left", sphere: "", cylinder: "", axis: "", vision: "" },
    ] as EyeExamEntry[],
    followUpDate: "",
    followUpNotes: "",
    generatedNote: "",
    assets: [] as NoteAsset[],
  };
}

type ConsultationWorkspaceSnapshot = {
  form: ReturnType<typeof createEmptyForm>;
  openSections: {
    vitals: boolean;
    testScores: boolean;
    eyeExam: boolean;
  };
  selectedMedicineIds: string[];
  medicineSearch: string;
  currentNoteId: string;
  noteStatus: "draft" | "final" | "sent" | "";
  isSent: boolean;
  recipientEmail: string;
  hasGeneratedNote: boolean;
  isFollowUpOpen: boolean;
};

function workspaceKey(patientId: string) {
  return `consultation-workspace:${patientId}`;
}

function readWorkspace(patientId: string): ConsultationWorkspaceSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(workspaceKey(patientId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ConsultationWorkspaceSnapshot;
  } catch {
    return null;
  }
}

function writeWorkspace(patientId: string, snapshot: ConsultationWorkspaceSnapshot) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(workspaceKey(patientId), JSON.stringify(snapshot));
}

function clearWorkspace(patientId: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(workspaceKey(patientId));
}

function formatMedicineLabel(item: CatalogItem) {
  const unit = item.unit.trim();
  return unit ? `${item.name} (${unit})` : item.name;
}

export function ConsultationDrawer({
  patient,
  onClose,
  onDone,
  onGenerate,
  onGeneratePdf,
  onSend,
}: ConsultationDrawerProps) {
  const [form, setForm] = useState(createEmptyForm);
  const [openSections, setOpenSections] = useState({
    vitals: false,
    testScores: false,
    eyeExam: false,
  });
  const [medicineItems, setMedicineItems] = useState<CatalogItem[]>([]);
  const [medicineSearch, setMedicineSearch] = useState("");
  const [selectedMedicineIds, setSelectedMedicineIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false);
  const [hasGeneratedNote, setHasGeneratedNote] = useState(false);
  const [currentNoteId, setCurrentNoteId] = useState("");
  const [noteStatus, setNoteStatus] = useState<"draft" | "final" | "sent" | "">("");
  const [isSent, setIsSent] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingMode, setDrawingMode] = useState<"draw" | "erase">("draw");
  const [brushSize, setBrushSize] = useState(3);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingHistoryRef = useRef<string[]>([]);

  useEffect(() => {
    if (!patient) {
      return;
    }

    let active = true;
    const cachedWorkspace = readWorkspace(patient.id);
    setStatusMessage("");
    setIsGenerating(false);
    setIsGeneratingPdf(false);
    setIsCompleting(false);
    setIsSending(false);
    setMedicineSearch(cachedWorkspace?.medicineSearch ?? "");
    setForm(cachedWorkspace?.form ? { ...createEmptyForm(), ...cachedWorkspace.form } : createEmptyForm());
    setOpenSections(
      cachedWorkspace?.openSections ?? {
        vitals: false,
        testScores: false,
        eyeExam: false,
      },
    );
    setSelectedMedicineIds(cachedWorkspace?.selectedMedicineIds ?? []);
    setIsFollowUpOpen(cachedWorkspace?.isFollowUpOpen ?? false);
    setHasGeneratedNote(cachedWorkspace?.hasGeneratedNote ?? false);
    setCurrentNoteId(cachedWorkspace?.currentNoteId ?? "");
    setNoteStatus(cachedWorkspace?.noteStatus ?? "");
    setIsSent(cachedWorkspace?.isSent ?? false);
    setRecipientEmail(cachedWorkspace?.recipientEmail ?? patient.email ?? "");

    void Promise.all([api.listCatalogItems(), api.listPatientNotes(patient.id)])
      .then(([items, notes]) => {
        if (!active) {
          return;
        }

        setMedicineItems(items.filter((item) => item.item_type === "medicine"));

        const latestNote = notes[0] ?? null;

        if (latestNote && !cachedWorkspace?.currentNoteId) {
          setCurrentNoteId(String(latestNote.id));
          setNoteStatus(latestNote.status);
          setHasGeneratedNote(Boolean((latestNote.content || "").trim()));
          if (!cachedWorkspace?.form.generatedNote.trim()) {
            setForm((current) => ({
              ...current,
              generatedNote: latestNote.content || "",
              assets: (latestNote.snapshot_asset_payload || latestNote.asset_payload || []) as NoteAsset[],
            }));
          }
        }
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setMedicineItems([]);
        setStatusMessage(error instanceof Error ? error.message : "Failed to load inventory medicines.");
      });

    return () => {
      active = false;
    };
  }, [patient]);

  useEffect(() => {
    if (!patient) {
      return;
    }

    writeWorkspace(patient.id, {
      form,
      openSections,
      selectedMedicineIds,
      medicineSearch,
      currentNoteId,
      noteStatus,
      isSent,
      recipientEmail,
      hasGeneratedNote,
      isFollowUpOpen,
    });
  }, [
    currentNoteId,
    form,
    hasGeneratedNote,
    isFollowUpOpen,
    isSent,
    medicineSearch,
    noteStatus,
    openSections,
    patient,
    recipientEmail,
    selectedMedicineIds,
  ]);

  const selectedMedicines = useMemo(
    () => medicineItems.filter((item) => selectedMedicineIds.includes(item.id)),
    [medicineItems, selectedMedicineIds],
  );
  const filteredMedicineItems = useMemo(() => {
    const query = medicineSearch.trim().toLowerCase();
    return medicineItems.filter((item) => {
      if (!query) {
        return true;
      }
      return item.name.toLowerCase().includes(query) || item.unit.toLowerCase().includes(query);
    });
  }, [medicineItems, medicineSearch]);
  const attachmentAssets = useMemo(
    () => form.assets.filter((asset) => asset.kind === "attachment"),
    [form.assets],
  );
  const drawingAsset = useMemo(
    () => form.assets.find((asset) => asset.kind === "drawing") ?? null,
    [form.assets],
  );
  const medicationPlan = useMemo(() => {
    const manualPlan = form.medications.trim();
    const selectedPlan = selectedMedicines.length
      ? [
          "Prescribed medicines:",
          ...selectedMedicines.map((item) => `- ${formatMedicineLabel(item)}`),
        ].join("\n")
      : "";

    return [manualPlan, selectedPlan].filter(Boolean).join("\n\n");
  }, [form.medications, selectedMedicines]);

  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!drawingAsset) {
      return;
    }
    const image = new window.Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = `data:${drawingAsset.content_type};base64,${drawingAsset.data_base64}`;
  }, [drawingAsset]);

  if (!patient) {
    return null;
  }

  const currentPatient = patient;

  async function handleGenerate(event?: FormEvent) {
    event?.preventDefault();
    setIsGenerating(true);
    setStatusMessage("");
    try {
      const refreshingDraft = Boolean(currentNoteId && noteStatus === "draft");
      const generated = await onGenerate({
        note_id: refreshingDraft ? currentNoteId : undefined,
        patient_id: currentPatient.id,
        symptoms: form.symptoms,
        diagnosis: form.diagnosis,
        medications: medicationPlan,
        notes: form.notes,
        blood_pressure_systolic: form.bloodPressureSystolic ? Number(form.bloodPressureSystolic) : null,
        blood_pressure_diastolic: form.bloodPressureDiastolic ? Number(form.bloodPressureDiastolic) : null,
        pulse: form.pulse ? Number(form.pulse) : null,
        spo2: form.spo2 ? Number(form.spo2) : null,
        blood_sugar: form.bloodSugar ? Number(form.bloodSugar) : null,
        test_scores: form.testScores
          .filter((entry) => entry.label.trim() && entry.value.trim())
          .map((entry) => ({ label: entry.label.trim(), value: entry.value.trim() })),
        eye_exam: form.eyeExam.filter((entry) =>
          entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim(),
        ),
        assets: form.assets,
      });
      setForm((current) => ({ ...current, generatedNote: generated.content }));
      setHasGeneratedNote(true);
      setCurrentNoteId(generated.noteId || "");
      setNoteStatus(generated.status || "draft");
      setIsSent(false);
      setStatusMessage(refreshingDraft ? "Draft note refreshed." : "Draft SOAP note generated.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to generate SOAP note.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSend() {
    if (!form.generatedNote.trim()) {
      setStatusMessage("Generate a note before sending.");
      return;
    }
    if (!currentNoteId) {
      setStatusMessage("Generate and save the note before sending it.");
      return;
    }
    if (!recipientEmail.trim()) {
      setStatusMessage("Enter a recipient email before sending.");
      return;
    }
    if (isSent) {
      setStatusMessage("This saved note has already been emailed and is locked.");
      return;
    }

    setIsSending(true);
    try {
      const message = await onSend({
        note_id: currentNoteId,
        patient_id: currentPatient.id,
        recipient_email: recipientEmail.trim(),
      });
      setNoteStatus("sent");
      setIsSent(true);
      setStatusMessage(message);
      clearWorkspace(currentPatient.id);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to send email.");
    } finally {
      setIsSending(false);
    }
  }

  async function handlePdf(action: "preview" | "download") {
    if (!form.generatedNote.trim()) {
      setStatusMessage("Generate a note before creating the PDF.");
      return;
    }

    setIsGeneratingPdf(true);
    try {
      const blob = await onGeneratePdf({
        note_id: currentNoteId && (noteStatus === "final" || noteStatus === "sent") ? currentNoteId : undefined,
        patient_id: currentPatient.id,
        content: form.generatedNote,
        assets: form.assets,
      });
      const url = URL.createObjectURL(blob);

      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${currentPatient.name.replace(/\s+/g, "_")}_note.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      setStatusMessage("PDF ready.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to prepare PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  async function handleDone() {
    if (!hasGeneratedNote || !form.generatedNote.trim() || !currentNoteId || noteStatus === "draft") {
      setStatusMessage("Finalize the consultation note before marking this patient done.");
      return;
    }

    setIsCompleting(true);
    try {
      const followUp =
        form.followUpDate.trim()
          ? {
              scheduled_for: new Date(`${form.followUpDate}T09:00:00`).toISOString(),
              notes: form.followUpNotes.trim(),
            }
          : undefined;
      await onDone(currentPatient, followUp);
      clearWorkspace(currentPatient.id);
      onClose();
    } finally {
      setIsCompleting(false);
    }
  }

  function updateTestScore(id: string, patch: Partial<TestScoreEntry>) {
    setForm((current) => ({
      ...current,
      testScores: current.testScores.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    }));
  }

  function addTestScore() {
    setForm((current) => ({
      ...current,
      testScores: [...current.testScores, { id: createId(), label: "", value: "" }],
    }));
  }

  function removeTestScore(id: string) {
    setForm((current) => ({
      ...current,
      testScores: current.testScores.length > 1
        ? current.testScores.filter((entry) => entry.id !== id)
        : [{ id: createId(), label: "", value: "" }],
    }));
  }

  function updateEyeExam(eye: "right" | "left", patch: Partial<EyeExamEntry>) {
    setForm((current) => ({
      ...current,
      eyeExam: current.eyeExam.map((entry) => (entry.eye === eye ? { ...entry, ...patch } : entry)),
    }));
  }

  function toggleMedicine(itemId: string) {
    setSelectedMedicineIds((current) =>
      current.includes(itemId) ? current.filter((selected) => selected !== itemId) : [...current, itemId],
    );
  }

  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  async function handleAttachmentSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      return;
    }
    if (attachmentAssets.length + files.length > MAX_ATTACHMENT_COUNT) {
      setStatusMessage(`You can keep up to ${MAX_ATTACHMENT_COUNT} consultation attachments.`);
      event.target.value = "";
      return;
    }
    try {
      for (const file of files) {
        if (!SUPPORTED_ATTACHMENT_TYPES.has(file.type || "")) {
          throw new Error("Only JPG, PNG, and PDF files are supported.");
        }
        if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
          throw new Error("Each attachment must be 6 MB or smaller.");
        }
      }
      const nextAssets = await Promise.all(
        files.map(async (file) => ({
          id: createId(),
          kind: "attachment" as const,
          name: file.name,
          content_type: file.type || "application/octet-stream",
          data_base64: await fileToBase64(file),
        })),
      );
      setForm((current) => ({
        ...current,
        assets: [...current.assets.filter((asset) => asset.kind !== "attachment"), ...nextAssets],
      }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to attach file.");
    } finally {
      event.target.value = "";
    }
  }

  function removeAsset(assetId: string) {
    setForm((current) => ({ ...current, assets: current.assets.filter((asset) => asset.id !== assetId) }));
  }

  function beginDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    drawingHistoryRef.current = [...drawingHistoryRef.current, canvas.toDataURL("image/png")].slice(-12);
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    context.globalCompositeOperation = drawingMode === "erase" ? "destination-out" : "source-over";
    context.strokeStyle = "#0f172a";
    context.lineWidth = drawingMode === "erase" ? brushSize * 4 : brushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
    setIsDrawing(true);
  }

  function continueDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) {
      return;
    }
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    context.lineTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
    context.stroke();
  }

  function finishDrawing() {
    if (!isDrawing) {
      return;
    }
    setIsDrawing(false);
    const canvas = drawingCanvasRef.current;
    if (!canvas) {
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const dataBase64 = dataUrl.split(",", 2)[1] || "";
    setForm((current) => ({
      ...current,
      assets: [
        ...current.assets.filter((asset) => asset.kind !== "drawing"),
        {
          id: current.assets.find((asset) => asset.kind === "drawing")?.id || createId(),
          kind: "drawing",
          name: "consultation-drawing.png",
          content_type: "image/png",
          data_base64: dataBase64,
        },
      ],
    }));
  }

  function clearDrawing() {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    setForm((current) => ({ ...current, assets: current.assets.filter((asset) => asset.kind !== "drawing") }));
    drawingHistoryRef.current = [];
  }

  function undoDrawing() {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    const previous = drawingHistoryRef.current.pop();
    if (!canvas || !context || !previous) {
      return;
    }
    const image = new window.Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      const dataBase64 = dataUrl.split(",", 2)[1] || "";
      setForm((current) => ({
        ...current,
        assets: [
          ...current.assets.filter((asset) => asset.kind !== "drawing"),
          {
            id: current.assets.find((asset) => asset.kind === "drawing")?.id || createId(),
            kind: "drawing",
            name: "consultation-drawing.png",
            content_type: "image/png",
            data_base64: dataBase64,
          },
        ],
      }));
    };
    image.src = previous;
  }

  const hasVitals =
    Boolean(form.bloodPressureSystolic.trim()) ||
    Boolean(form.bloodPressureDiastolic.trim()) ||
    Boolean(form.pulse.trim()) ||
    Boolean(form.spo2.trim()) ||
    Boolean(form.bloodSugar.trim());
  const filledTestScores = form.testScores.filter((entry) => entry.label.trim() || entry.value.trim());
  const hasTestScores = filledTestScores.length > 0;
  const filledEyeExam = form.eyeExam.filter(
    (entry) => entry.sphere.trim() || entry.cylinder.trim() || entry.axis.trim() || entry.vision.trim(),
  );
  const hasEyeExam = filledEyeExam.length > 0;

  const sectionSuggestions = [
    {
      key: "vitals" as const,
      label: "Vitals",
      active: openSections.vitals || hasVitals,
    },
    {
      key: "testScores" as const,
      label: "Test Scores",
      active: openSections.testScores || hasTestScores,
    },
    {
      key: "eyeExam" as const,
      label: "Eye Exam",
      active: openSections.eyeExam || hasEyeExam,
    },
  ];
  const lifecycleLabel =
    noteStatus === "sent"
      ? "Sent and locked"
      : noteStatus === "final"
        ? "Finalized"
        : noteStatus === "draft"
        ? "Draft"
          : null;
  const patientSnapshot = [
    { label: "Age", value: currentPatient.age !== null ? String(currentPatient.age) : "-" },
    { label: "Temp", value: currentPatient.temperature !== null ? `${currentPatient.temperature} F` : "-" },
    { label: "Weight", value: currentPatient.weight !== null ? `${currentPatient.weight} kg` : "-" },
    { label: "Height", value: currentPatient.height !== null ? `${currentPatient.height} cm` : "-" },
  ];
  const vitalsCards = [
    { label: "BP", value: hasVitals ? `${form.bloodPressureSystolic || "-"} / ${form.bloodPressureDiastolic || "-"}` : "-" },
    { label: "Pulse", value: form.pulse || "-" },
    { label: "SpO2", value: form.spo2 ? `${form.spo2}%` : "-" },
    { label: "Sugar", value: form.bloodSugar || "-" },
  ];

  return (
    <aside className="fixed inset-0 z-30 w-screen border-l-2 border-sky-300 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.2)] sm:p-6">
      <div className="flex h-full flex-col">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-600">Consultation</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">{currentPatient.name}</h2>
            <p className="mt-2 text-sm text-slate-700">
              {currentPatient.phone} · {currentPatient.reason}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {patientSnapshot.map((entry) => (
                <span
                  key={entry.label}
                  className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {entry.label} {entry.value}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-sky-200 p-2 text-slate-700 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="grid flex-1 gap-5 overflow-y-auto pr-1 xl:grid-cols-[minmax(0,1.7fr)_360px]" onSubmit={handleGenerate}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Symptoms</span>
              <textarea
                rows={4}
                value={form.symptoms}
                onChange={(event) =>
                  setForm((current) => ({ ...current, symptoms: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Chief complaints, duration, key context"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Diagnosis</span>
              <input
                value={form.diagnosis}
                onChange={(event) =>
                  setForm((current) => ({ ...current, diagnosis: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Provisional or confirmed diagnosis"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Medications</span>
              <textarea
                rows={4}
                value={form.medications}
                onChange={(event) =>
                  setForm((current) => ({ ...current, medications: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Prescriptions, dosage, duration"
              />
              <p className="mt-2 text-xs text-slate-500">
                Selected inventory medicines are forced into the treatment section of the generated note.
              </p>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Clinical Notes</span>
              <textarea
                rows={4}
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Exam findings, vitals, advice, follow-up"
              />
            </label>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-[28px] border border-sky-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Attachments</p>
                    <p className="mt-1 text-xs text-slate-500">Upload JPG, PNG, or PDF files. Images are appended to the PDF, PDFs are emailed as attachments.</p>
                  </div>
                  <label className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-800 transition hover:bg-sky-100">
                    Add files
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleAttachmentSelect}
                      className="hidden"
                    />
                  </label>
                </div>
                <div className="space-y-2">
                  {attachmentAssets.length ? attachmentAssets.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-sky-100 bg-sky-50/40 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        {asset.content_type.startsWith("image/") ? (
                          <NextImage
                            src={`data:${asset.content_type};base64,${asset.data_base64}`}
                            alt={asset.name}
                            width={48}
                            height={48}
                            className="h-12 w-12 rounded-xl border border-sky-100 object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-sky-100 bg-white text-slate-500">
                            <Paperclip className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{asset.name}</p>
                          <p className="text-xs text-slate-500">{asset.content_type}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAsset(asset.id)}
                        className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )) : (
                    <p className="rounded-[18px] border border-dashed border-sky-200 bg-sky-50/20 px-4 py-5 text-sm text-slate-500">
                      No consultation attachments yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-[28px] border border-sky-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Drawing</p>
                    <p className="mt-1 text-xs text-slate-500">Sketch findings, markings, or procedure notes.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDrawingMode("draw")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${drawingMode === "draw" ? "border-sky-300 bg-sky-100 text-sky-800" : "border-sky-200 bg-white text-slate-700 hover:bg-sky-50"}`}
                    >
                      <PenLine className="mr-1 inline h-3.5 w-3.5" />
                      Draw
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawingMode("erase")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${drawingMode === "erase" ? "border-sky-300 bg-sky-100 text-sky-800" : "border-sky-200 bg-white text-slate-700 hover:bg-sky-50"}`}
                    >
                      <Eraser className="mr-1 inline h-3.5 w-3.5" />
                      Erase
                    </button>
                    <button
                      type="button"
                      onClick={undoDrawing}
                      className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                    >
                      <Undo2 className="mr-1 inline h-3.5 w-3.5" />
                      Undo
                    </button>
                    <button
                      type="button"
                      onClick={clearDrawing}
                      className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Brush</span>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={brushSize}
                    onChange={(event) => setBrushSize(Number(event.target.value))}
                    className="w-36 accent-sky-500"
                  />
                  <span className="text-xs text-slate-500">{brushSize}px</span>
                </div>
                <canvas
                  ref={drawingCanvasRef}
                  width={560}
                  height={240}
                  onPointerDown={beginDrawing}
                  onPointerMove={continueDrawing}
                  onPointerUp={finishDrawing}
                  onPointerLeave={finishDrawing}
                  className="h-[220px] w-full rounded-[20px] border border-sky-100 bg-sky-50/30"
                />
                {drawingAsset ? (
                  <div className="mt-3 flex items-center gap-2 rounded-[18px] border border-sky-100 bg-sky-50/40 px-3 py-2 text-xs text-slate-600">
                    <ImageIcon className="h-4 w-4 text-sky-600" />
                    Drawing will be appended as an extra page in the generated consultation PDF.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {sectionSuggestions.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    section.active
                      ? "border-sky-300 bg-sky-100 text-sky-800"
                      : "border-sky-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                  }`}
                >
                  {section.active ? `${section.label} Added` : `+ ${section.label}`}
                </button>
              ))}
            </div>

            {openSections.vitals ? (
              <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Vitals & Measurements</p>
                  <p className="mt-1 text-xs text-slate-500">Structured findings will be included in the generated note.</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSection("vitals")}
                  className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                >
                  Hide
                </button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">BP</span>
                  <div className="flex gap-2">
                    <input
                      value={form.bloodPressureSystolic}
                      inputMode="numeric"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, bloodPressureSystolic: event.target.value }))
                      }
                      placeholder="120"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={form.bloodPressureDiastolic}
                      inputMode="numeric"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, bloodPressureDiastolic: event.target.value }))
                      }
                      placeholder="80"
                      className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Pulse</span>
                  <input
                    value={form.pulse}
                    inputMode="numeric"
                    onChange={(event) => setForm((current) => ({ ...current, pulse: event.target.value }))}
                    placeholder="72 bpm"
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">SpO2</span>
                  <input
                    value={form.spo2}
                    inputMode="numeric"
                    onChange={(event) => setForm((current) => ({ ...current, spo2: event.target.value }))}
                    placeholder="98"
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">Blood Sugar</span>
                  <input
                    value={form.bloodSugar}
                    inputMode="decimal"
                    onChange={(event) => setForm((current) => ({ ...current, bloodSugar: event.target.value }))}
                    placeholder="110"
                    className="w-full rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                  />
                </label>
              </div>
              </div>
            ) : null}

            {openSections.testScores ? (
              <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Test Scores</p>
                  <p className="mt-1 text-xs text-slate-500">Add exam values like visual acuity, pain score, or other structured results.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addTestScore}
                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
                  >
                    Add Score
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSection("testScores")}
                    className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                  >
                    Hide
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {form.testScores.map((entry) => (
                  <div key={entry.id} className="grid gap-3 md:grid-cols-[1fr_1fr_44px]">
                    <input
                      value={entry.label}
                      onChange={(event) => updateTestScore(entry.id!, { label: event.target.value })}
                      placeholder="Test name"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.value}
                      onChange={(event) => updateTestScore(entry.id!, { value: event.target.value })}
                      placeholder="Result"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <button
                      type="button"
                      onClick={() => removeTestScore(entry.id!)}
                      className="rounded-full border border-sky-200 bg-white p-2 text-slate-600 transition hover:bg-sky-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              </div>
            ) : null}

            {openSections.eyeExam ? (
              <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Eye Exam</p>
                  <p className="mt-1 text-xs text-slate-500">Optional refraction or vision entries for right and left eye.</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSection("eyeExam")}
                  className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50"
                >
                  Hide
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-[110px_repeat(4,minmax(0,1fr))]">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Eye</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Sphere</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Cylinder</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Axis</div>
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Vision</div>
                {form.eyeExam.map((entry) => (
                  <Fragment key={entry.eye}>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-sm font-medium capitalize text-slate-700">
                      {entry.eye}
                    </div>
                    <input
                      value={entry.sphere}
                      onChange={(event) => updateEyeExam(entry.eye, { sphere: event.target.value })}
                      placeholder="-1.25"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.cylinder}
                      onChange={(event) => updateEyeExam(entry.eye, { cylinder: event.target.value })}
                      placeholder="-0.50"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.axis}
                      onChange={(event) => updateEyeExam(entry.eye, { axis: event.target.value })}
                      placeholder="90"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <input
                      value={entry.vision}
                      onChange={(event) => updateEyeExam(entry.eye, { vision: event.target.value })}
                      placeholder="6/6"
                      className="rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </Fragment>
                ))}
              </div>
              </div>
            ) : null}

            <div className="rounded-[28px] border border-sky-200 bg-sky-50/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-sky-600" />
                  <span className="text-sm font-medium text-slate-900">Generated Note</span>
                </div>
                <div className="flex items-center gap-2">
                  {lifecycleLabel ? (
                    <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-600">
                      {lifecycleLabel}
                    </span>
                  ) : null}
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="inline-flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                  >
                    <Sparkles className="h-4 w-4" />
                    {isGenerating ? "Generating..." : noteStatus === "draft" ? "Refresh Draft" : "Generate Note"}
                  </button>
                </div>
              </div>
              <textarea
                rows={14}
                value={form.generatedNote}
                readOnly
                className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none transition focus:border-sky-400"
                placeholder="Saved SOAP note will appear here"
              />
              <p className="mt-2 text-xs text-slate-500">
                Saved notes are read-only. Generate again from the consultation fields if you need a different note.
                {noteStatus === "draft" ? " Sending will lock the current saved version automatically." : ""}
                {isSent ? " This note has been sent and is locked." : ""}
              </p>
            </div>
          </div>
          <div className="space-y-4 xl:sticky xl:top-0 xl:self-start">
            <div className="rounded-[28px] border border-sky-200 bg-sky-50/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">Patient Snapshot</p>
                  <p className="mt-1 text-xs text-slate-500">Quick clinical context while you write.</p>
                </div>
                <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                  {currentPatient.phone}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {vitalsCards.map((entry) => (
                  <div key={entry.label} className="rounded-[20px] border border-sky-100 bg-white px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">{entry.label}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{entry.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Medicines & Suggestions</p>
                  <p className="mt-1 text-xs text-slate-500">Pick from inventory and the treatment section will include them.</p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-medium text-emerald-700">
                  {selectedMedicines.length} selected
                </span>
              </div>
              <input
                value={medicineSearch}
                onChange={(event) => setMedicineSearch(event.target.value)}
                placeholder="Search medicines by name or unit"
                className="w-full rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-emerald-400"
              />
              {selectedMedicines.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedMedicines.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleMedicine(item.id)}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-emerald-50"
                    >
                      {formatMedicineLabel(item)}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                {filteredMedicineItems.length ? (
                  filteredMedicineItems.slice(0, 12).map((item) => {
                    const active = selectedMedicineIds.includes(item.id);
                    const outOfStock = item.track_inventory && item.stock_quantity <= 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleMedicine(item.id)}
                        disabled={outOfStock}
                        className={`flex w-full items-center justify-between gap-3 rounded-[22px] border px-4 py-3 text-left transition ${
                          active
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                            : "border-emerald-100 bg-white text-slate-700 hover:bg-emerald-50"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{item.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.default_price.toFixed(2)}{item.unit ? ` · ${item.unit}` : ""}
                            {item.track_inventory ? ` · Stock ${item.stock_quantity}` : ""}
                          </p>
                        </div>
                        <span className="rounded-full border border-emerald-200 px-3 py-1 text-xs font-medium">
                          {active ? "Selected" : outOfStock ? "Out of stock" : "Add"}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="rounded-[22px] border border-dashed border-emerald-200 bg-white px-4 py-6 text-sm text-slate-500">
                    No medicines match this search.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-sky-200 bg-white p-4">
              <p className="text-sm font-medium text-slate-900">Structured Add-ons</p>
              <p className="mt-1 text-xs text-slate-500">Turn on the extra clinical tables only when you need them.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {sectionSuggestions.map((section) => (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => toggleSection(section.key)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      section.active
                        ? "border-sky-300 bg-sky-100 text-sky-800"
                        : "border-sky-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                    }`}
                  >
                    {section.active ? `${section.label} Added` : `+ ${section.label}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-sky-200 pt-4">
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-700">{statusMessage || "Ready to generate and send."}</p>
                <div className="flex flex-col gap-3">
                  {isFollowUpOpen ? (
                    <div className="rounded-[24px] border border-sky-200 bg-sky-50/40 p-4">
                  <div className="grid gap-3 md:grid-cols-[220px_1fr]">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Date</span>
                      <input
                        type="date"
                        value={form.followUpDate}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, followUpDate: event.target.value }))
                        }
                        className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Follow-up Notes</span>
                      <input
                        value={form.followUpNotes}
                        onChange={(event) =>
                          setForm((current) => ({ ...current, followUpNotes: event.target.value }))
                        }
                        placeholder="Review symptoms, BP check, lab result review"
                        className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                      />
                    </label>
                  </div>
                    </div>
                  ) : null}
                  <div className="rounded-[24px] border border-sky-200 bg-sky-50/40 p-4">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                        Recipient email
                      </span>
                      <input
                        type="email"
                        value={recipientEmail}
                        onChange={(event) => setRecipientEmail(event.target.value)}
                        placeholder="patient@example.com"
                        className="w-full rounded-2xl border border-sky-100 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      disabled={isSending || !currentNoteId || isSent || !recipientEmail.trim()}
                      onClick={handleSend}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                    >
                      <Mail className="h-4 w-4" />
                      {isSending ? "Sending..." : isSent ? "Sent and Locked" : "Send Email"}
                    </button>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <button
                        type="button"
                        disabled={isCompleting || noteStatus === "draft" || !currentNoteId}
                        onClick={handleDone}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                      >
                        {isCompleting ? "Moving..." : "Done"}
                      </button>
                      <button
                        type="button"
                        disabled={isGeneratingPdf || !currentNoteId}
                        onClick={() => handlePdf("preview")}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                      >
                        <Eye className="h-4 w-4" />
                        {isGeneratingPdf ? "Preparing..." : "Preview"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsFollowUpOpen((current) => !current)}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
                      >
                        <CalendarPlus2 className="h-4 w-4" />
                        {isFollowUpOpen ? "Hide Follow-up" : "Follow-up"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
