"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Clock3, UserRound, X } from "lucide-react";

import type { ClinicSpecialty } from "@/lib/clinic-specialty";
import { PatientBioDataPanel } from "@/components/patient-chart/patient-bio-data-panel";
import { PatientEventDetailsPanel } from "@/components/patient-chart/patient-event-details-panel";
import { PatientTimelinePanel } from "@/components/patient-chart/patient-timeline-panel";
import { HistoricalMyopiaModal } from "@/components/optometry/myopia/historical-myopia-modal";
import { MyopiaManagementModal } from "@/components/optometry/myopia/myopia-management-modal";
import { api } from "@/lib/api";
import { formatMillimeterDelta } from "@/lib/optometry/myopia/shared";
import { specialtyHasModule } from "@/lib/specialty";
import { MyopiaHistory, MyopiaMeasurementPayload, Patient, PatientTimelineEvent, PediatricGrowthSummary } from "@/lib/types";

interface PatientDetailsDrawerProps {
  patient: Patient | null;
  clinicSpecialty?: ClinicSpecialty | null;
  onClose: () => void;
  onLoadTimeline: (patientId: string) => Promise<PatientTimelineEvent[]>;
  onLoadMyopiaHistory?: (patientId: string) => Promise<MyopiaHistory>;
  onLoadGrowthHistory?: (patientId: string) => Promise<PediatricGrowthSummary>;
  readOnly?: boolean;
  onSave: (payloadPatientId: string, payload: {
    name: string;
    phone: string;
    email: string;
    address: string;
    reason: string;
    age: number;
    weight: number;
    height: number | null;
    temperature: number;
  }) => Promise<void>;
}

function detailNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detailText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function PatientDetailsDrawer({
  patient,
  clinicSpecialty = null,
  onClose,
  onLoadTimeline,
  onLoadMyopiaHistory,
  onLoadGrowthHistory,
  readOnly = false,
  onSave,
}: PatientDetailsDrawerProps) {
  const isOptometryClinic = specialtyHasModule(clinicSpecialty, "myopia_management");
  const isPediatricsClinic = specialtyHasModule(clinicSpecialty, "pediatric_growth_measurement");
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
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
  const [myopiaHistory, setMyopiaHistory] = useState<MyopiaHistory | null>(null);
  const [growthHistory, setGrowthHistory] = useState<PediatricGrowthSummary | null>(null);
  const [isMyopiaLoading, setIsMyopiaLoading] = useState(false);
  const [myopiaError, setMyopiaError] = useState("");
  const [isHistoricalMyopiaOpen, setIsHistoricalMyopiaOpen] = useState(false);
  const [isMyopiaManagementOpen, setIsMyopiaManagementOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");

  useEffect(() => {
    if (!patient) {
      return;
    }

    setForm({
      name: patient.name,
      phone: patient.phone,
      email: patient.email ?? "",
      address: patient.address ?? "",
      reason: patient.reason,
      age: patient.age?.toString() ?? "",
      weight: patient.weight?.toString() ?? "",
      height: patient.height?.toString() ?? "",
      temperature: patient.temperature?.toString() ?? "",
    });
    setError("");
  }, [patient]);

  const loadPatientHistory = useCallback(async (patientId: string) => {
    const [events, nextMyopiaHistory, nextGrowthHistory] = await Promise.all([
      onLoadTimeline(patientId),
      isOptometryClinic && onLoadMyopiaHistory
        ? onLoadMyopiaHistory(patientId)
        : Promise.resolve({
            patient_id: patientId,
            records: [],
            baseline_delta: null,
            last_delta: null,
            annualized_growth: null,
            overlay_version: "clinic-reference-v1",
          } satisfies MyopiaHistory),
      isPediatricsClinic && onLoadGrowthHistory
        ? onLoadGrowthHistory(patientId)
        : Promise.resolve({
            patient_id: patientId,
            latest_measurement: null,
            previous_measurement: null,
            interval_change: null,
            trend_summary: "",
            flags: [],
            records: [],
          } satisfies PediatricGrowthSummary),
    ]);
    return { events, nextMyopiaHistory, nextGrowthHistory };
  }, [isOptometryClinic, isPediatricsClinic, onLoadGrowthHistory, onLoadMyopiaHistory, onLoadTimeline]);

  useEffect(() => {
    if (!patient) {
      setTimeline([]);
      setTimelineError("");
      setIsTimelineLoading(false);
      setMyopiaHistory(null);
      setGrowthHistory(null);
      setMyopiaError("");
      setIsMyopiaLoading(false);
      setSelectedEventId("");
      return;
    }

    const currentPatient = patient;
    let active = true;

    async function loadChartData() {
      setIsTimelineLoading(true);
      setIsMyopiaLoading(true);
      setTimelineError("");
      setMyopiaError("");
      try {
        const { events, nextMyopiaHistory, nextGrowthHistory } = await loadPatientHistory(currentPatient.id);
        if (!active) {
          return;
        }
        setTimeline(events);
        setMyopiaHistory(nextMyopiaHistory);
        setGrowthHistory(nextGrowthHistory);
        setSelectedEventId("");
      } catch (loadError) {
        if (!active) {
          return;
        }
        setTimeline([]);
        setMyopiaHistory(null);
        setGrowthHistory(null);
        const message = loadError instanceof Error ? loadError.message : "Failed to load patient history.";
        setTimelineError(message);
        setMyopiaError(message);
        setSelectedEventId("");
      } finally {
        if (active) {
          setIsTimelineLoading(false);
          setIsMyopiaLoading(false);
        }
      }
    }

    void loadChartData();
    return () => {
      active = false;
    };
  }, [loadPatientHistory, patient]);

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
    if (type === "myopia_measurement") {
      return <Clock3 className="h-4 w-4 text-emerald-600" />;
    }
    if (type === "growth_measurement" || type === "well_child_visit") {
      return <Clock3 className="h-4 w-4 text-amber-600" />;
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
  const currentVisitEvent = visitEvents[0] ?? null;
  const selectedEvent = timeline.find((event) => event.id === selectedEventId) ?? null;
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
  const myopiaRecords = myopiaHistory?.records ?? [];
  const growthRecords = growthHistory?.records ?? [];
  const measurementCount = myopiaRecords.length;
  const latestMyopiaRecord = myopiaRecords[myopiaRecords.length - 1] ?? null;
  const latestGrowthRecord = growthRecords[growthRecords.length - 1] ?? null;

  async function handleSaveHistoricalMyopia(payload: MyopiaMeasurementPayload) {
    if (!currentPatient) {
      return;
    }
    const patientId = currentPatient.id;
    setIsMyopiaLoading(true);
    setMyopiaError("");
    try {
      const saved = await api.createPatientMyopiaRecord(patientId, payload);
      const { events, nextMyopiaHistory } = await loadPatientHistory(patientId);
      setTimeline(events);
      setMyopiaHistory(nextMyopiaHistory);
      setSelectedEventId(`myopia-${saved.id}`);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save historical myopia data.";
      setMyopiaError(message);
      throw saveError;
    } finally {
      setIsMyopiaLoading(false);
    }
  }

  async function handleSave() {
    if (readOnly) {
      return;
    }
    if (!patient) {
      return;
    }

    const digits = getPhoneDigits(form.phone);
    const age = Number(form.age);
    const weight = Number(form.weight);
    const temperature = Number(form.temperature);
    const height = form.height.trim() ? Number(form.height) : null;
    const normalizedEmail = form.email.trim().toLowerCase();

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

    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
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
        email: normalizedEmail,
        address: form.address.trim(),
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
          <PatientTimelinePanel
            timelineGroups={timelineGroups}
            isLoading={isTimelineLoading}
            error={timelineError}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
            getEventTitle={getEventTitle}
            getTimelineIcon={getTimelineIcon}
            formatDateTime={formatDateTime}
          />

          <section className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
            <div className="mx-auto max-w-4xl space-y-5">
              <PatientBioDataPanel
                form={form}
                readOnly={readOnly}
                onFieldChange={(field, value) => {
                  setError("");
                  setForm((current) => ({ ...current, [field]: value }));
                }}
              />

              {isOptometryClinic ? (
                <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Myopia Management</p>
                      <h4 className="mt-1 text-lg font-semibold text-slate-900">Longitudinal progression</h4>
                    </div>
                    <div className="flex items-center gap-3">
                      {isMyopiaLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
                      <button
                        type="button"
                        onClick={() => setIsMyopiaManagementOpen(true)}
                        className="rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-700 transition hover:bg-sky-50"
                      >
                        Open Myopia Management
                      </button>
                    </div>
                  </div>

                  {myopiaError ? <p className="mt-3 text-sm text-rose-600">{myopiaError}</p> : null}

                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Readings</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{measurementCount || 0} recorded</p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Latest Reading</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {latestMyopiaRecord
                          ? `OD ${latestMyopiaRecord.axial_length_right_mm.toFixed(2)} · OS ${latestMyopiaRecord.axial_length_left_mm.toFixed(2)}`
                          : "No data yet"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Trend Since Baseline</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        OD {formatMillimeterDelta(myopiaHistory?.baseline_delta?.right_mm)} · OS {formatMillimeterDelta(myopiaHistory?.baseline_delta?.left_mm)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {isPediatricsClinic ? (
                <div className="rounded-[28px] border border-amber-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Pediatric Growth</p>
                      <h4 className="mt-1 text-lg font-semibold text-slate-900">Longitudinal growth tracking</h4>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Readings</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{growthRecords.length} recorded</p>
                    </div>
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Latest Measurement</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">
                        {latestGrowthRecord ? `${latestGrowthRecord.height_cm} cm · ${latestGrowthRecord.weight_kg} kg · BMI ${latestGrowthRecord.bmi}` : "No data yet"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-100 bg-amber-50/35 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Trend</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{growthHistory?.trend_summary || "No trend yet"}</p>
                    </div>
                  </div>
                  {growthHistory?.flags.length ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {growthHistory.flags.join(" ")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <PatientEventDetailsPanel
                selectedEvent={selectedEvent}
                formatStatusLabel={formatStatusLabel}
                formatDateTime={formatDateTime}
              />

              {readOnly ? (
                <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Current Visit</p>
                      <h4 className="mt-1 text-lg font-semibold text-slate-900">Latest recorded visit</h4>
                    </div>
                    {currentVisitEvent ? <p className="text-xs text-slate-500">{formatDateTime(currentVisitEvent.timestamp)}</p> : null}
                  </div>

                  {currentVisitEvent ? (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
                        <p className="text-sm leading-6 text-slate-700">{currentVisitEvent.description}</p>
                      </div>
                      {(() => {
                        const details = (currentVisitEvent.details ?? {}) as Record<string, unknown>;
                        const ageValue = detailNumber(details.age) ?? currentPatient.age;
                        const weightValue = detailNumber(details.weight) ?? currentPatient.weight;
                        const heightValue = detailNumber(details.height) ?? currentPatient.height;
                        const temperatureValue = detailNumber(details.temperature) ?? currentPatient.temperature;
                        return (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {[
                              ["Reason", detailText(details.reason) || currentPatient.reason || "—"],
                              ["Source", detailText(details.source) || "—"],
                              ["Age", ageValue ?? "—"],
                              ["Weight", weightValue ? `${weightValue} kg` : "—"],
                              ["Height", heightValue ? `${heightValue} cm` : "—"],
                              ["Temperature", temperatureValue ? `${temperatureValue} F` : "—"],
                            ].map(([label, value]) => (
                              <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                                <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 px-4 py-8 text-center text-sm text-slate-500">
                      No visits recorded yet.
                    </div>
                  )}
                </div>
              ) : (
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
                          onClick={() => setSelectedEventId(event.id)}
                          className={`block w-full rounded-[22px] border px-4 py-4 text-left ${
                            event.id === selectedEventId
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
              )}
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
            {!readOnly ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                className="rounded-full bg-sky-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {isOptometryClinic ? (
        <HistoricalMyopiaModal
          open={isHistoricalMyopiaOpen}
          patientAge={currentPatient.age}
          onClose={() => setIsHistoricalMyopiaOpen(false)}
          onSave={handleSaveHistoricalMyopia}
        />
      ) : null}
      {isOptometryClinic ? (
        <MyopiaManagementModal
          open={isMyopiaManagementOpen}
          readOnly={readOnly}
          history={myopiaHistory}
          isLoading={isMyopiaLoading}
          error={myopiaError}
          onClose={() => setIsMyopiaManagementOpen(false)}
          onAddPastReading={() => {
            setIsMyopiaManagementOpen(false);
            setIsHistoricalMyopiaOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}
