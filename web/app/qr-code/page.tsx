"use client";

import Image from "next/image";
import { Copy, Download, Printer, QrCode, RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";

import { AppHeader } from "@/components/app-header";
import { AppMenuDrawer } from "@/components/app-menu-drawer";
import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import type { CheckInConfig } from "@/lib/types";

function resolvePublicUrl(config: CheckInConfig | null) {
  if (!config) return "";
  if (typeof window === "undefined") return config.public_url;

  try {
    const configuredUrl = new URL(config.public_url);
    const configuredIsLoopback =
      configuredUrl.hostname === "127.0.0.1" || configuredUrl.hostname === "localhost";
    const browserIsLoopback =
      window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";

    if (configuredIsLoopback && !browserIsLoopback) {
      return `${window.location.origin}/check-in?token=${encodeURIComponent(config.token)}`;
    }
  } catch {
    return `${window.location.origin}/check-in?token=${encodeURIComponent(config.token)}`;
  }

  return config.public_url;
}

export default function QrCodePage() {
  const {
    clinicSettings,
    currentUser,
    handleLogout,
    isAuthReady,
    isRedirectingToLogin,
  } = useClinicShell();
  const [config, setConfig] = useState<CheckInConfig | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const canManage = currentUser?.role === "admin";
  const publicUrl = useMemo(() => resolvePublicUrl(config), [config]);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin || !currentUser) return;
    let active = true;
    api.getCheckInConfig()
      .then((row) => {
        if (active) setConfig(row);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Failed to load QR code.");
      });
    return () => {
      active = false;
    };
  }, [currentUser, isAuthReady, isRedirectingToLogin]);

  useEffect(() => {
    if (!publicUrl) return;
    let active = true;
    QRCode.toDataURL(publicUrl, {
      width: 640,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#172033", light: "#ffffff" },
    })
      .then((value) => {
        if (active) setQrDataUrl(value);
      })
      .catch(() => {
        if (active) setError("Failed to generate QR code.");
      });
    return () => {
      active = false;
    };
  }, [publicUrl]);

  async function toggleEnabled() {
    if (!config) return;
    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const saved = await api.updateCheckInConfig(!config.enabled);
      setConfig(saved);
      setStatus(saved.enabled ? "Patient check-in is open." : "Patient check-in is closed.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update check-in.");
    } finally {
      setIsSaving(false);
    }
  }

  async function regenerate() {
    if (!window.confirm("Regenerate this QR code? Existing printed QR codes will stop working.")) return;
    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const saved = await api.regenerateCheckInConfig();
      setConfig(saved);
      setStatus("A new QR code has been generated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to regenerate QR code.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyLink() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setStatus("Check-in link copied.");
  }

  function downloadQr() {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `${(clinicSettings?.clinic_name || "clinic").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-check-in-qr.png`;
    link.click();
  }

  function printPoster() {
    if (!qrDataUrl) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setError("Allow pop-ups to print the QR poster.");
      return;
    }
    const clinicName = clinicSettings?.clinic_name || "Clinic";
    const escapedClinicName = clinicName.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[character] || character);
    printWindow.document.write(`<!doctype html><html><head><title>${escapedClinicName} check-in</title>
      <style>body{font-family:Arial,sans-serif;text-align:center;color:#172033;padding:64px}
      h1{font-size:42px;margin:0 0 12px}p{font-size:24px;margin:0 0 36px}
      img{width:420px;height:420px}small{display:block;margin-top:28px;font-size:16px;color:#526174}</style>
      </head><body><h1>${escapedClinicName}</h1><p>Scan to join today's queue</p>
      <img src="${qrDataUrl}" alt="Patient check-in QR code"><small>Please keep this page open after submitting.</small>
      <script>window.onload=()=>window.print()</script></body></html>`);
    printWindow.document.close();
  }

  if (!isAuthReady || isRedirectingToLogin) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-600">Loading QR code...</main>;
  }

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-[1600px]">
        <AppHeader
          clinicName={clinicSettings?.clinic_name || "ClinicOS"}
          currentUser={currentUser}
          onOpenSettings={() => setIsMenuOpen(true)}
          onLogout={handleLogout}
          timezone={clinicSettings?.timezone}
        />

        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">QR Code</h1>
          <p className="mt-1 text-sm text-slate-600">Patient self check-in</p>
        </div>

        {error ? <div className="mb-5 border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {status ? <div className="mb-5 border-l-4 border-emerald-400 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div> : null}

        <section className="flex flex-col items-center">
          <div className="flex aspect-square w-full max-w-[520px] items-center justify-center rounded-lg border border-[#dbe7ef] bg-white p-8">
            {qrDataUrl ? (
              <Image src={qrDataUrl} alt="Patient check-in QR code" width={420} height={420} unoptimized className="h-auto w-full max-w-[420px]" />
            ) : (
              <QrCode className="h-20 w-20 text-slate-300" />
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={copyLink} disabled={!publicUrl} title="Copy check-in link" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#edf5fa] disabled:opacity-50">
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" onClick={downloadQr} disabled={!qrDataUrl} title="Download QR code" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#edf5fa] disabled:opacity-50">
              <Download className="h-4 w-4" />
            </button>
            <button type="button" onClick={printPoster} disabled={!qrDataUrl} title="Print poster" className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#bfd7e8] bg-white text-slate-700 hover:bg-[#edf5fa] disabled:opacity-50">
              <Printer className="h-4 w-4" />
            </button>
            {canManage ? (
              <button type="button" onClick={regenerate} disabled={!config || isSaving} className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${isSaving ? "animate-spin" : ""}`} />
                Regenerate
              </button>
            ) : null}
            <label className="inline-flex h-11 items-center gap-3 rounded-xl border border-[#bfd7e8] bg-white px-3 text-sm font-medium text-slate-700">
              <span>Enable</span>
              <button
                type="button"
                role="switch"
                aria-checked={config?.enabled || false}
                disabled={!config || isSaving || !canManage}
                onClick={toggleEnabled}
                className={`relative h-7 w-12 rounded-full transition ${config?.enabled ? "bg-emerald-500" : "bg-slate-300"}`}
              >
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${config?.enabled ? "left-6" : "left-1"}`} />
              </button>
            </label>
          </div>
        </section>
      </div>
      <AppMenuDrawer open={isMenuOpen} currentUser={currentUser} onClose={() => setIsMenuOpen(false)} />
    </main>
  );
}
