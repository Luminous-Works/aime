// AIME — D1 storage for mail, drop events and the allowlist. Pure SQL helpers;
// the dashboard and the mail path both go through here. DB failures must never
// break mail flow, so every caller wraps these in try/catch.
import { canonicalAddress } from "./core.js";

let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady || !db) return;
  // Statements are idempotent (IF NOT EXISTS), so a race is harmless.
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT NOT NULL, direction TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT, body TEXT, created_at TEXT NOT NULL)`
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread, id)`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, sender TEXT, reason TEXT, created_at TEXT NOT NULL)`
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS allowlist (addr TEXT PRIMARY KEY, added_at TEXT NOT NULL)`
    )
    .run();
  schemaReady = true;
}

export async function logMessage(db, { thread, direction, sender, subject, body }) {
  if (!db) return;
  await ensureSchema(db);
  await db
    .prepare(
      `INSERT INTO messages (thread, direction, sender, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      thread,
      direction,
      canonicalAddress(sender),
      String(subject || "").slice(0, 500),
      String(body || ""),
      new Date().toISOString()
    )
    .run();
}

export async function logEvent(db, { kind, sender, reason }) {
  if (!db) return;
  await ensureSchema(db);
  await db
    .prepare(`INSERT INTO events (kind, sender, reason, created_at) VALUES (?, ?, ?, ?)`)
    .bind(String(kind), canonicalAddress(sender), String(reason || ""), new Date().toISOString())
    .run();
}

export async function listThreads(db, limit = 200) {
  if (!db) return [];
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      `SELECT m.thread,
              COUNT(*) AS n,
              MAX(m.created_at) AS last,
              (SELECT subject FROM messages s WHERE s.thread = m.thread ORDER BY s.id DESC LIMIT 1) AS subject
       FROM messages m
       GROUP BY m.thread
       ORDER BY last DESC
       LIMIT ?`
    )
    .bind(Number(limit) || 200)
    .all();
  return results || [];
}

export async function getThread(db, thread, limit = 500) {
  if (!db) return [];
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      `SELECT id, direction, sender, subject, body, created_at FROM messages WHERE thread = ? ORDER BY id ASC LIMIT ?`
    )
    .bind(String(thread), Number(limit) || 500)
    .all();
  return results || [];
}

export async function stats(db) {
  if (!db) return { received: 0, replied: 0, dropped: 0, threads: 0 };
  await ensureSchema(db);
  const one = async (sql) => {
    const row = await db.prepare(sql).first();
    return row && row.n ? row.n : 0;
  };
  const received = await one(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'in'`);
  const replied = await one(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'out'`);
  const dropped = await one(`SELECT COUNT(*) AS n FROM events WHERE kind = 'dropped'`);
  const threads = await one(`SELECT COUNT(DISTINCT thread) AS n FROM messages`);
  return { received, replied, dropped, threads };
}

export async function recentEvents(db, limit = 100) {
  if (!db) return [];
  await ensureSchema(db);
  const { results } = await db
    .prepare(`SELECT kind, sender, reason, created_at FROM events ORDER BY id DESC LIMIT ?`)
    .bind(Number(limit) || 100)
    .all();
  return results || [];
}

export async function listAllow(db) {
  if (!db) return [];
  await ensureSchema(db);
  const { results } = await db.prepare(`SELECT addr, added_at FROM allowlist ORDER BY addr ASC`).all();
  return results || [];
}

export async function addAllow(db, addr) {
  if (!db) return;
  const a = canonicalAddress(addr);
  if (!a) return;
  await ensureSchema(db);
  await db
    .prepare(`INSERT OR IGNORE INTO allowlist (addr, added_at) VALUES (?, ?)`)
    .bind(a, new Date().toISOString())
    .run();
}

export async function removeAllow(db, addr) {
  if (!db) return;
  await ensureSchema(db);
  await db.prepare(`DELETE FROM allowlist WHERE addr = ?`).bind(canonicalAddress(addr)).run();
}