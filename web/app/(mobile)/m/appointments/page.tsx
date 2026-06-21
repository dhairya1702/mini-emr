"use client";

import { SettingsDrawerAppointmentsPanel } from "@/components/settings-drawer-appointments-panel";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { api } from "@/lib/api";

export default function MobileAppointmentsPage() {
  async function handleCheckInAppointment(
    appointmentId: string,
    options?: { existingPatientId?: string; forceNew?: boolean },
  ) {
    const checkedInPatient = options?.existingPatientId
      ? await api.checkInAppointmentWithPatient(appointmentId, options.existingPatientId)
      : await api.checkInAppointment(appointmentId, { force_new: options?.forceNew });
    return {
      id: appointmentId,
      checked_in_at: new Date().toISOString(),
      checked_in_patient_id: checkedInPatient.id,
    };
  }

  return (
    <MobileShell title="Appointments">
      <SettingsDrawerAppointmentsPanel
        onCheckInAppointment={handleCheckInAppointment}
        onUpdateAppointment={(appointmentId, payload) => api.updateAppointment(appointmentId, payload)}
        onUpdateFollowUp={(followUpId, payload) => api.updateFollowUp(followUpId, payload)}
        onCreateAppointment={(payload) => api.createAppointment(payload)}
        onCreateFollowUp={(patientId, payload) => api.createFollowUp(patientId, payload)}
      />
    </MobileShell>
  );
}
