"use client";

import { useEffect, useState } from "react";
import { Edit3, Save, X } from "lucide-react";

import { api } from "@/lib/api";
import {
  createEmptyOptometryHistory,
  hasOptometryHistoryDetails,
} from "@/lib/optometry/history";
import {
  OptometryHistory,
  OptometryHistoryPayload,
  OptometryHistoryPower,
} from "@/lib/types";

type HistoryPanelProps = {
  patientId: string;
  collapsible?: boolean;
};

const TEXTAREA_FIELDS: Array<{
  key: "ocular" | "systemic" | "allergies" | "current_medications" | "family";
  label: string;
  placeholder: string;
}> = [
  { key: "ocular", label: "Ocular", placeholder: "Conditions, surgery, injury, previous treatment, last examination" },
  { key: "systemic", label: "Systemic", placeholder: "Diabetes, hypertension, thyroid, autoimmune or other conditions" },
  { key: "allergies", label: "Allergies", placeholder: "Allergen, medicine and reaction" },
  { key: "current_medications", label: "Current medications", placeholder: "Medicine, strength, dose and frequency" },
  { key: "family", label: "Family", placeholder: "Glaucoma, high myopia, retinal disease, keratoconus, squint or other details" },
];

function formatPower(power: OptometryHistoryPower): string {
  return [
    power.sphere.trim() ? `SPH ${power.sphere.trim()}` : "",
    power.cylinder.trim() ? `CYL ${power.cylinder.trim()}` : "",
    power.axis.trim() ? `Axis ${power.axis.trim()}` : "",
    power.add.trim() ? `ADD ${power.add.trim()}` : "",
  ].filter(Boolean).join(" · ");
}

function booleanLabel(value: boolean | null): string {
  if (value === null) return "Not recorded";
  return value ? "Yes" : "No";
}

function HistoryRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="border-t border-[#dbe7ef] py-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value}</p>
    </div>
  );
}

