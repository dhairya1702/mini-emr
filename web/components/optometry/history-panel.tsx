"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Edit3, RefreshCw, Save, X } from "lucide-react";

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

const TEXTAREA_FIELDS: Array<{
  key: "ocular" | "systemic" | "allergies" | "current_medications" | "family";
  label: string;
  placeholder: string;
}> = [
  { key: "ocular", label: "Ocular", placeholder: "Conditions, surgery, injury, previous treatment, last examination" },
  { key: "systemic", label: "Systemic", placeholder: "Diabetes, hypertension, thyroid, autoimmune or other conditions" },
  { key: "allergies", label: "Allergies", placeholder: "Other allergen and reaction" },
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

function normalizeHistoryPayload(payload: OptometryHistoryPayload): OptometryHistoryPayload {
  const empty = createEmptyOptometryHistory();
  return {
    ...empty,
    ...payload,
    right_power: { ...empty.right_power, ...(payload.right_power || {}) },
    left_power: { ...empty.left_power, ...(payload.left_power || {}) },
    right_contact_power: { ...empty.right_contact_power, ...(payload.right_contact_power || {}) },
    left_contact_power: { ...empty.left_contact_power, ...(payload.left_contact_power || {}) },
  };
}

export function useOptometryHistory(patientId: string, enabled = true) {
  const [record, setRecord] = useState<OptometryHistory | null>(null);
  const [draft, setDraft] = useState<OptometryHistoryPayload>(createEmptyOptometryHistory);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!enabled || !patientId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError("");
    try {
      const loaded = await api.getPatientOptometryHistory(patientId);
      const payload = normalizeHistoryPayload(loaded.payload);
      setRecord({ ...loaded, payload });
      setDraft(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load history.");
      setRecord(null);
      setDraft(createEmptyOptometryHistory());
    } finally {
      setIsLoading(false);
    }
  }, [enabled, patientId]);

  useEffect(() => {
    let active = true;
    if (!enabled || !patientId) {
      setRecord(null);
      setDraft(createEmptyOptometryHistory());
      setError("");
      setIsLoading(false);
      return () => {
        active = false;
      };
    }
    setIsLoading(true);
    setError("");
    api.getPatientOptometryHistory(patientId)
      .then((loaded) => {
        if (!active) return;
        const payload = normalizeHistoryPayload(loaded.payload);
        setRecord({ ...loaded, payload });
        setDraft(payload);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load history.");
        setRecord(null);
        setDraft(createEmptyOptometryHistory());
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, patientId]);

  const savedPayload = useMemo(
    () => record?.payload ?? createEmptyOptometryHistory(),
    [record],
  );
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedPayload),
    [draft, savedPayload],
  );
  const hasDetails = Boolean(record?.exists && hasOptometryHistoryDetails(savedPayload));

  function update<K extends keyof OptometryHistoryPayload>(
    key: K,
    value: OptometryHistoryPayload[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updatePower(
    eye: "right_power" | "left_power" | "right_contact_power" | "left_contact_power",
    field: keyof OptometryHistoryPower,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      [eye]: { ...current[eye], [field]: value },
    }));
  }

  function reset() {
    setDraft(savedPayload);
    setError("");
  }

  async function save(): Promise<boolean> {
    if (!enabled || !patientId || (!isDirty && record)) return true;
    if (!isDirty && !hasOptometryHistoryDetails(draft)) return true;
    setIsSaving(true);
    setError("");
    try {
      const saved = await api.savePatientOptometryHistory(patientId, {
        expected_revision: record?.revision ?? 0,
        payload: {
          ...draft,
          drug_allergies: draft.no_known_allergies ? "" : draft.drug_allergies.trim(),
          contact_allergies: draft.no_known_allergies ? "" : draft.contact_allergies.trim(),
          food_allergies: draft.no_known_allergies ? "" : draft.food_allergies.trim(),
          allergies: draft.no_known_allergies ? "" : draft.allergies.trim(),
        },
      });
      const payload = normalizeHistoryPayload(saved.payload);
      setRecord({ ...saved, payload });
      setDraft(payload);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save history.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return {
    record,
    draft,
    savedPayload,
    isLoading,
    isSaving,
    isDirty,
    hasDetails,
    error,
    update,
    updatePower,
    reset,
    save,
    reload: load,
  };
}

export type OptometryHistoryController = ReturnType<typeof useOptometryHistory>;

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
      <p className="mb-2 text-xs font-medium text-slate-900">{label}</p>
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

function HistoryError({ controller }: { controller: OptometryHistoryController }) {
  if (!controller.error) return null;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <p>{controller.error}</p>
      <button
        type="button"
        onClick={() => void controller.reload()}
        className="mt-2 inline-flex items-center gap-2 font-medium text-rose-800 underline underline-offset-2"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Reload latest history
      </button>
    </div>
  );
}

