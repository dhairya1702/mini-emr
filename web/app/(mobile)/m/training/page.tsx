"use client";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { MobileShell } from "@/components/mobile/mobile-shell";

export default function MobileTrainingPage() {
  const { isTrainingMode, enterTrainingMode, exitTrainingMode, resetTrainingMode } = useClinicShell();

  return (
    <MobileShell title="Training Mode">
      <section className="rounded-[18px] border border-[#dbe7ef] bg-white p-5 shadow-[0_14px_34px_rgba(64,131,181,0.10)]">
        <h1 className="text-xl font-semibold text-slate-900">Training Mode</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Practice queue and consultation flows with local sandbox data before using the live clinic workspace.
        </p>
        <div className="mt-5 grid gap-3">
          {isTrainingMode ? (
            <>
              <button type="button" onClick={exitTrainingMode} className="rounded-xl bg-[#2f8fd3] px-4 py-3 text-sm font-medium text-white">
                Exit Training Mode
              </button>
              <button type="button" onClick={resetTrainingMode} className="rounded-xl border border-[#9fc7e1] bg-white px-4 py-3 text-sm font-medium text-slate-800">
                Reset Sandbox
              </button>
            </>
          ) : (
            <button type="button" onClick={enterTrainingMode} className="rounded-xl bg-[#2f8fd3] px-4 py-3 text-sm font-medium text-white">
              Enter Training Mode
            </button>
          )}
        </div>
      </section>
    </MobileShell>
  );
}
