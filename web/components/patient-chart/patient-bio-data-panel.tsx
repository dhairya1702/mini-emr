"use client";

type PatientBioDataForm = {
  name: string;
  phone: string;
  email: string;
  address: string;
  age: string;
};

export function PatientBioDataPanel({
  form,
  readOnly,
  onFieldChange,
}: {
  form: PatientBioDataForm;
  readOnly: boolean;
  onFieldChange: (field: keyof PatientBioDataForm, value: string) => void;
}) {
  return (
    <div className="rounded-[28px] border border-sky-100 bg-white p-5">
      <div className="flex items-center gap-3 text-slate-700">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Bio Data</p>
          <h4 className="mt-1 text-lg font-semibold text-slate-900">Patient identity</h4>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {readOnly ? (
          <>
            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-slate-700">Name</p>
              <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.name || "—"}</div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">Phone</p>
              <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.phone || "—"}</div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">Email</p>
              <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.email || "—"}</div>
            </div>
            <div className="sm:col-span-2">
              <p className="text-sm font-medium text-slate-700">Address</p>
              <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.address || "—"}</div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">Age</p>
              <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800">{form.age || "—"}</div>
            </div>
          </>
        ) : (
          <>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Name</span>
              <input
                value={form.name}
                onChange={(event) => onFieldChange("name", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Phone</span>
              <input
                value={form.phone}
                onChange={(event) => onFieldChange("phone", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => onFieldChange("email", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Address</span>
              <input
                value={form.address}
                onChange={(event) => onFieldChange("address", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-700">Age</span>
              <input
                value={form.age}
                inputMode="numeric"
                onChange={(event) => onFieldChange("age", event.target.value)}
                className="mt-2 w-full rounded-2xl border border-sky-200 bg-sky-50/35 px-4 py-3 text-base text-slate-800 outline-none transition focus:border-sky-400"
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
