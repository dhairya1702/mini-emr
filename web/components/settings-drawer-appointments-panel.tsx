"use client";

import { Fragment, useEffect, useState } from "react";
import { AlertCircle, CalendarClock, Mail, MessageCircle, Plus } from "lucide-react";

import { api } from "@/lib/api";
import {
  formatDateTimeInTimeZone,
  formatIsoDateInTimeZone,
  getTodayIsoDateInTimeZone,
  toDateTimeInputInTimeZone,
  zonedDateTimeInputToUtcIso,
} from "@/lib/timezone";
import { Appointment, FollowUp, Patient, PatientMatch } from "@/lib/types";

interface SettingsDrawerAppointmentsPanelProps {
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
  onCreateAppointment?: (payload: {
    name: string;
    phone: string;
    email: string;
    address: string;
    reason: string;
    date_of_birth: null;
    age: null;
    weight: null;
    height: null;
    temperature: null;
    scheduled_for: string;
  }) => Promise<Appointment>;
  onCreateFollowUp?: (patientId: string, payload: { scheduled_for: string; notes: string }) => Promise<FollowUp>;
  createSignal?: number;
  onActiveViewChange?: (view: AppointmentView) => void;
  clinicTimezone?: string;
}

type AppointmentView = "appointments" | "followUps";
type AppointmentFilter = "all" | "scheduled" | "checked_in" | "cancelled";
type FollowUpFilter = "needs_action" | "delivery_issues" | "history";

