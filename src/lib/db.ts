import { createClient, type Client, type Row } from "@libsql/client";

let _client: Client | null = null;
let _schemaReady = false;

export function getClient(): Client {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set");
    _client = createClient({ url, authToken: authToken || undefined });
  }
  return _client;
}

export async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const db = getClient();

  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS businesses (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      category        TEXT NOT NULL DEFAULT 'other',
      subcategory     TEXT,
      address         TEXT,
      lat             REAL,
      lng             REAL,
      website         TEXT,
      email           TEXT,
      phone           TEXT,
      contact_person  TEXT,
      contact_role    TEXT,
      google_place_id TEXT UNIQUE,
      google_rating   REAL,
      google_reviews  INTEGER,
      source          TEXT NOT NULL DEFAULT 'manual',
      source_url      TEXT,
      fit_score       INTEGER NOT NULL DEFAULT 0,
      fit_reason      TEXT,
      status          TEXT NOT NULL DEFAULT 'new',
      notes           TEXT NOT NULL DEFAULT '',
      last_contacted  TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_biz_category ON businesses(category);
    CREATE INDEX IF NOT EXISTS idx_biz_status ON businesses(status);
    CREATE INDEX IF NOT EXISTS idx_biz_fit ON businesses(fit_score DESC);

    CREATE TABLE IF NOT EXISTS email_drafts (
      id           TEXT PRIMARY KEY,
      business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      subject      TEXT NOT NULL,
      body         TEXT NOT NULL,
      offer_angle  TEXT,
      sent         INTEGER NOT NULL DEFAULT 0,
      sent_at      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_drafts_business ON email_drafts(business_id);

    CREATE TABLE IF NOT EXISTS web_assessments (
      id                TEXT PRIMARY KEY,
      business_id       TEXT NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
      website_url       TEXT,
      reachable         INTEGER NOT NULL DEFAULT 0,
      https             INTEGER NOT NULL DEFAULT 0,
      response_ms       INTEGER,
      has_viewport      INTEGER NOT NULL DEFAULT 0,
      copyright_year    INTEGER,
      tech_stack        TEXT,
      is_placeholder    INTEGER NOT NULL DEFAULT 0,
      quality_score     INTEGER NOT NULL DEFAULT 0,
      pitch_priority    INTEGER NOT NULL DEFAULT 0,
      issues_json       TEXT NOT NULL DEFAULT '[]',
      pitch_summary     TEXT,
      jack_status       TEXT NOT NULL DEFAULT 'not_assessed',
      jack_notes        TEXT NOT NULL DEFAULT '',
      jack_last_contacted TEXT,
      assessed_at       TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_web_priority ON web_assessments(pitch_priority DESC);
    CREATE INDEX IF NOT EXISTS idx_web_quality ON web_assessments(quality_score);
    CREATE INDEX IF NOT EXISTS idx_web_status ON web_assessments(jack_status);

    CREATE TABLE IF NOT EXISTS pitch_drafts (
      id           TEXT PRIMARY KEY,
      business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      subject      TEXT NOT NULL,
      body         TEXT NOT NULL,
      teardown     TEXT,
      sent         INTEGER NOT NULL DEFAULT 0,
      sent_at      TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pitch_business ON pitch_drafts(business_id);

    CREATE TABLE IF NOT EXISTS scrape_runs (
      id              TEXT PRIMARY KEY,
      categories      TEXT NOT NULL,
      total_found     INTEGER NOT NULL DEFAULT 0,
      total_inserted  INTEGER NOT NULL DEFAULT 0,
      total_skipped   INTEGER NOT NULL DEFAULT 0,
      cost_cents      INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'running',
      error           TEXT,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    );
  `);

  _schemaReady = true;
}

// ─── Types ───

export type BusinessCategory =
  | "marina"
  | "yacht_services"
  | "law_firm"
  | "wealth_management"
  | "real_estate"
  | "accounting"
  | "medical"
  | "wellness"
  | "luxury_retail"
  | "interior_design"
  | "salon_beauty"
  | "fitness"
  | "property_management"
  | "condo_association"
  | "hotel"
  | "restaurant"
  | "office"
  | "other";

export type BusinessStatus =
  | "new"
  | "researching"
  | "drafted"
  | "contacted"
  | "replied"
  | "meeting"
  | "customer"
  | "dead";

export interface Business {
  id: string;
  name: string;
  category: BusinessCategory;
  subcategory: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  contact_person: string | null;
  contact_role: string | null;
  google_place_id: string | null;
  google_rating: number | null;
  google_reviews: number | null;
  source: string;
  source_url: string | null;
  fit_score: number;
  fit_reason: string | null;
  status: BusinessStatus;
  notes: string;
  last_contacted: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailDraft {
  id: string;
  business_id: string;
  subject: string;
  body: string;
  offer_angle: string | null;
  sent: boolean;
  sent_at: string | null;
  created_at: string;
}

export type JackStatus =
  | "not_assessed"
  | "assessed"
  | "pitch_drafted"
  | "contacted"
  | "replied"
  | "meeting"
  | "client"
  | "dead";

export interface WebAssessment {
  id: string;
  business_id: string;
  website_url: string | null;
  reachable: boolean;
  https: boolean;
  response_ms: number | null;
  has_viewport: boolean;
  copyright_year: number | null;
  tech_stack: string | null;
  is_placeholder: boolean;
  quality_score: number;
  pitch_priority: number;
  issues_json: string;
  pitch_summary: string | null;
  jack_status: JackStatus;
  jack_notes: string;
  jack_last_contacted: string | null;
  assessed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PitchDraft {
  id: string;
  business_id: string;
  subject: string;
  body: string;
  teardown: string | null;
  sent: boolean;
  sent_at: string | null;
  created_at: string;
}

// Joined row for the /web view — every business with its (possibly null) assessment
export interface BusinessWithAssessment extends Business {
  assessment: WebAssessment | null;
}

function rowAs<T>(row: Row): T {
  return row as unknown as T;
}

// ─── Queries ───

export async function listBusinesses(opts?: {
  category?: BusinessCategory;
  status?: BusinessStatus;
  minFit?: number;
}): Promise<Business[]> {
  await ensureSchema();
  const db = getClient();
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts?.category) { where.push("category = ?"); args.push(opts.category); }
  if (opts?.status) { where.push("status = ?"); args.push(opts.status); }
  if (opts?.minFit !== undefined) { where.push("fit_score >= ?"); args.push(opts.minFit); }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const result = await db.execute({
    sql: `SELECT * FROM businesses ${whereClause} ORDER BY fit_score DESC, name ASC`,
    args,
  });
  return result.rows.map(rowAs<Business>);
}

export async function getBusiness(id: string): Promise<Business | null> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({ sql: "SELECT * FROM businesses WHERE id = ?", args: [id] });
  return result.rows[0] ? rowAs<Business>(result.rows[0]) : null;
}

export async function getBusinessByPlaceId(placeId: string): Promise<Business | null> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM businesses WHERE google_place_id = ?",
    args: [placeId],
  });
  return result.rows[0] ? rowAs<Business>(result.rows[0]) : null;
}

export async function upsertBusiness(b: Partial<Business> & { name: string }): Promise<Business> {
  await ensureSchema();
  const db = getClient();
  const id = b.id || crypto.randomUUID();
  const now = new Date().toISOString();

  if (b.google_place_id) {
    const existing = await getBusinessByPlaceId(b.google_place_id);
    if (existing) {
      await db.execute({
        sql: `UPDATE businesses SET
          name = ?, category = COALESCE(?, category), subcategory = COALESCE(?, subcategory),
          address = COALESCE(?, address), lat = COALESCE(?, lat), lng = COALESCE(?, lng),
          website = COALESCE(?, website), email = COALESCE(?, email), phone = COALESCE(?, phone),
          google_rating = COALESCE(?, google_rating), google_reviews = COALESCE(?, google_reviews),
          source_url = COALESCE(?, source_url), updated_at = ?
          WHERE id = ?`,
        args: [
          b.name, b.category ?? null, b.subcategory ?? null,
          b.address ?? null, b.lat ?? null, b.lng ?? null,
          b.website ?? null, b.email ?? null, b.phone ?? null,
          b.google_rating ?? null, b.google_reviews ?? null,
          b.source_url ?? null, now, existing.id,
        ],
      });
      const updated = await getBusiness(existing.id);
      if (!updated) throw new Error(`Business ${existing.id} vanished after upsert`);
      return updated;
    }
  }

  await db.execute({
    sql: `INSERT INTO businesses (
      id, name, category, subcategory, address, lat, lng,
      website, email, phone, contact_person, contact_role,
      google_place_id, google_rating, google_reviews,
      source, source_url, fit_score, fit_reason, status, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, b.name, b.category || "other", b.subcategory ?? null,
      b.address ?? null, b.lat ?? null, b.lng ?? null,
      b.website ?? null, b.email ?? null, b.phone ?? null,
      b.contact_person ?? null, b.contact_role ?? null,
      b.google_place_id ?? null, b.google_rating ?? null, b.google_reviews ?? null,
      b.source || "manual", b.source_url ?? null,
      b.fit_score ?? 0, b.fit_reason ?? null,
      b.status || "new", b.notes || "",
      now, now,
    ],
  });
  const created = await getBusiness(id);
  if (!created) throw new Error(`Business ${id} vanished after insert`);
  return created;
}

export async function updateBusiness(id: string, updates: Partial<Business>): Promise<Business> {
  await ensureSchema();
  const db = getClient();
  const fields: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === "id" || k === "created_at") continue;
    fields.push(`${k} = ?`);
    args.push(v as string | number | null);
  }
  fields.push("updated_at = ?");
  args.push(new Date().toISOString());
  args.push(id);
  await db.execute({
    sql: `UPDATE businesses SET ${fields.join(", ")} WHERE id = ?`,
    args,
  });
  const updated = await getBusiness(id);
  if (!updated) throw new Error(`Business ${id} not found`);
  return updated;
}

