"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldPlus, Stethoscope } from "lucide-react";

import { PasswordInput } from "@/components/password-input";
import { authStorage, SESSION_EXPIRED_MESSAGE } from "@/lib/auth";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [registerStep, setRegisterStep] = useState<1 | 2>(1);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [adminName, setAdminName] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const expiredReason =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("reason") === "session-expired";

    async function checkSession() {
      if (authStorage.clearExpiredSession()) {
        if (active) {
          setError(SESSION_EXPIRED_MESSAGE);
        }
        return;
      }

      try {
        await api.getCurrentUser();
        if (active) {
          router.replace("/");
        }
      } catch (error) {
        authStorage.clear();
        if (
          active &&
          error instanceof Error &&
          (error.message === SESSION_EXPIRED_MESSAGE || expiredReason)
        ) {
          setError(SESSION_EXPIRED_MESSAGE);
        }
      }
    }

    checkSession();
    return () => {
      active = false;
    };
  }, [router]);

  function resetRegisterFields() {
    setRegisterStep(1);
    setIdentifier("");
    setPassword("");
    setConfirmPassword("");
    setAdminName("");
    setClinicName("");
    setClinicAddress("");
    setClinicPhone("");
    setDoctorName("");
  }

  function handleModeChange(nextMode: "login" | "register") {
    setMode(nextMode);
    setError("");
    if (nextMode === "register") {
      resetRegisterFields();
      return;
    }
    setRegisterStep(1);
    setConfirmPassword("");
  }

  function handleContinueRegistration() {
    if (!adminName.trim()) {
      setError("Admin name is required.");
      return;
    }
    if (!clinicName.trim()) {
      setError("Clinic name is required.");
      return;
    }
    if (!clinicPhone.trim()) {
      setError("Clinic phone is required.");
      return;
    }
    if (!clinicAddress.trim()) {
      setError("Clinic address is required.");
      return;
    }

    if (!identifier.trim()) {
      setIdentifier(clinicPhone.trim());
    }
    setError("");
    setRegisterStep(2);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "register" && registerStep === 1) {
      handleContinueRegistration();
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      let session;
      if (mode === "login") {
        session = await api.login({
          identifier: identifier.trim(),
          password,
        });
      } else {
        if (!adminName.trim()) {
          throw new Error("Admin name is required.");
        }
        if (!clinicName.trim()) {
          throw new Error("Clinic name is required.");
        }
        if (!clinicPhone.trim()) {
          throw new Error("Clinic phone is required.");
        }
        if (!clinicAddress.trim()) {
          throw new Error("Clinic address is required.");
        }
        if (!identifier.trim()) {
          throw new Error("Username, email, or phone number is required.");
        }
        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        session = await api.register({
          identifier: identifier.trim(),
          password,
          admin_name: adminName.trim(),
          clinic_name: clinicName.trim(),
          clinic_address: clinicAddress.trim(),
          clinic_phone: clinicPhone.trim(),
          doctor_name: doctorName.trim() || adminName.trim(),
        });
      }
      authStorage.setSession(session, authStorage.getTokenExpiryMs());
      router.replace("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative overflow-hidden rounded-[36px] border border-sky-100 bg-white/95 p-8 shadow-[0_25px_80px_rgba(125,211,252,0.2)] sm:p-10">
          <div className="absolute -left-16 top-10 h-40 w-40 rounded-full bg-sky-100 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-48 w-48 rounded-full bg-cyan-100 blur-3xl" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1 text-xs tracking-[0.22em] text-sky-700">
              <Stethoscope className="h-3.5 w-3.5" />
              ClinicOS
            </div>
            <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl">
              Clinic workflow, notes, and queue control in one place.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-8 text-slate-600">
              Sign in to open your clinic workspace. Create Account provisions a new clinic
              organization with its own admin, settings, patients, and staff list.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[28px] border border-sky-100 bg-sky-50/70 p-5">
                <p className="text-sm font-semibold text-slate-900">Admin access</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Manage clinic details, queue operations, AI notes, and staff creation.
                </p>
              </div>
              <div className="rounded-[28px] border border-sky-100 bg-white p-5">
                <p className="text-sm font-semibold text-slate-900">Staff access</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  Join the clinic board with an admin-issued account and work patient flow.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-[36px] border border-sky-100 bg-white p-7 shadow-[0_25px_80px_rgba(148,163,184,0.14)] sm:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
                  {mode === "login"
                    ? "Welcome Back"
                    : registerStep === 1
                      ? "Create Admin"
                      : "Account Access"}
                </p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-900">
                  {mode === "login" ? "Sign in" : "Create account"}
                </h2>
              </div>
              <div className="rounded-full bg-sky-50 p-3 text-sky-700">
                <ShieldPlus className="h-5 w-5" />
              </div>
            </div>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              {mode === "login" ? (
                <>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Email or phone number
                    </span>
                    <input
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="doctor@clinic.com or +1 555 010 2020"
                      className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>

                  <PasswordInput
                    label="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimum 6 characters"
                  />
                </>
              ) : registerStep === 1 ? (
                <>
                  <div className="rounded-[28px] border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-slate-600">
                    Step 1 of 2. Start with clinic and admin details, then create the login credentials.
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">Admin name</span>
                    <input
                      value={adminName}
                      onChange={(event) => setAdminName(event.target.value)}
                      placeholder="Dr. Aditi Sharma"
                      className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Clinic name
                    </span>
                    <input
                      value={clinicName}
                      onChange={(event) => setClinicName(event.target.value)}
                      placeholder="Bluebird Clinic"
                      className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        Clinic phone
                      </span>
                      <input
                        value={clinicPhone}
                        onChange={(event) => setClinicPhone(event.target.value)}
                        placeholder="+1 555 010 2020"
                        className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Clinic address
                    </span>
                    <textarea
                      rows={3}
                      value={clinicAddress}
                      onChange={(event) => setClinicAddress(event.target.value)}
                      placeholder="Street, city, state"
                      className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Doctor name for letters and PDFs
                    </span>
                    <input
                      value={doctorName}
                      onChange={(event) => setDoctorName(event.target.value)}
                      placeholder="Leave blank to reuse admin name"
                      className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="rounded-[28px] border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm text-slate-600">
                    Step 2 of 2. Choose the login identifier and password for the admin account.
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-slate-700">
                      Username, email, or phone number
                    </span>
                    <input
                      value={identifier}
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="doctor@clinic.com or +1 555 010 2020"
                      className="w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-slate-800 outline-none transition focus:border-sky-400"
                    />
                    <p className="mt-2 text-sm text-slate-500">
                      This is your login credential. It can match the clinic phone or be a separate email.
                    </p>
                  </label>

                  <PasswordInput
                    label="Password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Minimum 6 characters"
                  />

                  <PasswordInput
                    label="Confirm password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Re-enter password"
                  />
                </>
              )}

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {mode === "register" && registerStep === 2 ? (
                <button
                  type="button"
                  onClick={() => {
                    setRegisterStep(1);
                    setError("");
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-3 text-sm font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to clinic details
                </button>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-600 disabled:opacity-60"
              >
                {isSubmitting
                  ? mode === "login"
                    ? "Signing in..."
                    : "Creating account..."
                  : mode === "login"
                    ? "Sign in"
                    : registerStep === 1
                      ? "Continue to account setup"
                      : "Create admin account"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-6 rounded-[28px] border border-sky-100 bg-slate-50/70 px-5 py-4 text-sm text-slate-600">
              {mode === "login"
                ? "Need a new clinic owner account?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => handleModeChange(mode === "login" ? "register" : "login")}
                className="font-semibold text-sky-700 transition hover:text-sky-800"
              >
                {mode === "login" ? "Create account" : "Sign in instead"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
