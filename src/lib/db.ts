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
