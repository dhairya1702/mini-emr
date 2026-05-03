"use client";

import { PatientTimelineEvent } from "@/lib/types";

function detailText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function detailNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detailItems(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function PatientEventDetailsPanel({
  selectedEvent,
  formatStatusLabel,
  formatDateTime,
}: {
  selectedEvent: PatientTimelineEvent | null;
  formatStatusLabel: (value: string) => string;
  formatDateTime: (value: string) => string;
}) {
  return (
    <div className="rounded-[28px] border border-sky-100 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Selected Event</p>
          <h4 className="mt-1 text-lg font-semibold text-slate-900">
            {selectedEvent ? selectedEvent.title : "Timeline inspection"}
          </h4>
        </div>
        {selectedEvent ? (
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-600">
            {formatStatusLabel(selectedEvent.type)}
          </span>
        ) : null}
      </div>

      {selectedEvent ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{selectedEvent.title}</p>
              <p className="text-xs text-slate-500">{formatDateTime(selectedEvent.timestamp)}</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{selectedEvent.description}</p>
          </div>

          {(() => {
            const details = (selectedEvent.details ?? {}) as Record<string, unknown>;

            if (selectedEvent.type === "visit_recorded") {
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Reason", detailText(details.reason) || "—"],
                    ["Source", detailText(details.source) || "—"],
                    ["Age", detailNumber(details.age) ?? "—"],
                    ["Weight", detailNumber(details.weight) ? `${detailNumber(details.weight)} kg` : "—"],
                    ["Height", detailNumber(details.height) ? `${detailNumber(details.height)} cm` : "—"],
                    ["Temperature", detailNumber(details.temperature) ? `${detailNumber(details.temperature)} F` : "—"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              );
            }

            if (selectedEvent.type === "consultation_note") {
              return (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Version", detailNumber(details.version_number) ?? "—"],
                      ["Status", detailText(details.status).replaceAll("_", " ") || "—"],
                      ["Recipient", detailText(details.sent_to) || "—"],
                      ["Signed by", detailText(details.sent_by_name) || "—"],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                        <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-sky-100 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Consultation content</p>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {detailText(details.content) || detailText(details.excerpt) || "No note content available."}
                    </div>
                  </div>
                </div>
              );
            }

            if (selectedEvent.type === "invoice_created" || selectedEvent.type === "bill_sent") {
              const items = detailItems(details.items) as Array<Record<string, unknown>>;
              return (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Payment status", detailText(details.payment_status) || "—"],
                      ["Recipient", detailText(details.recipient) || "—"],
                      ["Total", detailNumber(details.total) !== null ? `₹${detailNumber(details.total)}` : "—"],
                      ["Paid", detailNumber(details.amount_paid) !== null ? `₹${detailNumber(details.amount_paid)}` : "—"],
                      ["Due", detailNumber(details.balance_due) !== null ? `₹${detailNumber(details.balance_due)}` : "—"],
                      ["Items", detailNumber(details.item_count) ?? items.length ?? "—"],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                        <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                      </div>
                    ))}
                  </div>
                  {items.length ? (
                    <div className="rounded-2xl border border-sky-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Line items</p>
                      <div className="mt-3 space-y-2">
                        {items.map((item, index) => (
                          <div key={`${selectedEvent.id}-item-${index}`} className="flex items-center justify-between rounded-xl bg-sky-50/40 px-3 py-2 text-sm text-slate-700">
                            <span>{detailText(item.label) || "Item"}</span>
                            <span>
                              {detailNumber(item.quantity) ?? 0} × ₹{detailNumber(item.unit_price) ?? 0}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }

            if (selectedEvent.type === "follow_up_scheduled" || selectedEvent.type === "follow_up_completed") {
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Status", detailText(details.status).replaceAll("_", " ") || "—"],
                    ["Scheduled for", detailText(details.scheduled_for) ? formatDateTime(detailText(details.scheduled_for)) : "—"],
                    ["Completed at", detailText(details.completed_at) ? formatDateTime(detailText(details.completed_at)) : "—"],
                    ["Notes", detailText(details.notes) || "—"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              );
            }

            if (selectedEvent.type === "appointment_booked" || selectedEvent.type === "appointment_checked_in") {
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Status", detailText(details.status).replaceAll("_", " ") || "—"],
                    ["Scheduled for", detailText(details.scheduled_for) ? formatDateTime(detailText(details.scheduled_for)) : "—"],
                    ["Checked in", detailText(details.checked_in_at) ? formatDateTime(detailText(details.checked_in_at)) : "—"],
                    ["Reason", detailText(details.reason) || "—"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              );
            }

            if (selectedEvent.type === "patient_created") {
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Reason", detailText(details.reason) || "—"],
                    ["Phone", detailText(details.phone) || "—"],
                    ["Email", detailText(details.email) || "—"],
                    ["Address", detailText(details.address) || "—"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              );
            }

            if (selectedEvent.type === "myopia_measurement") {
              return (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Age", `${detailNumber(details.age_years) ?? "—"} years`],
                    ["Axial Length OD", detailNumber(details.axial_length_right_mm) !== null ? `${detailNumber(details.axial_length_right_mm)} mm` : "—"],
                    ["Axial Length OS", detailNumber(details.axial_length_left_mm) !== null ? `${detailNumber(details.axial_length_left_mm)} mm` : "—"],
                    ["Treatment", detailText(details.treatment_type) || "—"],
                    ["Refraction Right", detailText(details.refraction_right) || "—"],
                    ["Refraction Left", detailText(details.refraction_left) || "—"],
                    ["Treatment Notes", detailText(details.treatment_notes) || "—"],
                    ["Visit Notes", detailText(details.visit_notes) || "—"],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border border-sky-100 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              );
            }

            return null;
          })()}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 px-4 py-8 text-center text-sm text-slate-500">
          Select a timeline event from the left to inspect its details.
        </div>
      )}
    </div>
  );
}
