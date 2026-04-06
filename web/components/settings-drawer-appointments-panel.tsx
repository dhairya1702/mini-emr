"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { FollowUp, Patient } from "@/lib/types";

interface SettingsDrawerAppointmentsPanelProps {
  followUps: FollowUp[];
  patients: Patient[];
}

type AppointmentView = "appointments" | "followUps";

export function SettingsDrawerAppointmentsPanel({
  followUps,
  patients,
}: SettingsDrawerAppointmentsPanelProps) {
  const [activeView, setActiveView] = useState<AppointmentView>("followUps");
  const patientNames = Object.fromEntries(patients.map((patient) => [patient.id, patient.name]));
  const scheduledFollowUps = followUps
    .filter((followUp) => followUp.status === "scheduled")
    .sort((left, right) => left.scheduled_for.localeCompare(right.scheduled_for));

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-sky-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-sky-700" />
          <div>
            <h3 className="text-base font-semibold text-slate-900">Appointments</h3>
            <p className="mt-1 text-sm text-slate-600">
              Keep confirmed appointments separate from consultation follow-ups.
            </p>
          </div>
        </div>

        <div className="mb-4 inline-flex rounded-full border border-sky-200 bg-sky-50 p-1">
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
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-white text-sky-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {view.label}
              </button>
            );
          })}
        </div>

        {activeView === "appointments" ? (
          <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/30 px-6 py-16 text-center text-sm text-slate-500">
            No confirmed appointments yet.
          </div>
        ) : scheduledFollowUps.length ? (
          <div className="overflow-hidden rounded-[22px] border border-sky-200">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-sky-50/80 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Patient</th>
                  <th className="px-4 py-3 text-left font-semibold">Follow-Up For</th>
                  <th className="px-4 py-3 text-left font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {scheduledFollowUps.map((followUp) => (
                  <tr key={followUp.id} className="border-t border-sky-100 first:border-t-0">
                    <td className="px-4 py-3 text-slate-800">
                      {patientNames[followUp.patient_id] || "Patient"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {new Date(followUp.scheduled_for).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {followUp.notes || "No notes"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-[24px] border border-dashed border-sky-300 bg-sky-50/30 px-6 py-16 text-center text-sm text-slate-500">
            No scheduled follow-ups yet.
          </div>
        )}
      </div>
    </div>
  );
}
