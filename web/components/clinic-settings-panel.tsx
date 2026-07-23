"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent, ReactNode } from "react";
import { ExternalLink, FileText, RotateCcw, Trash2, Upload } from "lucide-react";

import { api } from "@/lib/api";
import { CLINIC_SPECIALTY_OPTIONS } from "@/lib/clinic-specialty";
import { DEFAULT_CLINIC_TIMEZONE, listSupportedTimeZones, normalizeTimeZoneValue } from "@/lib/timezone";
import type { AuthUser, ClinicSettings, ClinicSettingsUpdatePayload } from "@/lib/types";

type ClinicSettingsPanelProps = {
  settings: ClinicSettings | null;
  currentUser: AuthUser | null;
  onSave: (payload: ClinicSettingsUpdatePayload) => Promise<ClinicSettings | void>;
  onSaved?: (settings: ClinicSettings) => void;
};

type ClinicSettingsForm = {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  timezone: string;
  appointment_start_time: string;
  appointment_end_time: string;
  appointments_per_hour: string;
  document_template_notes_enabled: boolean;
  document_template_letters_enabled: boolean;
  document_template_invoices_enabled: boolean;
  document_template_margin_top: string;
  document_template_margin_right: string;
  document_template_margin_bottom: string;
  document_template_margin_left: string;
  document_template_signature_x: string;
  document_template_signature_y: string;
  document_template_signature_width: string;
  document_template_signature_height: string;
  document_template_doctor_name_x: string;
  document_template_doctor_name_y: string;
  document_template_doctor_name_width: string;
  document_template_doctor_name_height: string;
};

type TemplateBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragMode = "move" | "resize";
type PreviewBoxKey =
  | "name"
  | "weight"
  | "date"
  | "age"
  | "temp"
  | "height"
  | "noteBody";

type PreviewBoxes = Record<PreviewBoxKey, TemplateBox>;

const MIN_TEMPLATE_BOX_WIDTH = 0.06;
const MIN_TEMPLATE_BOX_HEIGHT = 0.025;
const DEFAULT_TEMPLATE_MARGINS = {
  top: "54",
  right: "54",
  bottom: "54",
  left: "54",
};
const DEFAULT_SIGNATURE_BOX: TemplateBox = { x: 0.1, y: 0.76, width: 0.24, height: 0.07 };
const DEFAULT_DOCTOR_NAME_BOX: TemplateBox = { x: 0.1, y: 0.845, width: 0.24, height: 0.04 };
const DEFAULT_PREVIEW_BOXES: PreviewBoxes = {
  name: { x: 0.1, y: 0.16, width: 0.26, height: 0.035 },
  weight: { x: 0.4, y: 0.16, width: 0.18, height: 0.035 },
  date: { x: 0.66, y: 0.16, width: 0.24, height: 0.035 },
  age: { x: 0.1, y: 0.205, width: 0.2, height: 0.035 },
  temp: { x: 0.4, y: 0.205, width: 0.2, height: 0.035 },
  height: { x: 0.1, y: 0.25, width: 0.22, height: 0.035 },
  noteBody: { x: 0.1, y: 0.305, width: 0.76, height: 0.41 },
};

