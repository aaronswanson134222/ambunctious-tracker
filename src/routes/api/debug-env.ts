import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/debug-env")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = {
            timestamp: new Date().toISOString(),
            node: process.versions.node,
            platform: process.platform,
            env: {
              OWNER_BEARER_TOKEN: !!process.env.OWNER_BEARER_TOKEN,
              OWNER_EMAIL: !!process.env.OWNER_EMAIL,
              SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
              LOVABLE_DEPLOY_REF: !!process.env.LOVABLE_DEPLOY_REF,
              LOVABLE_DEPLOY_SHA: !!process.env.LOVABLE_DEPLOY_SHA,
              GITHUB_REF: !!process.env.GITHUB_REF,
              GITHUB_SHA: !!process.env.GITHUB_SHA,
            },
          };
          return Response.json({ ok: true, payload }, { status: 200 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
