type Session = { access_token: string; refresh_token: string; user: { id: string; email?: string | null } };
const KEY = "ambunctious_owner_session";
const listeners = new Set<(event: string, session: Session | null) => void>();
function current(): Session | null { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }

class ClientQuery {
  private body: any = { action: "select", filters: [] };
  constructor(table: string) { this.body.table = table; }
  select(columns = "*", options?: any) { this.body.action = "select"; this.body.columns = columns; this.body.options = options; return this; }
  insert(payload: any) { this.body.action = "insert"; this.body.payload = payload; return this; }
  update(payload: any) { this.body.action = "update"; this.body.payload = payload; return this; }
  delete() { this.body.action = "delete"; return this; }
  upsert(payload: any) { this.body.action = "upsert"; this.body.payload = payload; return this; }
  eq(key: string, value: any) { this.body.filters.push([key, value]); return this; }
  order(key: string, options?: any) { this.body.order = [key, options]; return this; }
  limit(value: number) { this.body.limit = value; return this; }
  maybeSingle() { this.body.single = true; return this; }
  then(resolve: any, reject: any) { return this.execute().then(resolve, reject); }
  private async execute() {
    const session = current();
    const response = await fetch("/api/local-db", { method: "POST", headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify(this.body) });
    return response.json();
  }
}

export function configureSupabase() {}
export function hasSupabaseRuntimeConfig() { return true; }
export const supabase: any = {
  from(table: string) { return new ClientQuery(table); },
  auth: {
    async getSession() { return { data: { session: typeof window === "undefined" ? null : current() }, error: null }; },
    async setSession(tokens: { access_token: string; refresh_token: string }) {
      const session: Session = { ...tokens, user: { id: "owner", email: "owner@local" } };
      localStorage.setItem(KEY, JSON.stringify(session)); listeners.forEach(fn => fn("SIGNED_IN", session)); return { data: { session }, error: null };
    },
    async signOut() { localStorage.removeItem(KEY); listeners.forEach(fn => fn("SIGNED_OUT", null)); return { error: null }; },
    onAuthStateChange(callback: any) { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; },
  },
};
