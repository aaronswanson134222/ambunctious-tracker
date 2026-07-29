import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
// attachSupabaseAuth: attach owner bearer token from local session storage
const attachSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem('ambunctious.session') : null;
    const session = raw ? JSON.parse(raw) : null;
    const token = session?.access_token || null;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch (err) {
    return next({ headers: {} });
  }
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