function parseFinite(value: string | number | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function roundTemplateRatio(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

function boxFromForm(form: ClinicSettingsForm, prefix: "document_template_signature" | "document_template_doctor_name"): TemplateBox {
  const fallback = prefix === "document_template_signature" ? DEFAULT_SIGNATURE_BOX : DEFAULT_DOCTOR_NAME_BOX;
  return {
    x: clamp(parseFinite(form[`${prefix}_x`], fallback.x), 0, 0.98),
    y: clamp(parseFinite(form[`${prefix}_y`], fallback.y), 0, 0.98),
    width: clamp(parseFinite(form[`${prefix}_width`], fallback.width), MIN_TEMPLATE_BOX_WIDTH, 1),
    height: clamp(parseFinite(form[`${prefix}_height`], fallback.height), MIN_TEMPLATE_BOX_HEIGHT, 1),
  };
}

function clampBox(box: TemplateBox): TemplateBox {
  const width = clamp(box.width, MIN_TEMPLATE_BOX_WIDTH, 1);
  const height = clamp(box.height, MIN_TEMPLATE_BOX_HEIGHT, 1);
  return {
    x: clamp(box.x, 0, 1 - width),
    y: clamp(box.y, 0, 1 - height),
    width: clamp(width, MIN_TEMPLATE_BOX_WIDTH, 1),
    height: clamp(height, MIN_TEMPLATE_BOX_HEIGHT, 1),
  };
}

function normalizePreviewBoxes(layout: ClinicSettings["document_template_note_layout"] | null | undefined): PreviewBoxes {
  const normalized = { ...DEFAULT_PREVIEW_BOXES };
  if (!layout) {
    return normalized;
  }
  for (const key of Object.keys(DEFAULT_PREVIEW_BOXES) as PreviewBoxKey[]) {
    const box = layout[key];
    if (box) {
      normalized[key] = clampBox({
        x: parseFinite(box.x, DEFAULT_PREVIEW_BOXES[key].x),
        y: parseFinite(box.y, DEFAULT_PREVIEW_BOXES[key].y),
        width: parseFinite(box.width, DEFAULT_PREVIEW_BOXES[key].width),
        height: parseFinite(box.height, DEFAULT_PREVIEW_BOXES[key].height),
      });
    }
  }
  return normalized;
}

async function renderPdfFirstPagePreview(blob: Blob): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const source = await blob.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: source });
  const document = await loadingTask.promise;
  const page = await document.getPage(1);
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1200 / Math.max(unscaledViewport.width, unscaledViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not render document template preview.");
  }
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  await loadingTask.destroy();
  return canvas.toDataURL("image/png");
}

function createForm(settings: ClinicSettings | null): ClinicSettingsForm {
  return {
    clinic_name: settings?.clinic_name ?? "",
    clinic_address: settings?.clinic_address ?? "",
    clinic_phone: settings?.clinic_phone ?? "",
    timezone: normalizeTimeZoneValue(settings?.timezone ?? DEFAULT_CLINIC_TIMEZONE),
    appointment_start_time: settings?.appointment_start_time ?? "09:00",
    appointment_end_time: settings?.appointment_end_time ?? "18:00",
    appointments_per_hour: String(settings?.appointments_per_hour ?? 4),
    document_template_notes_enabled: settings?.document_template_notes_enabled ?? false,
    document_template_letters_enabled: settings?.document_template_letters_enabled ?? false,
    document_template_invoices_enabled: settings?.document_template_invoices_enabled ?? false,
    document_template_margin_top: String(settings?.document_template_margin_top ?? DEFAULT_TEMPLATE_MARGINS.top),
    document_template_margin_right: String(settings?.document_template_margin_right ?? DEFAULT_TEMPLATE_MARGINS.right),
    document_template_margin_bottom: String(settings?.document_template_margin_bottom ?? DEFAULT_TEMPLATE_MARGINS.bottom),
    document_template_margin_left: String(settings?.document_template_margin_left ?? DEFAULT_TEMPLATE_MARGINS.left),
    document_template_signature_x: String(settings?.document_template_signature_x ?? DEFAULT_SIGNATURE_BOX.x),
    document_template_signature_y: String(settings?.document_template_signature_y ?? DEFAULT_SIGNATURE_BOX.y),
    document_template_signature_width: String(settings?.document_template_signature_width ?? DEFAULT_SIGNATURE_BOX.width),
    document_template_signature_height: String(settings?.document_template_signature_height ?? DEFAULT_SIGNATURE_BOX.height),
    document_template_doctor_name_x: String(settings?.document_template_doctor_name_x ?? DEFAULT_DOCTOR_NAME_BOX.x),
    document_template_doctor_name_y: String(settings?.document_template_doctor_name_y ?? DEFAULT_DOCTOR_NAME_BOX.y),
    document_template_doctor_name_width: String(settings?.document_template_doctor_name_width ?? DEFAULT_DOCTOR_NAME_BOX.width),
    document_template_doctor_name_height: String(settings?.document_template_doctor_name_height ?? DEFAULT_DOCTOR_NAME_BOX.height),
  };
}

