"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Clock3, UserRound, X } from "lucide-react";

import { Patient, PatientTimelineEvent } from "@/lib/types";

interface PatientDetailsDrawerProps {
  patient: Patient | null;
  onClose: () => void;
  onLoadTimeline: (patientId: string) => Promise<PatientTimelineEvent[]>;
  onSave: (payloadPatientId: string, payload: {
    name: string;
    phone: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) => Promise<void>;
}

export function PatientDetailsDrawer({
  patient,
  onClose,
  onLoadTimeline,
  onSave,
}: PatientDetailsDrawerProps) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    reason: "",
    age: "",
    weight: "",
    height: "",
    temperature: "",
  });
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [timeline, setTimeline] = useState<PatientTimelineEvent[]>([]);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [selectedVisitEventId, setSelectedVisitEventId] = useState("");

  useEffect(() => {
    if (!patient) {
      return;
    }

    setForm({
      name: patient.name,
      phone: patient.phone,
      reason: patient.reason,
      age: patient.age?.toString() ?? "",
      weight: patient.weight?.toString() ?? "",
      height: patient.height?.toString() ?? "",
      temperature: patient.temperature?.toString() ?? "",
    });
    setError("");
  }, [patient]);

  useEffect(() => {
    if (!patient) {
      setTimeline([]);
      setTimelineError("");
      setIsTimelineLoading(false);
      setSelectedVisitEventId("");
      return;
    }

    const currentPatient = patient;
    let active = true;

    async function loadChartData() {
      setIsTimelineLoading(true);
      setTimelineError("");
      try {
        const events = await onLoadTimeline(currentPatient.id);
        if (!active) {
          return;
        }
        setTimeline(events);
        const firstVisitEvent = events.find((event) => event.type === "visit_recorded");
        setSelectedVisitEventId(firstVisitEvent?.id ?? "");
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTimeline([]);
        setTimelineError(loadError instanceof Error ? loadError.message : "Failed to load timeline.");
        setSelectedVisitEventId("");
      } finally {
        if (active) {
          setIsTimelineLoading(false);
        }
      }
    }

    void loadChartData();
    return () => {
      active = false;
    };
  }, [onLoadTimeline, patient]);

  const currentPatient = patient;

  function formatStatusLabel(value: string) {
    return value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function formatDateTime(value: string) {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function getEventTitle(event: PatientTimelineEvent) {
    if (event.type === "visit_recorded" && event.title.trim().toLowerCase() === "visit recorded") {
      return "Visit";
    }
    return event.title;
  }

  function getTimelineIcon(type: PatientTimelineEvent["type"]) {
    if (type === "follow_up_scheduled" || type === "follow_up_completed") {
      return <CalendarClock className="h-4 w-4 text-amber-600" />;
    }
    if (type === "appointment_booked" || type === "appointment_checked_in") {
      return <CalendarClock className="h-4 w-4 text-sky-600" />;
    }
    if (type === "visit_recorded") return <UserRound className="h-4 w-4 text-sky-600" />;
    return <Clock3 className="h-4 w-4 text-sky-600" />;
  }

  function getPhoneDigits(value: string) {
    return value.replace(/\D/g, "");
  }

  if (!currentPatient) {
    return null;
  }

  const lastVisitAt = formatDateTime(currentPatient.last_visit_at);
  const visitEvents = timeline.filter((event) => event.type === "visit_recorded");
  const timelineGroups = timeline.reduce<Array<{ label: string; events: PatientTimelineEvent[] }>>((groups, event) => {
    const date = new Date(event.timestamp);
    const label = date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.events.push(event);
      return groups;
    }
    groups.push({ label, events: [event] });
    return groups;
  }, []);

  async function handleSave() {
    if (!patient) {
      return;
    }

    const digits = getPhoneDigits(form.phone);
    const age = Number(form.age);
    const weight = Number(form.weight);
    const temperature = Number(form.temperature);
    const height = form.height.trim() ? Number(form.height) : null;

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }

    if (digits.length !== 10) {
      setError("Phone number must be exactly 10 digits.");
      return;
    }

    if (!form.reason.trim()) {
      setError("Reason for visit is required.");
      return;
    }

    if (!Number.isFinite(age) || age <= 0) {
      setError("Enter a valid age.");
      return;
    }

    if (!Number.isFinite(weight) || weight <= 0) {
      setError("Enter a valid weight.");
      return;
    }

    if (!Number.isFinite(temperature) || temperature < 90 || temperature > 110) {
      setError("Enter a valid temperature in F.");
      return;
    }

    if (height !== null && (!Number.isFinite(height) || height <= 0)) {
      setError("Enter a valid height.");
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      await onSave(patient.id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        reason: form.reason.trim(),
        age,
        weight,
        height,
        temperature,
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update patient.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/35 p-3 backdrop-blur-sm sm:p-5">
      <div className="mx-auto flex h-full max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[34px] border border-sky-100 bg-white shadow-[0_35px_90px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between gap-4 border-b border-sky-100 px-5 py-5 sm:px-7">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Patient Chart</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">{currentPatient.name}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {currentPatient.phone} · {formatStatusLabel(currentPatient.status)} · last visit {lastVisitAt}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError("");
              onClose();
            }}
            className="rounded-full border border-sky-100 p-2 text-slate-500 transition hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="min-h-0 border-b border-sky-100 bg-sky-50/35 px-4 py-5 lg:border-b-0 lg:border-r lg:px-5">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Timeline</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-900">Patient history</h3>
                </div>
                {isTimelineLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
              </div>

              {timelineError ? <p className="mt-3 text-sm text-rose-600">{timelineError}</p> : null}

              <div className="mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                {timelineGroups.length ? (
                  timelineGroups.map((group) => (
                    <div key={group.label}>
                      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {group.label}
                      </p>
                      <div className="space-y-3">
                        {group.events.map((event) => (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => {
                              if (event.type === "visit_recorded") {
                                setSelectedVisitEventId(event.id);
                              }
                            }}
                            className={`block w-full rounded-[22px] border px-3 py-3 text-left ${
                              event.type === "visit_recorded" && event.id === selectedVisitEventId
                                ? "border-sky-300 bg-white shadow-[0_14px_32px_rgba(125,211,252,0.18)]"
                                : "border-sky-100 bg-white/90"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <div className="rounded-full bg-white p-1.5 shadow-sm ring-1 ring-sky-100">
                                {getTimelineIcon(event.type)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-[13px] font-semibold text-slate-900">{getEventTitle(event)}</p>
                                  <p className="text-[11px] text-slate-500">{formatDateTime(event.timestamp)}</p>
                                </div>
                                <p className="mt-1.5 text-[13px] leading-6 text-slate-600">{event.description}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : !isTimelineLoading ? (
                  <div className="rounded-2xl border border-dashed border-sky-200 bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
                    No patient history yet.
                  </div>
                ) : null}
              </div>
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
            <div className="mx-auto max-w-4xl space-y-5">
              <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                <div className="flex items-center gap-3 text-slate-700">
                  <UserRound className="h-4 w-4 text-sky-600" />
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Bio Data</p>
                    <h4 className="mt-1 text-lg font-semibold text-slate-900">Patient identity</h4>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="block sm:col-span-2">
                    <span className="text-sm font-medium text-slate-700">Name</span>
                    <input
                      value={form.name}
                      onChange={(event) => {
                        setError("");
                        setForm((current) => ({ ...current, name: event.target.value }));
                      }}
                      className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Phone</span>
                    <input
                      value={form.phone}
                      onChange={(event) => {
                        setError("");
                        setForm((current) => ({ ...current, phone: event.target.value }));
                      }}
                      className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-slate-700">Age</span>
                    <input
                      value={form.age}
                      inputMode="numeric"
                      onChange={(event) => {
                        setError("");
                        setForm((current) => ({ ...current, age: event.target.value }));
                      }}
                      className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Visits</p>
                    <h4 className="mt-1 text-lg font-semibold text-slate-900">Patient visit history</h4>
                  </div>
                  {isTimelineLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
                </div>

                {timelineError ? <p className="mt-4 text-sm text-rose-600">{timelineError}</p> : null}

                <div className="mt-5 space-y-3">
                  {visitEvents.length ? (
                    visitEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => setSelectedVisitEventId(event.id)}
                        className={`block w-full rounded-[22px] border px-4 py-4 text-left ${
                          event.id === selectedVisitEventId
                            ? "border-sky-300 bg-white shadow-[0_14px_32px_rgba(125,211,252,0.18)]"
                            : "border-sky-100 bg-sky-50/35"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="rounded-full bg-white p-2 shadow-sm ring-1 ring-sky-100">
                            {getTimelineIcon(event.type)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">{getEventTitle(event)}</p>
                              <p className="text-xs text-slate-500">{formatDateTime(event.timestamp)}</p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{event.description}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  ) : !isTimelineLoading ? (
                    <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 px-4 py-8 text-center text-sm text-slate-500">
                      No visits recorded yet.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="border-t border-sky-100 px-5 py-4 sm:px-7">
          {error ? <p className="mb-3 text-sm font-medium text-rose-600">{error}</p> : null}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setError("");
                onClose();
              }}
              className="rounded-full border border-sky-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:text-slate-900"
            >
              Close
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
