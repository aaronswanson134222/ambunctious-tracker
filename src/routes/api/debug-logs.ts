import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

function tailLines(text: string, maxLines = 50) {
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(-maxLines);
}

export const Route = createFileRoute("/api/debug-logs")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const dataDir = path.resolve(process.cwd(), "data");
          const authPath = path.join(dataDir, "auth.log");
          const errorsPath = path.join(dataDir, "errors.log");

          let authLines: string[] = [];
          let errorLines: string[] = [];

          if (fs.existsSync(authPath)) {
            try {
              const raw = fs.readFileSync(authPath, "utf8");
              authLines = tailLines(raw, 200);
            } catch (e) {
              authLines = [`(failed to read auth.log: ${String(e)})`];
            }
          } else {
            authLines = ["(no auth.log present)"];
          }

          if (fs.existsSync(errorsPath)) {
            try {
              const raw = fs.readFileSync(errorsPath, "utf8");
              errorLines = tailLines(raw, 200);
            } catch (e) {
              errorLines = [`(failed to read errors.log: ${String(e)})`];
            }
          } else {
            errorLines = ["(no errors.log present)"];
          }

          // Return parsed JSON lines where possible for easier inspection
          const authParsed = authLines.map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return l;
            }
          });
          const errorParsed = errorLines.map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return l;
            }
          });

          return Response.json({ ok: true, payload: { auth: authParsed, errors: errorParsed } }, { status: 200 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
