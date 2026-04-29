"use client";

import { useMemo, useState } from "react";
import type { BusinessWithAssessment, JackStatus } from "@/lib/db";
import { labelForCategory } from "@/lib/scoring";
import { cn } from "@/lib/cn";

const JACK_STATUSES: JackStatus[] = [
  "not_assessed", "assessed", "pitch_drafted", "contacted", "replied", "meeting", "client", "dead",
];

interface Props {
  initialRows: BusinessWithAssessment[];
}

export function WebClient({ initialRows }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [filterStatus, setFilterStatus] = useState<JackStatus | "">("");
  const [minPriority, setMinPriority] = useState(0);
  const [maxQuality, setMaxQuality] = useState(100);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pitchResult, setPitchResult] = useState<Record<string, { subject: string; body: string; teardown: string }>>({});

  const summary = useMemo(() => {
    const total = rows.length;
    const assessed = rows.filter((r) => r.assessment).length;
    const highPriority = rows.filter((r) => (r.assessment?.pitch_priority ?? 0) >= 50).length;
    const noWebsite = rows.filter((r) => !r.website).length;
    return { total, assessed, highPriority, noWebsite };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const a = r.assessment;
      const status = (a?.jack_status || "not_assessed") as JackStatus;
      if (filterStatus && status !== filterStatus) return false;
      if ((a?.pitch_priority ?? 0) < minPriority) return false;
      if ((a?.quality_score ?? 0) > maxQuality) return false;
      if (search && !`${r.name} ${r.address || ""} ${r.website || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, filterStatus, minPriority, maxQuality, search]);

  async function assess(businessId: string) {
    setBusyId(businessId);
    try {
      const res = await fetch("/api/assess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId }),
      });
      if (!res.ok) {
        alert(`Assess failed: ${await res.text()}`);
        return;
      }
      const { assessment } = await res.json();
      setRows((prev) => prev.map((r) => (r.id === businessId ? { ...r, assessment } : r)));
    } finally {
      setBusyId(null);
    }
  }

  async function draftPitch(businessId: string) {
    setBusyId(businessId);
    try {
      const res = await fetch("/api/draft-pitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId }),
      });
      if (!res.ok) {
        alert(`Draft failed: ${await res.text()}`);
        return;
      }
      const { draft } = await res.json();
      setPitchResult((p) => ({ ...p, [businessId]: { subject: draft.subject, body: draft.body, teardown: draft.teardown } }));
      setRows((prev) =>
        prev.map((r) =>
          r.id === businessId && r.assessment
            ? { ...r, assessment: { ...r.assessment, jack_status: "pitch_drafted" as JackStatus } }
            : r
        )
      );
    } finally {
      setBusyId(null);
    }
  }

  async function patchStatus(businessId: string, updates: { jack_status?: JackStatus; jack_notes?: string }) {
    const res = await fetch("/api/web-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, ...updates }),
    });
    if (!res.ok) {
      alert(`Update failed: ${await res.text()}`);
      return;
    }
    const { assessment } = await res.json();
    setRows((prev) => prev.map((r) => (r.id === businessId ? { ...r, assessment } : r)));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--color-border)] bg-gradient-to-br from-[#1F4E3D] to-[#143229] text-white p-5">
        <div className="text-xs uppercase tracking-wider text-white/70">Warman Consulting</div>
        <h1 className="text-2xl font-semibold mt-1" style={{ fontFamily: "var(--font-serif)" }}>
          Local web rebuild prospects
        </h1>
        <p className="text-sm text-white/80 mt-1 max-w-2xl">
          Same Palm Beach businesses Maurizio is pitching for catering — sorted instead by{" "}
          <em>how much their website needs work × how good a customer they&apos;d be</em>.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Businesses" value={summary.total.toString()} />
        <StatCard label="Assessed" value={`${summary.assessed} / ${summary.total}`} />
        <StatCard label="High priority" value={summary.highPriority.toString()} accent />
        <StatCard label="No website" value={summary.noWebsite.toString()} />
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-white"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as JackStatus | "")}
          className="px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-white"
        >
          <option value="">All statuses</option>
          {JACK_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          Min priority
          <input type="number" min="0" max="100" value={minPriority}
            onChange={(e) => setMinPriority(parseInt(e.target.value) || 0)}
            className="w-16 px-2 py-1 text-sm rounded-md border border-[var(--color-border)] bg-white" />
        </label>
        <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          Max site quality
          <input type="number" min="0" max="100" value={maxQuality}
            onChange={(e) => setMaxQuality(parseInt(e.target.value) || 100)}
            className="w-16 px-2 py-1 text-sm rounded-md border border-[var(--color-border)] bg-white" />
        </label>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-border-light)] text-[var(--color-muted)]">
            <tr className="text-left">
              <Th>Business</Th>
              <Th>Priority</Th>
              <Th>Site quality</Th>
              <Th>Stack</Th>
              <Th>Status</Th>
              <Th>{null}</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-[var(--color-muted)]">No matches.</td></tr>
            )}
            {filtered.map((r) => (
              <Row
                key={r.id}
                row={r}
                expanded={openId === r.id}
                onToggle={() => setOpenId(openId === r.id ? null : r.id)}
                onAssess={() => assess(r.id)}
                onDraft={() => draftPitch(r.id)}
                onPatchStatus={(updates) => patchStatus(r.id, updates)}
                busy={busyId === r.id}
                pitch={pitchResult[r.id] || null}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--color-muted)] text-center">
        {filtered.length} of {rows.length} prospects · sorted by pitch priority
      </p>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="text-xs text-[var(--color-muted)] uppercase tracking-wide">{label}</div>
      <div
        className="text-2xl font-semibold mt-1"
        style={{ color: accent ? "var(--color-accent)" : undefined, fontFamily: "var(--font-serif)" }}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">{children}</th>;
}

function Row({
  row, expanded, onToggle, onAssess, onDraft, onPatchStatus, busy, pitch,
}: {
  row: BusinessWithAssessment;
  expanded: boolean;
  onToggle: () => void;
  onAssess: () => void;
  onDraft: () => void;
  onPatchStatus: (u: { jack_status?: JackStatus; jack_notes?: string }) => void;
  busy: boolean;
  pitch: { subject: string; body: string; teardown: string } | null;
}) {
  const a = row.assessment;
  const issues: string[] = a ? JSON.parse(a.issues_json || "[]") : [];

  return (
    <>
      <tr className="border-t border-[var(--color-border)] hover:bg-[var(--color-border-light)]/40">
        <td className="px-3 py-2.5">
          <button onClick={onToggle} className="text-left">
            <div className="font-medium">{row.name}</div>
            <div className="text-xs text-[var(--color-muted)]">
              {labelForCategory(row.category)}
              {row.website && (
                <>
                  {" · "}
                  <span className="font-mono">{row.website.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 30)}</span>
                </>
              )}
              {!row.website && <span className="text-[var(--color-warning)]"> · no website</span>}
            </div>
          </button>
        </td>
        <td className="px-3 py-2.5">
          {a ? <PriorityBadge value={a.pitch_priority} /> : <span className="text-xs text-[var(--color-muted)]">—</span>}
        </td>
        <td className="px-3 py-2.5">
          {a ? <QualityBadge value={a.quality_score} /> : <span className="text-xs text-[var(--color-muted)]">—</span>}
        </td>
        <td className="px-3 py-2.5 text-xs">
          {a?.tech_stack || <span className="text-[var(--color-muted)]">—</span>}
          {a?.response_ms != null && (
            <div className="text-[var(--color-muted)]">{a.response_ms}ms</div>
          )}
        </td>
        <td className="px-3 py-2.5">
          {a ? (
            <select
              value={a.jack_status}
              onChange={(e) => onPatchStatus({ jack_status: e.target.value as JackStatus })}
              className={cn(
                "text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white",
                a.jack_status === "client" && "text-[var(--color-success)] font-medium",
                a.jack_status === "dead" && "text-[var(--color-muted)]"
              )}
            >
              {JACK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <span className="text-xs text-[var(--color-muted)]">not assessed</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {!a ? (
            <button
              onClick={onAssess}
              disabled={busy}
              className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-accent)] hover:text-white hover:border-[var(--color-accent)] transition disabled:opacity-50"
            >
              {busy ? "Assessing…" : "Assess"}
            </button>
          ) : (
            <button
              onClick={onDraft}
              disabled={busy}
              className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-accent)] hover:text-white hover:border-[var(--color-accent)] transition disabled:opacity-50"
            >
              {busy ? "Drafting…" : "Draft pitch"}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[var(--color-border-light)]/30">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 text-xs">
                {row.website && (
                  <div>
                    <a href={row.website} target="_blank" rel="noreferrer" className="text-[var(--color-info)] underline">
                      {row.website}
                    </a>
                  </div>
                )}
                {a?.pitch_summary && (
                  <div className="rounded-md border border-[var(--color-border)] bg-white p-2">
                    <div className="text-[var(--color-muted)] uppercase tracking-wider text-[10px] mb-1">Pitch summary</div>
                    {a.pitch_summary}
                  </div>
                )}
                {issues.length > 0 && (
                  <div className="rounded-md border border-[var(--color-border)] bg-white p-2">
                    <div className="text-[var(--color-muted)] uppercase tracking-wider text-[10px] mb-1">Issues found</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {issues.map((i, idx) => <li key={idx}>{i}</li>)}
                    </ul>
                  </div>
                )}
                {a && (
                  <div className="grid grid-cols-2 gap-2 text-[var(--color-muted)]">
                    <div>HTTPS: <span className="text-[var(--color-foreground)]">{a.https ? "✓" : "✗"}</span></div>
                    <div>Mobile viewport: <span className="text-[var(--color-foreground)]">{a.has_viewport ? "✓" : "✗"}</span></div>
                    <div>Stack: <span className="text-[var(--color-foreground)]">{a.tech_stack || "?"}</span></div>
                    <div>Copyright: <span className="text-[var(--color-foreground)]">{a.copyright_year || "?"}</span></div>
                  </div>
                )}
                <textarea
                  placeholder="Your notes"
                  defaultValue={a?.jack_notes || ""}
                  onBlur={(e) => {
                    if (a && e.target.value !== a.jack_notes) onPatchStatus({ jack_notes: e.target.value });
                  }}
                  rows={3}
                  disabled={!a}
                  className="w-full text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white disabled:opacity-50"
                />
              </div>
              <div className="space-y-2">
                {pitch ? (
                  <>
                    <div className="rounded-md border border-[var(--color-border)] bg-white p-3 text-xs">
                      <div className="font-semibold mb-1">{pitch.subject}</div>
                      <pre className="whitespace-pre-wrap font-sans">{pitch.body}</pre>
                      <button
                        onClick={() => navigator.clipboard.writeText(`Subject: ${pitch.subject}\n\n${pitch.body}`)}
                        className="mt-2 text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-border-light)]"
                      >
                        Copy email
                      </button>
                    </div>
                    {pitch.teardown && (
                      <div className="rounded-md border border-[var(--color-border)] bg-white p-3 text-xs">
                        <div className="text-[var(--color-muted)] uppercase tracking-wider text-[10px] mb-1">Teardown (if they ask "tell me more")</div>
                        <pre className="whitespace-pre-wrap font-sans">{pitch.teardown}</pre>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-[var(--color-muted)] italic">
                    {a ? 'No pitch yet — click "Draft pitch" to generate.' : "Run Assess first to evaluate the website."}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PriorityBadge({ value }: { value: number }) {
  const color = value >= 70 ? "var(--color-accent)"
    : value >= 50 ? "var(--color-warning)"
    : value >= 25 ? "var(--color-secondary)"
    : "var(--color-muted)";
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-mono font-semibold"
      style={{ background: `${color}22`, color }}
    >
      {value}
    </span>
  );
}

function QualityBadge({ value }: { value: number }) {
  // Inverse colors — LOW quality = MORE pitchable = highlighted
  const color = value <= 30 ? "var(--color-danger)"
    : value <= 55 ? "var(--color-warning)"
    : value <= 75 ? "var(--color-secondary)"
    : "var(--color-success)";
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-mono font-semibold"
      style={{ background: `${color}22`, color }}
    >
      {value}
    </span>
  );
}
