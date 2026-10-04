import type { VideoGenResult } from "./index";

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string }; message?: string };
    return json.error?.message ?? json.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("已取消");
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("已取消"));
    }, { once: true });
  });
}

/** OpenAI / 兼容网关的 /videos 接口。不依赖 Node 模块，网页也能 import 类型包。 */
function bytesToBase64(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s);
}

export async function openaiGenerateVideo(
  config: Record<string, string>,
  req: {
    prompt: string;
    durationSec?: number;
    signal?: AbortSignal;
    image?: { mime: string; data: Uint8Array };
    lastFrame?: { mime: string; data: Uint8Array };
    dialogue?: string;
    audio?: boolean;
  },
): Promise<VideoGenResult> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey ?? ""}`,
  };
  const create = await fetch(joinUrl(config.baseUrl ?? "", "/videos"), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      prompt: req.prompt,
      seconds: String(req.durationSec || 5),
      ...(req.audio || req.dialogue ? { audio: true } : {}),
      ...(req.image
        ? { image: `data:${req.image.mime || "image/png"};base64,${bytesToBase64(req.image.data)}` }
        : {}),
      ...(req.lastFrame
        ? { last_frame: `data:${req.lastFrame.mime || "image/png"};base64,${bytesToBase64(req.lastFrame.data)}` }
        : {}),
    }),
    signal: req.signal ?? null,
  });
  if (!create.ok) throw new Error(await readError(create));
  const created = (await create.json()) as { id?: string };
  const id = created.id;
  if (!id) throw new Error("视频任务没有返回 id");

  for (let i = 0; i < 90; i++) {
    await sleep(4000, req.signal);
    const poll = await fetch(joinUrl(config.baseUrl ?? "", `/videos/${id}`), {
      headers,
      signal: req.signal ?? null,
    });
    if (!poll.ok) throw new Error(await readError(poll));
    const row = (await poll.json()) as { status?: string; error?: { message?: string } };
    if (row.status === "failed" || row.status === "cancelled") {
      throw new Error(row.error?.message || "视频生成失败");
    }
    if (row.status === "completed" || row.status === "succeeded") {
      const bin = await fetch(joinUrl(config.baseUrl ?? "", `/videos/${id}/content`), {
        headers,
        signal: req.signal ?? null,
      });
      if (!bin.ok) throw new Error(await readError(bin));
      return { data: new Uint8Array(await bin.arrayBuffer()), mime: "video/mp4", durationSec: req.durationSec };
    }
  }
  throw new Error("视频生成超时。到任务中心看进度，或换一个更快的模型。");
}
