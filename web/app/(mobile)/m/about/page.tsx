"use client";

import { MobileShell } from "@/components/mobile/mobile-shell";

export default function MobileAboutPage() {
  return (
    <MobileShell title="About">
      <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 text-slate-700 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
        <h1 className="text-xl font-semibold text-slate-900">About</h1>
        <p className="mt-3 text-sm leading-7">
          ClinicOS is a lightweight clinic workflow, documentation, and billing app for small outpatient teams.
        </p>
      </section>
    </MobileShell>
  );
}
