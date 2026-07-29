import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/debug-pin")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const dataDir = path.resolve(process.cwd(), "data");
          const dbJson = path.join(dataDir, "app.json");
          let pinSet = false;
          let ownerEmailPresent = false;
          if (fs.existsSync(dbJson)) {
            try {
              const raw = fs.readFileSync(dbJson, "utf8");
              const parsed = JSON.parse(raw);
              const secrets = parsed?.secrets ?? {};
              pinSet = typeof secrets.tracker_pin_hash === "string" && secrets.tracker_pin_hash.length > 0;
              ownerEmailPresent = typeof secrets.tracker_owner_email === "string" && secrets.tracker_owner_email.length > 0;
            } catch (e) {
              // ignore parse errors
            }
          }

          const payload = {
            timestamp: new Date().toISOString(),
            pin_set: pinSet,
            owner_email_present: ownerEmailPresent,
            owner_bearer_token_env: !!process.env.OWNER_BEARER_TOKEN,
          };

          return Response.json({ ok: true, payload }, { status: 200 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
