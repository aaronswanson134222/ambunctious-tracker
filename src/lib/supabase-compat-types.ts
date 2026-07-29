export type User = { id: string; email?: string | null };
export type Session = { access_token: string; refresh_token: string; user: User };
export type SupabaseClient<T = unknown> = any;

export function createClient(_url?: string, _key?: string, _options?: unknown) {
  return {
    auth: {
      async signInWithPassword() {
        const token = crypto.randomUUID().replace(/-/g, "");
        return {
          data: {
            session: {
              access_token: token,
              refresh_token: token,
              user: { id: "owner", email: process.env.OWNER_EMAIL ?? "owner@local" },
            },
          },
          error: null,
        };
      },
    },
  };
}
