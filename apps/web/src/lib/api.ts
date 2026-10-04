import type { ApiResp } from "@vw/core";

/** 统一 API 客户端：解包 { ok, data, error }，失败抛错 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  let json: ApiResp<T> | null = null;
  try {
    json = (await res.json()) as ApiResp<T>;
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok || !json || json.ok === false) {
    const message = json && json.ok === false ? json.error : `请求失败 (${res.status})`;
    throw new Error(message);
  }
  return json.data;
}

export function apiJson<T>(path: string, method: "post" | "put" | "patch" | "delete", body?: unknown): Promise<T> {
  return api<T>(path, {
    method: method.toUpperCase(),
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
