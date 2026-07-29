import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

type RuntimeEnv = Record<string, unknown>;

let serverEntryPromise: Promise<ServerEntry> | undefined;

function attachRuntimeEnv(env: unknown) {
  if (!env || typeof env !== "object") return;
  for (const [key, value] of Object.entries(env as RuntimeEnv)) {
    if (typeof value !== "string" || !value) continue;
    // Lovable's production runtime can provide bindings through the fetch env
    // object rather than Node's process.env. Mirror only missing values so local
    // and explicitly configured environment variables keep priority.
    if (!process.env[key]) process.env[key] = value;
  }
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

function apiErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json(
    { error: "Internal server error", detail: message.slice(0, 500) },
    {
      status: 500,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
  request: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const captured = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(captured);
  if (new URL(request.url).pathname.startsWith("/api/")) {
    return apiErrorResponse(captured);
  }
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function withSecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  let supabaseConnectSources = "https://*.supabase.co wss://*.supabase.co";
  try {
    const supabaseOrigin = new URL(
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
    ).origin;
    const supabaseSocketOrigin = supabaseOrigin.replace(/^https:/, "wss:");
    supabaseConnectSources += ` ${supabaseOrigin} ${supabaseSocketOrigin}`;
  } catch {
    // The application will show its normal configuration error.
  }
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self' ${supabaseConnectSources}`,
      "frame-src 'none'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "upgrade-insecure-requests",
    ].join("; "),
  );
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store, max-age=0");
  }
  if (requestUrl.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // This must happen before the server entry is imported because server-only
    // modules may read secrets during their first evaluation.
    attachRuntimeEnv(env);
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(
        await normalizeCatastrophicSsrResponse(response, request),
        request,
      );
    } catch (error) {
      console.error(error);
      const response = new URL(request.url).pathname.startsWith("/api/")
        ? apiErrorResponse(error)
        : new Response(renderErrorPage(), {
            status: 500,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
      return withSecurityHeaders(response, request);
    }
  },
};