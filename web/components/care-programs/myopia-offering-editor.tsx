"use client";

import { Save } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { CareProgramOffering } from "@/lib/types";

type OfferingForm = {
  name: string;
  description: string;
  default_price: string;
  duration_days: string;
  is_active: boolean;
  reviews: Array<{
    key: "baseline" | "review_1" | "review_2" | "final_review";
    label: string;
    offset_days: string;
  }>;
};

function toForm(offering: CareProgramOffering): OfferingForm {
  return {
    name: offering.name,
    description: offering.description,
    default_price: offering.default_price ? String(offering.default_price) : "",
    duration_days: String(offering.definition.duration_days),
    is_active: offering.is_active,
    reviews: offering.definition.reviews.map((review) => ({
      ...review,
      offset_days: String(review.offset_days),
    })),
  };
}

export function MyopiaOfferingEditor({
  offering,
  onSaved,
}: {
  offering: CareProgramOffering;
  onSaved: (offering: CareProgramOffering) => void;
}) {
  const [form, setForm] = useState<OfferingForm>(() => toForm(offering));
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => setForm(toForm(offering)), [offering]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");
    setIsSaving(true);
    try {
      const saved = await api.saveMyopiaCareOffering({
        name: form.name.trim(),
        description: form.description.trim(),
        default_price: Number(form.default_price),
        duration_days: Number(form.duration_days),
        is_active: form.is_active,
        reviews: form.reviews.map((review) => ({
          key: review.key,
          label: review.label.trim(),
          offset_days: Number(review.offset_days),
        })),
      });
      setForm(toForm(saved));
      onSaved(saved);
      setStatus("Myopia Care offering saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save the offering.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-lg border border-[#dbe7ef] bg-white p-5">
      {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {status ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div> : null}
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">
          Program name
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Price
          <input type="number" min="1" value={form.default_price} onChange={(event) => setForm({ ...form, default_price: event.target.value })} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Duration (days)
          <input type="number" min="90" max="730" value={form.duration_days} onChange={(event) => setForm({ ...form, duration_days: event.target.value })} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" />
        </label>
      </div>
      <label className="mt-4 block text-sm font-medium text-slate-700">
        Description
        <textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-1.5 w-full rounded-lg border border-[#bfd7e8] px-3 py-2.5" />
      </label>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        {form.reviews.map((review, index) => (
          <div key={review.key} className="rounded-lg border border-[#dbe7ef] p-3">
            <input
              value={review.label}
              onChange={(event) => setForm({
                ...form,
                reviews: form.reviews.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row),
              })}
              className="w-full border-0 p-0 text-sm font-medium outline-none"
            />
            <label className="mt-2 block text-xs text-slate-500">
              Day
              <input
                type="number"
                min={index ? 1 : 0}
                disabled={index === 0}
                value={review.offset_days}
                onChange={(event) => setForm({
                  ...form,
                  reviews: form.reviews.map((row, rowIndex) => rowIndex === index ? { ...row, offset_days: event.target.value } : row),
                })}
                className="mt-1 w-full rounded-lg border border-[#dbe7ef] px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
          Active and available for enrollment
        </label>
        <button disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-[#2f8fd3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : "Save offering"}
        </button>
      </div>
    </form>
  );
}
