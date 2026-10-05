/**
 * ComfyUI 本机出图 / 出视频。
 * 用户可贴 API Format 工作流；不贴则用内置文生图。提示词写进正向 CLIP，或替换 {{prompt}}。
 */

import type { ImageGenResult, ModelAdapter, TestResult, VideoGenResult } from "./index";
import { originRoot } from "./local";

export type ComfyPrompt = Record<
  string,
  {
    class_type?: string;
    inputs?: Record<string, unknown>;
    _meta?: { title?: string };
  }
>;

const TEXT_NODES = new Set([
  "CLIPTextEncode",
  "CLIPTextEncodeSDXL",
  "CLIPTextEncodeSD3",
  "CLIPTextEncodeFlux",
  "CLIPTextEncodeHunyuanDiT",
  "T5TextEncode",
  "BNK_CLIPTextEncodeAdvanced",
]);

const CKPT_KEYS = ["ckpt_name", "unet_name", "model_name", "checkpoint"];

export function joinComfyUrl(baseUrl: string, path: string): string {
  return `${originRoot(baseUrl || "http://127.0.0.1:8188")}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(config: Record<string, string>): HeadersInit {
  const key = (config.apiKey ?? "").trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string } | string; message?: string; node_errors?: unknown };
    if (typeof json.error === "string") return json.error;
    return json.error?.message ?? json.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function connectHint(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ECONNREFUSED|Failed to fetch|Unable to connect/i.test(msg)) {
    return "连不上 ComfyUI。先在本机打开 ComfyUI，默认端口 8188。";
  }
  return msg;
}

export function parseComfyWorkflow(raw: string): ComfyPrompt {
  const text = raw.trim();
  if (!text) return defaultImageWorkflow("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("工作流不是合法 JSON。在 ComfyUI 菜单里选 Save (API Format) 再贴。");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "nodes" in parsed) {
    throw new Error("这是普通工作流，没有节点输入名。请用 Save (API Format) 再贴进来。");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "prompt" in parsed) {
    const inner = (parsed as { prompt: unknown }).prompt;
    if (inner && typeof inner === "object") parsed = inner;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("工作流格式不对。需要 API Format 的节点表。");
  }
  const prompt = parsed as ComfyPrompt;
  const nodes = Object.values(prompt);
  if (!nodes.some((n) => n && typeof n.class_type === "string")) {
    throw new Error("工作流里没有 class_type。请用 Save (API Format)。");
  }
  return structuredClone(prompt);
}

export function defaultImageWorkflow(ckpt: string): ComfyPrompt {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: Math.floor(Math.random() * 1e9),
        steps: 20,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: ckpt || "model.safetensors" },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: 832, height: 1216, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      _meta: { title: "正向提示词" },
      inputs: { text: "", clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      _meta: { title: "负向提示词" },
      inputs: { text: "low quality, blurry, watermark, extra fingers", clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "geekreel", images: ["8", 0] },
    },
  };
}

function titleOf(id: string, node: ComfyPrompt[string]): string {
  return `${id} ${node._meta?.title ?? ""}`.toLowerCase();
}

function isNegativeTitle(title: string): boolean {
  return /neg|负向|负面|反面/.test(title);
}

export function applyPlaceholders(prompt: ComfyPrompt, vars: Record<string, string>): ComfyPrompt {
  const json = JSON.stringify(prompt);
  if (!/\{\{[a-z0-9_]+\}\}/i.test(json)) return prompt;
  let out = json;
  for (const [key, value] of Object.entries(vars)) {
    const escaped = JSON.stringify(value).slice(1, -1);
    out = out.replaceAll(`{{${key}}}`, escaped);
  }
  return JSON.parse(out) as ComfyPrompt;
}

export function injectComfyPrompt(
  prompt: ComfyPrompt,
  input: {
    text: string;
    model?: string;
    width?: number;
    height?: number;
    imageName?: string;
    lastFrameName?: string;
    durationSec?: number;
  },
): ComfyPrompt {
  const next = applyPlaceholders(structuredClone(prompt), {
    prompt: input.text,
    model: input.model ?? "",
    width: input.width ? String(input.width) : "",
    height: input.height ? String(input.height) : "",
    duration: input.durationSec ? String(input.durationSec) : "",
  });

  const textNodes = Object.entries(next).filter(([, n]) => TEXT_NODES.has(n.class_type ?? ""));
  const usedPlaceholder = JSON.stringify(prompt).includes("{{prompt}}");
  if (!usedPlaceholder && textNodes.length > 0) {
    const positive = textNodes.find(([id, n]) => !isNegativeTitle(titleOf(id, n))) ?? textNodes[0];
    if (positive?.[1].inputs) positive[1].inputs.text = input.text;
  }

  if (input.model?.trim()) {
    for (const node of Object.values(next)) {
      if (!node.inputs) continue;
      for (const key of CKPT_KEYS) {
        if (key in node.inputs && typeof node.inputs[key] === "string") node.inputs[key] = input.model.trim();
      }
    }
  }

  if (input.width && input.height) {
    for (const node of Object.values(next)) {
      if (!node.inputs) continue;
      if (typeof node.inputs.width === "number") node.inputs.width = input.width;
      if (typeof node.inputs.height === "number") node.inputs.height = input.height;
    }
  }

  const loaders = Object.entries(next).filter(([, n]) => n.class_type === "LoadImage");
  if (input.imageName && loaders[0]?.[1].inputs) loaders[0][1].inputs.image = input.imageName;
  if (input.lastFrameName && loaders[1]?.[1].inputs) loaders[1][1].inputs.image = input.lastFrameName;

  return next;
}

export function parseSize(size?: string): { width: number; height: number } | null {
  const m = size?.trim().match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return null;
  return { width, height };
}

export type ComfyOutputFile = { filename: string; subfolder?: string; type?: string; kind: "image" | "video" };

export function collectComfyOutputs(outputs: Record<string, unknown> | undefined): ComfyOutputFile[] {
  if (!outputs) return [];
  const files: ComfyOutputFile[] = [];
  for (const nodeOut of Object.values(outputs)) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    const bag = nodeOut as Record<string, unknown>;
    const push = (arr: unknown, kind: "image" | "video") => {
      if (!Array.isArray(arr)) return;
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const row = item as { filename?: string; subfolder?: string; type?: string };
        if (!row.filename) continue;
        files.push({ filename: row.filename, subfolder: row.subfolder ?? "", type: row.type ?? "output", kind });
      }
    };
    push(bag.images, "image");
    push(bag.gifs, /webm|mp4|mkv/i.test(JSON.stringify(bag.gifs)) ? "video" : "image");
    push(bag.videos, "video");
  }
  return files;
}

function mimeOf(name: string, kind: "image" | "video"): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webp")) return kind === "video" ? "video/webp" : "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return kind === "video" ? "video/mp4" : "image/png";
}

export function pickCheckpoints(objectInfo: Record<string, unknown>): string[] {
  const names = new Set<string>();
  const types = [
    "CheckpointLoaderSimple",
    "CheckpointLoader",
    "ImageOnlyCheckpointLoader",
    "UNETLoader",
    "unCLIPCheckpointLoader",
  ];
  for (const type of types) {
    const node = objectInfo[type] as
      | { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }
      | undefined;
    const required = node?.input?.required ?? {};
    const optional = node?.input?.optional ?? {};
    for (const spec of Object.values({ ...required, ...optional })) {
      if (!Array.isArray(spec) || !Array.isArray(spec[0])) continue;
      for (const name of spec[0]) if (typeof name === "string" && name.trim()) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

async function comfyFetch(
  config: Record<string, string>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(joinComfyUrl(config.baseUrl || "http://127.0.0.1:8188", path), {
    ...init,
    headers: { ...authHeaders(config), ...init?.headers },
  });
}

async function sleep(ms: number, signal?: AbortSignal) {
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

async function uploadImage(
  config: Record<string, string>,
  image: { mime: string; data: Uint8Array },
  name: string,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  const ext = image.mime.includes("jpeg") || image.mime.includes("jpg") ? "jpg" : "png";
  const file = new File([Buffer.from(image.data)], `${name}.${ext}`, { type: image.mime || "image/png" });
  form.append("image", file);
  form.append("overwrite", "true");
  form.append("type", "input");
  const res = await comfyFetch(config, "/upload/image", { method: "POST", body: form, signal: signal ?? null });
  if (!res.ok) throw new Error(await readError(res));
  const json = (await res.json()) as { name?: string };
  if (!json.name) throw new Error("ComfyUI 没收下参考图");
  return json.name;
}

async function downloadView(
  config: Record<string, string>,
  file: ComfyOutputFile,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const qs = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder ?? "",
    type: file.type ?? "output",
  });
  const res = await comfyFetch(config, `/view?${qs.toString()}`, { signal: signal ?? null });
  if (!res.ok) throw new Error(await readError(res));
  return new Uint8Array(await res.arrayBuffer());
}

async function runWorkflow(
  config: Record<string, string>,
  req: {
    prompt: string;
    size?: string;
    signal?: AbortSignal;
    image?: { mime: string; data: Uint8Array };
    lastFrame?: { mime: string; data: Uint8Array };
    durationSec?: number;
    prefer: "image" | "video";
  },
): Promise<{ data: Uint8Array; mime: string }> {
  const workflowRaw = (config.workflow ?? "").trim();
  if (!workflowRaw && req.prefer === "video") {
    throw new Error("出视频请先贴一份 ComfyUI 的 API Format 工作流。出图可以不贴，用内置文生图。");
  }
  if (!workflowRaw && !(config.model ?? "").trim()) {
    throw new Error("没贴工作流的话，要填一个 ComfyUI 里的 checkpoint 名字。可点「探测」从本机列表选。");
  }
  let prompt = workflowRaw ? parseComfyWorkflow(workflowRaw) : defaultImageWorkflow(config.model ?? "");
  const size = parseSize(req.size);
  let imageName: string | undefined;
  let lastFrameName: string | undefined;
  if (req.image) imageName = await uploadImage(config, req.image, "geekreel-ref", req.signal);
  if (req.lastFrame) lastFrameName = await uploadImage(config, req.lastFrame, "geekreel-tail", req.signal);
  prompt = injectComfyPrompt(prompt, {
    text: req.prompt,
    model: config.model,
    width: size?.width,
    height: size?.height,
    imageName,
    lastFrameName,
    durationSec: req.durationSec,
  });

  const body = { prompt, client_id: "geekreel" };
  const create = await comfyFetch(config, "/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: req.signal ?? null,
  });
  if (!create.ok) throw new Error(await readError(create));
  const created = (await create.json()) as {
    prompt_id?: string;
    node_errors?: Record<string, { errors?: Array<{ details?: string; message?: string }> }>;
    error?: { message?: string } | string;
  };
  const nodeErr = created.node_errors ? Object.values(created.node_errors).flatMap((n) => n.errors ?? []) : [];
  if (nodeErr.length) {
    throw new Error(nodeErr.map((e) => e.details || e.message).filter(Boolean).join("；") || "工作流节点报错");
  }
  if (created.error) {
    throw new Error(typeof created.error === "string" ? created.error : created.error.message || "ComfyUI 拒绝了这份工作流");
  }
  const id = created.prompt_id;
  if (!id) throw new Error("ComfyUI 没有返回任务 id");

  const max = req.prefer === "video" ? 300 : 180;
  for (let i = 0; i < max; i++) {
    await sleep(i < 3 ? 800 : 2000, req.signal);
    const hist = await comfyFetch(config, `/history/${id}`, { signal: req.signal ?? null });
    if (!hist.ok) throw new Error(await readError(hist));
    const json = (await hist.json()) as Record<
      string,
      {
        status?: { status_str?: string; completed?: boolean; messages?: unknown };
        outputs?: Record<string, unknown>;
      }
    >;
    const row = json[id];
    if (!row) continue;
    if (row.status?.status_str === "error") {
      throw new Error("ComfyUI 跑失败了。打开 ComfyUI 窗口看红字。");
    }
    const files = collectComfyOutputs(row.outputs);
    const preferred = files.find((f) => f.kind === req.prefer) ?? files[0];
    if (preferred && (row.status?.completed || files.length)) {
      const data = await downloadView(config, preferred, req.signal);
      return { data, mime: mimeOf(preferred.filename, preferred.kind) };
    }
  }
  throw new Error(req.prefer === "video" ? "ComfyUI 出视频超时" : "ComfyUI 出图超时");
}

export const comfyui: ModelAdapter = {
  type: "comfyui",
  label: "ComfyUI 本机",
  capabilities: ["image", "video"],
  configFields: [
    {
      key: "baseUrl",
      label: "ComfyUI 地址",
      type: "text",
      required: true,
      placeholder: "http://127.0.0.1:8188",
      defaultValue: "http://127.0.0.1:8188",
    },
    { key: "apiKey", label: "密钥（没有就空着）", type: "password", placeholder: "多数本机安装不需要" },
    { key: "model", label: "Checkpoint / 模型文件", type: "text", placeholder: "点探测从本机列表选" },
    {
      key: "workflow",
      label: "工作流 JSON（API Format）",
      type: "textarea",
      placeholder: "出图可不贴。出视频请从 ComfyUI 菜单 Save (API Format) 贴进来。可用 {{prompt}} 占位。",
    },
  ],

  async test(config): Promise<TestResult> {
    const start = Date.now();
    try {
      const res = await comfyFetch(config, "/system_stats", { signal: AbortSignal.timeout(6000) });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { ok: false, latencyMs, message: await readError(res) };
      return { ok: true, latencyMs, message: "ComfyUI 在线" };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: connectHint(e) };
    }
  },

  async listModels(config) {
    const res = await comfyFetch(config, "/object_info", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(await readError(res));
    const json = (await res.json()) as Record<string, unknown>;
    return pickCheckpoints(json);
  },

  async generateImage(config, req): Promise<ImageGenResult> {
    try {
      const out = await runWorkflow(config, { ...req, prefer: "image" });
      return { data: out.data, mime: out.mime };
    } catch (e) {
      throw new Error(connectHint(e));
    }
  },

  async generateVideo(config, req): Promise<VideoGenResult> {
    try {
      const out = await runWorkflow(config, { ...req, prefer: "video" });
      return { data: out.data, mime: out.mime };
    } catch (e) {
      throw new Error(connectHint(e));
    }
  },
};
