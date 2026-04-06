"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CreditCard,
  FilePenLine,
  Info,
  Mail,
  Pill,
  ReceiptIndianRupee,
  Settings2,
  Stethoscope,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";

import { AuthUser, CatalogItem, ClinicSettings, Invoice, Patient } from "@/lib/types";

type SettingsTab = "settings" | "about" | "contact" | "billing" | "clinic" | "users" | "letter" | "catalog";

interface SettingsDrawerProps {
  open: boolean;
  settings: ClinicSettings | null;
  currentUser: AuthUser | null;
  users: AuthUser[];
  patients: Patient[];
  catalogItems: CatalogItem[];
  onClose: () => void;
  onSaveClinic: (
    payload: Omit<ClinicSettings, "id" | "org_id" | "updated_at">,
  ) => Promise<void>;
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
    payment_status: "paid";
  }) => Promise<Invoice>;
  onGenerateInvoicePdf: (invoiceId: string) => Promise<Blob>;
  onSendInvoice: (payload: { invoice_id: string; recipient: string }) => Promise<string>;
  onBillingComplete: (patientId: string) => void;
}

const tabs: Array<{ id: SettingsTab; label: string; icon: typeof Settings2 }> = [
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "clinic", label: "Clinic", icon: Building2 },
  { id: "catalog", label: "Inventory", icon: Stethoscope },
  { id: "users", label: "Users", icon: UserPlus },
  { id: "letter", label: "Generate Letter", icon: FilePenLine },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "about", label: "About", icon: Info },
  { id: "contact", label: "Contact Us", icon: Mail },
];

type DraftInvoiceItem = {
  id: string;
  catalog_item_id?: string | null;
  item_type: "service" | "medicine";
  label: string;
  quantity: number;
  unit_price: number;
};

