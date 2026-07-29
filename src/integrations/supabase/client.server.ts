import { getState, matches, newRow, saveState, type Row } from "@/lib/local-store.server";

class Query {
  private action: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any;
  private filters: Array<[string, any]> = [];
  private orderBy: { key: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private single = false;
  private head = false;
  constructor(private table: string) {}
  select(_columns = "*", options?: { head?: boolean }) { this.action = "select"; this.head = options?.head === true; return this; }
  insert(payload: any) { this.action = "insert"; this.payload = payload; return this; }
  update(payload: any) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  upsert(payload: any) { this.action = "upsert"; this.payload = payload; return this; }
  eq(key: string, value: any) { this.filters.push([key, value]); return this; }
  order(key: string, options?: { ascending?: boolean }) { this.orderBy = { key, ascending: options?.ascending !== false }; return this; }
  limit(value: number) { this.max = value; return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve: (value: any) => any, reject: (error: any) => any) { return this.execute().then(resolve, reject); }
  private async execute() {
    try {
      const state = await getState();
      const rows = state.tables[this.table] ?? (state.tables[this.table] = []);
      if (this.action === "insert") {
        const inputs = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const input of inputs) {
          if (this.table === "tracker_notification_events" && rows.some(r => r.source_type === input.source_type && r.source_id === input.source_id && r.fingerprint === input.fingerprint)) return { data: null, error: { code: "23505", message: "Duplicate notification" } };
          rows.push(newRow(input));
        }
        await saveState(); return { data: Array.isArray(this.payload) ? inputs : inputs[0], error: null };
      }
      if (this.action === "update") { for (const row of rows) if (matches(row, this.filters)) Object.assign(row, this.payload, { updated_at: new Date().toISOString() }); await saveState(); return { data: null, error: null }; }
      if (this.action === "delete") { state.tables[this.table] = rows.filter(row => !matches(row, this.filters)); await saveState(); return { data: null, error: null }; }
      if (this.action === "upsert") {
        const input = this.payload as Row;
        const keys = this.filters.length ? this.filters : Object.keys(input).filter(k => k === "id" || k === "singleton" || k === "version").map(k => [k, input[k]] as [string, any]);
        const existing = rows.find(row => matches(row, keys));
        if (existing) Object.assign(existing, input, { updated_at: new Date().toISOString() }); else rows.push(newRow(input));
        await saveState(); return { data: input, error: null };
      }
      let result = rows.filter(row => matches(row, this.filters));
      if (this.orderBy) result = [...result].sort((a,b) => String(a[this.orderBy!.key] ?? "").localeCompare(String(b[this.orderBy!.key] ?? "")) * (this.orderBy!.ascending ? 1 : -1));
      if (this.max != null) result = result.slice(0, this.max);
      if (this.head) return { data: null, count: result.length, error: null };
      return { data: this.single ? (result[0] ?? null) : result.map(row => ({ ...row })), error: null };
    } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
  }
}

const sessions = new Set<string>();
export const supabaseAdmin: any = {
  from(table: string) { return new Query(table); },
  auth: { async getUser(token: string) { const valid = sessions.has(token) || token === process.env.OWNER_SESSION_TOKEN; return valid ? { data: { user: { id: "owner", email: process.env.OWNER_EMAIL ?? "owner@local" } }, error: null } : { data: { user: null }, error: { message: "Invalid session" } }; } },
  async rpc(name: string, args: Record<string, any> = {}) {
    const state = await getState();
    switch (name) {
      case "authenticate_tracker_pin": { const expected = process.env.OWNER_PIN ?? ""; if (!expected || args.candidate !== expected) return { data: [], error: null }; const token = crypto.randomUUID().replace(/-/g, ""); sessions.add(token); return { data: [{ owner_email: process.env.OWNER_EMAIL ?? "owner@local", internal_password: token }], error: null }; }
      case "verify_tracker_owner_email": return { data: args.candidate === (process.env.OWNER_EMAIL ?? "owner@local"), error: null };
      case "verify_tracker_cron_secret": return { data: Boolean(process.env.CRON_SECRET) && args.candidate === process.env.CRON_SECRET, error: null };
      case "acquire_tracker_run_lock": if (state.lockUntil > Date.now()) return { data: false, error: null }; state.lockUntil = Date.now() + 55_000; await saveState(); return { data: true, error: null };
      case "release_tracker_run_lock": state.lockUntil = 0; await saveState(); return { data: true, error: null };
      case "set_private_alert_secrets": state.secrets.discord_bot_token = args.bot_token; state.secrets.discord_user_id = args.discord_user_id; await saveState(); return { data: true, error: null };
      case "get_private_alert_secrets": return { data: { discord_bot_token: state.secrets.discord_bot_token, discord_user_id: state.secrets.discord_user_id }, error: null };
      case "has_private_alert_secrets": return { data: Boolean(state.secrets.discord_bot_token && state.secrets.discord_user_id), error: null };
      case "set_roblox_open_cloud_key": state.secrets.roblox_open_cloud_key = args.api_key ?? args.key; await saveState(); return { data: true, error: null };
      case "get_roblox_open_cloud_key": return { data: state.secrets.roblox_open_cloud_key ?? null, error: null };
      case "has_roblox_open_cloud_key": return { data: Boolean(state.secrets.roblox_open_cloud_key), error: null };
      default: return { data: null, error: { message: `Unknown local RPC: ${name}` } };
    }
  },
  _registerSession(token: string) { sessions.add(token); },
};
