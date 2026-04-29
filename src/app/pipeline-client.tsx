"use client";

import { useMemo, useState } from "react";
import type { Business, BusinessCategory, BusinessStatus } from "@/lib/db";
import { labelForCategory, colorForCategory } from "@/lib/scoring";
import { cn } from "@/lib/cn";

const STATUSES: BusinessStatus[] = [
  "new", "researching", "drafted", "contacted", "replied", "meeting", "customer", "dead",
];

const CATEGORIES: BusinessCategory[] = [
  "marina", "yacht_services", "law_firm", "wealth_management", "real_estate",
  "accounting", "medical", "wellness", "luxury_retail", "interior_design",
  "salon_beauty", "fitness", "property_management", "condo_association",
  "hotel", "restaurant", "office", "other",
];

interface Stats {
  total: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  avg_fit: number;
}

interface Props {
  initialBusinesses: Business[];
  summary: Stats;
}

export function PipelineClient({ initialBusinesses, summary }: Props) {
  const [businesses, setBusinesses] = useState<Business[]>(initialBusinesses);
  const [filterCategory, setFilterCategory] = useState<BusinessCategory | "">("");
  const [filterStatus, setFilterStatus] = useState<BusinessStatus | "">("");
  const [minFit, setMinFit] = useState(0);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<Record<string, { subject: string; body: string }>>({});

  const filtered = useMemo(() => {
    return businesses.filter((b) => {
      if (filterCategory && b.category !== filterCategory) return false;
      if (filterStatus && b.status !== filterStatus) return false;
      if (b.fit_score < minFit) return false;
      if (search && !`${b.name} ${b.address || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [businesses, filterCategory, filterStatus, minFit, search]);

  async function patch(id: string, updates: Partial<Business>) {
    const res = await fetch(`/api/businesses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      alert(`Update failed: ${await res.text()}`);
      return;
    }
    const { business } = await res.json();
    setBusinesses((prev) => prev.map((b) => (b.id === id ? business : b)));
  }

  async function generateDraft(id: string) {
    setDraftingId(id);
    try {
      const res = await fetch("/api/draft-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: id }),
      });
      if (!res.ok) {
        alert(`Draft failed: ${await res.text()}`);
        return;
      }
      const { draft } = await res.json();
      setDraftResult((prev) => ({ ...prev, [id]: { subject: draft.subject, body: draft.body } }));
      await patch(id, { status: "drafted" as BusinessStatus });
    } finally {
      setDraftingId(null);
    }
  }

  function exportCsv() {
    const headers = [
      "name", "category", "address", "website", "email", "phone",
      "fit_score", "fit_reason", "status", "contact_person", "notes", "last_contacted",
    ];
    const rows = filtered.map((b) =>
      headers.map((h) => {
        const v = (b as unknown as Record<string, unknown>)[h];
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      }).join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amici-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Prospects" value={summary.total.toString()} />
        <StatCard label="Avg fit" value={`${summary.avg_fit}/100`} />
        <StatCard label="Contacted" value={(summary.by_status.contacted || 0).toString()} />
        <StatCard label="Customers" value={(summary.by_status.customer || 0).toString()} accent />
      </div>

      {/* Toolbar */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 flex flex-wrap items-center gap-2">
        <input
          placeholder="Search name or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-white"
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as BusinessCategory | "")}
          className="px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-white"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{labelForCategory(c)}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as BusinessStatus | "")}
          className="px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-white"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
          Min fit
          <input
            type="number"
            min="0"
            max="100"
            value={minFit}
            onChange={(e) => setMinFit(parseInt(e.target.value) || 0)}
            className="w-16 px-2 py-1 text-sm rounded-md border border-[var(--color-border)] bg-white"
          />
        </label>
        <button
          onClick={exportCsv}
          className="ml-auto px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-border-light)]"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-border-light)] text-[var(--color-muted)]">
            <tr className="text-left">
              <Th>Business</Th>
              <Th>Fit</Th>
              <Th>Why</Th>
              <Th>Email / phone</Th>
              <Th>Status</Th>
              <Th>{null}</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-[var(--color-muted)]">No prospects yet — run the scrape to populate.</td></tr>
            )}
            {filtered.map((b) => (
              <BusinessRow
                key={b.id}
                business={b}
                expanded={openId === b.id}
                onToggle={() => setOpenId(openId === b.id ? null : b.id)}
                onPatch={(updates) => patch(b.id, updates)}
                onDraft={() => generateDraft(b.id)}
                drafting={draftingId === b.id}
                draft={draftResult[b.id] || null}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--color-muted)] text-center">
        {filtered.length} of {businesses.length} prospects shown · Amici Mining
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
        style={{ color: accent ? "var(--color-primary)" : undefined, fontFamily: "var(--font-serif)" }}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide">{children}</th>;
}

