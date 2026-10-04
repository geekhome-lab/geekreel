/**
 * 视频生成：OpenAI Videos、可灵、豆包 Seedance。
 * 这三家都是「提交任务 → 轮询 → 下载」，协议写在适配器里，用户只填密钥和模型名。
 */

import { createHmac } from "node:crypto";
import type { ModelAdapter, TestResult } from "./index";

export function jwtHs256(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消");
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("已取消"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function downloadBytes(url: string, headers?: HeadersInit, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { headers, signal: signal ?? null });
  if (!res.ok) throw new Error(`下载视频失败：HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string }; message?: string; msg?: string };
    return json.error?.message ?? json.message ?? json.msg ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** OpenAI / 兼容网关的 /videos 接口（Sora 一类） */
function klingAuth(config: Record<string, string>): string {
  const ak = config.accessKey || config.apiKey || "";
  const sk = config.secretKey || "";
  if (ak && sk) {
    const now = Math.floor(Date.now() / 1000);
    return jwtHs256({ iss: ak, iat: now, nbf: now - 5, exp: now + 1800 }, sk);
  }
  return ak;
}

export const kling: ModelAdapter = {
  type: "kling",
  label: "可灵 Kling",
  capabilities: ["video"],
  configFields: [
    { key: "baseUrl", label: "Base URL", type: "text", placeholder: "https://api.klingai.com" },
    { key: "accessKey", label: "Access Key", type: "text", required: true },
    { key: "secretKey", label: "Secret Key", type: "password", required: true },
    { key: "model", label: "模型名", type: "text", required: true, placeholder: "kling-v1-6", defaultValue: "kling-v1-6" },
  ],

  async test(config): Promise<TestResult> {
    const start = Date.now();
    try {
      const token = klingAuth(config);
      if (!token) return { ok: false, latencyMs: 0, message: "先填 Access Key 和 Secret Key" };
      const res = await fetch(joinUrl(config.baseUrl || "https://api.klingai.com", "/v1/videos/text2video"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model_name: config.model || "kling-v1-6", prompt: "connectivity test", duration: "5" }),
      });
      const latencyMs = Date.now() - start;
      if (res.status === 401 || res.status === 403) return { ok: false, latencyMs, message: await readError(res) };
      return { ok: true, latencyMs, message: res.ok || res.status === 400 ? "密钥可用" : await readError(res) };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async generateVideo(config, req) {
    const token = klingAuth(config);
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    const base = config.baseUrl || "https://api.klingai.com";
    const imageB64 = req.image ? Buffer.from(req.image.data).toString("base64") : "";
    const path = imageB64 ? "/v1/videos/image2video" : "/v1/videos/text2video";
    const create = await fetch(joinUrl(base, path), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model_name: config.model || "kling-v1-6",
        prompt: req.prompt,
        duration: String(req.durationSec || 5),
        ...(imageB64 ? { image: imageB64 } : {}),
        ...(req.lastFrame ? { image_tail: Buffer.from(req.lastFrame.data).toString("base64") } : {}),
      }),
      signal: req.signal ?? null,
    });
    if (!create.ok) throw new Error(await readError(create));
    const json = (await create.json()) as { data?: { task_id?: string; task?: { id?: string } }; task_id?: string };
    const taskId = json.data?.task_id ?? json.data?.task?.id ?? json.task_id;
    if (!taskId) throw new Error("可灵没有返回任务 id");

    for (let i = 0; i < 90; i++) {
      await sleep(5000, req.signal);
      const poll = await fetch(joinUrl(base, `${path}/${taskId}`), {
        headers,
        signal: req.signal ?? null,
      });
      if (!poll.ok) throw new Error(await readError(poll));
      const row = (await poll.json()) as {
        data?: {
          task_status?: string;
          task_status_msg?: string;
          task_result?: { videos?: Array<{ url?: string }> };
        };
      };
      const status = row.data?.task_status;
      if (status === "failed") throw new Error(row.data?.task_status_msg || "可灵生成失败");
      if (status === "succeed" || status === "succeeded") {
        const url = row.data?.task_result?.videos?.[0]?.url;
        if (!url) throw new Error("可灵完成了但没有视频地址");
        return { data: await downloadBytes(url, undefined, req.signal), mime: "video/mp4", durationSec: req.durationSec };
      }
    }
    throw new Error("可灵超时。到可灵控制台看任务，或换一个更短的时长。");
  },
};

export const doubaoSeedance: ModelAdapter = {
  type: "doubao-seedance",
  label: "豆包 Seedance",
  capabilities: ["video"],
  configFields: [
    { key: "baseUrl", label: "Base URL", type: "text", placeholder: "https://ark.cn-beijing.volces.com/api/v3" },
    { key: "apiKey", label: "API Key", type: "password", required: true },
    { key: "model", label: "模型名", type: "text", required: true, placeholder: "doubao-seedance-1-0-pro" },
  ],

  async test(config): Promise<TestResult> {
    const start = Date.now();
    try {
      const res = await fetch(joinUrl(config.baseUrl || "https://ark.cn-beijing.volces.com/api/v3", "/contents/generations/tasks"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey ?? ""}` },
        body: JSON.stringify({
          model: config.model,
          content: [{ type: "text", text: "connectivity test" }],
        }),
      });
      const latencyMs = Date.now() - start;
      if (res.status === 401 || res.status === 403) return { ok: false, latencyMs, message: await readError(res) };
      return { ok: res.ok || res.status === 400, latencyMs, message: res.ok || res.status === 400 ? "密钥可用" : await readError(res) };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async generateVideo(config, req) {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey ?? ""}` };
    const base = config.baseUrl || "https://ark.cn-beijing.volces.com/api/v3";
    const create = await fetch(joinUrl(base, "/contents/generations/tasks"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        content: [
          { type: "text", text: req.prompt },
          ...(req.image
            ? [{ type: "image_url", image_url: { url: `data:${req.image.mime || "image/png"};base64,${Buffer.from(req.image.data).toString("base64")}` } }]
            : []),
          ...(req.lastFrame
            ? [{ type: "image_url", image_url: { url: `data:${req.lastFrame.mime || "image/png"};base64,${Buffer.from(req.lastFrame.data).toString("base64")}` } }]
            : []),
        ],
        duration: req.durationSec || 5,
      }),
      signal: req.signal ?? null,
    });
    if (!create.ok) throw new Error(await readError(create));
    const created = (await create.json()) as { id?: string };
    if (!created.id) throw new Error("豆包没有返回任务 id");

    for (let i = 0; i < 90; i++) {
      await sleep(4000, req.signal);
      const poll = await fetch(joinUrl(base, `/contents/generations/tasks/${created.id}`), {
        headers,
        signal: req.signal ?? null,
      });
      if (!poll.ok) throw new Error(await readError(poll));
      const row = (await poll.json()) as {
        status?: string;
        error?: { message?: string };
        content?: { video_url?: string };
      };
      if (row.status === "failed") throw new Error(row.error?.message || "豆包视频失败");
      if (row.status === "succeeded" || row.status === "completed") {
        const url = row.content?.video_url;
        if (!url) throw new Error("豆包完成了但没有视频地址");
        return {
          data: await downloadBytes(url, { Authorization: headers.Authorization }, req.signal),
          mime: "video/mp4",
          durationSec: req.durationSec,
        };
      }
    }
    throw new Error("豆包视频超时。到火山方舟看任务状态。");
  },
};