export function SettingsDrawer({
  open,
  settings,
  currentUser,
  users,
  patients,
  catalogItems,
  onClose,
  onSaveClinic,
  onAddUser,
  onCreateCatalogItem,
  onAdjustCatalogStock,
  onDeleteCatalogItem,
  onGenerateLetter,
  onGenerateLetterPdf,
  onSendLetter,
  onCreateInvoice,
  onGenerateInvoicePdf,
  onSendInvoice,
  onBillingComplete,
}: SettingsDrawerProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("clinic");
  const [form, setForm] = useState({
    clinic_name: "ClinicOS",
    clinic_address: "",
    clinic_phone: "",
    doctor_name: "",
    custom_header: "",
    custom_footer: "",
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [userForm, setUserForm] = useState({ identifier: "", password: "" });
  const [userError, setUserError] = useState("");
  const [userSuccess, setUserSuccess] = useState("");
  const [isAddingUser, setIsAddingUser] = useState(false);

  const [catalogForm, setCatalogForm] = useState({
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
  const [deletingCatalogId, setDeletingCatalogId] = useState("");
  const [stockAdjustments, setStockAdjustments] = useState<Record<string, string>>({});
  const [adjustingStockId, setAdjustingStockId] = useState("");

  const [letterForm, setLetterForm] = useState({
    to: "",
    subject: "",
    content: "",
    generated: "",
    recipient: "",
  });
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

  useEffect(() => {
    if (!settings) {
      return;
    }
    setForm({
      clinic_name: settings.clinic_name,
      clinic_address: settings.clinic_address,
      clinic_phone: settings.clinic_phone,
      doctor_name: settings.doctor_name,
      custom_header: settings.custom_header,
      custom_footer: settings.custom_footer,
    });
    setError("");
  }, [settings]);

  useEffect(() => {
    if (!selectedBillingPatientId && patients[0]) {
      setSelectedBillingPatientId(patients[0].id);
    }
  }, [patients, selectedBillingPatientId]);

  if (!open) {
    return null;
  }

  async function handleClinicSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.clinic_name.trim()) {
      setError("Clinic name is required.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSaveClinic({
        clinic_name: form.clinic_name.trim(),
        clinic_address: form.clinic_address.trim(),
        clinic_phone: form.clinic_phone.trim(),
        doctor_name: form.doctor_name.trim(),
        custom_header: form.custom_header.trim(),
        custom_footer: form.custom_footer.trim(),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save settings.");
    } finally {
      setIsSaving(false);
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
      window.open(url, "_blank", "noopener,noreferrer");

      setLetterStatus("Letter PDF ready.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (pdfError) {
      setLetterError(pdfError instanceof Error ? pdfError.message : "Failed to prepare letter PDF.");
    } finally {
      setIsPreparingLetterPdf(false);
    }
  }

  async function handleSendLetter() {
    if (!letterForm.generated.trim()) {
      setLetterError("Generate the letter before sending.");
      return;
    }
    if (!letterForm.recipient.trim()) {
      setLetterError("Enter an email or phone number to send the letter.");
      return;
    }

    setIsSendingLetter(true);
    setLetterError("");
    setLetterStatus("");
    try {
      await onSendLetter({
        recipient: letterForm.recipient.trim(),
        content: letterForm.generated,
      });
      onClose();
    } catch (sendError) {
      setLetterError(sendError instanceof Error ? sendError.message : "Failed to send letter.");
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
        id: crypto.randomUUID(),
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
        payment_status: "paid",
      });
      setSavedInvoice(created);
      setBillingStatus("Bill created.");
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
          payment_status: "paid",
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
      setBillingError(sendError instanceof Error ? sendError.message : "Failed to send invoice.");
    } finally {
      setIsSendingInvoice(false);
    }
  }

  function renderClinicTab() {
    return (
      <form className="space-y-4" onSubmit={handleClinicSave}>
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

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Custom Header</span>
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
          <textarea
            rows={3}
            value={form.custom_footer}
            onChange={(event) =>
              setForm((current) => ({ ...current, custom_footer: event.target.value }))
            }
            className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
          />
        </label>

        {error ? <p className="text-sm font-medium text-rose-600">{error}</p> : null}

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
    );
  }

  function renderCatalogTab() {
    return (
      <div className="space-y-4">
        <form className="rounded-[28px] border border-sky-200 bg-white p-5" onSubmit={handleSaveCatalogItem}>
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900">Inventory Management</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              Add and manage the services and medicines your clinic uses so staff can bill from inventory quickly.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Name</span>
              <input
                value={catalogForm.name}
                onChange={(event) => setCatalogForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Consultation, Injection, Paracetamol"
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Type</span>
              <select
                value={catalogForm.item_type}
                onChange={(event) =>
                  setCatalogForm((current) => ({
                    ...current,
                    item_type: event.target.value as "service" | "medicine",
                    track_inventory:
                      event.target.value === "medicine" ? current.track_inventory || true : current.track_inventory,
                  }))
                }
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              >
                <option value="service">Service</option>
                <option value="medicine">Medicine</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Default Price</span>
              <input
                value={catalogForm.default_price}
                inputMode="decimal"
                onChange={(event) =>
                  setCatalogForm((current) => ({ ...current, default_price: event.target.value }))
                }
                placeholder="500"
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Unit</span>
              <input
                value={catalogForm.unit}
                onChange={(event) => setCatalogForm((current) => ({ ...current, unit: event.target.value }))}
                placeholder="per visit, each, strip, bottle"
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/30 px-4 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={catalogForm.track_inventory}
              onChange={(event) =>
                setCatalogForm((current) => ({ ...current, track_inventory: event.target.checked }))
              }
            />
            Track stock for this inventory item
          </label>

          {catalogForm.track_inventory ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Opening Stock</span>
                <input
                  value={catalogForm.stock_quantity}
                  inputMode="decimal"
                  onChange={(event) =>
                    setCatalogForm((current) => ({ ...current, stock_quantity: event.target.value }))
                  }
                  placeholder="100"
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Low Stock Threshold</span>
                <input
                  value={catalogForm.low_stock_threshold}
                  inputMode="decimal"
                  onChange={(event) =>
                    setCatalogForm((current) => ({ ...current, low_stock_threshold: event.target.value }))
                  }
                  placeholder="10"
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
            </div>
          ) : null}

          {catalogError ? <p className="mt-4 text-sm font-medium text-rose-600">{catalogError}</p> : null}
          {catalogStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{catalogStatus}</p> : null}

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={isSavingCatalog || currentUser?.role !== "admin"}
              className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {isSavingCatalog ? "Saving..." : "Save Inventory Item"}
            </button>
          </div>
        </form>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[28px] border border-sky-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-sky-700" />
              <h3 className="text-base font-semibold text-slate-900">Services</h3>
            </div>
            <div className="space-y-3">
              {serviceItems.length ? serviceItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-2xl border border-sky-100 bg-sky-50/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.unit || "per entry"} · {item.default_price.toFixed(2)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.track_inventory
                        ? `Stock ${item.stock_quantity} · Low at ${item.low_stock_threshold}`
                        : "Stock not tracked"}
                    </p>
                    {item.track_inventory ? (
                      <div className="mt-2 flex gap-2">
                        <input
                          value={stockAdjustments[item.id] ?? ""}
                          inputMode="decimal"
                          onChange={(event) =>
                            setStockAdjustments((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                          placeholder="+10 / -2"
                          className="w-28 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none"
                        />
                        <button
                          type="button"
                          disabled={adjustingStockId === item.id || currentUser?.role !== "admin"}
                          onClick={() => handleAdjustStock(item.id)}
                          className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-50"
                        >
                          {adjustingStockId === item.id ? "Updating..." : "Adjust"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={deletingCatalogId === item.id || currentUser?.role !== "admin"}
                    onClick={() => handleDeleteCatalog(item.id)}
                    className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )) : <p className="text-sm text-slate-600">No services added yet.</p>}
            </div>
          </div>

          <div className="rounded-[28px] border border-sky-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <Pill className="h-4 w-4 text-sky-700" />
              <h3 className="text-base font-semibold text-slate-900">Medicines</h3>
            </div>
            <div className="space-y-3">
              {medicineItems.length ? medicineItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-2xl border border-sky-100 bg-sky-50/30 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="mt-1 text-xs text-slate-600">{item.unit || "per entry"} · {item.default_price.toFixed(2)}</p>
                    <p className={`mt-1 text-xs ${item.track_inventory && item.stock_quantity <= item.low_stock_threshold ? "text-amber-700" : "text-slate-500"}`}>
                      {item.track_inventory
                        ? `Stock ${item.stock_quantity} · Low at ${item.low_stock_threshold}`
                        : "Stock not tracked"}
                    </p>
                    {item.track_inventory ? (
                      <div className="mt-2 flex gap-2">
                        <input
                          value={stockAdjustments[item.id] ?? ""}
                          inputMode="decimal"
                          onChange={(event) =>
                            setStockAdjustments((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                          placeholder="+10 / -2"
                          className="w-28 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none"
                        />
                        <button
                          type="button"
                          disabled={adjustingStockId === item.id || currentUser?.role !== "admin"}
                          onClick={() => handleAdjustStock(item.id)}
                          className="rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-sky-50 disabled:opacity-50"
                        >
                          {adjustingStockId === item.id ? "Updating..." : "Adjust"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={deletingCatalogId === item.id || currentUser?.role !== "admin"}
                    onClick={() => handleDeleteCatalog(item.id)}
                    className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )) : <p className="text-sm text-slate-600">No medicines added yet.</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderUsersTab() {
    return (
      <div className="space-y-4">
        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">User Access</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                Manage the people who can access this clinic workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsAddUserOpen((current) => !current);
                setUserError("");
                setUserSuccess("");
              }}
              disabled={currentUser?.role !== "admin"}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserPlus className="h-4 w-4" />
              Add User
            </button>
          </div>

          {currentUser?.role !== "admin" ? (
            <p className="mt-4 text-sm font-medium text-amber-700">Only admins can add staff users.</p>
          ) : null}
          {userSuccess ? <p className="mt-4 text-sm font-medium text-emerald-700">{userSuccess}</p> : null}

          {isAddUserOpen && currentUser?.role === "admin" ? (
            <form className="mt-4 grid gap-4 border-t border-sky-100 pt-4" onSubmit={handleAddUser}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Email or phone number</span>
                <input
                  value={userForm.identifier}
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, identifier: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(event) =>
                    setUserForm((current) => ({ ...current, password: event.target.value }))
                  }
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
              {userError ? <p className="text-sm font-medium text-rose-600">{userError}</p> : null}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isAddingUser}
                  className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
                >
                  {isAddingUser ? "Adding..." : "Create Staff User"}
                </button>
              </div>
            </form>
          ) : null}
        </div>

        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Clinic Users</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">Everyone who currently has access to this clinic.</p>
            </div>
            <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">{users.length} total</span>
          </div>
          {users.length ? (
            <div className="overflow-hidden rounded-[22px] border border-sky-200">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-sky-50/80 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Name</th>
                    <th className="px-4 py-3 text-left font-semibold">Role</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {users.map((user) => (
                    <tr key={user.id} className="border-t border-sky-100 first:border-t-0">
                      <td className="px-4 py-3 text-slate-800">{user.name}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                          {user.role === "admin" ? "Admin" : "Staff"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-sm text-slate-600">No users found for this clinic yet.</p>}
        </div>
      </div>
    );
  }

  function renderLetterTab() {
    return (
      <div className="space-y-4">
        <form className="rounded-[28px] border border-sky-200 bg-white p-5" onSubmit={handleGenerateLetter}>
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900">Generate Letter</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              Create a branded clinic letter for travel, school, consultation summaries, and similar requests.
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
                onChange={(event) =>
                  setLetterForm((current) => ({ ...current, subject: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Content</span>
              <textarea
                rows={6}
                value={letterForm.content}
                onChange={(event) =>
                  setLetterForm((current) => ({ ...current, content: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Send To</span>
              <input
                value={letterForm.recipient}
                onChange={(event) =>
                  setLetterForm((current) => ({ ...current, recipient: event.target.value }))
                }
                className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
          </div>

          {letterError ? <p className="mt-4 text-sm font-medium text-rose-600">{letterError}</p> : null}
          {letterStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{letterStatus}</p> : null}

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button type="submit" disabled={isGeneratingLetter} className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60">
              {isGeneratingLetter ? "Generating..." : "Generate Letter"}
            </button>
            <button type="button" disabled={isPreparingLetterPdf} onClick={handleLetterPdf} className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60">
              Preview PDF
            </button>
            <button type="button" disabled={isSendingLetter} onClick={handleSendLetter} className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60">
              {isSendingLetter ? "Sending..." : "Send"}
            </button>
          </div>
        </form>

        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-slate-900">Generated Draft</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">The PDF uses your clinic branding, footer, and current date.</p>
          </div>
          <textarea
            rows={16}
            value={letterForm.generated}
            onChange={(event) =>
              setLetterForm((current) => ({ ...current, generated: event.target.value }))
            }
            className="w-full rounded-2xl border border-sky-200 bg-sky-50/30 px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-sky-400"
          />
        </div>
      </div>
    );
  }

  function renderBillingTab() {
    return (
      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="rounded-[28px] border border-sky-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <ReceiptIndianRupee className="h-4 w-4 text-sky-700" />
            <div>
              <h3 className="text-base font-semibold text-slate-900">Patients</h3>
              <p className="mt-1 text-sm text-slate-600">Select a patient to prepare billing.</p>
            </div>
          </div>
          <div className="space-y-3">
            {patients.length ? patients.map((patient) => {
              const active = patient.id === selectedBillingPatientId;
              return (
                <button
                  key={patient.id}
                  type="button"
                  onClick={() => {
                    setSelectedBillingPatientId(patient.id);
                    setInvoiceItems([]);
                    setSavedInvoice(null);
                    setBillingError("");
                    setBillingStatus("");
                  }}
                  className={`w-full rounded-[24px] border px-4 py-3 text-left transition ${
                    active ? "border-sky-300 bg-sky-50" : "border-sky-100 bg-white hover:bg-sky-50/50"
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">{patient.name}</p>
                  <p className="mt-1 text-xs text-slate-600">{patient.reason}</p>
                </button>
              );
            }) : <p className="text-sm text-slate-600">No done patients yet.</p>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[28px] border border-sky-200 bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {selectedBillingPatient ? `Billing for ${selectedBillingPatient.name}` : "Billing"}
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Quick-add services and medicines from your inventory. Bills are recorded as fully paid upfront.
                </p>
              </div>
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                Paid Upfront
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-800">Services</p>
                <div className="flex flex-wrap gap-2">
                  {serviceItems.length ? serviceItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addCatalogItemToInvoice(item)}
                      disabled={item.track_inventory && item.stock_quantity <= 0}
                      className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-sky-100"
                    >
                      {item.name} · {item.default_price.toFixed(2)}
                      {item.track_inventory ? ` · Stock ${item.stock_quantity}` : ""}
                    </button>
                  )) : <p className="text-sm text-slate-600">No services in inventory.</p>}
                </div>
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold text-slate-800">Medicines</p>
                <div className="flex flex-wrap gap-2">
                  {medicineItems.length ? medicineItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addCatalogItemToInvoice(item)}
                      disabled={item.track_inventory && item.stock_quantity <= 0}
                      className="rounded-full border border-sky-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-sky-50"
                    >
                      {item.name} · {item.default_price.toFixed(2)}
                      {item.track_inventory ? ` · Stock ${item.stock_quantity}` : ""}
                    </button>
                  )) : <p className="text-sm text-slate-600">No medicines in inventory.</p>}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-sky-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Invoice Items</h3>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                {invoiceItems.length} item{invoiceItems.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="space-y-3">
              {invoiceItems.length ? invoiceItems.map((item) => (
                <div key={item.id} className="grid gap-3 rounded-[24px] border border-sky-100 bg-sky-50/30 p-4 md:grid-cols-[1.3fr_120px_140px_44px]">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{item.item_type}</p>
                  </div>
                  <input
                    value={item.quantity}
                    inputMode="decimal"
                    onChange={(event) => updateInvoiceItem(item.id, { quantity: Number(event.target.value) || 0 })}
                    className="rounded-2xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                  />
                  <input
                    value={item.unit_price}
                    inputMode="decimal"
                    onChange={(event) => updateInvoiceItem(item.id, { unit_price: Number(event.target.value) || 0 })}
                    className="rounded-2xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeInvoiceItem(item.id)}
                    className="rounded-full border border-sky-200 p-2 text-slate-600 transition hover:bg-white"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )) : <p className="text-sm text-slate-600">Add services or medicines from the inventory to start billing.</p>}
            </div>

            <div className="mt-5 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>Subtotal</span>
                <span>{invoiceSubtotal.toFixed(2)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-base font-semibold text-slate-900">
                <span>Total</span>
                <span>{invoiceSubtotal.toFixed(2)}</span>
              </div>
            </div>

            {selectedBillingPatient ? (
              <div className="mt-4 rounded-[24px] border border-sky-100 bg-sky-50/40 p-4">
                <p className="text-sm font-medium text-slate-700">Patient Recipient</p>
                <p className="mt-2 text-sm text-slate-900">{selectedBillingPatient.phone}</p>
              </div>
            ) : null}

            {billingError ? <p className="mt-4 text-sm font-medium text-rose-600">{billingError}</p> : null}
            {billingStatus ? <p className="mt-4 text-sm font-medium text-emerald-700">{billingStatus}</p> : null}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={handleCreateBill}
                disabled={isSavingInvoice}
                className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                {isSavingInvoice ? "Saving..." : savedInvoice ? "Recreate Bill" : "Create Bill"}
              </button>
              <button
                type="button"
                onClick={() => handleInvoicePdf("preview")}
                disabled={isPreparingInvoicePdf}
                className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                Preview PDF
              </button>
              <button
                type="button"
                onClick={handleSendInvoice}
                disabled={isSendingInvoice || isSavingInvoice}
                className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isSendingInvoice ? "Saving & Sending..." : "Send Bill"}
              </button>
            </div>
          </div>
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
    if (activeTab === "letter") return renderLetterTab();
    if (activeTab === "billing") return renderBillingTab();

    const copy: Record<Exclude<SettingsTab, "clinic" | "catalog" | "users" | "letter" | "billing">, { title: string; text: string }> = {
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
        text: "Add your support contact process here later. For now, this can be replaced with your clinic admin details.",
      },
    };

    const item = copy[activeTab as Exclude<SettingsTab, "clinic" | "catalog" | "users" | "letter" | "billing">];
    return renderSimplePanel(item.title, item.text);
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-sky-950/10 backdrop-blur-[1px]"
      />
      <aside className="absolute inset-y-0 left-0 w-full max-w-6xl border-r-2 border-sky-300 bg-white shadow-[0_20px_60px_rgba(125,211,252,0.2)]">
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
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition ${
                      isActive
                        ? "bg-white text-sky-700 shadow-[0_8px_24px_rgba(125,211,252,0.14)]"
                        : "text-slate-700 hover:bg-white/70"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="overflow-y-auto p-5 sm:p-6">
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