function BusinessRow({
  business: b,
  expanded,
  onToggle,
  onPatch,
  onDraft,
  drafting,
  draft,
}: {
  business: Business;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (u: Partial<Business>) => void;
  onDraft: () => void;
  drafting: boolean;
  draft: { subject: string; body: string } | null;
}) {
  return (
    <>
      <tr className="border-t border-[var(--color-border)] hover:bg-[var(--color-border-light)]/40">
        <td className="px-3 py-2.5">
          <button onClick={onToggle} className="text-left">
            <div className="font-medium">{b.name}</div>
            <div className="text-xs text-[var(--color-muted)] flex items-center gap-2">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: colorForCategory(b.category) }}
              />
              {labelForCategory(b.category)}
              {b.address && <span>· {b.address.split(",")[0]}</span>}
            </div>
          </button>
        </td>
        <td className="px-3 py-2.5">
          <FitBadge score={b.fit_score} />
        </td>
        <td className="px-3 py-2.5 text-xs text-[var(--color-muted)] max-w-[220px]">
          {b.fit_reason || "—"}
        </td>
        <td className="px-3 py-2.5 text-xs">
          {b.email && <div className="font-mono">{b.email}</div>}
          {b.phone && <div className="text-[var(--color-muted)]">{b.phone}</div>}
          {!b.email && !b.phone && <span className="text-[var(--color-muted)]">—</span>}
        </td>
        <td className="px-3 py-2.5">
          <select
            value={b.status}
            onChange={(e) => onPatch({ status: e.target.value as BusinessStatus })}
            className={cn(
              "text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white",
              b.status === "customer" && "text-[var(--color-success)] font-medium",
              b.status === "dead" && "text-[var(--color-muted)]"
            )}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-2.5">
          <button
            onClick={onDraft}
            disabled={drafting}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-primary)] hover:text-white hover:border-[var(--color-primary)] transition disabled:opacity-50"
          >
            {drafting ? "Drafting…" : "Draft email"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-[var(--color-border-light)]/30">
          <td colSpan={6} className="px-3 py-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 text-xs">
                {b.website && (
                  <div>
                    <span className="text-[var(--color-muted)]">Website:</span>{" "}
                    <a href={b.website} target="_blank" rel="noreferrer" className="text-[var(--color-info)] underline">
                      {b.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  </div>
                )}
                {b.address && <div><span className="text-[var(--color-muted)]">Address:</span> {b.address}</div>}
                {b.google_rating && (
                  <div>
                    <span className="text-[var(--color-muted)]">Google:</span>{" "}
                    {b.google_rating}★ ({b.google_reviews} reviews)
                  </div>
                )}
                <input
                  placeholder="Contact person"
                  defaultValue={b.contact_person || ""}
                  onBlur={(e) => {
                    if (e.target.value !== (b.contact_person || "")) {
                      onPatch({ contact_person: e.target.value });
                    }
                  }}
                  className="w-full text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white"
                />
                <textarea
                  placeholder="Notes"
                  defaultValue={b.notes}
                  onBlur={(e) => {
                    if (e.target.value !== b.notes) onPatch({ notes: e.target.value });
                  }}
                  rows={3}
                  className="w-full text-xs px-2 py-1 rounded-md border border-[var(--color-border)] bg-white"
                />
              </div>
              <div className="space-y-2">
                {draft ? (
                  <div className="rounded-md border border-[var(--color-border)] bg-white p-3 text-xs">
                    <div className="font-semibold mb-1">{draft.subject}</div>
                    <pre className="whitespace-pre-wrap font-sans text-[var(--color-foreground)]">{draft.body}</pre>
                    <button
                      onClick={() => navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)}
                      className="mt-2 text-xs px-2 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-border-light)]"
                    >
                      Copy email
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-[var(--color-muted)] italic">
                    No draft yet — click "Draft email" to generate.
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

function FitBadge({ score }: { score: number }) {
  const color = score >= 70 ? "var(--color-success)"
    : score >= 50 ? "var(--color-warning)"
    : score >= 30 ? "var(--color-secondary)"
    : "var(--color-muted)";
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-mono font-semibold"
      style={{ background: `${color}22`, color }}
    >
      {score}
    </span>
  );
}
