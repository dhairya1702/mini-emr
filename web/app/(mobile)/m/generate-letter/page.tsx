"use client";

import { FormEvent, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileAdminGate } from "@/components/mobile/mobile-admin-gate";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { LetterFormState, SettingsDrawerLetterPanel } from "@/components/settings-drawer-letter-panel";
import { api } from "@/lib/api";
import { hasUserSignature } from "@/lib/setup-checklist";

const emptyLetterForm: LetterFormState = {
  to: "",
  subject: "",
  content: "",
  generated: "",
  recipient_email: "",
};

export default function MobileGenerateLetterPage() {
  const { currentUser, clinicSettings } = useClinicShell();
  const [letterForm, setLetterForm] = useState<LetterFormState>(emptyLetterForm);
  const [letterError, setLetterError] = useState("");
  const [letterStatus, setLetterStatus] = useState("");
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
  const [isPreparingLetterPdf, setIsPreparingLetterPdf] = useState(false);
  const [isSendingLetter, setIsSendingLetter] = useState(false);
  const setupWarnings = [
    !clinicSettings?.email_configured ? "Clinic sender email is not configured yet." : "",
    !hasUserSignature(currentUser) ? "Your signature is missing." : "",
  ].filter(Boolean);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLetterError("");
    setLetterStatus("");
    if (!letterForm.to.trim() || !letterForm.subject.trim() || !letterForm.content.trim()) {
      setLetterError("To, subject, and content are required.");
      return;
    }
    setIsGeneratingLetter(true);
    try {
      const response = await api.generateLetter({
        to: letterForm.to.trim(),
        subject: letterForm.subject.trim(),
        content: letterForm.content.trim(),
      });
      setLetterForm((current) => ({ ...current, generated: response.content }));
      setLetterStatus("Letter generated.");
    } catch (generateError) {
      setLetterError(generateError instanceof Error ? generateError.message : "Failed to generate letter.");
    } finally {
      setIsGeneratingLetter(false);
    }
  }

  async function handlePreviewPdf() {
    const content = letterForm.generated.trim() || letterForm.content.trim();
    if (!content) {
      setLetterError("Generate or write letter content before previewing.");
      return;
    }
    setIsPreparingLetterPdf(true);
    setLetterError("");
    setLetterStatus("");
    try {
      const blob = await api.generateLetterPdf({ content });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setLetterStatus("PDF opened.");
    } catch (previewError) {
      setLetterError(previewError instanceof Error ? previewError.message : "Failed to preview PDF.");
    } finally {
      setIsPreparingLetterPdf(false);
    }
  }

  async function handleSend() {
    const content = letterForm.generated.trim() || letterForm.content.trim();
    if (!letterForm.recipient_email.trim() || !letterForm.subject.trim() || !content) {
      setLetterError("Recipient email, subject, and letter content are required.");
      return;
    }
    setIsSendingLetter(true);
    setLetterError("");
    setLetterStatus("");
    try {
      await api.sendLetter({
        recipient_email: letterForm.recipient_email.trim(),
        subject: letterForm.subject.trim(),
        content,
      });
      setLetterStatus("Letter sent.");
    } catch (sendError) {
      setLetterError(sendError instanceof Error ? sendError.message : "Failed to send letter.");
    } finally {
      setIsSendingLetter(false);
    }
  }

  return (
    <MobileAdminGate title="Generate Letter">
      <MobileShell title="Generate Letter">
        <SettingsDrawerLetterPanel
          letterForm={letterForm}
          letterError={letterError}
          letterStatus={letterStatus}
          setupWarnings={setupWarnings}
          isGeneratingLetter={isGeneratingLetter}
          isPreparingLetterPdf={isPreparingLetterPdf}
          isSendingLetter={isSendingLetter}
          onSubmit={handleSubmit}
          onChange={(patch) => setLetterForm((current) => ({ ...current, ...patch }))}
          onPreviewPdf={handlePreviewPdf}
          onSend={handleSend}
        />
      </MobileShell>
    </MobileAdminGate>
  );
}