export function SettingsDrawerAppointmentsPanel({
  onCheckInAppointment,
  onUpdateAppointment,
  onUpdateFollowUp,
  onCreateAppointment,
  onCreateFollowUp,
  createSignal = 0,
  onActiveViewChange,
  clinicTimezone = "UTC",
}: SettingsDrawerAppointmentsPanelProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [activeView, setActiveView] = useState<AppointmentView>("appointments");
  const [appointmentFilter, setAppointmentFilter] = useState<AppointmentFilter>("all");
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("needs_action");
  const [appointmentQuery, setAppointmentQuery] = useState("");
  const [followUpQuery, setFollowUpQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [checkingInId, setCheckingInId] = useState("");
  const [expandedAppointmentId, setExpandedAppointmentId] = useState("");
  const [expandedFollowUpId, setExpandedFollowUpId] = useState("");
  const [editingAppointmentId, setEditingAppointmentId] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [editingFollowUpId, setEditingFollowUpId] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [savingAppointmentId, setSavingAppointmentId] = useState("");
  const [remindingFollowUpId, setRemindingFollowUpId] = useState("");
  const [reminderChannels, setReminderChannels] = useState<Array<"email" | "whatsapp">>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newAppointment, setNewAppointment] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
      reason: "",
      date: getTodayIsoDateInTimeZone(clinicTimezone),
      time: "09:00",
    });
  const [newFollowUp, setNewFollowUp] = useState({
    patientId: "",
    date: getTodayIsoDateInTimeZone(clinicTimezone),
    time: "09:00",
    notes: "",
  });
  const [statusMessage, setStatusMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [duplicateCheckIn, setDuplicateCheckIn] = useState<{
    appointmentId: string;
    appointmentName: string;
    matches: PatientMatch[];
  } | null>(null);
  const todayIsoDate = getTodayIsoDateInTimeZone(clinicTimezone);

  function setView(view: AppointmentView) {
    setActiveView(view);
    onActiveViewChange?.(view);
  }

  useEffect(() => {
    onActiveViewChange?.(activeView);
  }, [activeView, onActiveViewChange]);

  useEffect(() => {
    setNewAppointment((current) => ({ ...current, date: todayIsoDate }));
    setNewFollowUp((current) => ({ ...current, date: todayIsoDate }));
  }, [todayIsoDate]);

  useEffect(() => {
    if (!createSignal) {
      return;
    }
    setIsCreateOpen(true);
    setStatusMessage("");
  }, [createSignal]);

  useEffect(() => {
    if (!isCreateOpen || activeView !== "followUps" || patients.length) {
      return;
    }
    let active = true;
    void api.listPatients({ limit: 500 })
      .then((rows) => {
        if (!active) {
          return;
        }
        setPatients(rows);
        setNewFollowUp((current) => ({
          ...current,
          patientId: current.patientId || rows[0]?.id || "",
        }));
      })
      .catch((error) => {
        if (active) {
          setStatusMessage(error instanceof Error ? error.message : "Failed to load patients for follow-up.");
        }
      });
    return () => {
      active = false;
    };
  }, [activeView, isCreateOpen, patients.length]);

  useEffect(() => {
    let active = true;
    const activeQuery = activeView === "appointments" ? appointmentQuery : followUpQuery;
    const requestDelayMs = activeQuery.trim() ? 250 : 0;
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      setLoadError("");
      const request =
        activeView === "appointments"
          ? api.listAppointments({
              status: appointmentFilter === "all" ? undefined : appointmentFilter,
              q: appointmentQuery.trim() || undefined,
              scheduled_date: selectedDate || undefined,
              upcoming: selectedDate ? undefined : true,
            }).then((rows) => {
              if (active) {
                setAppointments(
                  rows.filter((appointment) => {
                    const scheduledDate = formatIsoDateInTimeZone(appointment.scheduled_for, clinicTimezone);
                    return selectedDate
                      ? scheduledDate === selectedDate
                      : scheduledDate >= todayIsoDate;
                  }),
                );
              }
            })
          : api.listFollowUps({
              q: followUpQuery.trim() || undefined,
            }).then((rows) => {
              if (active) {
                setFollowUps(rows);
              }
            });

      void request
        .catch((error) => {
          if (active) {
            setLoadError(error instanceof Error ? error.message : "Failed to load schedule data.");
          }
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, requestDelayMs);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    };
  }, [activeView, appointmentFilter, appointmentQuery, clinicTimezone, followUpFilter, followUpQuery, selectedDate, todayIsoDate]);

  function formatDateTime(value: string) {
    return formatDateTimeInTimeZone(value, clinicTimezone);
  }

  function formatStatusLabel(value: string) {
    return value.replace("_", " ");
  }

  function statusChipClasses(status: string) {
    if (status === "scheduled") return "border-[#bfd7e8] bg-[#f3f8fb] text-[#2a6fa8]";
    if (status === "checked_in" || status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    return "border-slate-200 bg-slate-50 text-slate-600";
  }

  async function handleCheckIn(
    appointmentId: string,
    options?: { existingPatientId?: string; forceNew?: boolean },
  ) {
    setCheckingInId(appointmentId);
    setStatusMessage("");
    try {
      const updated = await onCheckInAppointment(appointmentId, options);
      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                status: "checked_in",
                checked_in_at: updated.checked_in_at,
                checked_in_patient_id: updated.checked_in_patient_id,
              }
            : appointment,
        ),
      );
      setDuplicateCheckIn(null);
      setStatusMessage("Appointment added to the waiting queue.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to move appointment to the queue.",
      );
    } finally {
      setCheckingInId("");
    }
  }

  async function handleStartCheckIn(appointment: Appointment) {
    setStatusMessage("");
    setDuplicateCheckIn(null);
    setCheckingInId(appointment.id);
    try {
      const matches = await api.previewAppointmentCheckIn(appointment.id);
      if (matches.length) {
        setDuplicateCheckIn({
          appointmentId: appointment.id,
          appointmentName: appointment.name,
          matches,
        });
        setStatusMessage("Possible active duplicate found. Choose the correct queue patient or create a new one.");
        return;
      }
      await handleCheckIn(appointment.id);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to check the queue before check-in.",
      );
    } finally {
      setCheckingInId("");
    }
  }

  function startReschedule(appointment: Appointment) {
    const localDateTime = toDateTimeInputInTimeZone(appointment.scheduled_for, clinicTimezone);
    const [isoDate, isoTime] = localDateTime.split("T");
    setEditingAppointmentId(appointment.id);
    setRescheduleDate(isoDate || "");
    setRescheduleTime(isoTime || "");
    setStatusMessage("");
  }

  function toggleAppointmentActions(appointment: Appointment) {
    if (appointment.status !== "scheduled") {
      return;
    }
    setStatusMessage("");
    setEditingAppointmentId((current) => (current === appointment.id ? "" : current));
    setExpandedAppointmentId((current) => (current === appointment.id ? "" : appointment.id));
  }

  async function handleSaveReschedule(appointmentId: string) {
    if (!rescheduleDate || !rescheduleTime) {
      setStatusMessage("Choose a date and time to reschedule.");
      return;
    }
    setSavingAppointmentId(appointmentId);
    setStatusMessage("");
    try {
      const updated = await onUpdateAppointment(appointmentId, {
        scheduled_for: zonedDateTimeInputToUtcIso(`${rescheduleDate}T${rescheduleTime}`, clinicTimezone),
      });
      setAppointments((current) =>
        current.map((appointment) => (appointment.id === appointmentId ? updated : appointment)),
      );
      setEditingAppointmentId("");
      setExpandedAppointmentId("");
      setStatusMessage("Appointment rescheduled.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to reschedule appointment.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  function startFollowUpEdit(followUp: FollowUp) {
    const localDateTime = toDateTimeInputInTimeZone(followUp.scheduled_for, clinicTimezone);
    const [isoDate, isoTime] = localDateTime.split("T");
    setEditingFollowUpId(followUp.id);
    setFollowUpDate(isoDate || "");
    setFollowUpTime(isoTime || "");
    setFollowUpNotes(followUp.notes);
    setStatusMessage("");
  }

  function toggleFollowUpActions(followUp: FollowUp) {
    setStatusMessage("");
    setEditingFollowUpId((current) => (current === followUp.id ? "" : current));
    setExpandedFollowUpId((current) => (current === followUp.id ? "" : followUp.id));
    setReminderChannels([
      ...(followUp.patient_email ? ["email" as const] : []),
      ...(followUp.patient_phone ? ["whatsapp" as const] : []),
    ]);
  }

  async function handleRemindPatient(followUp: FollowUp) {
    if (!reminderChannels.length) {
      setStatusMessage("This patient has no available email or WhatsApp contact.");
      return;
    }
    setRemindingFollowUpId(followUp.id);
    setStatusMessage("");
    try {
      const result = await api.remindFollowUp(followUp.id, reminderChannels, crypto.randomUUID());
      setFollowUps((current) => current.map((item) => item.id === followUp.id ? {
        ...item,
        last_contacted_at: result.sent_at,
        last_contact_channels: reminderChannels,
        last_delivery_status: result.delivery_status,
        last_delivery_error: Object.values(result.errors).join("; ") || null,
        reminder_count: (item.reminder_count || 0) + 1,
      } : item));
      setStatusMessage(
        result.delivery_status === "sent"
          ? "Reminder sent."
          : result.delivery_status === "partial"
            ? "Reminder sent through one channel; another channel failed."
            : "The reminder could not be delivered.",
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to remind the patient.");
    } finally {
      setRemindingFollowUpId("");
    }
  }

  async function handleSaveFollowUp(followUpId: string) {
    if (!followUpDate || !followUpTime) {
      setStatusMessage("Choose a date and time for the follow-up.");
      return;
    }
    setSavingAppointmentId(followUpId);
    setStatusMessage("");
    try {
      const updated = await onUpdateFollowUp(followUpId, {
        scheduled_for: zonedDateTimeInputToUtcIso(`${followUpDate}T${followUpTime}`, clinicTimezone),
        notes: followUpNotes.trim(),
        status: "scheduled",
      });
      setFollowUps((current) =>
        current.map((followUp) => (followUp.id === followUpId ? { ...followUp, ...updated } : followUp)),
      );
      setEditingFollowUpId("");
      setExpandedFollowUpId("");
      setStatusMessage("Follow-up updated.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update follow-up.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  async function handleUpdateFollowUpStatus(
    followUpId: string,
    status: "scheduled" | "completed" | "cancelled",
  ) {
    setSavingAppointmentId(followUpId);
    setStatusMessage("");
    try {
      const updated = await onUpdateFollowUp(followUpId, { status });
      setFollowUps((current) =>
        current.map((followUp) => (followUp.id === followUpId ? { ...followUp, ...updated } : followUp)),
      );
      if (editingFollowUpId === followUpId) {
        setEditingFollowUpId("");
      }
      if (expandedFollowUpId === followUpId) {
        setExpandedFollowUpId("");
      }
      setStatusMessage(
        status === "completed"
          ? "Follow-up marked completed."
          : status === "cancelled"
            ? "Follow-up cancelled."
            : "Follow-up updated.",
      );
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to update follow-up.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  async function handleCancelAppointment(appointmentId: string) {
    setSavingAppointmentId(appointmentId);
    setStatusMessage("");
    try {
      const updated = await onUpdateAppointment(appointmentId, { status: "cancelled" });
      setAppointments((current) =>
        current.map((appointment) => (appointment.id === appointmentId ? updated : appointment)),
      );
      if (editingAppointmentId === appointmentId) {
        setEditingAppointmentId("");
      }
      if (expandedAppointmentId === appointmentId) {
        setExpandedAppointmentId("");
      }
      setStatusMessage("Appointment cancelled.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to cancel appointment.");
    } finally {
      setSavingAppointmentId("");
    }
  }

  async function handleCreateAppointment() {
    if (!onCreateAppointment) {
      setStatusMessage("Appointment creation is not available here.");
      return;
    }
    if (!newAppointment.name.trim() || !newAppointment.phone.trim() || !newAppointment.reason.trim()) {
      setStatusMessage("Enter patient name, phone, and reason.");
      return;
    }
    if (!newAppointment.date || !newAppointment.time) {
      setStatusMessage("Choose appointment date and time.");
      return;
    }
    setIsCreating(true);
    setStatusMessage("");
    try {
      const created = await onCreateAppointment({
        name: newAppointment.name.trim(),
        phone: newAppointment.phone.trim(),
        email: newAppointment.email.trim(),
        address: newAppointment.address.trim(),
        reason: newAppointment.reason.trim(),
        date_of_birth: null,
        age: null,
        weight: null,
        height: null,
        temperature: null,
        scheduled_for: zonedDateTimeInputToUtcIso(`${newAppointment.date}T${newAppointment.time}`, clinicTimezone),
      });
      setAppointments((current) => [created, ...current]);
      setSelectedDate(newAppointment.date);
      setAppointmentFilter("all");
      setIsCreateOpen(false);
      setNewAppointment({
        name: "",
        phone: "",
        email: "",
        address: "",
        reason: "",
        date: newAppointment.date,
        time: newAppointment.time,
      });
      setStatusMessage("Appointment added.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to add appointment.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCreateFollowUp() {
    if (!onCreateFollowUp) {
      setStatusMessage("Follow-up creation is not available here.");
      return;
    }
    if (!newFollowUp.patientId) {
      setStatusMessage("Choose a patient.");
      return;
    }
    if (!newFollowUp.date || !newFollowUp.time) {
      setStatusMessage("Choose follow-up date and time.");
      return;
    }
    setIsCreating(true);
    setStatusMessage("");
    try {
      const created = await onCreateFollowUp(newFollowUp.patientId, {
        scheduled_for: zonedDateTimeInputToUtcIso(`${newFollowUp.date}T${newFollowUp.time}`, clinicTimezone),
        notes: newFollowUp.notes.trim(),
      });
      setFollowUps((current) => [created, ...current]);
      setFollowUpFilter("needs_action");
      setIsCreateOpen(false);
      setNewFollowUp((current) => ({
        patientId: current.patientId,
        date: current.date,
        time: current.time,
        notes: "",
      }));
      setStatusMessage("Follow-up added.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to add follow-up.");
    } finally {
      setIsCreating(false);
    }
  }

  const isBookedFollowUp = (followUp: FollowUp) =>
    Boolean(followUp.appointment_id && followUp.appointment_status !== "cancelled");
  const needsActionFollowUps = followUps.filter(
    (followUp) => followUp.status === "scheduled" && !isBookedFollowUp(followUp) && followUp.last_delivery_status !== "failed",
  );
  const deliveryIssueFollowUps = followUps.filter(
    (followUp) => followUp.status === "scheduled" && !isBookedFollowUp(followUp) && ["failed", "partial"].includes(followUp.last_delivery_status || ""),
  );
  const historyFollowUps = followUps.filter(
    (followUp) => followUp.status !== "scheduled" || isBookedFollowUp(followUp),
  );
  const visibleFollowUps = followUpFilter === "needs_action"
    ? needsActionFollowUps
    : followUpFilter === "delivery_issues"
      ? deliveryIssueFollowUps
      : historyFollowUps;

  function waitingLabel(followUp: FollowUp) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(followUp.created_at).getTime()) / 86_400_000));
    return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`;
  }

  function followUpStateLabel(followUp: FollowUp) {
    if (isBookedFollowUp(followUp)) return "Booked";
    if (followUp.status === "completed") return "Resolved";
    if (followUp.status === "cancelled") return "Cancelled";
    if (followUp.last_delivery_status === "failed") return "Delivery failed";
    if (followUp.last_delivery_status === "partial") return "Partially delivered";
    return "Awaiting patient";
  }

  function reminderAvailableAt(followUp: FollowUp) {
    if (!followUp.last_contacted_at) return null;
    return new Date(new Date(followUp.last_contacted_at).getTime() + 24 * 60 * 60 * 1000);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-[#bfd7e8] bg-white p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <CalendarClock className="h-5 w-5 shrink-0 text-[#2a6fa8]" />
          <div className="inline-flex rounded-xl border border-[#bfd7e8] bg-[#f3f8fb] p-1">
            {[
              { id: "appointments", label: "Appointments" },
              { id: "followUps", label: "Follow Ups" },
            ].map((view) => {
              const isActive = activeView === view.id;

              return (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setView(view.id as AppointmentView)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-white text-[#2a6fa8] shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {view.label}
                </button>
              );
            })}
          </div>
          {onCreateAppointment || onCreateFollowUp ? (
            <button
              type="button"
              onClick={() => {
                setIsCreateOpen(true);
                setStatusMessage("");
              }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf5fa] text-[#2a6fa8] transition hover:bg-[#dbeaf4]"
              aria-label={activeView === "appointments" ? "Add appointment" : "Add follow-up"}
              title={activeView === "appointments" ? "Add appointment" : "Add follow-up"}
            >
              <Plus className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        {isCreateOpen ? (
          <div className="mb-4 rounded-[16px] border border-[#bfd7e8] bg-[#f3f8fb]/50 px-4 py-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">
                Add {activeView === "appointments" ? "appointment" : "follow-up"}
              </p>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-medium text-slate-600"
              >
                Close
              </button>
            </div>
            {activeView === "appointments" ? (
              <div className="grid gap-3">
                <input value={newAppointment.name} onChange={(event) => setNewAppointment((current) => ({ ...current, name: event.target.value }))} placeholder="Patient name" className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                <input value={newAppointment.phone} onChange={(event) => setNewAppointment((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone" className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                <input value={newAppointment.reason} onChange={(event) => setNewAppointment((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason" className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input type="date" min={todayIsoDate} value={newAppointment.date} onChange={(event) => setNewAppointment((current) => ({ ...current, date: event.target.value }))} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                  <input type="time" value={newAppointment.time} onChange={(event) => setNewAppointment((current) => ({ ...current, time: event.target.value }))} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                </div>
                <button type="button" disabled={isCreating} onClick={() => void handleCreateAppointment()} className="rounded-xl bg-[#2f8fd3] px-4 py-3 text-sm font-medium text-white disabled:opacity-60">
                  {isCreating ? "Adding..." : "Add appointment"}
                </button>
              </div>
            ) : (
              <div className="grid gap-3">
                <select value={newFollowUp.patientId} onChange={(event) => setNewFollowUp((current) => ({ ...current, patientId: event.target.value }))} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none">
                  {patients.length ? null : <option value="">No patients found</option>}
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone || "No phone"}</option>
                  ))}
                </select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <input type="date" min={todayIsoDate} value={newFollowUp.date} onChange={(event) => setNewFollowUp((current) => ({ ...current, date: event.target.value }))} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                  <input type="time" value={newFollowUp.time} onChange={(event) => setNewFollowUp((current) => ({ ...current, time: event.target.value }))} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                </div>
                <input value={newFollowUp.notes} onChange={(event) => setNewFollowUp((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm outline-none" />
                <button type="button" disabled={isCreating || !patients.length} onClick={() => void handleCreateFollowUp()} className="rounded-xl bg-[#2f8fd3] px-4 py-3 text-sm font-medium text-white disabled:opacity-60">
                  {isCreating ? "Adding..." : "Add follow-up"}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {loadError ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {loadError}
          </div>
        ) : null}

        {duplicateCheckIn ? (
          <div className="mb-4 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Active patient match found for {duplicateCheckIn.appointmentName}
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  Reuse an existing queue patient if this is the same visit, or create a new queue entry if it is a separate visit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDuplicateCheckIn(null)}
                className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
              >
                Dismiss
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {duplicateCheckIn.matches.map((match) => (
                <div key={match.id} className="rounded-[20px] border border-amber-200 bg-white px-4 py-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{match.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {match.phone} · {formatStatusLabel(match.status)} · {new Date(match.created_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">{match.reason}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCheckIn(duplicateCheckIn.appointmentId, { existingPatientId: match.id })}
                      disabled={checkingInId === duplicateCheckIn.appointmentId}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-60"
                    >
                      Use Existing Patient
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => handleCheckIn(duplicateCheckIn.appointmentId, { forceNew: true })}
                disabled={checkingInId === duplicateCheckIn.appointmentId}
                className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-60"
              >
                Create New Queue Entry Anyway
              </button>
            </div>
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-[16px] border border-dashed border-[#9fc7e1] bg-[#f3f8fb]/30 px-6 py-16 text-center text-sm text-slate-500">
            Loading {activeView === "appointments" ? "appointments" : "follow-ups"}...
          </div>
        ) : activeView === "appointments" ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={appointmentQuery}
                onChange={(event) => setAppointmentQuery(event.target.value)}
                placeholder="Search patient, phone, or reason"
                className="min-w-[260px] rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
              {(["all", "scheduled", "checked_in", "cancelled"] as AppointmentFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setAppointmentFilter(filter)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] transition ${
                    appointmentFilter === filter
                      ? "bg-[#2f8fd3] text-white"
                      : "border border-[#bfd7e8] bg-white text-slate-600 hover:bg-[#f3f8fb]"
                  }`}
                >
                  {formatStatusLabel(filter)}
                </button>
              ))}
              <input
                type="date"
                aria-label="Filter appointments by date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
              {selectedDate ? (
                <button
                  type="button"
                  onClick={() => setSelectedDate("")}
                  className="rounded-xl border border-[#bfd7e8] bg-white px-3 py-2.5 text-xs font-medium text-[#2a6fa8] transition hover:bg-[#f3f8fb]"
                >
                  Show all upcoming
                </button>
              ) : (
                <span className="inline-flex items-center rounded-xl bg-[#edf5fa] px-3 py-2.5 text-xs font-medium text-[#2a6fa8]">
                  All upcoming
                </span>
              )}
            </div>
            {appointments.length ? (
              <div className="overflow-hidden rounded-[22px] border border-[#bfd7e8]">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-[#f3f8fb]/80 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Patient</th>
                      <th className="px-4 py-3 text-left font-semibold">Appointment For</th>
                      <th className="px-4 py-3 text-left font-semibold">Reason</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {appointments.map((appointment) => (
                      <Fragment key={appointment.id}>
                        <tr
                          role={appointment.status === "scheduled" ? "button" : undefined}
                          tabIndex={appointment.status === "scheduled" ? 0 : undefined}
                          aria-expanded={appointment.status === "scheduled" ? expandedAppointmentId === appointment.id : undefined}
                          onClick={() => toggleAppointmentActions(appointment)}
                          onKeyDown={(event) => {
                            if (appointment.status !== "scheduled") {
                              return;
                            }
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleAppointmentActions(appointment);
                            }
                          }}
                          className={`border-t border-[#dbe7ef] first:border-t-0 ${
                            appointment.status === "scheduled"
                              ? "cursor-pointer transition hover:bg-[#f3f8fb]/60 focus:outline-none focus-visible:bg-[#f3f8fb]/60"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-slate-800">
                            <div className="font-medium">{appointment.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{appointment.phone}</div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatDateTime(appointment.scheduled_for)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{appointment.reason}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-xl border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${statusChipClasses(appointment.status)}`}>
                              {formatStatusLabel(appointment.status)}
                            </span>
                          </td>
                        </tr>
                        {expandedAppointmentId === appointment.id && appointment.status === "scheduled" ? (
                          <tr className="border-t border-[#dbe7ef] bg-[#f3f8fb]/40">
                            <td colSpan={4} className="px-4 py-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleStartCheckIn(appointment);
                                  }}
                                  disabled={checkingInId === appointment.id || savingAppointmentId === appointment.id}
                                  className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-[#2a6fa8] transition hover:bg-[#dbeaf4] disabled:opacity-60"
                                >
                                  <Plus className="h-4 w-4" />
                                  Move to Queue
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startReschedule(appointment);
                                  }}
                                  disabled={savingAppointmentId === appointment.id}
                                  className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                                >
                                  Reschedule
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleCancelAppointment(appointment.id);
                                  }}
                                  disabled={savingAppointmentId === appointment.id}
                                  className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {editingAppointmentId === appointment.id && appointment.status === "scheduled" ? (
                          <tr className="border-t border-[#dbe7ef] bg-[#f3f8fb]/40">
                            <td colSpan={4} className="px-4 py-4">
                              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Date</span>
                                  <input
                                    type="date"
                                    value={rescheduleDate}
                                    onChange={(event) => setRescheduleDate(event.target.value)}
                                    className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Time</span>
                                  <input
                                    type="time"
                                    value={rescheduleTime}
                                    onChange={(event) => setRescheduleTime(event.target.value)}
                                    className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveReschedule(appointment.id)}
                                    disabled={savingAppointmentId === appointment.id}
                                    className="rounded-xl bg-[#2f8fd3] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                                  >
                                    {savingAppointmentId === appointment.id ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingAppointmentId("")}
                                    disabled={savingAppointmentId === appointment.id}
                                    className="rounded-xl border border-[#bfd7e8] px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-60"
                                  >
                                    Hide
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[#9fc7e1] bg-[#f3f8fb]/30 px-6 py-16 text-center text-sm text-slate-500">
                No appointments matched this view.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <input
                value={followUpQuery}
                onChange={(event) => setFollowUpQuery(event.target.value)}
                placeholder="Search patient or reason"
                className="min-w-[260px] rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
              {([
                { id: "needs_action", label: "Needs Action", count: needsActionFollowUps.length },
                { id: "delivery_issues", label: "Delivery Issues", count: deliveryIssueFollowUps.length },
                { id: "history", label: "History", count: historyFollowUps.length },
              ] as Array<{ id: FollowUpFilter; label: string; count: number }>).map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setFollowUpFilter(filter.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] transition ${
                    followUpFilter === filter.id
                      ? "bg-[#2f8fd3] text-white"
                      : "border border-[#bfd7e8] bg-white text-slate-600 hover:bg-[#f3f8fb]"
                  }`}
                >
                  {filter.label} <span className="ml-1 opacity-75">{filter.count}</span>
                </button>
              ))}
            </div>
            {visibleFollowUps.length ? (
              <div className="overflow-hidden rounded-[22px] border border-[#bfd7e8]">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-[#f3f8fb]/80 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Patient</th>
                      <th className="px-4 py-3 text-left font-semibold">Due</th>
                      <th className="px-4 py-3 text-left font-semibold">Waiting</th>
                      <th className="px-4 py-3 text-left font-semibold">Last Contact</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {visibleFollowUps.map((followUp) => (
                      <Fragment key={followUp.id}>
                        <tr
                          role="button"
                          tabIndex={0}
                          aria-expanded={expandedFollowUpId === followUp.id}
                          onClick={() => toggleFollowUpActions(followUp)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleFollowUpActions(followUp);
                            }
                          }}
                          className="cursor-pointer border-t border-[#dbe7ef] first:border-t-0 transition hover:bg-[#f3f8fb]/60 focus:outline-none focus-visible:bg-[#f3f8fb]/60"
                        >
                          <td className="px-4 py-3 text-slate-800">
                            <p className="font-medium">{followUp.patient_name || "Patient"}</p>
                            <p className="mt-1 max-w-[280px] truncate text-xs text-slate-500">{followUp.notes || "Follow-up"}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatDateTime(followUp.scheduled_for)}</td>
                          <td className="px-4 py-3 text-slate-600">{waitingLabel(followUp)}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {followUp.last_contacted_at ? formatDateTime(followUp.last_contacted_at) : "Not delivered"}
                            {followUp.last_contact_channels?.length ? <p className="mt-1 text-xs capitalize text-slate-400">{followUp.last_contact_channels.join(" + ")}</p> : null}
                          </td>
                        </tr>
                        {expandedFollowUpId === followUp.id ? (
                          <tr className="border-t border-[#dbe7ef] bg-[#f3f8fb]/40">
                            <td colSpan={4} className="px-4 py-4">
                              {followUp.status === "scheduled" ? <div className="space-y-4">
                                <div className="space-y-3 rounded-xl border border-[#dbe7ef] bg-white p-4">
                                  <div className="flex items-center gap-10 text-sm text-slate-700">
                                    <p><span className="font-medium text-slate-950">Email:</span> {followUp.patient_email || "Not available"}</p>
                                    <p><span className="font-medium text-slate-950">Phone:</span> {followUp.patient_phone || "Not available"}</p>
                                  </div>
                                  {followUp.last_delivery_error ? <p className="text-sm text-rose-700"><AlertCircle className="mr-1 inline h-4 w-4" />{followUp.last_delivery_error}</p> : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                  {followUp.patient_email ? <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={reminderChannels.includes("email")} onChange={() => setReminderChannels((current) => current.includes("email") ? current.filter((channel) => channel !== "email") : [...current, "email"])} /><Mail className="h-4 w-4" />Email</label> : null}
                                  {followUp.patient_phone ? <label className="inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={reminderChannels.includes("whatsapp")} onChange={() => setReminderChannels((current) => current.includes("whatsapp") ? current.filter((channel) => channel !== "whatsapp") : [...current, "whatsapp"])} /><MessageCircle className="h-4 w-4" />WhatsApp</label> : null}
                                  <button type="button" onClick={() => void handleRemindPatient(followUp)} disabled={remindingFollowUpId === followUp.id || !reminderChannels.length || Boolean(reminderAvailableAt(followUp) && reminderAvailableAt(followUp)! > new Date())} className="rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
                                    {remindingFollowUpId === followUp.id ? "Sending..." : "Remind Patient"}
                                  </button>
                                  {reminderAvailableAt(followUp) && reminderAvailableAt(followUp)! > new Date() ? <span className="text-xs text-slate-500">Available after {formatDateTime(reminderAvailableAt(followUp)!.toISOString())}</span> : null}
                                  <button type="button" onClick={() => startFollowUpEdit(followUp)} className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700">Change due date</button>
                                  <button type="button" onClick={() => void handleUpdateFollowUpStatus(followUp.id, "completed")} className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700">Mark resolved</button>
                                  <button type="button" onClick={() => void handleUpdateFollowUpStatus(followUp.id, "cancelled")} className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700">Cancel</button>
                                </div>
                              </div> : <div className="text-sm text-slate-600">
                                {isBookedFollowUp(followUp) && followUp.appointment_scheduled_for ? <>Appointment booked for <strong>{formatDateTime(followUp.appointment_scheduled_for)}</strong>. It is now managed in Appointments.</> : <>This follow-up is in history as {followUpStateLabel(followUp).toLowerCase()}.</>}
                              </div>}
                              {editingFollowUpId === followUp.id && followUp.status === "scheduled" ?
                              <div className="grid gap-3 md:grid-cols-[220px_180px_1fr_auto] md:items-end">
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Date</span>
                                  <input
                                    type="date"
                                    value={followUpDate}
                                    onChange={(event) => setFollowUpDate(event.target.value)}
                                    className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">New Time</span>
                                  <input
                                    type="time"
                                    value={followUpTime}
                                    onChange={(event) => setFollowUpTime(event.target.value)}
                                    className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Notes</span>
                                  <input
                                    value={followUpNotes}
                                    onChange={(event) => setFollowUpNotes(event.target.value)}
                                    className="w-full rounded-xl border border-[#bfd7e8] bg-white px-4 py-3 text-sm text-slate-800 outline-none"
                                  />
                                </label>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleSaveFollowUp(followUp.id)}
                                    disabled={savingAppointmentId === followUp.id}
                                    className="rounded-xl bg-[#2f8fd3] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
                                  >
                                    {savingAppointmentId === followUp.id ? "Saving..." : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingFollowUpId("")}
                                    disabled={savingAppointmentId === followUp.id}
                                    className="rounded-xl border border-[#bfd7e8] px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white disabled:opacity-60"
                                  >
                                    Hide
                                  </button>
                                </div>
                              </div> : null}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-[16px] border border-dashed border-[#9fc7e1] bg-[#f3f8fb]/30 px-6 py-16 text-center text-sm text-slate-500">
                {followUpFilter === "needs_action" ? "No patients are waiting to schedule a follow-up." : followUpFilter === "delivery_issues" ? "No follow-up delivery issues." : "No follow-up history yet."}
              </div>
            )}
          </>
        )}

        {statusMessage ? (
          <p className="mt-4 text-sm font-medium text-slate-700">{statusMessage}</p>
        ) : null}
      </div>
    </div>
  );
}
