"use client";

import { FormEvent, Suspense, useState } from "react";
import { ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { PasswordInput } from "@/components/password-input";
import { api } from "@/lib/api";

function safeReturnPath(value: string | null) {
  if (
    value &&
    value.startsWith("/superdashboard") &&
    !value.startsWith("/superdashboard/login")
  ) {
    return value;
  }
  return "/superdashboard";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await api.loginSuperdashboard({
        identifier: identifier.trim(),
        password,
      });
      router.replace(safeReturnPath(searchParams.get("next")));
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to sign in to ClinicOS Ops.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-lg items-center">
        <section className="w-full rounded-[28px] border border-slate-700 bg-white p-7 shadow-[0_30px_100px_rgba(15,23,42,0.45)] sm:p-9">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                <Zap className="h-4 w-4" />
                ClinicOS Ops
              </div>
              <h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950">Platform sign in</h1>
              <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
                Use an approved platform administrator account. This session is separate from ClinicOS.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
              <ShieldCheck className="h-6 w-6" />
            </div>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700">Email or phone number</span>
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                required
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <PasswordInput
              label="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />

            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Signing in…" : "Sign in to Ops"}
              {!isSubmitting ? <ArrowRight className="h-5 w-5" /> : null}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

export function SuperdashboardLoginForm() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950" />}>
      <LoginForm />
    </Suspense>
  );
}
