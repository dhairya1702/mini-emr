"use client";

import { FormEvent, useEffect, useState } from "react";
import { Building2, CreditCard, FilePenLine, Info, Mail, Settings2, UserPlus, X } from "lucide-react";

import { AuthUser, ClinicSettings } from "@/lib/types";

type SettingsTab = "settings" | "about" | "contact" | "billing" | "clinic" | "users" | "letter";

interface SettingsDrawerProps {
  open: boolean;
  settings: ClinicSettings | null;
  currentUser: AuthUser | null;
  users: AuthUser[];
  onClose: () => void;
  onSaveClinic: (
    payload: Omit<ClinicSettings, "id" | "org_id" | "updated_at">,
  ) => Promise<void>;
  onAddUser: (payload: { identifier: string; password: string }) => Promise<void>;
  onGenerateLetter: (payload: { to: string; subject: string; content: string }) => Promise<string>;
  onGenerateLetterPdf: (payload: { content: string }) => Promise<Blob>;
  onSendLetter: (payload: { recipient: string; content: string }) => Promise<string>;
}

const tabs: Array<{ id: SettingsTab; label: string; icon: typeof Settings2 }> = [
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "clinic", label: "Clinic", icon: Building2 },
  { id: "users", label: "Users", icon: UserPlus },
  { id: "letter", label: "Generate Letter", icon: FilePenLine },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "about", label: "About", icon: Info },
  { id: "contact", label: "Contact Us", icon: Mail },
];

export function SettingsDrawer({
  open,
  settings,
  currentUser,
  users,
  onClose,
  onSaveClinic,
  onAddUser,
  onGenerateLetter,
  onGenerateLetterPdf,
  onSendLetter,
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

  async function handleLetterPdf(action: "preview" | "download") {
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

      if (action === "preview") {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = "clinic_letter.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

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
      const message = await onSendLetter({
        recipient: letterForm.recipient.trim(),
        content: letterForm.generated,
      });
      setLetterStatus(message);
    } catch (sendError) {
      setLetterError(sendError instanceof Error ? sendError.message : "Failed to send letter.");
    } finally {
      setIsSendingLetter(false);
    }
  }

  function renderContent() {
    if (activeTab === "clinic") {
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

          <div className="grid gap-4 sm:grid-cols-2">
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

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Custom Header</span>
            <textarea
              rows={2}
              value={form.custom_header}
              onChange={(event) =>
                setForm((current) => ({ ...current, custom_header: event.target.value }))
              }
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
              placeholder="Shown near the top of the PDF note"
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
              placeholder="Shown at the bottom of the PDF note"
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

    if (activeTab === "users") {
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
              <p className="mt-4 text-sm font-medium text-amber-700">
                Only admins can add staff users.
              </p>
            ) : null}

            {userSuccess ? (
              <p className="mt-4 text-sm font-medium text-emerald-700">{userSuccess}</p>
            ) : null}

            {isAddUserOpen && currentUser?.role === "admin" ? (
              <form className="mt-4 grid gap-4 border-t border-sky-100 pt-4" onSubmit={handleAddUser}>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    Email or phone number
                  </span>
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
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Everyone who currently has access to this clinic.
                </p>
              </div>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                {users.length} total
              </span>
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
            ) : (
              <p className="text-sm text-slate-600">No users found for this clinic yet.</p>
            )}
          </div>
        </div>
      );
    }

    if (activeTab === "letter") {
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
                  onChange={(event) =>
                    setLetterForm((current) => ({ ...current, to: event.target.value }))
                  }
                  placeholder="School principal, embassy officer, airline, employer"
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
                  placeholder="Fitness to travel, school absence note, consultation confirmation"
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
                  placeholder="Describe what the letter should say, including purpose, patient context, dates, restrictions, and any wording you want included."
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Send To
                </span>
                <input
                  value={letterForm.recipient}
                  onChange={(event) =>
                    setLetterForm((current) => ({ ...current, recipient: event.target.value }))
                  }
                  placeholder="recipient@email.com or +1 555 010 2020"
                  className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                />
              </label>
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
                onClick={() => handleLetterPdf("preview")}
                className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                {isPreparingLetterPdf ? "Preparing..." : "Preview PDF"}
              </button>
              <button
                type="button"
                disabled={isPreparingLetterPdf}
                onClick={() => handleLetterPdf("download")}
                className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                Download PDF
              </button>
              <button
                type="button"
                disabled={isSendingLetter}
                onClick={handleSendLetter}
                className="rounded-full border border-sky-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-sky-50 disabled:opacity-60"
              >
                {isSendingLetter ? "Sending..." : "Send"}
              </button>
            </div>
          </form>

          <div className="rounded-[28px] border border-sky-200 bg-white p-5">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">Generated Draft</h3>
              <p className="mt-2 text-sm leading-7 text-slate-600">
                The PDF will use your clinic name, custom header, custom footer, and today&apos;s date.
              </p>
            </div>
            <textarea
              rows={16}
              value={letterForm.generated}
              onChange={(event) =>
                setLetterForm((current) => ({ ...current, generated: event.target.value }))
              }
              className="w-full rounded-2xl border border-sky-200 bg-sky-50/30 px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-sky-400"
              placeholder="Generated letter text will appear here."
            />
          </div>
        </div>
      );
    }

    const copy: Record<Exclude<SettingsTab, "clinic" | "users" | "letter">, { title: string; text: string }> = {
      settings: {
        title: "Settings",
        text: "Basic application preferences can live here later. For now, clinic branding and note layout settings are under Clinic.",
      },
      about: {
        title: "About",
        text: "ClinicOS is a lightweight clinic workflow and note-generation app for small outpatient teams.",
      },
      contact: {
        title: "Contact Us",
        text: "Add your support contact process here later. For now, this can be replaced with your clinic admin details.",
      },
      billing: {
        title: "Billing",
        text: "Billing settings and invoice preferences can be added here in a later iteration.",
      },
    };

    const item = copy[activeTab as Exclude<SettingsTab, "clinic" | "users" | "letter">];
    return (
      <div className="rounded-[28px] border border-sky-200 bg-sky-50/40 p-5">
        <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-700">{item.text}</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-sky-950/10 backdrop-blur-[1px]"
      />
      <aside className="absolute inset-y-0 left-0 w-full max-w-4xl border-r-2 border-sky-300 bg-white shadow-[0_20px_60px_rgba(125,211,252,0.2)]">
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
              <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
                {activeTab}
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                {activeTab === "clinic" ? "Clinic Details" : tabs.find((tab) => tab.id === activeTab)?.label}
              </h2>
            </div>
            {renderContent()}
          </div>
        </div>
      </aside>
    </div>
  );
}
