import type { Context } from "hono";
import type { ApiResp } from "@vw/core";

export function ok<T>(c: Context, data: T) {
  return c.json<ApiResp<T>>({ ok: true, data });
}

export function err(c: Context, message: string, status = 400) {
  return c.json<ApiResp<never>>({ ok: false, error: message }, status as never);
}

export function now(): number {
  return Date.now();
}

export function newId(): string {
  return crypto.randomUUID();
}
