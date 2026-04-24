"use client";

import { FormEvent, startTransition, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarClock,
  CreditCard,
  FileText,
  FilePenLine,
  History,
  Info,
  LayoutDashboard,
  Mail,
  Search,
  Settings2,
  Stethoscope,
  RefreshCw,
  Trash2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";

import { DraftInvoiceItem, SettingsDrawerBillingPanel } from "@/components/settings-drawer-billing-panel";
import { SettingsDrawerAppointmentsPanel } from "@/components/settings-drawer-appointments-panel";
import { CatalogFormState, SettingsDrawerInventoryPanel } from "@/components/settings-drawer-inventory-panel";
import { SettingsDrawerUsersPanel, UserFormState } from "@/components/settings-drawer-users-panel";
import { api } from "@/lib/api";
import { Appointment, AuditEvent, AuthUser, CatalogItem, ClinicSettings, FollowUp, Invoice, Patient, PaymentStatus } from "@/lib/types";

function createId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type SettingsTab = "settings" | "about" | "contact" | "billing" | "clinic" | "users" | "letter" | "catalog" | "appointments" | "audit" | "exports";
type DrawerMenuItem =
  | { href: string; label: string; icon: typeof Settings2 }
  | { tab: SettingsTab; label: string; icon: typeof Settings2 };

interface SettingsDrawerProps {
  open: boolean;
  settings: ClinicSettings | null;
  currentUser: AuthUser | null;
  users: AuthUser[];
  onLoadUsers: () => Promise<AuthUser[]>;
  auditEvents: AuditEvent[];
  onLoadAuditEvents: () => Promise<AuditEvent[]>;
  patients: Patient[];
  catalogItems: CatalogItem[];
  onLoadCatalogItems: () => Promise<CatalogItem[]>;
  onClose: () => void;
  onSaveClinic: (
    payload: Omit<ClinicSettings, "id" | "org_id" | "updated_at">,
  ) => Promise<ClinicSettings | void>;
  onClinicSettingsChange?: (settings: ClinicSettings) => void;
  onAddUser: (payload: { identifier: string; password: string }) => Promise<void>;
  onCreateCatalogItem: (payload: {
    name: string;
    item_type: "service" | "medicine";
    default_price: number;
    track_inventory: boolean;
    stock_quantity: number;
    low_stock_threshold: number;
    unit: string;
  }) => Promise<void>;
  onAdjustCatalogStock: (itemId: string, delta: number) => Promise<void>;
  onDeleteCatalogItem: (itemId: string) => Promise<void>;
  onGenerateLetter: (payload: { to: string; subject: string; content: string }) => Promise<string>;
  onGenerateLetterPdf: (payload: { content: string }) => Promise<Blob>;
  onSendLetter: (payload: { recipient: string; content: string }) => Promise<string>;
  onCreateInvoice: (payload: {
    patient_id: string;
    items: Array<{
      catalog_item_id?: string | null;
      item_type: "service" | "medicine";
      label: string;
      quantity: number;
      unit_price: number;
    }>;
    payment_status: PaymentStatus;
    amount_paid?: number | null;
  }) => Promise<Invoice>;
  onGenerateInvoicePdf: (invoiceId: string) => Promise<Blob>;
  onSendInvoice: (payload: { invoice_id: string; recipient: string }) => Promise<string>;
  onExportPatientsCsv: () => Promise<Blob>;
  onExportVisitsCsv: () => Promise<Blob>;
  onExportInvoicesCsv: () => Promise<Blob>;
  onCheckInAppointment: (
    appointmentId: string,
    options?: { existingPatientId?: string; forceNew?: boolean },
  ) => Promise<{ id: string; checked_in_at: string | null; checked_in_patient_id: string | null }>;
  onUpdateAppointment: (
    appointmentId: string,
    payload: { scheduled_for?: string; status?: "scheduled" | "checked_in" | "cancelled" },
  ) => Promise<Appointment>;
  onUpdateFollowUp: (
    followUpId: string,
    payload: { status?: "scheduled" | "completed" | "cancelled"; scheduled_for?: string; notes?: string },
  ) => Promise<FollowUp>;
  onBillingComplete: (patientId: string) => void;
}

const emptyLetterForm = {
  to: "",
  subject: "",
  content: "",
  generated: "",
  recipient: "",
};

type ClinicFormState = {
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string;
  doctor_name: string;
  custom_header: string;
  custom_footer: string;
  document_template_name: string | null;
  document_template_url: string | null;
  document_template_notes_enabled: boolean;
  document_template_letters_enabled: boolean;
  document_template_invoices_enabled: boolean;
  document_template_margin_top: string;
  document_template_margin_right: string;
  document_template_margin_bottom: string;
  document_template_margin_left: string;
};

const PREVIEW_PAGE_WIDTH = 595;
const PREVIEW_PAGE_HEIGHT = 842;

function normalizePreviewMargin(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 54;
  }
  return parsed;
}

function previewInsetStyles(form: ClinicFormState) {
  const top = (normalizePreviewMargin(form.document_template_margin_top) / PREVIEW_PAGE_HEIGHT) * 100;
  const right = (normalizePreviewMargin(form.document_template_margin_right) / PREVIEW_PAGE_WIDTH) * 100;
  const bottom = (normalizePreviewMargin(form.document_template_margin_bottom) / PREVIEW_PAGE_HEIGHT) * 100;
  const left = (normalizePreviewMargin(form.document_template_margin_left) / PREVIEW_PAGE_WIDTH) * 100;

  return {
    top: `${Math.min(top, 40)}%`,
    right: `${Math.min(right, 30)}%`,
    bottom: `${Math.min(bottom, 25)}%`,
    left: `${Math.min(left, 30)}%`,
  };
}

