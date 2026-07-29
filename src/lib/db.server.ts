import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.json');

// Simple file-backed JSON store as a fallback to avoid native sqlite builds in CI.
// Structure mirrors the tables previously used.
let store: any = {
  secrets: {},
  users: [],
  tracked_roblox_experiences: [],
  tracked_products: [],
  tracker_hourly_reports: [],
  tracker_pin_attempts: [],
  locks: {},
};

function loadStore() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      store = JSON.parse(raw);
    } else {
      saveStore();
    }
  } catch (err) {
    console.error('Failed to load JSON DB, starting fresh', err);
    store = {
      secrets: {},
      users: [],
      tracked_roblox_experiences: [],
      tracked_products: [],
      tracker_hourly_reports: [],
      tracker_pin_attempts: [],
      locks: {},
    };
    saveStore();
  }
}

function saveStore() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2), 'utf8');
}

loadStore();

function nextId(table: string) {
  const arr = store[table] || [];
  if (!arr.length) return 1;
  return Math.max(...arr.map((r: any) => Number(r.id || 0))) + 1;
}

function run(query: string, params: any[] = []) {
  // Not a SQL DB; provide a minimal compatible runner for callers using dbClient.run
  return { data: null, error: new Error('JSON store does not support raw SQL') };
}

function from(table: string) {
  return {
    async insert(row: any) {
      const rows = Array.isArray(row) ? row : [row];
      const inserted = rows.map((r: any) => {
        const rec = { ...r };
        if (!('id' in rec)) rec.id = nextId(table);
        store[table] = store[table] || [];
        store[table].push(rec);
        return rec;
      });
      saveStore();
      return { data: Array.isArray(row) ? inserted : inserted[0], error: null };
    },
    select: (columns?: string | null, opts?: any) => {
      const arr = (store[table] || []).slice();
      if (opts && opts.count === 'exact' && opts.head === true) {
        return { data: arr.length, error: null };
      }
      // ignoring columns, order, limit for simplicity
      return { data: arr, error: null };
    },
    delete: () => ({
      eq: (col: string, val: any) => {
        const before = (store[table] || []).length;
        store[table] = (store[table] || []).filter((r: any) => r[col] !== val);
        saveStore();
        return { data: { changes: before - store[table].length }, error: null };
      },
    }),
    update: (obj: Record<string, any>) => ({
      eq: (col: string, val: any) => {
        let changed = 0;
        store[table] = (store[table] || []).map((r: any) => {
          if (r[col] === val) {
            changed++;
            return { ...r, ...obj };
          }
          return r;
        });
        saveStore();
        return { data: { changes: changed }, error: null };
      },
    }),
    single: async function () {
      const arr = store[table] || [];
      return { data: arr[0] ?? null, error: null };
    },
  };
}

async function rpc(name: string, params: Record<string, any> = {}) {
  try {
    switch (name) {
      case 'get_roblox_open_cloud_key':
        return { data: store.secrets.roblox_open_cloud_key ?? null, error: null };
      case 'has_roblox_open_cloud_key':
        return { data: !!store.secrets.roblox_open_cloud_key, error: null };
      case 'set_roblox_open_cloud_key': {
        const val = typeof params.candidate === 'string' ? params.candidate : '';
        if (!val) return { data: false, error: new Error('Invalid key') };
        store.secrets.roblox_open_cloud_key = val;
        saveStore();
        return { data: true, error: null };
      }
      case 'verify_tracker_owner_email':
        return { data: store.secrets.tracker_owner_email === params.candidate, error: null };
      case 'authenticate_tracker_pin': {
        // Support both { pin } and older { candidate } param keys for resilience
        const candidate = params.pin ?? params.candidate;
        const ok = store.secrets.tracker_pin_hash === candidate;
        if (!ok) return { data: null, error: null };
        return {
          data: [
            {
              owner_email: store.secrets.tracker_owner_email ?? null,
              internal_password: store.secrets.tracker_internal_auth_password ?? null,
            },
          ],
          error: null,
        };
      }
      case 'get_private_alert_secrets':
        return { data: store.secrets.private_alerts ? JSON.parse(store.secrets.private_alerts) : null, error: null };
      case 'has_private_alert_secrets':
        return { data: !!store.secrets.private_alerts, error: null };
      case 'set_private_alert_secrets':
        store.secrets.private_alerts = JSON.stringify(params.candidate);
        saveStore();
        return { data: true, error: null };
      case 'acquire_tracker_run_lock': {
        const name = 'tracker_run_lock';
        const now = Date.now();
        const expires = now + (params.ttl_ms || 60000);
        store.locks[name] = { owner: params.owner || 'local', expires_at: expires };
        saveStore();
        return { data: true, error: null };
      }
      case 'release_tracker_run_lock':
        delete store.locks['tracker_run_lock'];
        saveStore();
        return { data: true, error: null };
      case 'has_embed_test_webhook': {
        const present = typeof store.secrets.embed_test_webhook === 'string' && store.secrets.embed_test_webhook.length > 0;
        return { data: present, error: null };
      }
      case 'get_embed_test_webhook': {
        return { data: store.secrets.embed_test_webhook ?? null, error: null };
      }
      case 'set_embed_test_webhook': {
        const val = typeof params.candidate === 'string' ? params.candidate : '';
        if (!val) return { data: false, error: new Error('Invalid webhook') };
        store.secrets.embed_test_webhook = val;
        saveStore();
        return { data: true, error: null };
      }
      default:
        return { data: null, error: new Error(`Unsupported rpc: ${name}`) };
    }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

async function getUser(token: string) {
  try {
    const ownerTok = process.env.OWNER_BEARER_TOKEN;
    const ownerEmail = process.env.OWNER_EMAIL || null;
    // Accept either env-set owner token or the stored owner token in the JSON DB
    const storedOwnerTok = (store.secrets || {}).owner_bearer_token || (store.secrets || {}).owner_bearer_token;
    if (ownerTok && token === ownerTok) return { data: { user: { email: ownerEmail } }, error: null };
    if (storedOwnerTok && token === storedOwnerTok) return { data: { user: { email: ownerEmail || store.secrets.tracker_owner_email || null } }, error: null };
    const user = (store.users || []).find((u: any) => u.token === token);
    if (user) return { data: { user: { email: user.email } }, error: null };
    return { data: null, error: new Error('User not found') };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export const supabaseAdmin = {
  auth: { getUser },
  rpc,
  from,
};

export const dbClient = {
  run,
  raw: store,
};

export default store;
