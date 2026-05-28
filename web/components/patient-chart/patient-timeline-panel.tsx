"use client";

import { ReactNode } from "react";

import { PatientTimelineEvent } from "@/lib/types";

type TimelineGroup = {
  label: string;
  events: PatientTimelineEvent[];
};

export function PatientTimelinePanel({
  timelineGroups,
  isLoading,
  error,
  selectedEventId,
  onSelectEvent,
  getEventTitle,
  getTimelineIcon,
  formatDateTime,
}: {
  timelineGroups: TimelineGroup[];
  isLoading: boolean;
  error: string;
  selectedEventId: string;
  onSelectEvent: (eventId: string) => void;
  getEventTitle: (event: PatientTimelineEvent) => string;
  getTimelineIcon: (type: PatientTimelineEvent["type"]) => ReactNode;
  formatDateTime: (value: string) => string;
}) {
  return (
    <aside className="min-h-0 border-b border-[#dbe7ef] bg-[#f3f8fb]/35 px-4 py-5 lg:border-b-0 lg:border-r lg:px-5">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-slate-500">Timeline</p>
            <h3 className="mt-2 text-xl font-semibold text-slate-900">Patient history</h3>
          </div>
          {isLoading ? <span className="text-xs text-slate-500">Loading...</span> : null}
        </div>

        {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

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
                      onClick={() => onSelectEvent(event.id)}
                      className={`block w-full rounded-[22px] border px-3 py-3 text-left ${
                        event.id === selectedEventId
                          ? "border-[#9fc7e1] bg-white shadow-[0_14px_32px_rgba(64,131,181,0.10)]"
                          : "border-[#dbe7ef] bg-white/90"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="rounded-full bg-white p-1.5 shadow-sm ring-1 ring-[#dbe7ef]">
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
          ) : !isLoading ? (
            <div className="rounded-xl border border-dashed border-[#bfd7e8] bg-white/80 px-4 py-6 text-center text-sm text-slate-500">
              No patient history yet.
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