export async function deleteBusiness(id: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({ sql: "DELETE FROM businesses WHERE id = ?", args: [id] });
}

export async function getDrafts(businessId: string): Promise<EmailDraft[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: "SELECT * FROM email_drafts WHERE business_id = ? ORDER BY created_at DESC",
    args: [businessId],
  });
  return result.rows.map((r) => ({ ...rowAs<EmailDraft>(r), sent: !!r.sent }));
}

export async function createDraft(d: Omit<EmailDraft, "id" | "created_at" | "sent" | "sent_at">): Promise<EmailDraft> {
  await ensureSchema();
  const db = getClient();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO email_drafts (id, business_id, subject, body, offer_angle)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, d.business_id, d.subject, d.body, d.offer_angle ?? null],
  });
  const result = await db.execute({ sql: "SELECT * FROM email_drafts WHERE id = ?", args: [id] });
  const row = result.rows[0];
  if (!row) throw new Error(`Draft ${id} vanished`);
  return { ...rowAs<EmailDraft>(row), sent: !!row.sent };
}

export async function logScrapeRun(params: {
  id: string;
  categories: string[];
  total_found: number;
  total_inserted: number;
  total_skipped: number;
  cost_cents: number;
  status: "running" | "complete" | "failed";
  error?: string;
}): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: `INSERT OR REPLACE INTO scrape_runs (id, categories, total_found, total_inserted, total_skipped, cost_cents, status, error, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      params.id,
      JSON.stringify(params.categories),
      params.total_found,
      params.total_inserted,
      params.total_skipped,
      params.cost_cents,
      params.status,
      params.error ?? null,
      params.status === "running" ? null : new Date().toISOString(),
    ],
  });
}

// ─── Web assessment queries ───

function rowToAssessment(row: Row): WebAssessment {
  const r = row as unknown as Record<string, unknown>;
  return {
    ...(r as unknown as WebAssessment),
    reachable: !!r.reachable,
    https: !!r.https,
    has_viewport: !!r.has_viewport,
    is_placeholder: !!r.is_placeholder,
  };
}

export async function getAssessment(businessId: string): Promise<WebAssessment | null> {
  await ensureSchema();
  const db = getClient();
  const r = await db.execute({ sql: "SELECT * FROM web_assessments WHERE business_id = ?", args: [businessId] });
  return r.rows[0] ? rowToAssessment(r.rows[0]) : null;
}

export async function upsertAssessment(a: Omit<WebAssessment, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<WebAssessment> {
  await ensureSchema();
  const db = getClient();
  const existing = await getAssessment(a.business_id);
  const now = new Date().toISOString();
  if (existing) {
    await db.execute({
      sql: `UPDATE web_assessments SET
        website_url=?, reachable=?, https=?, response_ms=?, has_viewport=?,
        copyright_year=?, tech_stack=?, is_placeholder=?, quality_score=?,
        pitch_priority=?, issues_json=?, pitch_summary=?, assessed_at=?, updated_at=?
        WHERE business_id = ?`,
      args: [
        a.website_url, a.reachable ? 1 : 0, a.https ? 1 : 0, a.response_ms ?? null,
        a.has_viewport ? 1 : 0, a.copyright_year ?? null, a.tech_stack ?? null,
        a.is_placeholder ? 1 : 0, a.quality_score, a.pitch_priority,
        a.issues_json, a.pitch_summary ?? null, a.assessed_at ?? now, now,
        a.business_id,
      ],
    });
  } else {
    const id = a.id || crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO web_assessments (
        id, business_id, website_url, reachable, https, response_ms, has_viewport,
        copyright_year, tech_stack, is_placeholder, quality_score, pitch_priority,
        issues_json, pitch_summary, jack_status, jack_notes, assessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, a.business_id, a.website_url,
        a.reachable ? 1 : 0, a.https ? 1 : 0, a.response_ms ?? null, a.has_viewport ? 1 : 0,
        a.copyright_year ?? null, a.tech_stack ?? null, a.is_placeholder ? 1 : 0,
        a.quality_score, a.pitch_priority, a.issues_json, a.pitch_summary ?? null,
        a.jack_status || "assessed", a.jack_notes || "", a.assessed_at ?? now,
      ],
    });
  }
  const updated = await getAssessment(a.business_id);
  if (!updated) throw new Error(`Assessment for ${a.business_id} vanished`);
  return updated;
}

export async function updateAssessment(businessId: string, updates: Partial<WebAssessment>): Promise<WebAssessment> {
  await ensureSchema();
  const db = getClient();
  const fields: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === "id" || k === "business_id" || k === "created_at") continue;
    fields.push(`${k} = ?`);
    if (typeof v === "boolean") args.push(v ? 1 : 0);
    else args.push(v as string | number | null);
  }
  fields.push("updated_at = ?");
  args.push(new Date().toISOString());
  args.push(businessId);
  await db.execute({
    sql: `UPDATE web_assessments SET ${fields.join(", ")} WHERE business_id = ?`,
    args,
  });
  const updated = await getAssessment(businessId);
  if (!updated) throw new Error(`Assessment for ${businessId} not found`);
  return updated;
}

// Returns every business with its (possibly null) assessment, sorted by pitch_priority DESC.
// Businesses without an assessment row appear last (priority NULL → 0).
export async function listBusinessesWithAssessments(): Promise<BusinessWithAssessment[]> {
  await ensureSchema();
  const db = getClient();
  const r = await db.execute(`
    SELECT b.*,
           a.id AS a_id, a.website_url AS a_website_url, a.reachable AS a_reachable,
           a.https AS a_https, a.response_ms AS a_response_ms, a.has_viewport AS a_has_viewport,
           a.copyright_year AS a_copyright_year, a.tech_stack AS a_tech_stack,
           a.is_placeholder AS a_is_placeholder, a.quality_score AS a_quality_score,
           a.pitch_priority AS a_pitch_priority, a.issues_json AS a_issues_json,
           a.pitch_summary AS a_pitch_summary, a.jack_status AS a_jack_status,
           a.jack_notes AS a_jack_notes, a.jack_last_contacted AS a_jack_last_contacted,
           a.assessed_at AS a_assessed_at, a.created_at AS a_created_at, a.updated_at AS a_updated_at
    FROM businesses b
    LEFT JOIN web_assessments a ON a.business_id = b.id
    ORDER BY COALESCE(a.pitch_priority, 0) DESC, b.fit_score DESC
  `);
  return r.rows.map((row) => {
    const r = row as unknown as Record<string, unknown>;
    const business: Business = {
      id: r.id as string, name: r.name as string, category: r.category as Business["category"],
      subcategory: (r.subcategory as string) || null, address: (r.address as string) || null,
      lat: (r.lat as number) ?? null, lng: (r.lng as number) ?? null,
      website: (r.website as string) || null, email: (r.email as string) || null,
      phone: (r.phone as string) || null, contact_person: (r.contact_person as string) || null,
      contact_role: (r.contact_role as string) || null, google_place_id: (r.google_place_id as string) || null,
      google_rating: (r.google_rating as number) ?? null, google_reviews: (r.google_reviews as number) ?? null,
      source: r.source as string, source_url: (r.source_url as string) || null,
      fit_score: r.fit_score as number, fit_reason: (r.fit_reason as string) || null,
      status: r.status as Business["status"], notes: r.notes as string,
      last_contacted: (r.last_contacted as string) || null,
      created_at: r.created_at as string, updated_at: r.updated_at as string,
    };
    const assessment: WebAssessment | null = r.a_id ? {
      id: r.a_id as string, business_id: r.id as string,
      website_url: (r.a_website_url as string) || null,
      reachable: !!r.a_reachable, https: !!r.a_https,
      response_ms: (r.a_response_ms as number) ?? null,
      has_viewport: !!r.a_has_viewport,
      copyright_year: (r.a_copyright_year as number) ?? null,
      tech_stack: (r.a_tech_stack as string) || null,
      is_placeholder: !!r.a_is_placeholder,
      quality_score: r.a_quality_score as number,
      pitch_priority: r.a_pitch_priority as number,
      issues_json: (r.a_issues_json as string) || "[]",
      pitch_summary: (r.a_pitch_summary as string) || null,
      jack_status: r.a_jack_status as JackStatus,
      jack_notes: (r.a_jack_notes as string) || "",
      jack_last_contacted: (r.a_jack_last_contacted as string) || null,
      assessed_at: (r.a_assessed_at as string) || null,
      created_at: r.a_created_at as string,
      updated_at: r.a_updated_at as string,
    } : null;
    return { ...business, assessment };
  });
}

export async function createPitchDraft(d: Omit<PitchDraft, "id" | "created_at" | "sent" | "sent_at">): Promise<PitchDraft> {
  await ensureSchema();
  const db = getClient();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO pitch_drafts (id, business_id, subject, body, teardown) VALUES (?, ?, ?, ?, ?)`,
    args: [id, d.business_id, d.subject, d.body, d.teardown ?? null],
  });
  const r = await db.execute({ sql: "SELECT * FROM pitch_drafts WHERE id = ?", args: [id] });
  const row = r.rows[0];
  if (!row) throw new Error(`Pitch draft ${id} vanished`);
  return { ...rowAs<PitchDraft>(row), sent: !!row.sent };
}

export async function stats(): Promise<{
  total: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  avg_fit: number;
}> {
  await ensureSchema();
  const db = getClient();
  const total = (await db.execute("SELECT COUNT(*) as c FROM businesses")).rows[0]?.c as number || 0;
  const byStatusRows = (await db.execute("SELECT status, COUNT(*) as c FROM businesses GROUP BY status")).rows;
  const byCatRows = (await db.execute("SELECT category, COUNT(*) as c FROM businesses GROUP BY category")).rows;
  const avgFit = (await db.execute("SELECT AVG(fit_score) as a FROM businesses")).rows[0]?.a as number || 0;
  const by_status: Record<string, number> = {};
  for (const r of byStatusRows) by_status[r.status as string] = r.c as number;
  const by_category: Record<string, number> = {};
  for (const r of byCatRows) by_category[r.category as string] = r.c as number;
  return { total, by_status, by_category, avg_fit: Math.round(avgFit) };
}
