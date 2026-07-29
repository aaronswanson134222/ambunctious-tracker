// Lightweight client-side compatibility wrapper that proxies data operations to server-side endpoints.

export const STORAGE_KEY = 'ambunctious.session';

export function hasSupabaseRuntimeConfig() {
  return true; // always available; runtime config is no longer needed
}

export function configureSupabase(_config: { url: string; publishableKey: string }) {
  // no-op: public supabase removed; keep for compatibility
}

function makeAuth() {
  // LocalStorage session shape: expect an object similar to { session: { access_token, refresh_token, user } }
  function readSession() {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  return {
    async getSession() {
      try {
        const session = readSession();
        // Match Supabase client shape: { data: { session } }
        return { data: { session } };
      } catch (err) {
        return { data: { session: null } };
      }
    },
    async setSession(session: unknown) {
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        // fire storage event-like callback by writing and reading
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
    onAuthStateChange(cb?: (event: string, session: any) => void) {
      // Minimal implementation: notify on storage changes in same origin and return subscription object like Supabase does.
      const listener = (ev: StorageEvent) => {
        if (ev.key !== STORAGE_KEY) return;
        try {
          const newSession = ev.newValue ? JSON.parse(ev.newValue) : null;
          cb?.('SIGNED_IN', { session: newSession });
        } catch (e) {
          cb?.('SIGNED_OUT', { session: null });
        }
      };
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('storage', listener);
      }
      const subscription = {
        unsubscribe: () => {
          try {
            if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('storage', listener);
          } catch {}
        },
      };
      return { data: { subscription } };
    },
  };
}

function makeQuery(table: string, columns?: string) {
  const state: any = { columns: columns || '*', filters: [], order: null, limit: null };
  const q: any = {
    order(col: string, opts?: { ascending?: boolean }) {
      state.order = { col, ascending: opts?.ascending === true };
      return q;
    },
    limit(n: number) {
      state.limit = n;
      return q;
    },
    eq(col: string, value: any) {
      state.filters.push({ type: 'eq', col, value });
      return q;
    },
    // allow single() usage: returns first item or null
    async single() {
      const res = await q;
      if (res?.data && Array.isArray(res.data)) return { data: res.data[0], error: res.error };
      return res;
    },
    // thenable so awaiting the query works: perform fetch with composed state
    then(resolve: any, reject: any) {
      (async () => {
        try {
          const res = await fetch('/api/compat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'select', table, payload: state }),
          });
          const json = await res.json();
          return resolve ? resolve(json) : json;
        } catch (err) {
          if (reject) return reject(err);
          throw err;
        }
      })();
    },
  };
  return q;
}

function from(table: string) {
  return {
    insert: async (payload: any) => {
      const res = await fetch('/api/compat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'insert', table, payload }),
      });
      return await res.json();
    },
    select: (columns?: string) => makeQuery(table, columns),
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
      const sel = await makeQuery(table, '*');
      const res = await sel;
      if (res?.data && Array.isArray(res.data)) return { data: res.data[0], error: res.error };
      return res;
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