function HistoryForm({ controller }: { controller: OptometryHistoryController }) {
  const { draft, update, updatePower } = controller;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {TEXTAREA_FIELDS.map((field) => (
          <div key={field.key} className={field.key === "family" || field.key === "allergies" ? "lg:col-span-2" : ""}>
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-900">
              {field.label}
            </span>
            {field.key === "allergies" ? (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-xs text-slate-900">
                  <input
                    type="checkbox"
                    checked={draft.no_known_allergies}
                    onChange={(event) => update("no_known_allergies", event.target.checked)}
                  />
                  No known allergies
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    ["drug_allergies", "Drug allergies", "Medicine and reaction"],
                    ["contact_allergies", "Contact allergies", "Latex, cosmetics, metals or other contact allergens"],
                    ["food_allergies", "Food allergies", "Food and reaction"],
                    ["allergies", "Other allergies", field.placeholder],
                  ] as const).map(([key, label, placeholder]) => (
                    <label key={key} className="block">
                      <span className="mb-1 block text-[11px] font-medium text-slate-900">{label}</span>
                      <textarea
                        aria-label={label}
                        rows={2}
                        disabled={draft.no_known_allergies}
                        value={draft[key]}
                        onChange={(event) => update(key, event.target.value)}
                        placeholder={placeholder}
                        className="w-full resize-y rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8] disabled:opacity-50"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <textarea
                aria-label={field.label}
                rows={field.key === "ocular" || field.key === "systemic" ? 3 : 2}
                value={draft[field.key]}
                onChange={(event) => update(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="w-full resize-y rounded-xl border border-[#dbe7ef] bg-[#f3f8fb]/40 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#6daed8]"
              />
            )}
          </div>
        ))}
      </div>

      <div className="space-y-4 border-t border-[#dbe7ef] pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-900">Glasses & contacts</p>
        <YesNoField label="Wears glasses" value={draft.wears_glasses} onChange={(value) => update("wears_glasses", value)} />
        {draft.wears_glasses ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {([
                ["glasses_since", "Since when"],
                ["glasses_usage", "Usage"],
                ["lens_type", "Lens type"],
                ["prescription_age", "Prescription age"],
                ["pd", "PD"],
              ] as const).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] font-medium text-slate-900">{label}</span>
                  <input
                    value={draft[key]}
                    onChange={(event) => update(key, event.target.value)}
                    className="w-full rounded-xl border border-[#dbe7ef] bg-white px-3 py-2 text-sm outline-none focus:border-[#6daed8]"
                  />
                </label>
              ))}
            </div>
            <div className="overflow-x-auto rounded-xl border border-[#dbe7ef]">
              <table className="w-full min-w-[540px] text-xs">
                <thead className="bg-[#f3f8fb] text-slate-900">
                  <tr>
                    <th className="px-3 py-2 text-left">Eye</th>
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
                      <td className="px-3 py-2 font-semibold text-slate-700">{label}</td>
                      {(["sphere", "cylinder", "axis", "add"] as const).map((field) => (
                        <td key={field} className="px-1 py-2">
                          <input
                            aria-label={`${label} ${field}`}
                            value={draft[eye][field]}
                            onChange={(event) => updatePower(eye, field, event.target.value)}
                            className="w-full min-w-20 rounded-lg border border-[#dbe7ef] px-2 py-1.5 text-sm outline-none focus:border-[#6daed8]"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <textarea
              aria-label="Glasses notes"
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
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-900">Since when</span>
              <input
                aria-label="Contacts since"
                value={draft.contacts_since}
                onChange={(event) => update("contacts_since", event.target.value)}
                className="w-full rounded-xl border border-[#dbe7ef] px-3 py-2.5 text-sm outline-none focus:border-[#6daed8]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-slate-900">Type</span>
              <input
                aria-label="Contact lens type"
                value={draft.contact_lens_type}
                onChange={(event) => update("contact_lens_type", event.target.value)}
                className="w-full rounded-xl border border-[#dbe7ef] px-3 py-2.5 text-sm outline-none focus:border-[#6daed8]"
              />
            </label>
            <div className="sm:col-span-2">
              <p className="mb-2 text-[11px] font-medium text-slate-900">Current contact lens power</p>
              <div className="overflow-x-auto rounded-xl border border-[#dbe7ef]">
                <table className="w-full min-w-[540px] text-xs">
                  <thead className="bg-[#f3f8fb] text-slate-900">
                    <tr>
                      <th className="px-3 py-2 text-left">Eye</th>
                      <th className="px-2 py-2 text-left">SPH</th>
                      <th className="px-2 py-2 text-left">CYL</th>
                      <th className="px-2 py-2 text-left">Axis</th>
                      <th className="px-2 py-2 text-left">ADD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      ["right_contact_power", "OD"],
                      ["left_contact_power", "OS"],
                    ] as const).map(([eye, label]) => (
                      <tr key={eye} className="border-t border-[#dbe7ef]">
                        <td className="px-3 py-2 font-semibold text-slate-900">{label}</td>
                        {(["sphere", "cylinder", "axis", "add"] as const).map((field) => (
                          <td key={field} className="px-1 py-2">
                            <input
                              aria-label={`Contact ${label} ${field}`}
                              value={draft[eye][field]}
                              onChange={(event) => updatePower(eye, field, event.target.value)}
                              className="w-full min-w-20 rounded-lg border border-[#dbe7ef] px-2 py-1.5 text-sm outline-none focus:border-[#6daed8]"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <textarea
              aria-label="Contact lens notes"
              rows={2}
              value={draft.contact_lens_notes}
              onChange={(event) => update("contact_lens_notes", event.target.value)}
              placeholder="Basic details; use the Contact Lens module for a full assessment"
              className="rounded-xl border border-[#dbe7ef] px-3 py-2.5 text-sm outline-none focus:border-[#6daed8] sm:col-span-2"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HistoryRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div className="border-t border-[#dbe7ef] py-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-900">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{value}</p>
    </div>
  );
}

function HistorySummaryRows({ controller }: { controller: OptometryHistoryController }) {
  const saved = controller.savedPayload;
  if (controller.isLoading) return <p className="py-6 text-center text-sm text-slate-500">Loading...</p>;
  if (!controller.hasDetails) return <p className="py-6 text-center text-sm text-slate-500">No history recorded.</p>;
  return (
    <div>
      <HistoryRow label="Ocular" value={saved.ocular} />
      <HistoryRow label="Systemic" value={saved.systemic} />
      {saved.no_known_allergies ? <HistoryRow label="Allergies" value="No known allergies" /> : (
        <>
          <HistoryRow label="Drug allergies" value={saved.drug_allergies} />
          <HistoryRow label="Contact allergies" value={saved.contact_allergies} />
          <HistoryRow label="Food allergies" value={saved.food_allergies} />
          <HistoryRow label="Other allergies" value={saved.allergies} />
        </>
      )}
      <HistoryRow label="Current medications" value={saved.current_medications} />
      <HistoryRow label="Family" value={saved.family} />
      {saved.wears_glasses !== null ? <HistoryRow label="Wears glasses" value={booleanLabel(saved.wears_glasses)} /> : null}
      <HistoryRow
        label="Glasses & contacts"
        value={[
          saved.glasses_since ? `Since ${saved.glasses_since}` : "",
          saved.glasses_usage,
          saved.lens_type,
          saved.prescription_age ? `Rx ${saved.prescription_age}` : "",
          saved.pd ? `PD ${saved.pd}` : "",
        ].filter(Boolean).join(" · ")}
      />
      <HistoryRow label="Current power OD" value={formatPower(saved.right_power)} />
      <HistoryRow label="Current power OS" value={formatPower(saved.left_power)} />
      <HistoryRow label="Glasses notes" value={saved.glasses_notes} />
      {saved.wears_contact_lenses !== null ? <HistoryRow label="Wears contact lenses" value={booleanLabel(saved.wears_contact_lenses)} /> : null}
      <HistoryRow
        label="Contact lenses"
        value={[saved.contacts_since ? `Since ${saved.contacts_since}` : "", saved.contact_lens_type, saved.contact_lens_notes]
          .filter(Boolean).join(" · ")}
      />
      <HistoryRow label="Contact power OD" value={formatPower(saved.right_contact_power)} />
      <HistoryRow label="Contact power OS" value={formatPower(saved.left_contact_power)} />
    </div>
  );
}

export function OptometryHistoryEditor({
  controller,
  onContinue,
}: {
  controller: OptometryHistoryController;
  onContinue: () => Promise<void>;
}) {
  if (controller.isLoading) {
    return <div className="py-20 text-center text-sm text-slate-500">Loading patient history...</div>;
  }
  return (
    <section aria-label="Optometry history">
      <HistoryForm controller={controller} />
      <div className="mt-6 space-y-3 border-t border-[#dbe7ef] pt-5">
        <HistoryError controller={controller} />
        <div className="flex justify-end">
          <button
            type="button"
            disabled={controller.isSaving}
            onClick={() => void onContinue()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#287fc0] disabled:opacity-60"
          >
            {controller.isSaving ? "Saving..." : "Continue to Examination"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function OptometryHistorySummary({
  controller,
  onEdit,
  compact = false,
}: {
  controller: OptometryHistoryController;
  onEdit: () => void;
  compact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (compact) {
    return (
      <section className="rounded-[18px] border border-[#bfd7e8] bg-white/95 shadow-sm xl:hidden">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-700">
            {controller.hasDetails ? <Check className="h-4 w-4 text-emerald-600" /> : null} History
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-500 transition ${isExpanded ? "rotate-180" : ""}`} />
        </button>
        {isExpanded ? (
          <div className="border-t border-[#dbe7ef] p-4">
            <HistorySummaryRows controller={controller} />
            <button type="button" onClick={onEdit} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[#2a6fa8]">
              <Edit3 className="h-4 w-4" /> Edit history
            </button>
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <section className="hidden rounded-[18px] border border-[#bfd7e8] bg-white/95 shadow-sm xl:block">
      <div className="flex items-center justify-between gap-3 border-b border-[#dbe7ef] px-4 py-4">
        <span className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-700">History</span>
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-2 text-xs font-medium text-[#2a6fa8]">
          <Edit3 className="h-3.5 w-3.5" /> Edit history
        </button>
      </div>
      <div className="max-h-[calc(100vh-16rem)] overflow-y-auto p-4">
        <HistorySummaryRows controller={controller} />
      </div>
    </section>
  );
}

export function OptometryHistoryPanel({
  patientId,
  collapsible = false,
}: {
  patientId: string;
  collapsible?: boolean;
}) {
  const controller = useOptometryHistory(patientId);
  const [isExpanded, setIsExpanded] = useState(!collapsible);
  const [isEditing, setIsEditing] = useState(false);

  async function saveAndClose() {
    if (await controller.save()) setIsEditing(false);
  }

  return (
    <section className="rounded-[18px] border border-[#bfd7e8] bg-white/95 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[#dbe7ef] px-4 py-4">
        <button
          type="button"
          disabled={!collapsible}
          onClick={() => collapsible && setIsExpanded((current) => !current)}
          className="flex items-center gap-2 text-left"
        >
          <span className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-700">History</span>
          {collapsible ? <ChevronDown className={`h-4 w-4 transition ${isExpanded ? "rotate-180" : ""}`} /> : null}
        </button>
        {isExpanded && !isEditing ? (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-2 text-xs font-medium text-[#2a6fa8]"
          >
            <Edit3 className="h-3.5 w-3.5" /> {controller.hasDetails ? "Edit" : "Add details"}
          </button>
        ) : null}
      </div>
      {isExpanded ? (
        <div className="p-4">
          {isEditing ? (
            <div className="space-y-4">
              <HistoryForm controller={controller} />
              <HistoryError controller={controller} />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={controller.isSaving}
                  onClick={() => void saveAndClose()}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2f8fd3] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  <Save className="h-4 w-4" /> {controller.isSaving ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  disabled={controller.isSaving}
                  onClick={() => {
                    controller.reset();
                    setIsEditing(false);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#dbe7ef] px-4 py-2 text-sm text-slate-700"
                >
                  <X className="h-4 w-4" /> Cancel
                </button>
              </div>
            </div>
          ) : (
            <HistorySummaryRows controller={controller} />
          )}
        </div>
      ) : null}
    </section>
  );
}
