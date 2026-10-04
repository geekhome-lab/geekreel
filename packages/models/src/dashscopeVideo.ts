import { dashscopeOrigin } from "./dashscopeImage";
import type { VideoGenResult } from "./index";

function bytesToBase64(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(data).toString("base64");
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s);
}

function dataUri(img: { mime?: string; data: Uint8Array }): string {
  return `data:${img.mime || "image/png"};base64,${bytesToBase64(img.data)}`;
}

export function pickWanVideoModel(model: string, hasImage: boolean): string {
  if (!hasImage) return model;
  if (/-i2v-|-kf2v-/i.test(model)) return model;
  if (/-t2v-/i.test(model)) return model.replace(/-t2v-/, "-i2v-");
  return model;
}

export function wanDurationCap(model: string): { min: number; max: number; allowed?: number[] } | null {
  if (/wan2\.[6-9]|wan2\.[1-9]\d/i.test(model)) return { min: 2, max: 15 };
  if (/wan2\.5/i.test(model)) return { min: 5, max: 10, allowed: [5, 10] };
  if (/wan2\.|wanx2\./i.test(model)) return { min: 5, max: 5, allowed: [5] };
  return null;
}

export function snapWanDuration(model: string, durationSec?: number): number {
  const want = Math.max(1, Math.round(durationSec || 5));
  const cap = wanDurationCap(model);
  if (!cap) return want;
  if (cap.allowed?.length) {
    return cap.allowed.find((s) => s >= want) ?? cap.allowed[cap.allowed.length - 1]!;
  }
  return Math.min(cap.max, Math.max(cap.min, want));
}

/** wan2.2 一次只有 5 秒。10 秒剧本要两段再接上。 */
export function wanVideoChunks(model: string, durationSec?: number): number[] {
  const want = Math.max(1, Math.round(durationSec || 5));
  const cap = wanDurationCap(model);
  if (!cap) return [want];
  if (want <= cap.max) return [snapWanDuration(model, want)];
  const n = Math.ceil(want / cap.max);
  return Array.from({ length: n }, () => cap.max);
}

export function wanVideoParams(model: string, durationSec?: number): Record<string, unknown> {
  const duration = snapWanDuration(model, durationSec);
  if (/wan2\.[5-9]|wan2\.[1-9]\d/i.test(model)) {
    return {
      resolution: "720P",
      ratio: "16:9",
      duration,
      prompt_extend: true,
    };
  }
  return { size: "1920*1080", duration, prompt_extend: true };
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消");
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("已取消"));
      },
      { once: true },
    );
  });
}

/** 通义万相视频：提交异步任务再轮询。OpenAI /videos 这条路是 404。 */
export async function dashscopeGenerateVideo(
  config: Record<string, string>,
  req: {
    prompt: string;
    durationSec?: number;
    signal?: AbortSignal;
    image?: { mime: string; data: Uint8Array };
    lastFrame?: { mime: string; data: Uint8Array };
  },
): Promise<VideoGenResult> {
  const origin = dashscopeOrigin(config.baseUrl ?? "");
  const model = pickWanVideoModel(config.model || "wan2.2-t2v-plus", Boolean(req.image));
  const input: Record<string, unknown> = { prompt: req.prompt };
  if (req.image) input.img_url = dataUri(req.image);
  if (req.lastFrame) input.last_img_url = dataUri(req.lastFrame);

  const submit = await fetch(`${origin}/api/v1/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey ?? ""}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model,
      input,
      parameters: wanVideoParams(model, req.durationSec),
    }),
    signal: req.signal ?? null,
  });
  const created = (await submit.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    output?: { task_id?: string; message?: string };
  };
  if (!submit.ok || created.code) {
    throw new Error(created.output?.message || created.message || created.code || `HTTP ${submit.status}`);
  }
  const taskId = created.output?.task_id;
  if (!taskId) throw new Error("通义万相视频没有返回任务号，核对一下模型名");

  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await sleep(4000, req.signal);
    const poll = await fetch(`${origin}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${config.apiKey ?? ""}` },
      signal: req.signal ?? null,
    });
    if (!poll.ok) throw new Error(`查询视频任务失败：HTTP ${poll.status}`);
    const json = (await poll.json()) as {
      message?: string;
      output?: { task_status?: string; message?: string; video_url?: string };
    };
    const status = json.output?.task_status;
    if (status === "SUCCEEDED") {
      const url = json.output?.video_url;
      if (!url) throw new Error("通义万相视频成功了但没给文件");
      const bin = await fetch(url, { signal: req.signal ?? null });
      if (!bin.ok) throw new Error(`下载视频失败：HTTP ${bin.status}`);
      return {
        data: new Uint8Array(await bin.arrayBuffer()),
        mime: bin.headers.get("content-type") || "video/mp4",
        durationSec: snapWanDuration(model, req.durationSec),
      };
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(json.output?.message || json.message || "通义万相视频生成失败");
    }
  }
  throw new Error("通义万相视频超时。到任务中心看进度，或过一会儿再试。");
}
