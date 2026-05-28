"use client";

import { Fragment, useEffect, useState } from "react";
import { CalendarClock, Plus } from "lucide-react";

import { api } from "@/lib/api";
import { Appointment, FollowUp, PatientMatch } from "@/lib/types";

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
}

type AppointmentView = "appointments" | "followUps";
type AppointmentFilter = "all" | "scheduled" | "checked_in" | "cancelled";
type FollowUpFilter = "all" | "scheduled" | "completed" | "cancelled";

function getTodayIsoDate() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function toLocalIsoDate(value: string) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function SettingsDrawerAppointmentsPanel({
  onCheckInAppointment,
  onUpdateAppointment,
  onUpdateFollowUp,
}: SettingsDrawerAppointmentsPanelProps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [activeView, setActiveView] = useState<AppointmentView>("appointments");
  const [appointmentFilter, setAppointmentFilter] = useState<AppointmentFilter>("all");
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("all");
  const [appointmentQuery, setAppointmentQuery] = useState("");
  const [followUpQuery, setFollowUpQuery] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => getTodayIsoDate());
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
  const [statusMessage, setStatusMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [duplicateCheckIn, setDuplicateCheckIn] = useState<{
    appointmentId: string;
    appointmentName: string;
    matches: PatientMatch[];
  } | null>(null);
  const todayIsoDate = getTodayIsoDate();

  useEffect(() => {
    let active = true;
    const timeoutId = window.setTimeout(() => {
      setIsLoading(true);
      setLoadError("");
      const request =
        activeView === "appointments"
          ? api.listAppointments({
              status: appointmentFilter === "all" ? undefined : appointmentFilter,
              q: appointmentQuery.trim() || undefined,
              scheduled_date: selectedDate,
            }).then((rows) => {
              if (active) {
                setAppointments(
                  rows.filter((appointment) => {
                    const scheduledDate = toLocalIsoDate(appointment.scheduled_for);
                    return scheduledDate >= todayIsoDate && scheduledDate === selectedDate;
                  }),
                );
              }
            })
          : api.listFollowUps({
              status: followUpFilter === "all" ? undefined : followUpFilter,
              q: followUpQuery.trim() || undefined,
              scheduled_date: selectedDate,
            }).then((rows) => {
              if (active) {
                setFollowUps(
                  rows.filter((followUp) => {
                    const scheduledDate = toLocalIsoDate(followUp.scheduled_for);
                    return scheduledDate >= todayIsoDate && scheduledDate === selectedDate;
                  }),
                );
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
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    };
  }, [activeView, appointmentFilter, appointmentQuery, followUpFilter, followUpQuery, selectedDate, todayIsoDate]);

  function formatDateTime(value: string) {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
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
    const localDate = new Date(appointment.scheduled_for);
    const isoDate = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-");
    const isoTime = `${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}`;
    setEditingAppointmentId(appointment.id);
    setRescheduleDate(isoDate);
    setRescheduleTime(isoTime);
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
        scheduled_for: new Date(`${rescheduleDate}T${rescheduleTime}:00`).toISOString(),
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
    const localDate = new Date(followUp.scheduled_for);
    const isoDate = [
      localDate.getFullYear(),
      String(localDate.getMonth() + 1).padStart(2, "0"),
      String(localDate.getDate()).padStart(2, "0"),
    ].join("-");
    const isoTime = `${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}`;
    setEditingFollowUpId(followUp.id);
    setFollowUpDate(isoDate);
    setFollowUpTime(isoTime);
    setFollowUpNotes(followUp.notes);
    setStatusMessage("");
  }

  function toggleFollowUpActions(followUp: FollowUp) {
    if (followUp.status !== "scheduled") {
      return;
    }
    setStatusMessage("");
    setEditingFollowUpId((current) => (current === followUp.id ? "" : current));
    setExpandedFollowUpId((current) => (current === followUp.id ? "" : followUp.id));
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
        scheduled_for: new Date(`${followUpDate}T${followUpTime}:00`).toISOString(),
        notes: followUpNotes.trim(),
        status: "scheduled",
      });
      setFollowUps((current) =>
        current.map((followUp) => (followUp.id === followUpId ? updated : followUp)),
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
        current.map((followUp) => (followUp.id === followUpId ? updated : followUp)),
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

  return (
    <div className="space-y-4">
      <div className="rounded-[18px] border border-[#bfd7e8] bg-white p-5">
        <div className="mb-4 flex items-center gap-3">
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
                  onClick={() => setActiveView(view.id as AppointmentView)}
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
        </div>

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
              <input
                type="date"
                value={selectedDate}
                min={todayIsoDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
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
            <div className="mb-4 flex flex-wrap gap-2">
              <input
                value={followUpQuery}
                onChange={(event) => setFollowUpQuery(event.target.value)}
                placeholder="Search patient or follow-up notes"
                className="min-w-[260px] rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
              <input
                type="date"
                value={selectedDate}
                min={todayIsoDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
              {(["all", "scheduled", "completed", "cancelled"] as FollowUpFilter[]).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setFollowUpFilter(filter)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] transition ${
                    followUpFilter === filter
                      ? "bg-[#2f8fd3] text-white"
                      : "border border-[#bfd7e8] bg-white text-slate-600 hover:bg-[#f3f8fb]"
                  }`}
                >
                  {formatStatusLabel(filter)}
                </button>
              ))}
            </div>
            {followUps.length ? (
              <div className="overflow-hidden rounded-[22px] border border-[#bfd7e8]">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-[#f3f8fb]/80 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Patient</th>
                      <th className="px-4 py-3 text-left font-semibold">Follow-Up For</th>
                      <th className="px-4 py-3 text-left font-semibold">Notes</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white">
                    {followUps.map((followUp) => (
                      <Fragment key={followUp.id}>
                        <tr
                          role={followUp.status === "scheduled" ? "button" : undefined}
                          tabIndex={followUp.status === "scheduled" ? 0 : undefined}
                          aria-expanded={followUp.status === "scheduled" ? expandedFollowUpId === followUp.id : undefined}
                          onClick={() => toggleFollowUpActions(followUp)}
                          onKeyDown={(event) => {
                            if (followUp.status !== "scheduled") {
                              return;
                            }
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleFollowUpActions(followUp);
                            }
                          }}
                          className={`border-t border-[#dbe7ef] first:border-t-0 ${
                            followUp.status === "scheduled"
                              ? "cursor-pointer transition hover:bg-[#f3f8fb]/60 focus:outline-none focus-visible:bg-[#f3f8fb]/60"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-3 text-slate-800">
                            {followUp.patient_name || "Patient"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatDateTime(followUp.scheduled_for)}</td>
                          <td className="px-4 py-3 text-slate-600">{followUp.notes || "No notes"}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-xl border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${statusChipClasses(followUp.status)}`}>
                              {formatStatusLabel(followUp.status)}
                            </span>
                          </td>
                        </tr>
                        {expandedFollowUpId === followUp.id && followUp.status === "scheduled" ? (
                          <tr className="border-t border-[#dbe7ef] bg-[#f3f8fb]/40">
                            <td colSpan={4} className="px-4 py-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    startFollowUpEdit(followUp);
                                  }}
                                  disabled={savingAppointmentId === followUp.id}
                                  className="rounded-xl border border-[#bfd7e8] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-[#f3f8fb] disabled:opacity-60"
                                >
                                  Reschedule
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleUpdateFollowUpStatus(followUp.id, "completed");
                                  }}
                                  disabled={savingAppointmentId === followUp.id}
                                  className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-60"
                                >
                                  Complete
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleUpdateFollowUpStatus(followUp.id, "cancelled");
                                  }}
                                  disabled={savingAppointmentId === followUp.id}
                                  className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                        {editingFollowUpId === followUp.id && followUp.status === "scheduled" ? (
                          <tr className="border-t border-[#dbe7ef] bg-[#f3f8fb]/40">
                            <td colSpan={4} className="px-4 py-4">
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
                No follow-ups matched this view.
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
