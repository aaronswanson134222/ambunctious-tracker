import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.db');
const db = new Database(DB_PATH);

// Initialize minimal schema used by the app. Add more tables as needed.
db.exec(`
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  token TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS tracked_roblox_experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id INTEGER,
  universe_id INTEGER,
  label TEXT,
  lookback_days INTEGER,
  known_item_keys TEXT,
  items TEXT,
  last_checked_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS tracked_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE,
  data TEXT
);

CREATE TABLE IF NOT EXISTS tracker_hourly_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hour_start TEXT,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS tracker_pin_attempts (
  id INTEGER PRIMARY KEY,
  failed_attempts INTEGER,
  locked_until TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS locks (
  name TEXT PRIMARY KEY,
  owner TEXT,
  expires_at INTEGER
);
`);

// Simple helper to run queries and return consistent shape
function run(query: string, params: any[] = []) {
  try {
    const stmt = db.prepare(query);
    if (/^\s*(?:select|pragma)/i.test(query)) {
      const rows = stmt.all(...params);
      return { data: rows, error: null };
    } else {
      const info = stmt.run(...params);
      return { data: info, error: null };
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Minimal from(table) implementation supporting insert/select/delete.single()
function from(table: string) {
  return {
    async insert(row: Record<string, any> | Record<string, any>[]) {
      const rows = Array.isArray(row) ? row : [row];
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map(() => '?').join(',');
      const insert = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
      try {
        const results: any[] = [];
        const insertMany = db.transaction((items: any[]) => {
          for (const it of items) {
            const vals = cols.map((c) => (typeof it[c] === 'object' ? JSON.stringify(it[c]) : it[c]));
            const info = insert.run(...vals);
            results.push(info);
          }
        });
        insertMany(rows);
        return { data: rows.map((r, i) => ({ ...r, id: results[i]?.lastInsertRowid || null })), error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    select: (columns: string | undefined, opts?: any) => {
      try {
        if (opts && opts.count === 'exact' && opts.head === true) {
          const res = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
          return { data: res.count, error: null };
        }
        const cols = columns && columns !== '*' ? columns : '*';
        const rows = db.prepare(`SELECT ${cols} FROM ${table}`).all();
        return { data: rows, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
    delete: () => ({
      eq: (col: string, val: any) => {
        try {
          const info = db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(val);
          return { data: info, error: null };
        } catch (err) {
          return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
    // minimal update
    update: (obj: Record<string, any>) => ({
      eq: (col: string, val: any) => {
        try {
          const keys = Object.keys(obj);
          const sets = keys.map((k) => `${k} = ?`).join(',');
          const vals = keys.map((k) => (typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]));
          vals.push(val);
          const info = db.prepare(`UPDATE ${table} SET ${sets} WHERE ${col} = ?`).run(...vals);
          return { data: info, error: null };
        } catch (err) {
          return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
        }
      },
    }),
    single: async function () {
      // used after select or insert chains in original code; noop here
      return this;
    },
  };
}

// rpc implementations for names used in the codebase (expand as needed)
async function rpc(name: string, params: Record<string, any> = {}) {
  try {
    switch (name) {
      case 'get_roblox_open_cloud_key': {
        const row = db.prepare(`SELECT value FROM secrets WHERE name = ?`).get('roblox_open_cloud_key');
        return { data: row ? row.value : null, error: null };
      }
      case 'has_roblox_open_cloud_key': {
        const row = db.prepare(`SELECT value FROM secrets WHERE name = ?`).get('roblox_open_cloud_key');
        return { data: !!row?.value, error: null };
      }
      case 'set_roblox_open_cloud_key': {
        const val = typeof params.candidate === 'string' ? params.candidate : '';
        if (!val) return { data: false, error: new Error('Invalid key') };
        db.prepare(`INSERT INTO secrets(name, value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value`).run('roblox_open_cloud_key', val);
        return { data: true, error: null };
      }
      case 'verify_tracker_owner_email': {
        const candidate = params.candidate;
        const row = db.prepare(`SELECT value FROM secrets WHERE name = ?`).get('tracker_owner_email');
        return { data: row && row.value === candidate, error: null };
      }
      case 'authenticate_tracker_pin': {
        // simple compare against stored hash value in secrets.tracker_pin_hash
        const candidate = params.pin;
        const row = db.prepare(`SELECT value FROM secrets WHERE name = ?`).get('tracker_pin_hash');
        // NOTE: for now, plain compare (migration should convert to bcrypt/secure). Treat as string match.
        return { data: row && row.value === candidate, error: null };
      }
      case 'get_private_alert_secrets': {
        const row = db.prepare(`SELECT value FROM secrets WHERE name = ?`).get('private_alerts');
        return { data: row ? JSON.parse(row.value) : null, error: null };
      }
      case 'has_private_alert_secrets': {
        const row = db.prepare(`SELECT value FROM secrets WHERE name = ?`).get('private_alerts');
        return { data: !!row?.value, error: null };
      }
      case 'set_private_alert_secrets': {
        const candidate = params.candidate;
        db.prepare(`INSERT INTO secrets(name,value) VALUES(?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value`).run('private_alerts', JSON.stringify(candidate));
        return { data: true, error: null };
      }
      case 'acquire_tracker_run_lock': {
        const name = 'tracker_run_lock';
        const now = Date.now();
        const expires = now + (params.ttl_ms || 60000);
        const info = db.prepare(`INSERT OR REPLACE INTO locks(name, owner, expires_at) VALUES (?, ?, ?)`).run(name, params.owner || 'local', expires);
        return { data: true, error: null };
      }
      case 'release_tracker_run_lock': {
        db.prepare(`DELETE FROM locks WHERE name = ?`).run('tracker_run_lock');
        return { data: true, error: null };
      }
      default:
        return { data: null, error: new Error(`Unsupported rpc: ${name}`) };
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Minimal auth.getUser implementation using OWNER_BEARER_TOKEN
async function getUser(token: string) {
  try {
    const ownerTok = process.env.OWNER_BEARER_TOKEN;
    const ownerEmail = process.env.OWNER_EMAIL || null;
    if (ownerTok && token === ownerTok) {
      return { data: { user: { email: ownerEmail } }, error: null };
    }
    // fallback: check users table
    const row = db.prepare(`SELECT email FROM users WHERE token = ?`).get(token);
    if (row) return { data: { user: { email: row.email } }, error: null };
    return { data: null, error: new Error('User not found') };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// Expose a supabaseAdmin-compatible object used by routes
export const supabaseAdmin = {
  auth: { getUser },
  rpc,
  from,
};

// Also export a compact db helper
export const dbClient = {
  run,
  raw: db,
};

export default db;