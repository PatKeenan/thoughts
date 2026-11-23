"use client";

import type { createAuthClient } from "@neon/auth/next";

type AuthClient = ReturnType<typeof createAuthClient>;

export const INSECURE_ORIGIN_MESSAGE =
  "Sign-in needs HTTPS. Open the app over https:// or on localhost.";

/**
 * The Neon Auth SDK calls crypto.randomUUID() when it loads, which browsers only provide on secure
 * origins (HTTPS or localhost). Importing it eagerly crashed every page that pulled this module in
 * when opened over plain http on a LAN address, so it is loaded on first use instead.
 */
let client: Promise<AuthClient> | null = null;

export function getAuthClient(): Promise<AuthClient> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return Promise.reject(new Error(INSECURE_ORIGIN_MESSAGE));
  }
  // Talks to the same-origin proxy at /api/auth/[...path]; takes no options by design.
  client ??= import("@neon/auth/next").then((m) => m.createAuthClient());
  return client;
}

/** The server's own message for a failed auth call (the client throws on non-OK responses). */
export function authErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === "object") {
    const body = (e as { error?: { message?: unknown } }).error;
    if (typeof body?.message === "string" && body.message) return body.message;
    if (e instanceof Error && e.message) return e.message;
  }
  return fallback;
}
