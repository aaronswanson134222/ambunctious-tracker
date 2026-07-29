import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/debug")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const dataDir = path.resolve(process.cwd(), "data");
          const dbJson = path.join(dataDir, "app.json");
          const dbSqlite = path.join(dataDir, "app.db");

          const files = (fs.existsSync(dataDir) && fs.readdirSync(dataDir)) || [];

          const payload = {
            timestamp: new Date().toISOString(),
            node: process.versions.node,
            platform: process.platform,
            env: {
              owner_bearer_token_set: !!process.env.OWNER_BEARER_TOKEN,
              owner_email_set: !!process.env.OWNER_EMAIL,
              supabase_service_role_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            },
            data_dir: {
              path: dataDir,
              exists: fs.existsSync(dataDir),
              files,
              app_json_exists: fs.existsSync(dbJson),
              app_db_exists: fs.existsSync(dbSqlite),
            },
            repo: {
              ref: process.env.LOVABLE_DEPLOY_REF || process.env.GITHUB_REF || null,
              sha: process.env.LOVABLE_DEPLOY_SHA || process.env.GITHUB_SHA || null,
            },
            deps: {
              better_sqlite3_present: fs.existsSync(path.join(process.cwd(), "node_modules", "better-sqlite3")),
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
