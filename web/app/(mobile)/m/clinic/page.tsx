"use client";

import { useCallback } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileAdminGate } from "@/components/mobile/mobile-admin-gate";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { ClinicSettingsPanel } from "@/components/clinic-settings-panel";
import { api } from "@/lib/api";

export default function MobileClinicPage() {
  const { currentUser, clinicSettings, applyClinicSettings } = useClinicShell();
  const handleSaveClinicSettings = useCallback(async (payload: Parameters<typeof api.updateClinicSettings>[0]) => {
    const saved = await api.updateClinicSettings(payload);
    applyClinicSettings(saved);
    return saved;
  }, [applyClinicSettings]);

  return (
    <MobileAdminGate title="Clinic">
      <MobileShell title="Clinic">
        <ClinicSettingsPanel
          settings={clinicSettings}
          currentUser={currentUser}
          onSave={handleSaveClinicSettings}
          onSaved={applyClinicSettings}
        />
      </MobileShell>
    </MobileAdminGate>
  );
}
