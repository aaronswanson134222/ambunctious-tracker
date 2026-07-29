// Lightweight client-side compatibility wrapper that proxies data operations to server-side endpoints.

export const STORAGE_KEY = 'ambunctious.session';

export function hasSupabaseRuntimeConfig() {
  return true; // always available; runtime config is no longer needed
}

export function configureSupabase(_config: { url: string; publishableKey: string }) {
  // no-op: public supabase removed; keep for compatibility
}

function makeAuth() {
  return {
    async getSession() {
      try {
        const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
        const session = raw ? JSON.parse(raw) : null;
        return { data: session };
      } catch (err) {
        return { data: null };
      }
    },
    async setSession(session: unknown) {
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        return { error: null };
      } catch (err) {
        return { error: String(err) };
      }
    },
    async signOut() {
      try {
        if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
        return { error: null };
      } catch (err) {
        return { error: String(err) };
      }
    },
    onAuthStateChange() {
      // No-op: compatibility only
      return { data: null };
    },
  };
}

function from(table: string) {
  return {
    async insert(payload: any) {
      const res = await fetch('/api/compat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insert', table, payload }),
      });
      return await res.json();
    },
    async select(columns?: string) {
      const res = await fetch('/api/compat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select', table, payload: { columns: columns || '*' } }),
      });
      return await res.json();
    },
    delete: () => ({
      eq: async (col: string, value: any) => {
        const res = await fetch('/api/compat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', table, payload: { col, value } }),
        });
        return await res.json();
      },
    }),
    update: (obj: any) => ({
      eq: async (col: string, value: any) => {
        const res = await fetch('/api/compat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', table, payload: { col, value, data: obj } }),
        });
        return await res.json();
      },
    }),
    single: async function () {
      const sel = await this.select('*');
      if (sel?.data && Array.isArray(sel.data)) return { data: sel.data[0], error: sel.error };
      return sel;
    },
  };
}

export const supabase = {
  auth: makeAuth(),
  from,
  functions: {
    async invoke(name: string, payload?: any) {
      const res = await fetch('/api/compat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rpc', payload: { name, params: payload } }),
      });
      return await res.json();
    },
  },
};
