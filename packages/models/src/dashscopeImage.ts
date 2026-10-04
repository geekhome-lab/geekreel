import type { ImageGenResult } from "./index";

export function isDashScope(baseUrl: string): boolean {
  return /dashscope(?:-intl)?\.aliyuncs\.com/i.test(baseUrl);
}

export function dashscopeOrigin(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://dashscope.aliyuncs.com";
  }
}

/** 画布是 1024x1024，万相要 宽*高。wanx 和 qwen-image 允许的尺寸不一样。 */
export function dashscopeImageSize(model: string, size?: string): string {
  const raw = (size ?? "1024x1024").replace(/\*/g, "x");
  const [ws, hs] = raw.split(/x/i);
  const w = Number(ws);
  const h = Number(hs);
  const r = w > 0 && h > 0 ? w / h : 1;
  if (/wanx/i.test(model)) {
    if (r > 1.2) return "1280*720";
    if (r < 0.85) return "720*1280";
    return "1024*1024";
  }
  if (r > 1.4) return "1664*928";
  if (r > 1.1) return "1472*1104";
  if (r < 0.7) return "928*1664";
  if (r < 0.9) return "1104*1472";
  return "1328*1328";
}

async function readDashError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as {
      message?: string;
      code?: string;
      output?: { message?: string; code?: string };
    };
    return json.output?.message || json.message || json.code || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
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

/** 通义万相 / qwen-image-plus 不走 OpenAI /images/generations，要异步合成再轮询。 */
export async function dashscopeGenerateImage(
  config: Record<string, string>,
  req: { prompt: string; size?: string; signal?: AbortSignal },
): Promise<ImageGenResult> {
  const origin = dashscopeOrigin(config.baseUrl ?? "");
  const model = config.model || "qwen-image-plus";
  const submit = await fetch(`${origin}/api/v1/services/aigc/text2image/image-synthesis`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey ?? ""}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model,
      input: { prompt: req.prompt },
      parameters: { size: dashscopeImageSize(model, req.size), n: 1 },
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
  if (!taskId) throw new Error("通义万相没有返回任务号，换一个模型名再试");

  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    await sleep(2000, req.signal);
    const poll = await fetch(`${origin}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${config.apiKey ?? ""}` },
      signal: req.signal ?? null,
    });
    if (!poll.ok) throw new Error(await readDashError(poll));
    const json = (await poll.json()) as {
      message?: string;
      output?: {
        task_status?: string;
        message?: string;
        results?: Array<{ url?: string }>;
      };
    };
    const status = json.output?.task_status;
    if (status === "SUCCEEDED") {
      const url = json.output?.results?.[0]?.url;
      if (!url) throw new Error("通义万相成功了但没给图");
      const img = await fetch(url, { signal: req.signal ?? null });
      if (!img.ok) throw new Error(`下载生成图失败: HTTP ${img.status}`);
      return {
        data: new Uint8Array(await img.arrayBuffer()),
        mime: img.headers.get("content-type") || "image/png",
      };
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(json.output?.message || json.message || "通义万相生成失败");
    }
  }
  throw new Error("通义万相出图超时，过一会儿再试");
}
