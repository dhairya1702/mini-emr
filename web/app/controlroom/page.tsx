"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Database,
  FileText,
  RefreshCw,
  Server,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { api } from "@/lib/api";
import {
  ControlRoomDatabase,
  ControlRoomIncident,
  ControlRoomIncidents,
  ControlRoomRunbooks,
  ControlRoomStatus,
  ControlRoomStatusValue,
} from "@/lib/types";

type Tab = "status" | "database" | "incidents" | "runbooks";

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "status", label: "Status" },
  { key: "database", label: "Database" },
  { key: "incidents", label: "Incidents" },
  { key: "runbooks", label: "Runbooks" },
];

const statusStyle: Record<ControlRoomStatusValue, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  failing: "border-rose-200 bg-rose-50 text-rose-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-700",
};

const emptyStatus: ControlRoomStatus = {
  checked_at: "",
  overall_status: "unknown",
  checks: [],
};

const emptyDatabase: ControlRoomDatabase = {
  checked_at: "",
  reachable: false,
  migration_status: "unknown",
  pending_migrations: [],
  database_only_migrations: [],
  applied_migrations: [],
  table_stats: [],
  integrity_checks: [],
};

const emptyIncidents: ControlRoomIncidents = {
  checked_at: "",
  window_hours: 24,
  incidents: [],
};