function TemplateOverlayBox({
  box,
  label,
  tone,
  disabled,
  children,
  onChange,
}: {
  box: TemplateBox;
  label?: string;
  tone: "content" | "signature" | "doctor";
  disabled: boolean;
  children: ReactNode;
  onChange: (box: TemplateBox) => void;
}) {
  const dragStartRef = useRef<{
    pointerId: number;
    mode: DragMode;
    startX: number;
    startY: number;
    pageWidth: number;
    pageHeight: number;
    box: TemplateBox;
  } | null>(null);

  const toneClasses = {
    content: "border-[#2f8fd3] bg-white/45 text-[#174f7b]",
    signature: "border-emerald-500 bg-emerald-50/80 text-emerald-900",
    doctor: "border-slate-600 bg-white/85 text-slate-900",
  }[tone];

  function beginDrag(event: PointerEvent<HTMLDivElement>, mode: DragMode) {
    if (disabled) return;
    const page = event.currentTarget.closest("[data-template-page]");
    const rect = page?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      pageWidth: rect.width,
      pageHeight: rect.height,
      box,
    };
  }

  function updateDrag(event: PointerEvent<HTMLDivElement>) {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    const deltaX = (event.clientX - dragStart.startX) / dragStart.pageWidth;
    const deltaY = (event.clientY - dragStart.startY) / dragStart.pageHeight;
    if (dragStart.mode === "move") {
      onChange(clampBox({ ...dragStart.box, x: dragStart.box.x + deltaX, y: dragStart.box.y + deltaY }));
      return;
    }
    onChange(clampBox({ ...dragStart.box, width: dragStart.box.width + deltaX, height: dragStart.box.height + deltaY }));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current?.pointerId === event.pointerId) {
      dragStartRef.current = null;
    }
  }

  return (
    <div
      className={`absolute select-none overflow-hidden border-2 ${toneClasses} ${disabled ? "" : "cursor-move"}`}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
      onPointerDown={(event) => beginDrag(event, "move")}
      onPointerMove={updateDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {label ? (
        <span className="pointer-events-none absolute left-1 top-1 z-10 bg-white/75 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-[0.18em] opacity-80">
          {label}
        </span>
      ) : null}
      <div className={`h-full overflow-hidden p-2 ${label ? "pt-5" : ""}`}>
        {children}
      </div>
      {!disabled ? (
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize border-l border-t border-current bg-white/80"
          onPointerDown={(event) => {
            event.stopPropagation();
            beginDrag(event, "resize");
          }}
          onPointerMove={updateDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      ) : null}
    </div>
  );
}

export function ClinicSettingsPanel({
  settings,
  currentUser,
  onSave,
  onSaved,
}: ClinicSettingsPanelProps) {
  const [form, setForm] = useState(() => createForm(settings));
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  const [isRemovingTemplate, setIsRemovingTemplate] = useState(false);
  const [isOpeningTemplate, setIsOpeningTemplate] = useState(false);
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState("");
  const [isTemplatePreviewLoading, setIsTemplatePreviewLoading] = useState(false);
  const [refreshedUser, setRefreshedUser] = useState<AuthUser | null>(null);
  const [signaturePreviewUrl, setSignaturePreviewUrl] = useState("");
  const [previewBoxes, setPreviewBoxes] = useState<PreviewBoxes>(DEFAULT_PREVIEW_BOXES);
  const timeZoneOptions = listSupportedTimeZones(form.timezone);
  const canEdit = currentUser?.role === "admin";
  const hasDocumentTemplate = Boolean(settings?.document_template_name || settings?.document_template_url);
  const previewUser = refreshedUser ?? currentUser;
  const doctorDisplayName = previewUser?.name || settings?.doctor_name || "Doctor Name";
  const specialtyLabel =
    CLINIC_SPECIALTY_OPTIONS.find((option) => option.value === settings?.clinic_specialty)?.label ??
    "Not set";

  useEffect(() => {
    setForm(createForm(settings));
    setPreviewBoxes(normalizePreviewBoxes(settings?.document_template_note_layout));
    setError("");
    setStatus("");
  }, [settings]);

  useEffect(() => {
    let isMounted = true;
    void api.getCurrentUser()
      .then((user) => {
        if (isMounted) setRefreshedUser(user);
      })
      .catch(() => {
        if (isMounted) setRefreshedUser(null);
      });
    return () => {
      isMounted = false;
    };
  }, [currentUser?.id, currentUser?.doctor_signature_name, currentUser?.doctor_signature_url]);

  useEffect(() => {
    if (!previewUser?.doctor_signature_name && !previewUser?.doctor_signature_url) {
      setSignaturePreviewUrl("");
      return;
    }

    let isMounted = true;
    let objectUrl = "";
    void api.downloadMySignature()
      .then((blob) => {
        if (!isMounted) return;
        objectUrl = URL.createObjectURL(blob);
        setSignaturePreviewUrl(objectUrl);
      })
      .catch(() => {
        if (isMounted) setSignaturePreviewUrl("");
      });

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewUser?.doctor_signature_name, previewUser?.doctor_signature_url]);

  useEffect(() => {
    if (!hasDocumentTemplate) {
      setTemplatePreviewUrl("");
      return;
    }

    let isMounted = true;
    let objectUrl = "";
    setIsTemplatePreviewLoading(true);
    void api.downloadClinicDocumentTemplate()
      .then(async (blob) => {
        if (!isMounted) return;
        const isPdfTemplate =
          blob.type.includes("pdf") ||
          String(settings?.document_template_name || "").toLowerCase().endsWith(".pdf");
        if (isPdfTemplate) {
          const renderedPreviewUrl = await renderPdfFirstPagePreview(blob);
          if (!isMounted) return;
          setTemplatePreviewUrl(renderedPreviewUrl);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        if (!isMounted) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setTemplatePreviewUrl(objectUrl);
      })
      .catch((previewError) => {
        if (!isMounted) return;
        setTemplatePreviewUrl("");
        setError(previewError instanceof Error ? previewError.message : "Failed to load document template preview.");
      })
      .finally(() => {
        if (isMounted) setIsTemplatePreviewLoading(false);
      });

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasDocumentTemplate, settings?.document_template_name, settings?.document_template_url]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || !canEdit) {
      return;
    }

    const appointmentsPerHour = Number(form.appointments_per_hour);
    if (!Number.isFinite(appointmentsPerHour) || appointmentsPerHour < 1) {
      setError("Appointments / hour must be at least 1.");
      return;
    }

    const templateMargins = {
      top: Number(form.document_template_margin_top),
      right: Number(form.document_template_margin_right),
      bottom: Number(form.document_template_margin_bottom),
      left: Number(form.document_template_margin_left),
    };
    if (Object.values(templateMargins).some((margin) => !Number.isFinite(margin) || margin < 0 || margin > 288)) {
      setError("Document template margins must be between 0 and 288 points.");
      return;
    }

    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const saved = await onSave({
        clinic_name: form.clinic_name.trim(),
        clinic_address: form.clinic_address.trim(),
        clinic_phone: form.clinic_phone.trim(),
        clinic_specialty: settings.clinic_specialty,
        timezone: form.timezone,
        appointment_start_time: form.appointment_start_time,
        appointment_end_time: form.appointment_end_time,
        appointments_per_hour: appointmentsPerHour,
        doctor_name: settings.doctor_name,
        sender_name: settings.sender_name,
        sender_email: settings.sender_email,
        email_configured: settings.email_configured,
        custom_header: settings.custom_header,
        custom_footer: settings.custom_footer,
        document_template_name: settings.document_template_name,
        document_template_url: settings.document_template_url,
        document_template_notes_enabled: form.document_template_notes_enabled,
        document_template_letters_enabled: form.document_template_letters_enabled,
        document_template_invoices_enabled: form.document_template_invoices_enabled,
        document_template_margin_top: templateMargins.top,
        document_template_margin_right: templateMargins.right,
        document_template_margin_bottom: templateMargins.bottom,
        document_template_margin_left: templateMargins.left,
        document_template_signature_x: parseFinite(form.document_template_signature_x, DEFAULT_SIGNATURE_BOX.x),
        document_template_signature_y: parseFinite(form.document_template_signature_y, DEFAULT_SIGNATURE_BOX.y),
        document_template_signature_width: parseFinite(form.document_template_signature_width, DEFAULT_SIGNATURE_BOX.width),
        document_template_signature_height: parseFinite(form.document_template_signature_height, DEFAULT_SIGNATURE_BOX.height),
        document_template_doctor_name_x: parseFinite(form.document_template_doctor_name_x, DEFAULT_DOCTOR_NAME_BOX.x),
        document_template_doctor_name_y: parseFinite(form.document_template_doctor_name_y, DEFAULT_DOCTOR_NAME_BOX.y),
        document_template_doctor_name_width: parseFinite(form.document_template_doctor_name_width, DEFAULT_DOCTOR_NAME_BOX.width),
        document_template_doctor_name_height: parseFinite(form.document_template_doctor_name_height, DEFAULT_DOCTOR_NAME_BOX.height),
        document_template_note_layout: previewBoxes,
      });
      if (saved) {
        onSaved?.(saved);
      }
      setStatus("Clinic settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save clinic settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTemplateUpload(file: File) {
    if (!canEdit) return;
    setIsUploadingTemplate(true);
    setError("");
    setStatus("");
    try {
      const saved = await api.uploadClinicDocumentTemplate(file);
      setForm(createForm(saved));
      onSaved?.(saved);
      setStatus("Document template uploaded and enabled for notes, letters, and invoices.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload document template.");
    } finally {
      setIsUploadingTemplate(false);
    }
  }

  async function handleTemplateOpen() {
    setIsOpeningTemplate(true);
    setError("");
    try {
      const blob = await api.previewClinicDocumentTemplateNote();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open document template.");
    } finally {
      setIsOpeningTemplate(false);
    }
  }

  async function handleTemplateRemove() {
    if (!canEdit) return;
    setIsRemovingTemplate(true);
    setError("");
    setStatus("");
    try {
      const saved = await api.removeClinicDocumentTemplate();
      setForm(createForm(saved));
      onSaved?.(saved);
      setStatus("Document template removed. PDFs will use the clinic header and footer.");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove document template.");
    } finally {
      setIsRemovingTemplate(false);
    }
  }

  if (!settings) {
    return (
      <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-6 text-sm text-slate-600">
        Loading clinic settings...
      </section>
    );
  }

  const signatureBox = clampBox(boxFromForm(form, "document_template_signature"));
  const doctorNameBox = clampBox(boxFromForm(form, "document_template_doctor_name"));

  function updateNormalizedBox(prefix: "document_template_signature" | "document_template_doctor_name", box: TemplateBox) {
    const clamped = clampBox(box);
    setForm((current) => ({
      ...current,
      [`${prefix}_x`]: roundTemplateRatio(clamped.x),
      [`${prefix}_y`]: roundTemplateRatio(clamped.y),
      [`${prefix}_width`]: roundTemplateRatio(clamped.width),
      [`${prefix}_height`]: roundTemplateRatio(clamped.height),
    }));
  }

  function updatePreviewBox(key: PreviewBoxKey, box: TemplateBox) {
    setPreviewBoxes((current) => ({ ...current, [key]: clampBox(box) }));
  }

  function resetTemplateLayout() {
    if (!canEdit) return;
    setPreviewBoxes(normalizePreviewBoxes(DEFAULT_PREVIEW_BOXES));
    setForm((current) => ({
      ...current,
      document_template_margin_top: DEFAULT_TEMPLATE_MARGINS.top,
      document_template_margin_right: DEFAULT_TEMPLATE_MARGINS.right,
      document_template_margin_bottom: DEFAULT_TEMPLATE_MARGINS.bottom,
      document_template_margin_left: DEFAULT_TEMPLATE_MARGINS.left,
      document_template_signature_x: String(DEFAULT_SIGNATURE_BOX.x),
      document_template_signature_y: String(DEFAULT_SIGNATURE_BOX.y),
      document_template_signature_width: String(DEFAULT_SIGNATURE_BOX.width),
      document_template_signature_height: String(DEFAULT_SIGNATURE_BOX.height),
      document_template_doctor_name_x: String(DEFAULT_DOCTOR_NAME_BOX.x),
      document_template_doctor_name_y: String(DEFAULT_DOCTOR_NAME_BOX.y),
      document_template_doctor_name_width: String(DEFAULT_DOCTOR_NAME_BOX.width),
      document_template_doctor_name_height: String(DEFAULT_DOCTOR_NAME_BOX.height),
    }));
    setStatus("Layout reset to defaults. Click Save to keep it.");
    setError("");
  }

  return (
    <form
      className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_38px_rgba(64,131,181,0.09)]"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-4">
        <label className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Clinic Name</span>
          <input
            value={form.clinic_name}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, clinic_name: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          />
        </label>

        <label className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Clinic Phone</span>
          <input
            value={form.clinic_phone}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, clinic_phone: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          />
        </label>

        <div className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Specialty</span>
          <div className="flex h-11 items-center rounded-xl border border-[#dbe7ef] bg-[#edf5fa] px-4 text-slate-700">
            {specialtyLabel}
          </div>
        </div>

        <label className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Timezone</span>
          <select
            value={form.timezone}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          >
            {timeZoneOptions.map((timeZone) => (
              <option key={timeZone.value} value={timeZone.value}>{timeZone.label}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
          <span className="text-sm font-medium text-slate-700">Address</span>
          <input
            value={form.clinic_address}
            disabled={!canEdit}
            onChange={(event) => setForm((current) => ({ ...current, clinic_address: event.target.value }))}
            className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-[180px_1fr_1fr_1fr] md:items-end">
          <div className="hidden text-sm font-semibold text-slate-900 md:block">Working hours</div>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Opening Time</span>
            <input
              type="time"
              value={form.appointment_start_time}
              disabled={!canEdit}
              onChange={(event) => setForm((current) => ({ ...current, appointment_start_time: event.target.value }))}
              className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Closing Time</span>
            <input
              type="time"
              value={form.appointment_end_time}
              disabled={!canEdit}
              onChange={(event) => setForm((current) => ({ ...current, appointment_end_time: event.target.value }))}
              className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">Appointments / Hour</span>
            <input
              type="number"
              min="1"
              max="12"
              step="1"
              value={form.appointments_per_hour}
              disabled={!canEdit}
              onChange={(event) => setForm((current) => ({ ...current, appointments_per_hour: event.target.value }))}
              className="h-11 rounded-xl border border-[#bfd7e8] bg-[#f3f8fb]/40 px-4 text-slate-800 outline-none transition focus:border-[#6daed8] disabled:text-slate-500"
            />
          </label>
        </div>

        <section className="mt-3 border-t border-[#dbe7ef] pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Document template</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">Clinic letterhead and PDF background</h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Upload one PDF, JPG, or PNG page. Generated content is placed over it using the margins below.
              </p>
            </div>
            <span className="rounded-xl border border-[#bfd7e8] bg-[#edf5fa] px-3 py-2 text-xs font-semibold text-[#2a6fa8]">
              {hasDocumentTemplate ? "Template active" : "Default layout"}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#dbe7ef] bg-[#f3f8fb]/50 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[#dbe7ef] bg-white text-[#2a6fa8]">
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {settings.document_template_name || "No template uploaded"}
                </p>
                <p className="mt-1 text-xs text-slate-500">PDF, JPG, or PNG · maximum 10 MB</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {hasDocumentTemplate ? (
                <button
                  type="button"
                  disabled={isOpeningTemplate}
                  onClick={() => void handleTemplateOpen()}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#edf5fa] disabled:opacity-60"
                >
                  <ExternalLink className="h-4 w-4" />
                  {isOpeningTemplate ? "Opening..." : "View"}
                </button>
              ) : null}
              <label className={`inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white transition ${canEdit && !isUploadingTemplate && !isRemovingTemplate ? "cursor-pointer hover:bg-[#287fc0]" : "cursor-not-allowed opacity-60"}`}>
                <Upload className="h-4 w-4" />
                {isUploadingTemplate ? "Uploading..." : hasDocumentTemplate ? "Replace" : "Upload template"}
                <input
                  type="file"
                  accept=".pdf,image/png,image/jpeg"
                  disabled={!canEdit || isUploadingTemplate || isRemovingTemplate}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleTemplateUpload(file);
                    event.target.value = "";
                  }}
                />
              </label>
              {hasDocumentTemplate ? (
                <button
                  type="button"
                  disabled={!canEdit || isRemovingTemplate || isUploadingTemplate}
                  onClick={() => void handleTemplateRemove()}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {isRemovingTemplate ? "Removing..." : "Remove"}
                </button>
              ) : null}
            </div>
          </div>

          {hasDocumentTemplate ? (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Preview and placement</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Drag or resize the boxes to decide where generated PDF content, doctor name, and signature print.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isTemplatePreviewLoading ? (
                    <span className="text-xs font-medium text-slate-500">Loading preview...</span>
                  ) : null}
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={resetTemplateLayout}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#9fc7e1] bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-[#edf5fa] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset layout
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-[#dbe7ef] bg-slate-100 p-4">
                <div
                  data-template-page
                  className="relative mx-auto aspect-[595/842] w-full max-w-[595px] overflow-hidden border border-slate-300 bg-white shadow-sm"
                >
                  {templatePreviewUrl ? (
                    <Image
                      src={templatePreviewUrl}
                      alt="Document template preview"
                      fill
                      unoptimized
                      className="pointer-events-none object-contain"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-500">
                      Template preview unavailable. Placement boxes can still be adjusted.
                    </div>
                  )}
                  <div className="absolute inset-0 bg-white/5" />

                  <TemplateOverlayBox
                    box={previewBoxes.name}
                    tone="content"
                    disabled={!canEdit}
                    onChange={(box) => updatePreviewBox("name", box)}
                  >
                    <p className="text-[9px] leading-tight text-slate-900 sm:text-[10px]"><strong>Name:</strong> Sample Patient</p>
                  </TemplateOverlayBox>
                  <TemplateOverlayBox
                    box={previewBoxes.weight}
                    tone="content"
                    disabled={!canEdit}
                    onChange={(box) => updatePreviewBox("weight", box)}
                  >
                    <p className="text-[9px] leading-tight text-slate-900 sm:text-[10px]"><strong>Weight:</strong> 68 kg</p>
                  </TemplateOverlayBox>
                  <TemplateOverlayBox
                    box={previewBoxes.date}
                    tone="content"
                    disabled={!canEdit}
                    onChange={(box) => updatePreviewBox("date", box)}
                  >
                    <p className="text-[9px] leading-tight text-slate-900 sm:text-[10px]"><strong>Date:</strong> Jul 23, 2026</p>
                  </TemplateOverlayBox>
                  <TemplateOverlayBox
                    box={previewBoxes.age}
                    tone="content"
                    disabled={!canEdit}
                    onChange={(box) => updatePreviewBox("age", box)}
                  >
                    <p className="text-[9px] leading-tight text-slate-900 sm:text-[10px]"><strong>Age:</strong> 34 yrs</p>
                  </TemplateOverlayBox>
                  <TemplateOverlayBox
                    box={previewBoxes.temp}
                    tone="content"
                    disabled={!canEdit}
                    onChange={(box) => updatePreviewBox("temp", box)}
                  >
                    <p className="text-[9px] leading-tight text-slate-900 sm:text-[10px]"><strong>Temp:</strong> 98.4 F</p>
                  </TemplateOverlayBox>
                  <TemplateOverlayBox
                    box={previewBoxes.height}
                    tone="content"
                    disabled={!canEdit}
                    onChange={(box) => updatePreviewBox("height", box)}
                  >
                    <p className="text-[9px] leading-tight text-slate-900 sm:text-[10px]"><strong>Height:</strong> 172 cm</p>
                  </TemplateOverlayBox>
                  <TemplateOverlayBox
                    box={previewBoxes.noteBody}
                    tone="content"
                    disabled={!canEdit}
                    onChange={(box) => updatePreviewBox("noteBody", box)}
                  >
                    <div className="space-y-1.5 overflow-hidden text-[8.5px] leading-[1.25] text-slate-900 sm:text-[9.5px]">
                      <p><strong>Presenting Complaint:</strong> Patient reports gradual blurring of distance vision over the last 3 months, intermittent frontal headache after prolonged screen use, mild watering in the evening, and difficulty reading small text during night driving.</p>
                      <p><strong>Clinical Notes:</strong> Visual acuity assessed with and without correction. Patient is comfortable during examination. Anterior segment appears quiet. Pupils are equal and reactive. Extraocular movements are full. No acute symptoms reported during today&apos;s visit.</p>
                      <p><strong>Diagnosis:</strong> Myopic astigmatism with accommodative eye strain related to prolonged near work and inconsistent spectacle use.</p>
                      <p><strong>Treatment:</strong> Updated spectacle prescription explained. Discussed 20-20-20 visual hygiene, ergonomic screen distance, adequate lighting, and avoiding continuous near work without breaks. Patient was advised to use the new correction consistently and monitor headache frequency.</p>
                      <p><strong>Follow-up Advice:</strong> Routine review in 6 months, earlier if headaches persist after new spectacles or if any acute symptoms appear.</p>
                    </div>
                  </TemplateOverlayBox>

                  <TemplateOverlayBox
                    box={signatureBox}
                    label="Signature"
                    tone="signature"
                    disabled={!canEdit}
                    onChange={(box) => updateNormalizedBox("document_template_signature", box)}
                  >
                    <div className="relative h-full min-h-0">
                      {signaturePreviewUrl ? (
                        <Image
                          src={signaturePreviewUrl}
                          alt="Doctor signature"
                          fill
                          unoptimized
                          className="object-contain object-left"
                        />
                      ) : (
                        <div className="grid h-full place-items-center border border-dashed border-emerald-300 bg-white/70 text-xs font-semibold text-emerald-800">
                          Signature
                        </div>
                      )}
                    </div>
                  </TemplateOverlayBox>

                  <TemplateOverlayBox
                    box={doctorNameBox}
                    tone="doctor"
                    disabled={!canEdit}
                    onChange={(box) => updateNormalizedBox("document_template_doctor_name", box)}
                  >
                    <div className="flex h-full items-center overflow-hidden text-xs font-semibold leading-tight sm:text-sm">
                      {doctorDisplayName}
                    </div>
                  </TemplateOverlayBox>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="text-sm font-semibold text-slate-900">Use template for</p>
              <div className="mt-3 flex flex-wrap gap-4">
                {[
                  ["document_template_notes_enabled", "Notes"],
                  ["document_template_letters_enabled", "Letters"],
                  ["document_template_invoices_enabled", "Invoices"],
                ].map(([key, label]) => (
                  <label key={key} className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={form[key as keyof Pick<ClinicSettingsForm, "document_template_notes_enabled" | "document_template_letters_enabled" | "document_template_invoices_enabled">]}
                      disabled={!canEdit || !hasDocumentTemplate}
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.checked }))}
                      className="h-4 w-4 rounded border-[#9fc7e1] text-[#2f8fd3] focus:ring-[#6daed8]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-900">Content margins</p>
              <p className="mt-1 text-xs text-slate-500">Points from each page edge; 72 points equals one inch.</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["document_template_margin_top", "Top"],
                  ["document_template_margin_right", "Right"],
                  ["document_template_margin_bottom", "Bottom"],
                  ["document_template_margin_left", "Left"],
                ].map(([key, label]) => (
                  <label key={key} className="grid gap-1.5">
                    <span className="text-xs font-medium text-slate-600">{label}</span>
                    <input
                      type="number"
                      min="0"
                      max="288"
                      step="1"
                      value={form[key as keyof Pick<ClinicSettingsForm, "document_template_margin_top" | "document_template_margin_right" | "document_template_margin_bottom" | "document_template_margin_left">]}
                      disabled={!canEdit || !hasDocumentTemplate}
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                      className="h-10 min-w-0 rounded-xl border border-[#bfd7e8] bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-[#6daed8] disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}
      {status ? <p className="mt-4 text-sm font-medium text-emerald-700">{status}</p> : null}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!canEdit || isSaving || isUploadingTemplate || isRemovingTemplate}
          className="rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
