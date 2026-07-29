import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/debug-version")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const payload = {
            timestamp: new Date().toISOString(),
            ref: process.env.LOVABLE_DEPLOY_REF || process.env.GITHUB_REF || null,
            sha: process.env.LOVABLE_DEPLOY_SHA || process.env.GITHUB_SHA || null,
            node: process.versions.node,
            platform: process.platform,
          };
          return Response.json({ ok: true, payload }, { status: 200 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