const emptyRunbooks: ControlRoomRunbooks = {
  runbooks: [],
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusIcon(status: ControlRoomStatusValue) {
  if (status === "healthy") return <CheckCircle2 className="h-5 w-5" />;
  if (status === "failing") return <XCircle className="h-5 w-5" />;
  if (status === "warning") return <AlertTriangle className="h-5 w-5" />;
  return <ShieldAlert className="h-5 w-5" />;
}

function StatusPill({ status }: { status: ControlRoomStatusValue }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-bold uppercase ${statusStyle[status]}`}>
      {statusIcon(status)}
      {status}
    </span>
  );
}

function SectionHeader({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="text-slate-500">{icon}</span>
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-500">{title}</h2>
      </div>
      {right}
    </div>
  );
}

function copyCommand(command: string) {
  if (!command) return;
  void navigator.clipboard?.writeText(command);
}

export default function ControlRoomPage() {
  const [tab, setTab] = useState<Tab>("status");
  const [status, setStatus] = useState<ControlRoomStatus>(emptyStatus);
  const [database, setDatabase] = useState<ControlRoomDatabase>(emptyDatabase);
  const [incidents, setIncidents] = useState<ControlRoomIncidents>(emptyIncidents);
  const [runbooks, setRunbooks] = useState<ControlRoomRunbooks>(emptyRunbooks);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const failingIntegrity = useMemo(
    () => database.integrity_checks.filter((check) => check.status === "failing"),
    [database.integrity_checks],
  );

  async function load() {
    setIsLoading(true);
    setMessage("");
    try {
      const [statusData, databaseData, incidentData, runbookData] = await Promise.all([
        api.getControlRoomStatus(),
        api.getControlRoomDatabase(),
        api.getControlRoomIncidents(24),
        api.getControlRoomRunbooks(),
      ]);
      setStatus(statusData);
      setDatabase(databaseData);
      setIncidents(incidentData);
      setRunbooks(runbookData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load control room.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 pb-12 text-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Server className="h-6 w-6 text-blue-600" />
              <h1 className="text-2xl font-black">Control Room</h1>
              <StatusPill status={status.overall_status} />
            </div>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              Production safety, database integrity, incidents, and runbooks.
            </p>
          </div>
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-600 transition hover:text-slate-950 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-md px-4 py-2 text-sm font-black transition ${
                tab === item.key ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:text-slate-950"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <section className="space-y-6 px-6 py-6">
        {message ? (
          <div className="rounded-md border border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-700">
            {message}
          </div>
        ) : null}

        {tab === "status" ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {status.checks.map((check) => (
              <div key={check.key} className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-black">{check.label}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">
                      {formatDateTime(check.checked_at)}
                    </p>
                  </div>
                  <StatusPill status={check.status} />
                </div>
                <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">{check.evidence}</p>
                {check.next_action ? (
                  <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">{check.next_action}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {tab === "database" ? (
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Reachable</p>
                <p className="mt-3 text-2xl font-black">{database.reachable ? "Yes" : "No"}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Migrations</p>
                <div className="mt-3"><StatusPill status={database.migration_status} /></div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Pending</p>
                <p className="mt-3 text-2xl font-black">{database.pending_migrations.length}</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500">Integrity failures</p>
                <p className="mt-3 text-2xl font-black">{failingIntegrity.length}</p>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-white shadow-sm">
              <SectionHeader icon={<Database className="h-5 w-5" />} title="Tenant Integrity" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Check</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Invalid rows</th>
                      <th className="px-5 py-3">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {database.integrity_checks.map((check) => (
                      <tr key={check.key} className="border-t border-slate-100">
                        <td className="px-5 py-3 font-bold">{check.label}</td>
                        <td className="px-5 py-3"><StatusPill status={check.status} /></td>
                        <td className="px-5 py-3 font-black">{check.invalid_count}</td>
                        <td className="px-5 py-3 font-semibold text-slate-600">{check.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-white shadow-sm">
                <SectionHeader icon={<FileText className="h-5 w-5" />} title="Applied Migrations" />
                <div className="max-h-[420px] overflow-auto">
                  {database.pending_migrations.length || database.database_only_migrations.length ? (
                    <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-800">
                      {database.pending_migrations.length} pending, {database.database_only_migrations.length} database-only records.
                    </div>
                  ) : null}
                  {database.applied_migrations.slice(0, 30).map((migration) => (
                    <div key={migration.name} className="border-b border-slate-100 px-5 py-3 last:border-0">
                      <p className="font-black">{migration.name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(migration.applied_at)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-white shadow-sm">
                <SectionHeader icon={<Database className="h-5 w-5" />} title="Table Estimates" />
                <div className="max-h-[420px] overflow-auto">
                  {database.table_stats.map((table) => (
                    <div key={table.table_name} className="flex items-center justify-between border-b border-slate-100 px-5 py-3 last:border-0">
                      <span className="font-bold">{table.table_name}</span>
                      <span className="font-black">{table.estimated_rows.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "incidents" ? (
          <div className="rounded-md border border-slate-200 bg-white shadow-sm">
            <SectionHeader
              icon={<AlertTriangle className="h-5 w-5" />}
              title="Grouped Incidents"
              right={<span className="text-sm font-bold text-slate-500">Last {incidents.window_hours}h</span>}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Severity</th>
                    <th className="px-5 py-3">Route</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Count</th>
                    <th className="px-5 py-3">Orgs</th>
                    <th className="px-5 py-3">First</th>
                    <th className="px-5 py-3">Last</th>
                    <th className="px-5 py-3">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.incidents.map((incident: ControlRoomIncident) => (
                    <tr key={incident.fingerprint} className="border-t border-slate-100 align-top">
                      <td className="px-5 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black uppercase">{incident.severity}</span></td>
                      <td className="px-5 py-3 font-black">{incident.method} {incident.path}</td>
                      <td className="px-5 py-3 font-bold text-slate-600">{incident.error_type} {incident.status_code ? `· ${incident.status_code}` : ""}</td>
                      <td className="px-5 py-3 font-black">{incident.count}</td>
                      <td className="px-5 py-3 font-black">{incident.affected_org_count}</td>
                      <td className="px-5 py-3 font-semibold text-slate-500">{formatDateTime(incident.first_seen_at)}</td>
                      <td className="px-5 py-3 font-semibold text-slate-500">{formatDateTime(incident.last_seen_at)}</td>
                      <td className="px-5 py-3 font-semibold text-slate-600">{incident.message}</td>
                    </tr>
                  ))}
                  {!incidents.incidents.length ? (
                    <tr><td className="px-5 py-8 text-center font-bold text-slate-500" colSpan={8}>No incidents in this window.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === "runbooks" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {runbooks.runbooks.map((runbook) => (
              <div key={runbook.key} className="rounded-md border border-slate-200 bg-white shadow-sm">
                <SectionHeader icon={<FileText className="h-5 w-5" />} title={runbook.title} />
                <div className="space-y-3 p-5">
                  <p className="text-sm font-semibold leading-6 text-slate-600">{runbook.summary}</p>
                  {runbook.steps.map((step) => (
                    <div key={`${runbook.key}-${step.label}`} className={`rounded-md border p-3 ${step.dangerous ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black">{step.label}</p>
                          {step.note ? <p className="mt-1 text-sm font-semibold text-slate-600">{step.note}</p> : null}
                        </div>
                        {step.dangerous ? <span className="rounded-md bg-rose-100 px-2 py-1 text-xs font-black uppercase text-rose-700">Risky</span> : null}
                      </div>
                      {step.command ? (
                        <button
                          onClick={() => copyCommand(step.command)}
                          className="mt-3 flex w-full items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-left font-mono text-xs font-bold text-slate-700 transition hover:border-blue-300"
                        >
                          <span className="break-all">{step.command}</span>
                          <Clipboard className="h-4 w-4 flex-none text-slate-400" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