function YesNoField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-slate-600">{label}</p>
      <div className="flex flex-wrap gap-2">
        {([
          { value: true, label: "Yes" },
          { value: false, label: "No" },
          { value: null, label: "Not recorded" },
        ] as const).map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
              value === option.value
                ? "border-[#2f8fd3] bg-[#edf5fa] text-[#2a6fa8]"
                : "border-[#dbe7ef] bg-white text-slate-600 hover:bg-[#f3f8fb]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function OptometryHistoryPanel({
  patientId,
  collapsible = false,
}: HistoryPanelProps) {
  const [record, setRecord] = useState<OptometryHistory | null>(null);
  const [draft, setDraft] = useState<OptometryHistoryPayload>(createEmptyOptometryHistory);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!collapsible);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError("");
    setIsEditing(false);
    api.getPatientOptometryHistory(patientId)
      .then((loaded) => {
        if (!active) return;
        setRecord(loaded);
        setDraft(loaded.payload);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load details.");
        setRecord(null);
        setDraft(createEmptyOptometryHistory());
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [patientId]);

  function update<K extends keyof OptometryHistoryPayload>(
    key: K,
    value: OptometryHistoryPayload[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updatePower(
    eye: "right_power" | "left_power",
    field: keyof OptometryHistoryPower,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      [eye]: { ...current[eye], [field]: value },
    }));
  }

  async function save() {
    setIsSaving(true);
    setError("");
    try {
      const saved = await api.savePatientOptometryHistory(patientId, {
        expected_revision: record?.revision ?? 0,
        payload: {
          ...draft,
          allergies: draft.no_known_allergies ? "" : draft.allergies.trim(),
        },
      });
      setRecord(saved);
      setDraft(saved.payload);
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save details.");
    } finally {
      setIsSaving(false);
    }
  }

  const savedPayload = record?.payload ?? createEmptyOptometryHistory();
  const hasDetails = record?.exists && hasOptometryHistoryDetails(savedPayload);
  const updatedLabel = record?.updated_at
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(record.updated_at))
    : "";

  return (
    <section className="rounded-[18px] border border-[#bfd7e8] bg-white/95 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[#dbe7ef] px-4 py-4">
        <button
          type="button"
          disabled={!collapsible}
          onClick={() => collapsible && setIsExpanded((current) => !current)}
          className="text-left"
        >
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-700">History</span>
        </button>
        {!isLoading && !isEditing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(record?.payload ?? createEmptyOptometryHistory());
              setIsEditing(true);
              setIsExpanded(true);
              setError("");
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-[#bfd7e8] bg-white px-3 py-1.5 text-xs font-medium text-[#2a6fa8] transition hover:bg-[#f3f8fb]"
          >
            <Edit3 className="h-3.5 w-3.5" />
            {hasDetails ? "Edit" : "Add details"}
          </button>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="p-4">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading...</p>
          ) : isEditing ? (
            <div className="space-y-5">
              {TEXTAREA_FIELDS.map((field) => (
                <div key={field.key}>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                    {field.label}
                  </span>
                  {field.key === "allergies" ? (
                    <label className="mb-2 flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={draft.no_known_allergies}
                        onChange={(event) => update("no_known_allergies", event.target.checked)}
                      />
                      No known allergies
                    </label>
                  ) : null}
                  <textarea
                    rows={field.key === "ocular" || field.key === "systemic" ? 3 : 2}
                    disabled={field.key === "allergies" && draft.no_known_allergies}
                    value={draft[field.key]}
                    onChange={(event) => update(field.key, event.target.value)}
                    placeholder={field.placeholder}
                    className="w-full resize-y rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8] disabled:opacity-50"
                  />
                </div>
              ))}

              <div className="space-y-4 border-t border-[#dbe7ef] pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">Glasses & contacts</p>
                <YesNoField label="Wears glasses" value={draft.wears_glasses} onChange={(value) => update("wears_glasses", value)} />
                {draft.wears_glasses ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        ["glasses_since", "Since when"],
                        ["glasses_usage", "Usage"],
                        ["lens_type", "Lens type"],
                        ["prescription_age", "Prescription age"],
                        ["pd", "PD"],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="block">
                          <span className="mb-1 block text-[11px] text-slate-500">{label}</span>
                          <input
                            value={draft[key]}
                            onChange={(event) => update(key, event.target.value)}
                            className="w-full rounded-xl border border-[#dbe7ef] bg-white px-3 py-2 text-sm outline-none focus:border-[#6daed8]"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-[#dbe7ef]">
                      <table className="w-full min-w-[390px] text-xs">
                        <thead className="bg-[#f3f8fb] text-slate-600">
                          <tr>
                            <th className="px-2 py-2 text-left">Eye</th>
                            <th className="px-2 py-2 text-left">SPH</th>
                            <th className="px-2 py-2 text-left">CYL</th>
                            <th className="px-2 py-2 text-left">Axis</th>
                            <th className="px-2 py-2 text-left">ADD</th>
                          </tr>
                        </thead>
                        <tbody>
                          {([
                            ["right_power", "OD"],
                            ["left_power", "OS"],
                          ] as const).map(([eye, label]) => (
                            <tr key={eye} className="border-t border-[#dbe7ef]">
                              <td className="px-2 py-2 font-semibold text-slate-700">{label}</td>
                              {(["sphere", "cylinder", "axis", "add"] as const).map((field) => (
                                <td key={field} className="px-1 py-2">
                                  <input
                                    aria-label={`${label} ${field}`}
                                    value={draft[eye][field]}
                                    onChange={(event) => updatePower(eye, field, event.target.value)}
                                    className="w-20 rounded-lg border border-[#dbe7ef] px-2 py-1.5 text-sm outline-none focus:border-[#6daed8]"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <textarea
                      rows={2}
                      value={draft.glasses_notes}
                      onChange={(event) => update("glasses_notes", event.target.value)}
                      placeholder="Comfort, vision issues or other details"
                      className="w-full rounded-xl border border-[#dbe7ef] px-3 py-2.5 text-sm outline-none focus:border-[#6daed8]"
                    />
                  </>
                ) : null}
                <YesNoField
                  label="Wears contact lenses"
                  value={draft.wears_contact_lenses}
                  onChange={(value) => update("wears_contact_lenses", value)}
                />
                {draft.wears_contact_lenses ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      value={draft.contacts_since}
                      onChange={(event) => update("contacts_since", event.target.value)}
                      placeholder="Since when"
                      className="rounded-xl border border-[#dbe7ef] px-3 py-2.5 text-sm outline-none focus:border-[#6daed8]"
                    />
                    <input
                      value={draft.contact_lens_type}
                      onChange={(event) => update("contact_lens_type", event.target.value)}
                      placeholder="Type"
                      className="rounded-xl border border-[#dbe7ef] px-3 py-2.5 text-sm outline-none focus:border-[#6daed8]"
                    />
                    <textarea
                      rows={2}
                      value={draft.contact_lens_notes}
                      onChange={(event) => update("contact_lens_notes", event.target.value)}
                      placeholder="Basic details; use the Contact Lens module for a full assessment"
                      className="rounded-xl border border-[#dbe7ef] px-3 py-2.5 text-sm outline-none focus:border-[#6daed8] sm:col-span-2"
                    />
                  </div>
                ) : null}
              </div>

              {error ? <p className="text-sm text-rose-700">{error}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void save()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => {
                    setDraft(record?.payload ?? createEmptyOptometryHistory());
                    setIsEditing(false);
                    setError("");
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#dbe7ef] bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              </div>
            </div>
          ) : hasDetails ? (
            <div>
              <HistoryRow label="Ocular" value={savedPayload.ocular} />
              <HistoryRow label="Systemic" value={savedPayload.systemic} />
              <HistoryRow
                label="Allergies"
                value={savedPayload.no_known_allergies ? "No known allergies" : savedPayload.allergies}
              />
              <HistoryRow label="Current medications" value={savedPayload.current_medications} />
              <HistoryRow label="Family" value={savedPayload.family} />
              {savedPayload.wears_glasses !== null ? (
                <HistoryRow label="Wears glasses" value={booleanLabel(savedPayload.wears_glasses)} />
              ) : null}
              <HistoryRow
                label="Glasses & contacts"
                value={[
                  savedPayload.glasses_since ? `Since ${savedPayload.glasses_since}` : "",
                  savedPayload.glasses_usage,
                  savedPayload.lens_type,
                  savedPayload.prescription_age ? `Rx ${savedPayload.prescription_age}` : "",
                  savedPayload.pd ? `PD ${savedPayload.pd}` : "",
                ].filter(Boolean).join(" · ")}
              />
              <HistoryRow label="Current power OD" value={formatPower(savedPayload.right_power)} />
              <HistoryRow label="Current power OS" value={formatPower(savedPayload.left_power)} />
              <HistoryRow label="Glasses notes" value={savedPayload.glasses_notes} />
              {savedPayload.wears_contact_lenses !== null ? (
                <HistoryRow label="Wears contact lenses" value={booleanLabel(savedPayload.wears_contact_lenses)} />
              ) : null}
              <HistoryRow
                label="Contact lenses"
                value={[
                  savedPayload.contacts_since ? `Since ${savedPayload.contacts_since}` : "",
                  savedPayload.contact_lens_type,
                  savedPayload.contact_lens_notes,
                ].filter(Boolean).join(" · ")}
              />
              {updatedLabel ? (
                <p className="mt-3 border-t border-[#dbe7ef] pt-3 text-xs text-slate-500">
                  Updated {updatedLabel}{record?.updated_by_name ? ` by ${record.updated_by_name}` : ""}
                </p>
              ) : null}
              {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">No details recorded.</p>
              {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
