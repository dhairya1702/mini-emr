"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClinicShell } from "@/components/clinic-shell-provider";
import { api } from "@/lib/api";
import { PlatformError, SuperuserOrgDetail, SuperuserOrgSummary } from "@/lib/types";

type SuperuserTab = "dashboard" | "orgs" | "errors";
type SuperuserTheme = "light" | "dark";
const SUPERUSER_THEME_STORAGE_KEY = "clinic_superuser_theme_v1";

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function SuperuserPage() {
  const { currentUser, isAuthReady, isRedirectingToLogin, handleLogout } = useClinicShell();
  const [activeTab, setActiveTab] = useState<SuperuserTab>("dashboard");
  const [theme, setTheme] = useState<SuperuserTheme>("light");
  const [orgs, setOrgs] = useState<SuperuserOrgSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedOrgDetail, setSelectedOrgDetail] = useState<SuperuserOrgDetail | null>(null);
  const [errors, setErrors] = useState<PlatformError[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const selectedOrgIdRef = useRef("");

  useEffect(() => {
    selectedOrgIdRef.current = selectedOrgId;
  }, [selectedOrgId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedTheme = window.localStorage.getItem(SUPERUSER_THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SUPERUSER_THEME_STORAGE_KEY, theme);
  }, [theme]);

  const loadDashboard = useCallback(async (preferredOrgId?: string) => {
    setIsLoading(true);
    setError("");
    try {
      const [nextOrgs, nextErrors] = await Promise.all([
        api.listSuperuserOrgs(),
        api.listPlatformErrors(50),
      ]);
      setOrgs(nextOrgs);
      setErrors(nextErrors);

      const orgIdToLoad = preferredOrgId || selectedOrgIdRef.current || nextOrgs[0]?.org_id || "";
      if (!orgIdToLoad) {
        setSelectedOrgId("");
        selectedOrgIdRef.current = "";
        setSelectedOrgDetail(null);
        setStatus("No organizations found.");
        return;
      }

      setSelectedOrgId(orgIdToLoad);
      selectedOrgIdRef.current = orgIdToLoad;
      const detail = await api.getSuperuserOrgDetail(orgIdToLoad);
      setSelectedOrgDetail(detail);
      setStatus("Dashboard refreshed.");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load superuser dashboard.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthReady || isRedirectingToLogin) {
      return;
    }
    void loadDashboard();
  }, [isAuthReady, isRedirectingToLogin, loadDashboard]);

  const selectedOrgSummary = useMemo(
    () => orgs.find((org) => org.org_id === selectedOrgId) ?? null,
    [orgs, selectedOrgId],
  );

  const overview = useMemo(() => {
    const totals = orgs.reduce(
      (acc, org) => {
        acc.orgCount += 1;
        acc.userCount += org.user_count;
        acc.patientCount += org.patient_count;
        acc.noteCount += org.note_count;
        acc.invoiceCount += org.invoice_count;
        acc.followUpCount += org.follow_up_count;
        acc.totalTokens += org.total_tokens;
        return acc;
      },
      {
        orgCount: 0,
        userCount: 0,
        patientCount: 0,
        noteCount: 0,
        invoiceCount: 0,
        followUpCount: 0,
        totalTokens: 0,
      },
    );

    return {
      ...totals,
      errorCount: errors.length,
      hotOrgs: [...orgs]
        .sort((left, right) => right.total_tokens - left.total_tokens)
        .slice(0, 3),
      activeOrgs: [...orgs]
        .sort((left, right) => {
          const rightTime = right.last_activity_at ? new Date(right.last_activity_at).getTime() : 0;
          const leftTime = left.last_activity_at ? new Date(left.last_activity_at).getTime() : 0;
          return rightTime - leftTime;
        })
        .slice(0, 3),
    };
  }, [errors.length, orgs]);

  async function handleSelectOrg(orgId: string) {
    if (orgId === selectedOrgIdRef.current && selectedOrgDetail?.summary.org_id === orgId) {
      return;
    }
    setSelectedOrgId(orgId);
    selectedOrgIdRef.current = orgId;
    setStatus("");
    setError("");
    try {
      const detail = await api.getSuperuserOrgDetail(orgId);
      setSelectedOrgDetail(detail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load organization details.");
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!selectedOrgDetail) {
      return;
    }
    if (!window.confirm("Delete this user? This cannot be undone.")) {
      return;
    }
    setIsDeleting(true);
    setError("");
    setStatus("");
    try {
      await api.deleteSuperuserUser(userId);
      await loadDashboard(selectedOrgDetail.summary.org_id);
      setStatus("User deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete user.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDeleteOrg() {
    if (!selectedOrgDetail) {
      return;
    }
    if (!window.confirm(`Delete ${selectedOrgDetail.summary.clinic_name}? This removes the entire org.`)) {
      return;
    }
    setIsDeleting(true);
    setError("");
    setStatus("");
    try {
      await api.deleteSuperuserOrg(selectedOrgDetail.summary.org_id);
      await loadDashboard();
      setStatus("Organization deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete organization.");
    } finally {
      setIsDeleting(false);
    }
  }

  const isDark = theme === "dark";
  const surface = isDark ? "bg-slate-925 border-slate-800 shadow-[0_16px_40px_rgba(0,0,0,0.28)]" : "bg-white border-slate-200 shadow-[0_20px_60px_rgba(148,163,184,0.14)]";
  const softSurface = isDark ? "bg-slate-900 border-slate-800" : "bg-slate-50 border-slate-200";
  const strongSurface = isDark ? "bg-slate-950 border-slate-700" : "bg-white border-slate-200";
  const mainBg = isDark ? "bg-slate-950 text-slate-100" : "bg-[linear-gradient(180deg,#f5fbff_0%,#eef6ff_52%,#f9fbff_100%)] text-slate-900";
  const sectionHeader = isDark ? "text-slate-100" : "text-slate-900";
  const bodyText = isDark ? "text-slate-400" : "text-slate-600";
  const subtleText = isDark ? "text-slate-500" : "text-slate-500";
  const chip = isDark ? "border-slate-700 bg-slate-950 text-slate-300" : "border-slate-200 bg-white text-slate-600";
  const tabWrap = isDark ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-slate-100";
  const tabActive = isDark ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900 shadow-sm";
  const tabInactive = isDark ? "text-slate-400 hover:bg-slate-800 hover:text-slate-100" : "text-slate-600 hover:bg-white hover:text-slate-900";
  const rosePanel = isDark ? "border-rose-900/40 bg-rose-950/25" : "border-rose-200 bg-rose-50/90";
  const roseCard = isDark ? "border-rose-900/40 bg-slate-950/50" : "border-rose-200 bg-white";
  const roseTitle = isDark ? "text-rose-200" : "text-rose-700";
  const roseMeta = isDark ? "text-rose-200/70" : "text-rose-600";
  const dangerButton = "rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-60";
  const neutralButton = isDark ? "rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-slate-800" : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50";
  const primaryButton = isDark ? "rounded-full bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400" : "rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500";

  if (isRedirectingToLogin) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600">Redirecting to login...</div></main>;
  }

  if (!isAuthReady) {
    return <main className="flex min-h-screen items-center justify-center px-4"><div className="rounded-[30px] border border-sky-100 bg-white px-8 py-7 text-sm text-slate-600">Loading superuser dashboard...</div></main>;
  }

  return (
    <main className={cn("min-h-screen px-4 py-5 sm:px-6 lg:px-8", mainBg)}>
      <div className="mx-auto max-w-[1560px] space-y-5">
        <section className={cn("overflow-hidden rounded-[32px] border", surface, isDark && "shadow-[0_22px_60px_rgba(0,0,0,0.35)]")}>
          <div className={cn("flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4 sm:px-6", isDark ? "border-slate-800" : "border-slate-200")}>
            <div className="flex items-center gap-4">
              <div className={cn("flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold tracking-[0.18em] text-sky-300", strongSurface)}>
                SU
              </div>
              <div>
                <p className={cn("text-[11px] font-semibold uppercase tracking-[0.28em]", subtleText)}>Hidden route</p>
                <h1 className={cn("mt-1 text-2xl font-semibold tracking-[-0.03em]", sectionHeader)}>Superuser control room</h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className={cn("inline-flex rounded-full border p-1", tabWrap)}>
                {(["dashboard", "orgs", "errors"] as SuperuserTab[]).map((tab) => {
                  const active = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActiveTab(tab)}
                      className={cn("rounded-full px-4 py-2 text-sm font-medium capitalize transition", active ? tabActive : tabInactive)}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
                className={neutralButton}
              >
                {isDark ? "Dark mode" : "Light mode"}
              </button>
              <button
                type="button"
                onClick={() => void loadDashboard(selectedOrgIdRef.current)}
                className={neutralButton}
              >
                {isLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className={primaryButton}
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="max-w-[70ch]">
                <p className={cn("text-sm leading-7", bodyText)}>
                  Platform-wide visibility across clinic organizations, user access, usage pressure, and backend failures.
                </p>
                {currentUser ? (
                  <p className={cn("mt-2 text-xs uppercase tracking-[0.18em]", subtleText)}>
                    Signed in as {currentUser.identifier}
                  </p>
                ) : null}
              </div>
              <div className={cn("rounded-[24px] border px-4 py-3 text-right", softSurface)}>
                <p className={cn("text-[11px] uppercase tracking-[0.2em]", subtleText)}>Selected org</p>
                <p className={cn("mt-1 text-sm font-semibold", sectionHeader)}>
                  {selectedOrgSummary?.clinic_name || "No org selected"}
                </p>
                <p className={cn("mt-1 text-xs", subtleText)}>{selectedOrgSummary?.org_id || "Pick an org below"}</p>
              </div>
            </div>

            {error ? <div className="mt-4 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
            {status ? <div className="mt-4 rounded-[20px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{status}</div> : null}
          </div>
        </section>

        {activeTab === "dashboard" ? (
          <div className="space-y-5">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                ["Organizations", overview.orgCount, "Total clinics currently onboarded."],
                ["Users", overview.userCount, "All staff and admin accounts across orgs."],
                ["Errors", overview.errorCount, "Recent platform errors in the current feed."],
                ["Tokens", overview.totalTokens, "Total recorded AI token usage across orgs."],
              ].map(([label, value, copy], index) => (
                <article
                  key={String(label)}
                  className={cn("rounded-[30px] border px-5 py-5", index === 2 ? rosePanel : index === 0 ? surface : softSurface)}
                >
                  <p className={cn("text-[11px] uppercase tracking-[0.22em]", subtleText)}>{label}</p>
                  <p className={cn("mt-5 text-4xl font-semibold tracking-[-0.05em]", sectionHeader)}>{formatNumber(Number(value))}</p>
                  <p className={cn("mt-3 max-w-[26ch] text-sm leading-6", bodyText)}>{copy}</p>
                </article>
              ))}
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <article className={cn("rounded-[30px] border p-5", surface)}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={cn("text-[11px] uppercase tracking-[0.22em]", subtleText)}>Platform volume</p>
                    <h2 className={cn("mt-2 text-2xl font-semibold tracking-[-0.03em]", sectionHeader)}>Operational totals</h2>
                  </div>
                  <div className={cn("rounded-full border px-3 py-1 text-xs font-medium", chip)}>
                    Manual refresh only
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["Patients", overview.patientCount],
                    ["Notes", overview.noteCount],
                    ["Invoices", overview.invoiceCount],
                    ["Follow-ups", overview.followUpCount],
                    ["Active orgs", overview.activeOrgs.length],
                    ["Recent errors", overview.errorCount],
                  ].map(([label, value]) => (
                    <div key={String(label)} className={cn("rounded-[22px] border px-4 py-4", softSurface)}>
                      <p className={cn("text-[11px] uppercase tracking-[0.2em]", subtleText)}>{label}</p>
                      <p className={cn("mt-3 text-2xl font-semibold tracking-[-0.03em]", sectionHeader)}>{formatNumber(Number(value))}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className={cn("rounded-[30px] border p-5", surface)}>
                <p className={cn("text-[11px] uppercase tracking-[0.22em]", subtleText)}>Current org</p>
                <h2 className={cn("mt-2 text-2xl font-semibold tracking-[-0.03em]", sectionHeader)}>
                  {selectedOrgSummary?.clinic_name || "No org selected"}
                </h2>
                <p className={cn("mt-2 max-w-[34ch] text-sm leading-6", bodyText)}>
                  Quick snapshot of the org you are currently drilling into.
                </p>
                <div className="mt-5 space-y-3">
                  {selectedOrgDetail ? (
                    <>
                      {[
                        ["Users", selectedOrgDetail.summary.user_count],
                        ["Patients", selectedOrgDetail.summary.patient_count],
                        ["Notes", selectedOrgDetail.summary.note_count],
                        ["Invoices", selectedOrgDetail.summary.invoice_count],
                        ["Tokens", selectedOrgDetail.summary.total_tokens],
                      ].map(([label, value]) => (
                        <div key={String(label)} className={cn("flex items-center justify-between rounded-[20px] border px-4 py-3 text-sm", softSurface, isDark ? "text-slate-200" : "text-slate-700")}>
                          <span>{label}</span>
                          <span className="font-semibold">{formatNumber(Number(value))}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p className={cn("text-sm", bodyText)}>Pick an organization to see its detail snapshot.</p>
                  )}
                </div>
              </article>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <article className={cn("rounded-[30px] border p-5", surface)}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={cn("text-[11px] uppercase tracking-[0.22em]", subtleText)}>Highest usage</p>
                    <h3 className={cn("mt-2 text-xl font-semibold tracking-[-0.03em]", sectionHeader)}>Top token orgs</h3>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {overview.hotOrgs.length ? overview.hotOrgs.map((org, index) => (
                    <button
                      key={org.org_id}
                      type="button"
                      onClick={() => {
                        setActiveTab("orgs");
                        void handleSelectOrg(org.org_id);
                      }}
                      className={cn("flex w-full items-center justify-between rounded-[22px] border px-4 py-4 text-left transition", softSurface, isDark ? "hover:bg-slate-800" : "hover:bg-slate-100")}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn("flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold text-sky-300", strongSurface)}>
                          {index + 1}
                        </div>
                        <div>
                          <p className={cn("text-sm font-semibold", sectionHeader)}>{org.clinic_name}</p>
                          <p className={cn("mt-1 text-xs", subtleText)}>{org.user_count} users • {org.invoice_count} invoices</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={cn("text-sm font-semibold", sectionHeader)}>{formatNumber(org.total_tokens)}</p>
                        <p className={cn("mt-1 text-xs", subtleText)}>tokens</p>
                      </div>
                    </button>
                  )) : <p className={cn("text-sm", bodyText)}>No org usage data yet.</p>}
                </div>
              </article>

              <article className={cn("rounded-[30px] border p-5", rosePanel)}>
                <p className={cn("text-[11px] uppercase tracking-[0.22em]", roseMeta)}>Recent failures</p>
                <h3 className={cn("mt-2 text-xl font-semibold tracking-[-0.03em]", sectionHeader)}>Error pulse</h3>
                <div className="mt-5 space-y-3">
                  {errors.slice(0, 4).length ? errors.slice(0, 4).map((entry) => (
                    <div key={entry.id} className={cn("rounded-[22px] border px-4 py-4", roseCard)}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className={cn("text-sm font-semibold", roseTitle)}>{entry.error_type}</p>
                        <p className={cn("text-xs", roseMeta)}>{formatDateTime(entry.created_at)}</p>
                      </div>
                      <p className={cn("mt-2 text-sm leading-6", isDark ? "text-slate-300" : "text-slate-700")}>{entry.message}</p>
                      <p className={cn("mt-2 text-xs uppercase tracking-[0.14em]", roseMeta)}>
                        {entry.method} {entry.path}
                      </p>
                    </div>
                  )) : <p className={cn("text-sm", bodyText)}>No recent errors recorded.</p>}
                </div>
              </article>
            </section>
          </div>
        ) : null}

        {activeTab === "orgs" ? (
          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className={cn("rounded-[30px] border p-5", surface)}>
              <div className="mb-4">
                <p className={cn("text-[11px] uppercase tracking-[0.22em]", subtleText)}>Organizations</p>
                <h2 className={cn("mt-2 text-xl font-semibold tracking-[-0.03em]", sectionHeader)}>{orgs.length} orgs</h2>
              </div>
              <div className="space-y-3">
                {orgs.map((org) => {
                  const active = org.org_id === selectedOrgId;
                  return (
                    <button
                      key={org.org_id}
                      type="button"
                      onClick={() => void handleSelectOrg(org.org_id)}
                      className={cn("w-full rounded-[24px] border px-4 py-4 text-left transition", active ? (isDark ? "border-sky-500/50 bg-slate-900" : "border-sky-400 bg-sky-50") : softSurface, !active && (isDark ? "hover:bg-slate-800" : "hover:bg-slate-100"))}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className={cn("text-sm font-semibold", sectionHeader)}>{org.clinic_name}</p>
                          <p className={cn("mt-1 text-xs", subtleText)}>{org.org_id}</p>
                        </div>
                        <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", chip)}>
                          {org.user_count} users
                        </span>
                      </div>
                      <div className={cn("mt-3 grid grid-cols-2 gap-2 text-xs", bodyText)}>
                        <span>{org.patient_count} patients</span>
                        <span>{org.note_count} notes</span>
                        <span>{org.invoice_count} invoices</span>
                        <span>{formatNumber(org.total_tokens)} tokens</span>
                      </div>
                      <p className={cn("mt-3 text-xs", subtleText)}>Last activity: {formatDateTime(org.last_activity_at)}</p>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="space-y-5">
              <section className={cn("rounded-[30px] border p-5", surface)}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className={cn("text-[11px] uppercase tracking-[0.22em]", subtleText)}>Organization detail</p>
                    <h2 className={cn("mt-2 text-2xl font-semibold tracking-[-0.03em]", sectionHeader)}>{selectedOrgSummary?.clinic_name || "Select an org"}</h2>
                    <p className={cn("mt-1 text-sm", bodyText)}>{selectedOrgSummary?.org_id || "Choose an org from the list."}</p>
                  </div>
                  <button
                    type="button"
                    disabled={!selectedOrgDetail || isDeleting}
                    onClick={() => void handleDeleteOrg()}
                    className={dangerButton}
                  >
                    Delete org
                  </button>
                </div>
                {selectedOrgDetail ? (
                  <>
                    <div className={cn("mt-5 rounded-[24px] border px-4 py-4", rosePanel)}>
                      <p className={cn("text-[11px] uppercase tracking-[0.18em]", roseMeta)}>Danger zone</p>
                      <p className={cn("mt-2 text-sm leading-6", isDark ? "text-slate-300" : "text-slate-700")}>
                        Deleting an organization removes its users and the entire org record. Use this only for broken test orgs or explicit admin cleanup.
                      </p>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                    {[
                      ["Users", selectedOrgDetail.summary.user_count],
                      ["Patients", selectedOrgDetail.summary.patient_count],
                      ["Notes", selectedOrgDetail.summary.note_count],
                      ["Invoices", selectedOrgDetail.summary.invoice_count],
                      ["Follow-ups", selectedOrgDetail.summary.follow_up_count],
                      ["Tokens", selectedOrgDetail.summary.total_tokens],
                    ].map(([label, value]) => (
                      <div key={String(label)} className={cn("rounded-[22px] border px-4 py-3", softSurface)}>
                        <p className={cn("text-[11px] uppercase tracking-[0.16em]", subtleText)}>{label}</p>
                        <p className={cn("mt-2 text-lg font-semibold", sectionHeader)}>{formatNumber(Number(value))}</p>
                      </div>
                    ))}
                    </div>
                  </>
                ) : null}
              </section>

              <section className={cn("rounded-[30px] border p-5", surface)}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className={cn("text-lg font-semibold", sectionHeader)}>Users</h3>
                  <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", chip)}>
                    {selectedOrgDetail?.users.length || 0} loaded
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  {selectedOrgDetail?.users.length ? selectedOrgDetail.users.map((user) => (
                    <div key={user.id} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-[22px] border px-4 py-3", softSurface)}>
                      <div>
                        <p className={cn("text-sm font-semibold", sectionHeader)}>{user.name}</p>
                        <p className={cn("mt-1 text-xs", subtleText)}>{user.identifier}</p>
                        <p className={cn("mt-1 text-xs", bodyText)}>Created {formatDateTime(user.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={cn("rounded-full border px-3 py-1 text-xs font-medium", chip)}>{user.role}</span>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => void handleDeleteUser(user.id)}
                          className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )) : <p className={cn("text-sm", bodyText)}>No users loaded.</p>}
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-2">
                <section className={cn("rounded-[30px] border p-5", surface)}>
                  <h3 className={cn("text-lg font-semibold", sectionHeader)}>Usage</h3>
                  <div className={cn("mt-4 rounded-[22px] border px-4 py-3", softSurface)}>
                    <p className={cn("text-sm", bodyText)}>Total requests: {formatNumber(selectedOrgDetail?.usage.total_requests || 0)}</p>
                    <p className={cn("mt-1 text-sm", bodyText)}>Total tokens: {formatNumber(selectedOrgDetail?.usage.total_tokens || 0)}</p>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selectedOrgDetail ? Object.entries(selectedOrgDetail.usage.by_feature).map(([feature, tokens]) => (
                      <div key={feature} className={cn("flex items-center justify-between rounded-[18px] border px-4 py-2 text-sm", softSurface, isDark ? "text-slate-200" : "text-slate-700")}>
                        <span>{feature}</span>
                        <span>{formatNumber(tokens)}</span>
                      </div>
                    )) : null}
                  </div>
                </section>

                <section className={cn("rounded-[30px] border p-5", rosePanel)}>
                  <h3 className={cn("text-lg font-semibold", sectionHeader)}>Recent org errors</h3>
                  <div className="mt-4 space-y-3">
                    {selectedOrgDetail?.recent_errors.length ? selectedOrgDetail.recent_errors.map((entry) => (
                      <div key={entry.id} className={cn("rounded-[20px] border px-4 py-3", roseCard)}>
                        <p className={cn("text-sm font-semibold", roseTitle)}>{entry.error_type}</p>
                        <p className={cn("mt-1 text-sm", isDark ? "text-slate-300" : "text-slate-700")}>{entry.message}</p>
                        <p className={cn("mt-2 text-xs", roseMeta)}>{entry.method} {entry.path} • {formatDateTime(entry.created_at)}</p>
                      </div>
                    )) : <p className={cn("text-sm", bodyText)}>No recent org errors.</p>}
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "errors" ? (
          <section className={cn("rounded-[30px] border p-5", rosePanel)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className={cn("text-[11px] uppercase tracking-[0.22em]", roseMeta)}>Errors</p>
                <h2 className={cn("mt-2 text-2xl font-semibold tracking-[-0.03em]", sectionHeader)}>Recent platform failures</h2>
                <p className={cn("mt-2 max-w-[65ch] text-sm leading-6", bodyText)}>
                  Durable error feed for backend failures across all orgs. Refresh when you want a fresh view.
                </p>
              </div>
              <div className={cn("rounded-[22px] border px-4 py-3 text-right", roseCard)}>
                <p className={cn("text-[11px] uppercase tracking-[0.18em]", roseMeta)}>Entries loaded</p>
                <p className={cn("mt-1 text-2xl font-semibold", sectionHeader)}>{formatNumber(errors.length)}</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {errors.length ? errors.map((entry) => (
                <div key={entry.id} className={cn("rounded-[22px] border px-4 py-4", roseCard)}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className={cn("text-sm font-semibold", roseTitle)}>{entry.error_type}</p>
                      <p className={cn("mt-1 text-xs uppercase tracking-[0.14em]", roseMeta)}>
                        {entry.method} {entry.path}
                      </p>
                    </div>
                    <p className={cn("text-xs", roseMeta)}>{formatDateTime(entry.created_at)}</p>
                  </div>
                  <p className={cn("mt-3 text-sm leading-6", isDark ? "text-slate-300" : "text-slate-700")}>{entry.message}</p>
                  <div className={cn("mt-3 flex flex-wrap gap-2 text-xs", roseMeta)}>
                    {entry.identifier ? <span className={cn("rounded-full border px-3 py-1", roseCard)}>{entry.identifier}</span> : null}
                    {entry.org_id ? <span className={cn("rounded-full border px-3 py-1", roseCard)}>{entry.org_id}</span> : null}
                    {entry.status_code ? <span className={cn("rounded-full border px-3 py-1", roseCard)}>HTTP {entry.status_code}</span> : null}
                  </div>
                </div>
              )) : <p className={cn("text-sm", bodyText)}>No errors recorded.</p>}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