function ClinicDocumentPreview({
  form,
  templatePreviewUrl,
  templatePreviewMimeType,
  isTemplatePreviewLoading,
}: {
  form: ClinicFormState;
  templatePreviewUrl: string;
  templatePreviewMimeType: string;
  isTemplatePreviewLoading: boolean;
}) {
  const hasTemplate = Boolean(form.document_template_name || form.document_template_url);
  const contentInsets = previewInsetStyles(form);
  const isPdf = templatePreviewMimeType === "application/pdf";
  const pdfPreviewSrc = templatePreviewUrl
    ? `${templatePreviewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`
    : "";

  return (
    <div className="rounded-[32px] border border-sky-200 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Live Preview</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">
            {hasTemplate ? "Template fit preview" : "Fallback paper preview"}
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            {hasTemplate
              ? "The highlighted frame shows where generated content is allowed to sit on top of the uploaded page."
              : "Without a template, generated documents fall back to your custom header and footer. The sample page reflects that layout."}
          </p>
        </div>
        <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">
          {hasTemplate ? "Template mode" : "Header/footer mode"}
        </div>
      </div>

      <div className="mt-5 rounded-[28px] border border-sky-100 bg-[linear-gradient(180deg,#eff6ff_0%,#f8fbff_100%)] p-4">
        <div className="mx-auto aspect-[595/842] w-full max-w-[620px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
          <div className="relative h-full w-full bg-white">
            {hasTemplate ? (
              <>
                {templatePreviewUrl ? (
                  isPdf ? (
                    <iframe
                      title="Clinic template preview"
                      src={pdfPreviewSrc}
                      className="pointer-events-none absolute inset-0 h-full w-full border-0"
                    />
                  ) : (
                    <Image
                      src={templatePreviewUrl}
                      alt="Clinic template preview"
                      fill
                      unoptimized
                      className="pointer-events-none object-contain"
                    />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">
                    {isTemplatePreviewLoading ? "Loading template preview..." : "Template preview unavailable."}
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col bg-white">
                <div className="border-b border-slate-200 px-10 pb-5 pt-10">
                  <p className="text-2xl font-semibold text-slate-900">
                    {form.clinic_name.trim() || "Clinic Name"}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {(form.custom_header.trim() || form.clinic_address.trim() || "Custom header preview")}
                  </p>
                </div>
                <div className="flex-1 px-10 py-8 text-slate-800">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Consultation Note</p>
                  <div className="mt-5 space-y-4 text-sm leading-6">
                    <p><span className="font-semibold">Patient:</span> Sample Patient</p>
                    <p><span className="font-semibold">Reason:</span> Follow-up review and treatment summary.</p>
                    <p>
                      Presenting complaint: Sample content appears here so the clinic can judge line width, top spacing,
                      and where body copy begins.
                    </p>
                    <p>
                      Treatment: Demonstration text continues across a few lines to make the page rhythm obvious before
                      saving settings.
                    </p>
                  </div>
                </div>
                <div className="border-t border-slate-200 px-10 py-5 text-xs leading-5 text-slate-500">
                  {form.custom_footer.trim() || "Custom footer preview"}
                </div>
              </div>
            )}

            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(248,250,252,0.04),rgba(14,165,233,0.04))]" />
              <div
                className="absolute rounded-[18px] border-2 border-dashed border-sky-500 bg-sky-400/8 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)]"
                style={contentInsets}
              >
                <div className="absolute left-4 top-4 rounded-full bg-sky-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                  Content area
                </div>
                <div className="flex h-full flex-col justify-start gap-3 p-6 pt-14 text-[11px] leading-5 text-slate-800">
                  <p className="font-semibold text-slate-900">Name: Sample Patient</p>
                  <p>Reason for Visit: Layout alignment preview for generated note content.</p>
                  <p>
                    Presenting Complaint: This sample block helps you judge where text starts and how close it sits to
                    the branded art or letterhead.
                  </p>
                  <p>Treatment: Adjust top/right/bottom/left offsets until this frame sits comfortably inside your paper.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Top", form.document_template_margin_top],
            ["Right", form.document_template_margin_right],
            ["Bottom", form.document_template_margin_bottom],
            ["Left", form.document_template_margin_left],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-sky-100 bg-white/85 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{value || "0"}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LetterDocumentPreview({
  letterForm,
  clinicForm,
  templatePreviewUrl,
  templatePreviewMimeType,
  isTemplatePreviewLoading,
  letterPreviewUrl,
}: {
  letterForm: typeof emptyLetterForm;
  clinicForm: ClinicFormState;
  templatePreviewUrl: string;
  templatePreviewMimeType: string;
  isTemplatePreviewLoading: boolean;
  letterPreviewUrl: string;
}) {
  const hasRenderedPreview = Boolean(letterPreviewUrl);
  const hasTemplate = Boolean(clinicForm.document_template_name || clinicForm.document_template_url);
  const previewUrl = hasRenderedPreview ? letterPreviewUrl : templatePreviewUrl;
  const previewMimeType = hasRenderedPreview ? "application/pdf" : templatePreviewMimeType;
  const isPdf = previewMimeType === "application/pdf";
  const iframeSrc = previewUrl ? `${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH` : "";

  return (
    <div className="rounded-[32px] border border-sky-200 bg-white p-5 shadow-[0_20px_60px_rgba(125,211,252,0.16)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Letter Preview</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">
            {hasRenderedPreview ? "Generated PDF preview" : hasTemplate ? "Template paper preview" : "Fallback paper preview"}
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            {hasRenderedPreview
              ? "This panel shows the generated letter PDF inside the same workspace."
              : hasTemplate
                ? "The uploaded clinic paper is shown here before generation. Click Preview PDF after generating the letter to fill it."
                : "No template is uploaded, so the preview starts with the fallback clinic letter layout."}
          </p>
        </div>
        <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">
          {hasRenderedPreview ? "PDF ready" : hasTemplate ? "Template only" : "Fallback paper"}
        </div>
      </div>

      <div className="mt-5 rounded-[28px] border border-sky-100 bg-[linear-gradient(180deg,#eff6ff_0%,#f8fbff_100%)] p-4">
        <div className="mx-auto aspect-[595/842] w-full max-w-[620px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
          <div className="relative h-full w-full bg-white">
            {previewUrl ? (
              isPdf ? (
                <iframe title="Generated letter preview" src={iframeSrc} className="pointer-events-none absolute inset-0 h-full w-full border-0" />
              ) : (
                <Image src={previewUrl} alt="Clinic paper preview" fill unoptimized className="pointer-events-none object-contain" />
              )
            ) : hasTemplate ? (
              <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">
                {isTemplatePreviewLoading ? "Loading template preview..." : "Template preview unavailable."}
              </div>
            ) : (
              <div className="flex h-full flex-col bg-white">
                <div className="border-b border-slate-200 px-10 pb-5 pt-10">
                  <p className="text-2xl font-semibold text-slate-900">{clinicForm.clinic_name.trim() || "Clinic Name"}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {clinicForm.custom_header.trim() || clinicForm.clinic_address.trim() || "Custom header preview"}
                  </p>
                </div>
                <div className="flex-1 px-10 py-8 text-slate-800">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Clinic Letter</p>
                  <div className="mt-6 space-y-4 text-sm leading-6">
                    <p><span className="font-semibold">To:</span> {letterForm.to.trim() || "Recipient name"}</p>
                    <p><span className="font-semibold">Subject:</span> {letterForm.subject.trim() || "Letter subject"}</p>
                    <p>{letterForm.generated.trim() || letterForm.content.trim() || "Generated letter content will appear here after you click Generate Letter and then Preview PDF."}</p>
                  </div>
                </div>
                <div className="border-t border-slate-200 px-10 py-5 text-xs leading-5 text-slate-500">
                  {clinicForm.custom_footer.trim() || "Custom footer preview"}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function toMarginInput(value?: number | null) {
  return Number.isFinite(value) ? String(value) : "54";
}

function createClinicFormState(settings?: ClinicSettings | null): ClinicFormState {
  return {
    clinic_name: settings?.clinic_name ?? "ClinicOS",
    clinic_address: settings?.clinic_address ?? "",
    clinic_phone: settings?.clinic_phone ?? "",
    doctor_name: settings?.doctor_name ?? "",
    custom_header: settings?.custom_header ?? "",
    custom_footer: settings?.custom_footer ?? "",
    document_template_name: settings?.document_template_name ?? null,
    document_template_url: settings?.document_template_url ?? null,
    document_template_notes_enabled: settings?.document_template_notes_enabled ?? false,
    document_template_letters_enabled: settings?.document_template_letters_enabled ?? false,
    document_template_invoices_enabled: settings?.document_template_invoices_enabled ?? false,
    document_template_margin_top: toMarginInput(settings?.document_template_margin_top),
    document_template_margin_right: toMarginInput(settings?.document_template_margin_right),
    document_template_margin_bottom: toMarginInput(settings?.document_template_margin_bottom),
    document_template_margin_left: toMarginInput(settings?.document_template_margin_left),
  };
}

export function SettingsDrawer({
  open,
  settings,
  currentUser,
  users,
  onLoadUsers,
  auditEvents,
  onLoadAuditEvents,
  patients,
  catalogItems,
  onLoadCatalogItems,
  onClose,
  onSaveClinic,
  onClinicSettingsChange,
  onAddUser,
  onCreateCatalogItem,
  onAdjustCatalogStock,
  onDeleteCatalogItem,
  onGenerateLetter,
  onGenerateLetterPdf,
  onCreateInvoice,
  onGenerateInvoicePdf,
  onSendInvoice,
  onExportPatientsCsv,
  onExportVisitsCsv,
  onExportInvoicesCsv,
  onCheckInAppointment,
  onUpdateAppointment,
  onUpdateFollowUp,
  onBillingComplete,
}: SettingsDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<SettingsTab>("clinic");
  const [form, setForm] = useState<ClinicFormState>(() => createClinicFormState());
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateStatus, setTemplateStatus] = useState("");
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false);
  const [isRemovingTemplate, setIsRemovingTemplate] = useState(false);
  const [isOpeningTemplate, setIsOpeningTemplate] = useState(false);
  const [templatePreviewUrl, setTemplatePreviewUrl] = useState("");
  const [templatePreviewMimeType, setTemplatePreviewMimeType] = useState("");
  const [isTemplatePreviewLoading, setIsTemplatePreviewLoading] = useState(false);
  const [letterPdfPreviewUrl, setLetterPdfPreviewUrl] = useState("");

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [userForm, setUserForm] = useState<UserFormState>({ identifier: "", password: "" });
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [hasLoadedUsers, setHasLoadedUsers] = useState(false);

  const [catalogForm, setCatalogForm] = useState<CatalogFormState>({
    name: "",
    item_type: "service" as "service" | "medicine",
    default_price: "",
    track_inventory: false,
    stock_quantity: "",
    low_stock_threshold: "",
    unit: "",
  });
  const [catalogError, setCatalogError] = useState("");
  const [catalogStatus, setCatalogStatus] = useState("");
  const [isSavingCatalog, setIsSavingCatalog] = useState(false);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [hasLoadedCatalog, setHasLoadedCatalog] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [hasLoadedAudit, setHasLoadedAudit] = useState(false);
  const [deletingCatalogId, setDeletingCatalogId] = useState("");
  const [stockAdjustments, setStockAdjustments] = useState<Record<string, string>>({});
  const [adjustingStockId, setAdjustingStockId] = useState("");

  const [letterForm, setLetterForm] = useState(emptyLetterForm);
  const [letterError, setLetterError] = useState("");
  const [letterStatus, setLetterStatus] = useState("");
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
  const [isPreparingLetterPdf, setIsPreparingLetterPdf] = useState(false);
  const [isSendingLetter, setIsSendingLetter] = useState(false);

  const [selectedBillingPatientId, setSelectedBillingPatientId] = useState("");
  const [invoiceItems, setInvoiceItems] = useState<DraftInvoiceItem[]>([]);
  const [billingError, setBillingError] = useState("");
  const [billingStatus, setBillingStatus] = useState("");
  const [savedInvoice, setSavedInvoice] = useState<Invoice | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [amountPaidInput, setAmountPaidInput] = useState("");
  const [isExporting, setIsExporting] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [isPreparingInvoicePdf, setIsPreparingInvoicePdf] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);

  const serviceItems = useMemo(
    () => catalogItems.filter((item) => item.item_type === "service"),
    [catalogItems],
  );
  const medicineItems = useMemo(
    () => catalogItems.filter((item) => item.item_type === "medicine"),
    [catalogItems],
  );
  const selectedBillingPatient =
    patients.find((patient) => patient.id === selectedBillingPatientId) ?? null;
  const invoiceSubtotal = invoiceItems.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0,
  );
  const normalizedAmountPaid =
    paymentStatus === "paid"
      ? invoiceSubtotal
      : paymentStatus === "unpaid"
        ? 0
        : Number(amountPaidInput || "0");
  const balanceDue = Math.max(invoiceSubtotal - normalizedAmountPaid, 0);
  const menuItems: DrawerMenuItem[] = [
    { href: "/", label: "Queue", icon: LayoutDashboard },
    { href: "/patients", label: "Patients", icon: Search },
    { tab: "appointments" as SettingsTab, label: "Appointments", icon: CalendarClock },
    { href: "/billing", label: "Billing", icon: CreditCard },
    { href: "/history", label: "History", icon: History },
    { href: "/inventory", label: "Inventory", icon: Stethoscope },
    { href: "/users", label: "Users", icon: UserPlus },
    { href: "/audit", label: "Audit", icon: Settings2 },
    { tab: "clinic" as SettingsTab, label: "Clinic", icon: Building2 },
    { tab: "letter" as SettingsTab, label: "Generate Letter", icon: FilePenLine },
    { tab: "about" as SettingsTab, label: "About", icon: Info },
    { tab: "contact" as SettingsTab, label: "Contact Us", icon: Mail },
  ];

  if (currentUser?.role === "admin") {
    menuItems.splice(3, 0, { href: "/earnings", label: "Earnings", icon: BarChart3 });
  }

  useEffect(() => {
    if (!settings) {
      return;
    }
    setForm(createClinicFormState(settings));
    setError("");
    setSaveStatus("");
    setTemplateError("");
    setTemplateStatus("");
  }, [settings]);

  useEffect(() => {
    if (!templatePreviewUrl) {
      return;
    }

    return () => {
      URL.revokeObjectURL(templatePreviewUrl);
    };
  }, [templatePreviewUrl]);

  useEffect(() => {
    if (!letterPdfPreviewUrl) {
      return;
    }

    return () => {
      URL.revokeObjectURL(letterPdfPreviewUrl);
    };
  }, [letterPdfPreviewUrl]);

  useEffect(() => {
    if (!selectedBillingPatientId && patients[0]) {
      setSelectedBillingPatientId(patients[0].id);
    }
  }, [patients, selectedBillingPatientId]);

  useEffect(() => {
    if (open) {
      return;
    }
    setLetterForm(emptyLetterForm);
    setLetterError("");
    setLetterStatus("");
    setLetterPdfPreviewUrl("");
  }, [open]);

  useEffect(() => {
    if (!open || activeTab !== "users") {
      setIsUsersLoading(false);
      return;
    }

    if (hasLoadedUsers || isUsersLoading) {
      return;
    }

    let active = true;
    setIsUsersLoading(true);
    setUserError("");
    void onLoadUsers()
      .then(() => {
        if (active) {
          setHasLoadedUsers(true);
        }
      })
      .catch((loadError) => {
        if (active) {
          setHasLoadedUsers(true);
          setUserError(loadError instanceof Error ? loadError.message : "Failed to load users.");
        }
      })
      .finally(() => {
        setIsUsersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedUsers, isUsersLoading, onLoadUsers, open]);

  useEffect(() => {
    const needsCatalog = open && (activeTab === "catalog" || activeTab === "billing");
    if (!needsCatalog) {
      setIsCatalogLoading(false);
      return;
    }

    if (hasLoadedCatalog || isCatalogLoading) {
      return;
    }

    let active = true;
    setIsCatalogLoading(true);
    setCatalogError("");
    void onLoadCatalogItems()
      .then(() => {
        if (active) {
          setHasLoadedCatalog(true);
        }
      })
      .catch((loadError) => {
        if (active) {
          setHasLoadedCatalog(true);
          setCatalogError(loadError instanceof Error ? loadError.message : "Failed to load inventory.");
        }
      })
      .finally(() => {
        setIsCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedCatalog, isCatalogLoading, onLoadCatalogItems, open]);

  useEffect(() => {
    if (!open || activeTab !== "audit") {
      setIsAuditLoading(false);
      return;
    }

    if (hasLoadedAudit || isAuditLoading) {
      return;
    }

    let active = true;
    setIsAuditLoading(true);
    setAuditError("");
    void onLoadAuditEvents()
      .then(() => {
        if (active) {
          setHasLoadedAudit(true);
        }
      })
      .catch((loadError) => {
        if (active) {
          setHasLoadedAudit(true);
          setAuditError(loadError instanceof Error ? loadError.message : "Failed to load audit events.");
        }
      })
      .finally(() => {
        if (active) {
          setIsAuditLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, hasLoadedAudit, isAuditLoading, onLoadAuditEvents, open]);

  useEffect(() => {
    if (open && activeTab === "audit") {
      setHasLoadedAudit(false);
    }
  }, [activeTab, open]);

  useEffect(() => {
    const shouldLoadPreview =
      open &&
      (activeTab === "clinic" || activeTab === "letter") &&
      Boolean(form.document_template_url || form.document_template_name);

    if (!shouldLoadPreview) {
      setIsTemplatePreviewLoading(false);
      if (!form.document_template_url && !form.document_template_name) {
        setTemplatePreviewUrl("");
        setTemplatePreviewMimeType("");
      }
      return;
    }

    let active = true;
    setIsTemplatePreviewLoading(true);
    void api.downloadClinicDocumentTemplate()
      .then((blob) => {
        if (!active) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        setTemplatePreviewUrl(objectUrl);
        setTemplatePreviewMimeType(blob.type || "");
      })
      .catch((previewError) => {
        if (!active) {
          return;
        }
        setTemplatePreviewUrl("");
        setTemplatePreviewMimeType("");
        setTemplateError(
          previewError instanceof Error ? previewError.message : "Failed to load document preview.",
        );
      })
      .finally(() => {
        if (active) {
          setIsTemplatePreviewLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeTab, form.document_template_name, form.document_template_url, open]);

  if (!open) {
    return null;
  }

  async function handleClinicSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.clinic_name.trim()) {
      setError("Clinic name is required.");
      return;
    }

    const margins = {
      top: Number(form.document_template_margin_top),
      right: Number(form.document_template_margin_right),
      bottom: Number(form.document_template_margin_bottom),
      left: Number(form.document_template_margin_left),
    };
    if (Object.values(margins).some((value) => !Number.isFinite(value) || value < 0)) {
      setError("Document template margins must be valid positive numbers or zero.");
      return;
    }

    setIsSaving(true);
    setError("");
    setSaveStatus("");
    try {
      const saved = await onSaveClinic({
        clinic_name: form.clinic_name.trim(),
        clinic_address: form.clinic_address.trim(),
        clinic_phone: form.clinic_phone.trim(),
        doctor_name: form.doctor_name.trim(),
        custom_header: form.custom_header.trim(),
        custom_footer: form.custom_footer.trim(),
        document_template_name: form.document_template_name,
        document_template_url: form.document_template_url,
        document_template_notes_enabled: form.document_template_notes_enabled,
        document_template_letters_enabled: form.document_template_letters_enabled,
        document_template_invoices_enabled: form.document_template_invoices_enabled,
        document_template_margin_top: margins.top,
        document_template_margin_right: margins.right,
        document_template_margin_bottom: margins.bottom,
        document_template_margin_left: margins.left,
      });
      if (saved) {
        onClinicSettingsChange?.(saved);
        setForm(createClinicFormState(saved));
      }
      setSaveStatus("Clinic settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDocumentTemplateUpload(file: File) {
    setIsUploadingTemplate(true);
    setTemplateError("");
    setTemplateStatus("");
    try {
      const updated = await api.uploadClinicDocumentTemplate(file);
      setForm(createClinicFormState(updated));
      onClinicSettingsChange?.(updated);
      setTemplateStatus("Document template uploaded.");
    } catch (uploadError) {
      setTemplateError(uploadError instanceof Error ? uploadError.message : "Failed to upload document template.");
    } finally {
      setIsUploadingTemplate(false);
    }
  }

  async function handleRemoveDocumentTemplate() {
    setIsRemovingTemplate(true);
    setTemplateError("");
    setTemplateStatus("");
    try {
      const updated = await api.removeClinicDocumentTemplate();
      setForm(createClinicFormState(updated));
      onClinicSettingsChange?.(updated);
      setTemplateStatus("Document template removed.");
    } catch (removeError) {
      setTemplateError(removeError instanceof Error ? removeError.message : "Failed to remove document template.");
    } finally {
      setIsRemovingTemplate(false);
    }
  }

  async function handleOpenDocumentTemplate() {
    setIsOpeningTemplate(true);
    setTemplateError("");
    try {
      const blob = await api.downloadClinicDocumentTemplate();
      const objectUrl = URL.createObjectURL(blob);
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (openError) {
      setTemplateError(openError instanceof Error ? openError.message : "Failed to open document template.");
    } finally {
      setIsOpeningTemplate(false);
    }
  }

  async function handleAddUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserError("");
    setUserSuccess("");

    if (!userForm.identifier.trim()) {
      setUserError("Email or phone number is required.");
      return;
    }
    if (userForm.password.length < 8) {
      setUserError("Password must be at least 8 characters.");
      return;
    }

    setIsAddingUser(true);
    try {
      await onAddUser({
        identifier: userForm.identifier.trim(),
        password: userForm.password,
      });
      setUserSuccess("Staff user added.");
      setUserForm({ identifier: "", password: "" });
      setIsAddUserOpen(false);
    } catch (saveError) {
      setUserError(saveError instanceof Error ? saveError.message : "Failed to add user.");
    } finally {
      setIsAddingUser(false);
    }
  }

  async function handleRefreshAudit() {
    setIsAuditLoading(true);
    setAuditError("");
    try {
      await onLoadAuditEvents();
      setHasLoadedAudit(true);
    } catch (loadError) {
      setAuditError(loadError instanceof Error ? loadError.message : "Failed to load audit events.");
    } finally {
      setIsAuditLoading(false);
    }
  }

  async function handleSaveCatalogItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCatalogError("");
    setCatalogStatus("");

    const price = Number(catalogForm.default_price);
    const stockQuantity = Number(catalogForm.stock_quantity || "0");
    const lowStockThreshold = Number(catalogForm.low_stock_threshold || "0");
    if (!catalogForm.name.trim()) {
      setCatalogError("Name is required.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setCatalogError("Enter a valid price.");
      return;
    }
    if (catalogForm.track_inventory && (!Number.isFinite(stockQuantity) || stockQuantity < 0)) {
      setCatalogError("Enter a valid stock quantity.");
      return;
    }
    if (catalogForm.track_inventory && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
      setCatalogError("Enter a valid low-stock threshold.");
      return;
    }

    setIsSavingCatalog(true);
    try {
      await onCreateCatalogItem({
        name: catalogForm.name.trim(),
        item_type: catalogForm.item_type,
        default_price: price,
        track_inventory: catalogForm.track_inventory,
        stock_quantity: catalogForm.track_inventory ? stockQuantity : 0,
        low_stock_threshold: catalogForm.track_inventory ? lowStockThreshold : 0,
        unit: catalogForm.unit.trim(),
      });
      setCatalogStatus(
        catalogForm.item_type === "service" ? "Service saved." : "Medicine saved.",
      );
      setCatalogForm({
        name: "",
        item_type: catalogForm.item_type,
        default_price: "",
        track_inventory: catalogForm.item_type === "medicine",
        stock_quantity: "",
        low_stock_threshold: "",
        unit: "",
      });
    } catch (saveError) {
      setCatalogError(saveError instanceof Error ? saveError.message : "Failed to save catalog item.");
    } finally {
      setIsSavingCatalog(false);
    }
  }

  async function handleAdjustStock(itemId: string) {
    const raw = stockAdjustments[itemId] ?? "";
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) {
      setCatalogError("Enter a stock adjustment other than zero.");
      return;
    }

    setAdjustingStockId(itemId);
    setCatalogError("");
    setCatalogStatus("");
    try {
      await onAdjustCatalogStock(itemId, delta);
      setStockAdjustments((current) => ({ ...current, [itemId]: "" }));
      setCatalogStatus(delta > 0 ? "Stock increased." : "Stock reduced.");
    } catch (adjustError) {
      setCatalogError(adjustError instanceof Error ? adjustError.message : "Failed to adjust stock.");
    } finally {
      setAdjustingStockId("");
    }
  }

  async function handleDeleteCatalog(itemId: string) {
    setDeletingCatalogId(itemId);
    setCatalogError("");
    setCatalogStatus("");
    try {
      await onDeleteCatalogItem(itemId);
      setCatalogStatus("Inventory item removed.");
    } catch (deleteError) {
      setCatalogError(deleteError instanceof Error ? deleteError.message : "Failed to remove inventory item.");
    } finally {
      setDeletingCatalogId("");
    }
  }

  async function handleGenerateLetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLetterError("");
    setLetterStatus("");

    if (!letterForm.to.trim()) {
      setLetterError("Recipient is required.");
      return;
    }
    if (!letterForm.subject.trim()) {
      setLetterError("Subject is required.");
      return;
    }
    if (!letterForm.content.trim()) {
      setLetterError("Content is required.");
      return;
    }

    setIsGeneratingLetter(true);
    try {
      setLetterPdfPreviewUrl("");
      const generated = await onGenerateLetter({
        to: letterForm.to.trim(),
        subject: letterForm.subject.trim(),
        content: letterForm.content.trim(),
      });
      setLetterForm((current) => ({ ...current, generated }));
      setLetterStatus("Letter generated.");
    } catch (generateError) {
      setLetterError(generateError instanceof Error ? generateError.message : "Failed to generate letter.");
    } finally {
      setIsGeneratingLetter(false);
    }
  }

  async function handleLetterPdf() {
    if (!letterForm.generated.trim()) {
      setLetterError("Generate the letter before creating a PDF.");
      return;
    }

    setIsPreparingLetterPdf(true);
    setLetterError("");
    setLetterStatus("");
    try {
      const blob = await onGenerateLetterPdf({ content: letterForm.generated });
      const url = URL.createObjectURL(blob);
      setLetterPdfPreviewUrl(url);
      setLetterStatus("Letter PDF ready.");
    } catch (pdfError) {
      setLetterError(pdfError instanceof Error ? pdfError.message : "Failed to prepare letter PDF.");
    } finally {
      setIsPreparingLetterPdf(false);
    }
  }

  async function handleSendLetter() {
    if (!letterForm.generated.trim()) {
      setLetterError("Generate the letter before copying.");
      return;
    }
    setIsSendingLetter(true);
    setLetterError("");
    setLetterStatus("");
    try {
      await navigator.clipboard.writeText(letterForm.generated);
      setLetterStatus("Letter copied. Share it outside ClinicOS.");
    } catch (sendError) {
      setLetterError(sendError instanceof Error ? sendError.message : "Failed to copy letter.");
    } finally {
      setIsSendingLetter(false);
    }
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
    setSavedInvoice(null);
  }

  function updateInvoiceItem(itemId: string, patch: Partial<DraftInvoiceItem>) {
    setInvoiceItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    );
    setBillingStatus("");
    setBillingError("");
    setSavedInvoice(null);
  }

  function removeInvoiceItem(itemId: string) {
    setInvoiceItems((current) => current.filter((item) => item.id !== itemId));
    setBillingStatus("");
    setBillingError("");
    setSavedInvoice(null);
  }

  async function handleCreateBill() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    if (!invoiceItems.length) {
      setBillingError("Add at least one service or medicine.");
      return;
    }

    setIsSavingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const created = await onCreateInvoice({
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
      });
      setSavedInvoice(created);
      setBillingStatus("Invoice created.");
    } catch (createError) {
      setBillingError(createError instanceof Error ? createError.message : "Failed to create bill.");
    } finally {
      setIsSavingInvoice(false);
    }
  }

  async function handleInvoicePdf(action: "preview" | "download") {
    if (!savedInvoice) {
      setBillingError("Send the bill first to save it, then preview the PDF.");
      return;
    }

    setIsPreparingInvoicePdf(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const blob = await onGenerateInvoicePdf(savedInvoice.id);
      const url = URL.createObjectURL(blob);
      const patientLabel = selectedBillingPatient?.name.replace(/\s+/g, "_") || "patient";
      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${patientLabel}_invoice.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setBillingStatus("Invoice PDF ready.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (pdfError) {
      setBillingError(pdfError instanceof Error ? pdfError.message : "Failed to prepare invoice PDF.");
    } finally {
      setIsPreparingInvoicePdf(false);
    }
  }

  async function handleSendInvoice() {
    if (!selectedBillingPatient) {
      setBillingError("Select a done patient to bill.");
      return;
    }
    if (!invoiceItems.length) {
      setBillingError("Add at least one service or medicine.");
      return;
    }

    setIsSendingInvoice(true);
    setBillingError("");
    setBillingStatus("");
    try {
      const invoice =
        savedInvoice ??
        (await onCreateInvoice({
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
        }));
      if (!savedInvoice) {
        setSavedInvoice(invoice);
      }
      const message = await onSendInvoice({
        invoice_id: invoice.id,
        recipient: selectedBillingPatient.phone,
      });
      setBillingStatus(message);
      onBillingComplete(selectedBillingPatient.id);
    } catch (sendError) {
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to mark invoice as shared.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  async function handleExportCsv(
    kind: "patients" | "visits" | "invoices",
    loader: () => Promise<Blob>,
  ) {
    setIsExporting(kind);
    setExportError("");
    setExportStatus("");
    try {
      const blob = await loader();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${kind}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setExportStatus(`${kind[0].toUpperCase()}${kind.slice(1)} export downloaded.`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : `Failed to export ${kind}.`);
    } finally {
      setIsExporting("");
    }
  }

  function renderClinicTab() {
    const hasDocumentTemplate = Boolean(form.document_template_name || form.document_template_url);

    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.82fr)_minmax(520px,1.18fr)]">
        <form className="space-y-4" onSubmit={handleClinicSave}>
          <section className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]">
            <div className="max-w-3xl">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Clinic Workspace</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">Branding, document paper, and fit controls</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Configure the clinic identity on the left and use the live page preview on the right to tune where generated content sits.
              </p>
            </div>

            <div className="mt-6 grid gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Clinic Name</span>
                <input
                  value={form.clinic_name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, clinic_name: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Doctor Name</span>
                <input
                  value={form.doctor_name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, doctor_name: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Address</span>
                <textarea
                  rows={3}
                  value={form.clinic_address}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, clinic_address: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Clinic Phone</span>
                <input
                  value={form.clinic_phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, clinic_phone: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
            </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Document Template</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">Shared clinic paper</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Upload one shared paper template for generated notes, letters, and invoices. Custom header and footer stay available below as fallback when the template is absent or disabled for a document type.
              </p>
            </div>
            <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">
              {hasDocumentTemplate ? "Template ready" : "Fallback only"}
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white p-3 text-sky-700">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {form.document_template_name || "No document template uploaded"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload a PDF or image to use as the shared clinic page background.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50">
                  <Upload className="h-4 w-4" />
                  {isUploadingTemplate ? "Uploading..." : "Upload template"}
                  <input
                    type="file"
                    accept=".pdf,image/png,image/jpeg"
                    disabled={isUploadingTemplate || isRemovingTemplate}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleDocumentTemplateUpload(file);
                      }
                      event.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={!hasDocumentTemplate || isRemovingTemplate || isUploadingTemplate}
                  onClick={() => void handleRemoveDocumentTemplate()}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  {isRemovingTemplate ? "Removing..." : "Remove"}
                </button>
              </div>
            </div>

            {hasDocumentTemplate ? (
              <button
                type="button"
                onClick={() => void handleOpenDocumentTemplate()}
                disabled={isOpeningTemplate}
                className="mt-4 inline-flex text-sm font-medium text-sky-700 hover:text-sky-800 disabled:opacity-60"
              >
                {isOpeningTemplate ? "Opening template..." : "View current template"}
              </button>
            ) : null}

            {templateError ? <p className="mt-4 text-sm font-medium text-rose-600">{templateError}</p> : null}
            {templateStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{templateStatus}</p> : null}
          </div>

          <div className="mt-6 rounded-[24px] border border-sky-100 bg-sky-50/30 p-4">
            <p className="text-sm font-semibold text-slate-900">Use for</p>
            <div className="mt-4 flex flex-wrap gap-5">
              {[
                { key: "document_template_notes_enabled" as const, label: "Notes" },
                { key: "document_template_letters_enabled" as const, label: "Letters" },
                { key: "document_template_invoices_enabled" as const, label: "Invoices" },
              ].map((item) => (
                <label key={item.key} className="inline-flex items-center gap-3 text-sm font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={form[item.key]}
                    disabled={!hasDocumentTemplate}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [item.key]: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-sky-300 text-sky-500 focus:ring-sky-400"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Template margins</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Set page margins for the uploaded template. Values are saved as numeric spacing and used only where the template is enabled.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              {[
                { key: "document_template_margin_top" as const, label: "Top" },
                { key: "document_template_margin_right" as const, label: "Right" },
                { key: "document_template_margin_bottom" as const, label: "Bottom" },
                { key: "document_template_margin_left" as const, label: "Left" },
              ].map((item) => (
                <label key={item.key} className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">{item.label}</span>
                  <input
                    type="number"
                    min="0"
                    max="288"
                    step="0.1"
                    value={form[item.key]}
                    disabled={!hasDocumentTemplate}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [item.key]: event.target.value }))
                    }
                    className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              ))}
            </div>
          </div>
          </section>

          <section className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]">
            <div className="grid gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Custom Header</span>
                <span className="mb-2 block text-xs text-slate-500">
                  Fallback header when no document template is uploaded or the document type toggle is off.
                </span>
                <textarea
                  rows={2}
                  value={form.custom_header}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, custom_header: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Custom Footer</span>
                <span className="mb-2 block text-xs text-slate-500">
                  Fallback footer when no document template is uploaded or the document type toggle is off.
                </span>
                <textarea
                  rows={3}
                  value={form.custom_footer}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, custom_footer: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
            </div>
          </section>

          {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}
          {saveStatus ? <p className="text-sm font-medium text-emerald-700">{saveStatus}</p> : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Clinic Details"}
            </button>
          </div>
        </form>

        <div className="xl:sticky xl:top-0 xl:self-start">
          <ClinicDocumentPreview
            form={form}
            templatePreviewUrl={templatePreviewUrl}
            templatePreviewMimeType={templatePreviewMimeType}
            isTemplatePreviewLoading={isTemplatePreviewLoading}
          />
        </div>
      </div>
    );
  }

  function renderCatalogTab() {
    if (isCatalogLoading) {
      return renderSimplePanel("Inventory", "Loading inventory...");
    }

    return (
      <SettingsDrawerInventoryPanel
        currentUser={currentUser}
        catalogForm={catalogForm}
        catalogError={catalogError}
        catalogStatus={catalogStatus}
        isSavingCatalog={isSavingCatalog}
        serviceItems={serviceItems}
        medicineItems={medicineItems}
        stockAdjustments={stockAdjustments}
        adjustingStockId={adjustingStockId}
        deletingCatalogId={deletingCatalogId}
        onSubmit={handleSaveCatalogItem}
        onCatalogFormChange={(patch) => setCatalogForm((current) => ({ ...current, ...patch }))}
        onStockAdjustmentChange={(itemId, value) =>
          setStockAdjustments((current) => ({ ...current, [itemId]: value }))
        }
        onAdjustStock={handleAdjustStock}
        onDeleteCatalogItem={handleDeleteCatalog}
      />
    );
  }

  function renderUsersTab() {
    if (isUsersLoading) {
      return renderSimplePanel("Users", "Loading clinic users...");
    }

    return (
      <SettingsDrawerUsersPanel
        currentUser={currentUser}
        users={users}
        isAddUserOpen={isAddUserOpen}
        userForm={userForm}
        userError={userError}
        userSuccess={userSuccess}
        isAddingUser={isAddingUser}
        onToggleAddUser={() => {
          setIsAddUserOpen((current) => !current);
          setUserError("");
          setUserSuccess("");
        }}
        onSubmit={handleAddUser}
        onUserFormChange={(patch) => setUserForm((current) => ({ ...current, ...patch }))}
      />
    );
  }

  function renderLetterTab() {
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.82fr)_minmax(520px,1.18fr)]">
        <div className="space-y-4">
          <form className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]" onSubmit={handleGenerateLetter}>
            <div className="mb-4">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Letter Workspace</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">Generate a clinic letter and preview it inline</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                The right side starts with the clinic paper only. After you generate the draft and click Preview PDF, the rendered letter appears there.
              </p>
            </div>

            <div className="grid gap-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">To</span>
                <input
                  value={letterForm.to}
                  onChange={(event) => setLetterForm((current) => ({ ...current, to: event.target.value }))}
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Subject</span>
                <input
                  value={letterForm.subject}
                  onChange={(event) => setLetterForm((current) => ({ ...current, subject: event.target.value }))}
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Content</span>
                <textarea
                  rows={7}
                  value={letterForm.content}
                  onChange={(event) => setLetterForm((current) => ({ ...current, content: event.target.value }))}
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
              <div className="rounded-2xl border border-sky-100 bg-sky-50/30 px-4 py-3 text-sm leading-6 text-slate-600">
                Generate the draft first. `Preview PDF` renders it into the live panel on the right using the saved clinic template or fallback branding.
              </div>
            </div>

            {letterError ? <p className="mt-4 text-sm font-medium text-rose-600">{letterError}</p> : null}
            {letterStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{letterStatus}</p> : null}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="submit"
                disabled={isGeneratingLetter}
                className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isGeneratingLetter ? "Generating..." : "Generate Letter"}
              </button>
              <button
                type="button"
                disabled={isPreparingLetterPdf}
                onClick={() => void handleLetterPdf()}
                className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                {isPreparingLetterPdf ? "Rendering..." : "Preview PDF"}
              </button>
              <button
                type="button"
                disabled={isSendingLetter}
                onClick={() => void handleSendLetter()}
                className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                {isSendingLetter ? "Copying..." : "Copy Text"}
              </button>
            </div>
          </form>

          <div className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">Generated Draft</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">Edit the generated content before rendering the PDF preview.</p>
            </div>
            <textarea
              rows={18}
              value={letterForm.generated}
              onChange={(event) => setLetterForm((current) => ({ ...current, generated: event.target.value }))}
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/30 px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-sky-400"
            />
          </div>
        </div>

        <div className="xl:sticky xl:top-0 xl:self-start">
          <LetterDocumentPreview
            letterForm={letterForm}
            clinicForm={form}
            templatePreviewUrl={templatePreviewUrl}
            templatePreviewMimeType={templatePreviewMimeType}
            isTemplatePreviewLoading={isTemplatePreviewLoading}
            letterPreviewUrl={letterPdfPreviewUrl}
          />
        </div>
      </div>
    );
  }

  function renderAppointmentsTab() {
    return (
      <SettingsDrawerAppointmentsPanel
        onCheckInAppointment={onCheckInAppointment}
        onUpdateAppointment={onUpdateAppointment}
        onUpdateFollowUp={onUpdateFollowUp}
      />
    );
  }

  function renderBillingTab() {
    return (
      <SettingsDrawerBillingPanel
        patients={patients}
        selectedBillingPatientId={selectedBillingPatientId}
        selectedBillingPatient={selectedBillingPatient}
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
        isPreparingInvoicePdf={isPreparingInvoicePdf}
        isSendingInvoice={isSendingInvoice}
        savedInvoice={savedInvoice}
        onSelectPatient={(patientId) => {
          setSelectedBillingPatientId(patientId);
          setInvoiceItems([]);
          setSavedInvoice(null);
          setBillingError("");
          setBillingStatus("");
          setAmountPaidInput("");
        }}
        onAddCatalogItem={addCatalogItemToInvoice}
        onUpdateInvoiceItem={updateInvoiceItem}
        onRemoveInvoiceItem={removeInvoiceItem}
        onCreateBill={handleCreateBill}
        onPaymentStatusChange={(status) => {
          setPaymentStatus(status);
          setAmountPaidInput(status === "partial" ? invoiceSubtotal.toFixed(2) : "");
          setSavedInvoice(null);
          setBillingStatus("");
          setBillingError("");
        }}
        onAmountPaidChange={setAmountPaidInput}
        onPreviewPdf={() => handleInvoicePdf("preview")}
        onSendInvoice={handleSendInvoice}
      />
    );
  }

  function renderAuditTab() {
    if (isAuditLoading) {
      return renderSimplePanel("Audit", "Loading recent clinic activity...");
    }

    return (
      <div className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Audit</p>
            <h3 className="mt-2 text-xl font-semibold text-slate-900">Recent system activity</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              This feed tracks who changed what across patients, appointments, follow-ups, notes, and billing.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleRefreshAudit()}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700">
              {auditEvents.length} event{auditEvents.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {auditError ? <p className="mt-4 text-sm font-medium text-rose-600">{auditError}</p> : null}

        <div className="mt-6 space-y-3">
          {auditEvents.length ? auditEvents.map((event) => (
            <div key={event.id} className="rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{event.summary}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                    {event.actor_name} · {event.action.replaceAll("_", " ")}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {event.entity_type.replaceAll("_", " ")} · ID {event.entity_id.slice(0, 8).toUpperCase()}
                  </p>
                </div>
                <p className="text-right text-xs text-slate-500">
                  {new Date(event.created_at).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          )) : (
            <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/20 px-6 py-12 text-center text-sm text-slate-500">
              No audit events yet.
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderExportsTab() {
    return (
      <div className="rounded-[28px] border border-sky-200 bg-white p-5 shadow-[0_16px_45px_rgba(125,211,252,0.12)]">
        <div className="max-w-2xl">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Exports</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-900">Download clinic data</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Export patients, visit history, and invoices as CSV files for backup, review, or migration.
          </p>
        </div>
        {exportError ? <p className="mt-4 text-sm font-medium text-rose-600">{exportError}</p> : null}
        {exportStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{exportStatus}</p> : null}
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { key: "patients", label: "Patients", description: "Current patient snapshot and latest visit date.", loader: onExportPatientsCsv },
            { key: "visits", label: "Visits", description: "Per-visit vitals and reasons for every recorded visit.", loader: onExportVisitsCsv },
            { key: "invoices", label: "Invoices", description: "Invoice totals, payment status, and shared timestamps.", loader: onExportInvoicesCsv },
          ].map((item) => (
            <div key={item.key} className="rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
              <h4 className="text-base font-semibold text-slate-900">{item.label}</h4>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
              <button
                type="button"
                onClick={() => void handleExportCsv(item.key as "patients" | "visits" | "invoices", item.loader)}
                disabled={isExporting === item.key}
                className="mt-4 rounded-full border border-sky-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                {isExporting === item.key ? "Preparing..." : `Download ${item.label}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderSimplePanel(title: string, text: string) {
    return (
      <div className="rounded-[28px] border border-sky-200 bg-sky-50/40 p-5">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-700">{text}</p>
      </div>
    );
  }

  function renderContent() {
    if (activeTab === "clinic") return renderClinicTab();
    if (activeTab === "catalog") return renderCatalogTab();
    if (activeTab === "users") return renderUsersTab();
    if (activeTab === "audit") return renderAuditTab();
    if (activeTab === "appointments") return renderAppointmentsTab();
    if (activeTab === "letter") return renderLetterTab();
    if (activeTab === "billing") return renderBillingTab();
    if (activeTab === "exports") return renderExportsTab();

    const copy: Record<Exclude<SettingsTab, "clinic" | "catalog" | "users" | "letter" | "billing" | "appointments" | "audit" | "exports">, { title: string; text: string }> = {
      settings: {
        title: "Settings",
        text: "Core clinic configuration, inventory management, users, letters, and billing all live in this drawer.",
      },
      about: {
        title: "About",
        text: "ClinicOS is a lightweight clinic workflow, documentation, and billing app for small outpatient teams.",
      },
      contact: {
        title: "Contact Us",
        text: "For support, contact your ClinicOS setup lead or your clinic admin. Replace this copy with your real support channel before external demos.",
      },
    };

    const item = copy[activeTab as Exclude<SettingsTab, "clinic" | "catalog" | "users" | "letter" | "billing" | "appointments" | "audit" | "exports">];
    return renderSimplePanel(item.title, item.text);
  }

  const isWorkspaceTab = activeTab === "clinic" || activeTab === "letter";

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-sky-950/10 backdrop-blur-[1px]"
      />
      <aside
        className={`absolute left-0 w-full border-r-2 border-sky-300 bg-white shadow-[0_20px_60px_rgba(125,211,252,0.2)] ${
          isWorkspaceTab ? "inset-0" : "inset-y-0 max-w-6xl"
        }`}
      >
        <div className="grid h-full md:grid-cols-[220px_1fr]">
          <div className="border-b border-r border-sky-100 bg-sky-50/40 p-4 md:border-b-0">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">ClinicOS</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">Menu</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-sky-200 p-2 text-slate-700 transition hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="space-y-2">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isRouteItem = "href" in item;
                const isActive = isRouteItem ? pathname === item.href : activeTab === item.tab;
                return (
                  <button
                    key={isRouteItem ? item.href : item.tab}
                    type="button"
                    onClick={() => {
                      if (isRouteItem) {
                        const href = item.href;
                        onClose();
                        if (pathname !== href) {
                          startTransition(() => {
                            router.push(href);
                          });
                        }
                        return;
                      }
                      setActiveTab(item.tab);
                    }}
                    className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                      isActive
                        ? "bg-white text-sky-700 shadow-[0_8px_24px_rgba(125,211,252,0.14)]"
                        : "text-slate-700 hover:bg-white/70"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className={`overflow-y-auto ${isWorkspaceTab ? "p-6 xl:p-8" : "p-5 sm:p-6"}`}>
            <div className="mb-6">
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">{activeTab}</p>
            </div>
            {renderContent()}
          </div>
        </div>
      </aside>
    </div>
  );
}
