/**
 * @vw/models —— 模型适配器抽象 + 内置适配器。
 * 两层设计：适配器（内置，懂协议） × 端点（用户自建，存配置与密钥）。
 * 新厂商接入 = 新增一个适配器文件并在 registry 注册。
 */

import { dashscopeGenerateImage, isDashScope } from "./dashscopeImage";
import { dashscopeGenerateSpeech, isDashScopeTts } from "./dashscopeTts";
import { dashscopeGenerateVideo, dashscopeLipSync } from "./dashscopeVideo";
export { wanVideoChunks, snapWanDuration, wanDurationCap } from "./dashscopeVideo";
import { openaiGenerateVideo } from "./openaiVideo";
import { originRoot } from "./local";

export type Capability = "llm" | "image" | "video" | "tts";

export const capabilityLabels: Record<Capability, string> = {
  llm: "文本模型",
  image: "图片模型",
  video: "视频模型",
  tts: "语音模型",
};

/** 下拉里同名端点靠模型 id 分开，例如两个都叫「通义万相视频」。 */
export function endpointOptionLabel(ep: { name: string; config: Record<string, string> }): string {
  const model = (ep.config.model ?? "").trim();
  if (model && !ep.name.includes(model)) return `${ep.name} · ${model}`;
  return ep.name;
}

export type { ImageBlob, ImageGenRequest, VideoGenRequest } from "./blobs";
export { collectVideoImages } from "./blobs";
import type { ImageGenRequest, VideoGenRequest } from "./blobs";

export interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "number" | "checkbox" | "textarea";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
}

/** 用户配置的端点（apiKey 加密存储，接口返回时脱敏） */
export interface ModelEndpoint {
  id: string;
  name: string;
  adapterType: string;
  capability: Capability;
  /** 除 apiKey 外的明文配置 + apiKeyEnc 密文 */
  config: Record<string, string>;
  webSearch: boolean;
  /** 文本端点能看图（分析读帧） */
  vision: boolean;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatResult {
  text: string;
  usage: TokenUsage;
}

export interface ImageGenResult {
  data: Uint8Array;
  mime: string;
}

export interface SpeechResult {
  data: Uint8Array;
  mime: string;
}

export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptResult {
  text: string;
  words?: TranscriptWord[];
}

export interface VideoGenResult {
  data: Uint8Array;
  mime: string;
  durationSec?: number;
}

export interface ModelAdapter {
  type: string;
  label: string;
  capabilities: Capability[];
  configFields: FieldSpec[];
  test(config: Record<string, string>): Promise<TestResult>;
  listModels?(config: Record<string, string>): Promise<string[]>;
  chat?(
    config: Record<string, string>,
    req: {
      prompt: string;
      system?: string;
      webSearch?: boolean;
      images?: Array<{ mime: string; data: Uint8Array }>;
    },
  ): Promise<ChatResult>;
  generateImage?(config: Record<string, string>, req: ImageGenRequest): Promise<ImageGenResult>;
  generateSpeech?(
    config: Record<string, string>,
    req: { text: string; voice?: string; signal?: AbortSignal },
  ): Promise<SpeechResult>;
  generateVideo?(config: Record<string, string>, req: VideoGenRequest): Promise<VideoGenResult>;
  /** 视频出来后再对嘴。没有就用 generateVideo + 配音。 */
  lipSync?(
    config: Record<string, string>,
    req: {
      image?: { mime: string; data: Uint8Array };
      video?: { mime: string; data: Uint8Array };
      audio: { mime: string; data: Uint8Array };
      text?: string;
      durationSec?: number;
      signal?: AbortSignal;
    },
  ): Promise<VideoGenResult>;
  transcribe?(
    config: Record<string, string>,
    req: { data: Uint8Array; filename: string; mime?: string; signal?: AbortSignal },
  ): Promise<TranscriptResult>;
}

export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 1.5 + (text.length - cjk) / 4));
}

export function parsePrice(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 按端点里填的单价算钱。没填单价就是 0，用量照记。 */
export function computeCost(input: {
  config: Record<string, string>;
  promptTokens?: number;
  completionTokens?: number;
  images?: number;
  audioChars?: number;
  videoSec?: number;
}): number {
  const pin = parsePrice(input.config.priceInput);
  const pout = parsePrice(input.config.priceOutput);
  const pimg = parsePrice(input.config.priceImage);
  const ptts = parsePrice(input.config.priceTts);
  const pvid = parsePrice(input.config.priceVideo);
  const yuan =
    ((input.promptTokens ?? 0) / 1000) * pin +
    ((input.completionTokens ?? 0) / 1000) * pout +
    (input.images ?? 0) * pimg +
    ((input.audioChars ?? 0) / 1000) * ptts +
    (input.videoSec ?? 0) * pvid;
  return Math.round(yuan * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// OpenAI 兼容适配器：一套配置通吃 文本/图片/语音（DeepSeek、通义、豆包、智谱…）
// ---------------------------------------------------------------------------

function bytesToBase64(data: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(data).toString("base64");
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function openaiFetch(
  config: Record<string, string>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const key = (config.apiKey ?? "").trim();
  const res = await fetch(joinUrl(config.baseUrl ?? "", path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...init?.headers,
    },
  });
  return res;
}

async function readError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { error?: { message?: string }; message?: string };
    return json.error?.message ?? json.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export const openaiCompatible: ModelAdapter = {
  type: "openai-compatible",
  label: "OpenAI 兼容接口",
  capabilities: ["llm", "image", "tts", "video"],
  configFields: [
    { key: "baseUrl", label: "Base URL", type: "text", required: true, placeholder: "https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1" },
    { key: "apiKey", label: "API Key", type: "password", placeholder: "本机 Ollama / LM Studio 没有就空着" },
    { key: "model", label: "模型名", type: "text", required: true, placeholder: "deepseek-chat / llama3.1 / gpt-image-1" },
  ],

  async test(config) {
    const start = Date.now();
    try {
      const res = await openaiFetch(config, "/models", { signal: AbortSignal.timeout(6000) });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { ok: false, latencyMs, message: await readError(res) };
      return { ok: true, latencyMs, message: "连接成功" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const hint = /fetch failed|ECONNREFUSED|Failed to fetch|Unable to connect/i.test(msg)
        ? "连不上这个地址。本机模型要先把 Ollama / LM Studio / vLLM 开起来。"
        : msg;
      return { ok: false, latencyMs: Date.now() - start, message: hint };
    }
  },

  async listModels(config) {
    const fromOpenAi = async () => {
      const res = await openaiFetch(config, "/models", { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as { data?: Array<{ id?: string }> };
      return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    };
    try {
      const ids = await fromOpenAi();
      if (ids.length) return ids;
    } catch {
      /* Ollama 原生 /api/tags 再试一次 */
    }
    const tags = await fetch(`${originRoot(config.baseUrl ?? "")}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!tags.ok) throw new Error(await readError(tags));
    const json = (await tags.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (json.models ?? []).map((m) => m.name || m.model).filter((id): id is string => Boolean(id));
  },

  async chat(config, req) {
    const userContent =
      req.images && req.images.length > 0
        ? [
            { type: "text", text: req.prompt },
            ...req.images.slice(0, 6).map((img) => ({
              type: "image_url",
              image_url: {
                url: `data:${img.mime || "image/jpeg"};base64,${bytesToBase64(img.data)}`,
              },
            })),
          ]
        : req.prompt;
    const messages = [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: userContent },
    ];
    const once = async (extra: Record<string, unknown> = {}) => {
      const res = await openaiFetch(config, "/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: config.model, messages, ...extra }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new Error("模型返回为空");
      const prompt = `${req.system ?? ""}\n${req.prompt}`;
      return {
        text,
        usage: {
          promptTokens: json.usage?.prompt_tokens ?? estimateTokens(prompt),
          completionTokens: json.usage?.completion_tokens ?? estimateTokens(text),
        },
      };
    };
    if (req.webSearch) {
      try {
        return await once({ enable_search: true });
      } catch {
        return await once();
      }
    }
    return once();
  },

  async generateImage(config, req) {
    if (isDashScope(config.baseUrl ?? "")) {
      return dashscopeGenerateImage(config, req);
    }
    const body: Record<string, unknown> = {
      model: config.model,
      prompt: req.prompt,
      n: 1,
    };
    if (req.size) body.size = req.size;
    if (req.refs?.[0] && /gpt-image/i.test(config.model ?? "")) {
      body.image = `data:${req.refs[0].mime || "image/png"};base64,${
        typeof Buffer !== "undefined"
          ? Buffer.from(req.refs[0].data).toString("base64")
          : btoa(Array.from(req.refs[0].data, (b) => String.fromCharCode(b)).join(""))
      }`;
    }

    const res = await openaiFetch(config, "/images/generations", {
      method: "POST",
      body: JSON.stringify(body),
      signal: req.signal ?? null,
    });
    if (!res.ok) throw new Error(await readError(res));

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const item = json.data?.[0];
    if (item?.b64_json) {
      const bin = atob(item.b64_json);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { data: bytes, mime: "image/png" };
    }
    if (item?.url) {
      const img = await fetch(item.url, { signal: req.signal ?? null });
      if (!img.ok) throw new Error(`下载生成图失败: HTTP ${img.status}`);
      return { data: new Uint8Array(await img.arrayBuffer()), mime: "image/png" };
    }
    throw new Error("模型未返回图片");
  },

  async generateSpeech(config, req) {
    if (isDashScopeTts(config)) return dashscopeGenerateSpeech(config, req);
    const res = await openaiFetch(config, "/audio/speech", {
      method: "POST",
      body: JSON.stringify({
        model: config.model || "tts-1",
        input: req.text.slice(0, 4096),
        voice: req.voice || config.voice || "alloy",
      }),
      signal: req.signal ?? null,
    });
    if (!res.ok) throw new Error(await readError(res));
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get("content-type") || "audio/mpeg",
    };
  },

  async transcribe(config, req) {
    const form = new FormData();
    const file = new File([Buffer.from(req.data)], req.filename || "audio.wav", { type: req.mime || "audio/wav" });
    form.append("file", file);
    form.append("model", config.model || "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const key = (config.apiKey ?? "").trim();
    const res = await fetch(joinUrl(config.baseUrl ?? "", "/audio/transcriptions"), {
      method: "POST",
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      body: form,
      signal: req.signal ?? null,
    });
    if (!res.ok) throw new Error(await readError(res));
    const json = (await res.json()) as {
      text?: string;
      words?: Array<{ word?: string; start?: number; end?: number }>;
      segments?: Array<{ words?: Array<{ word?: string; start?: number; end?: number }> }>;
    };
    const rawWords = json.words?.length
      ? json.words
      : json.segments?.flatMap((s) => s.words ?? []) ?? [];
    const words = rawWords
      .map((w) => ({
        word: String(w.word ?? "").trim(),
        startMs: Math.round((Number(w.start) || 0) * 1000),
        endMs: Math.round((Number(w.end) || 0) * 1000),
      }))
      .filter((w) => w.word);
    return { text: (json.text ?? "").trim(), words: words.length ? words : undefined };
  },

  generateVideo(config, req) {
    if (isDashScope(config.baseUrl ?? "")) {
      return dashscopeGenerateVideo(config, req);
    }
    return openaiGenerateVideo(config, req);
  },

  async lipSync(config, req) {
    if (isDashScope(config.baseUrl ?? "")) {
      return dashscopeLipSync(config, req);
    }
    const prompt = req.text?.trim()
      ? `角色对着镜头说：「${req.text.trim()}」。嘴型必须对上这句，能出声就一起出声。`
      : "对着镜头说话，嘴型对齐配音。";
    return this.generateVideo!(config, {
      prompt,
      durationSec: req.durationSec,
      image: req.image,
      dialogue: req.text,
      audio: true,
      voice: req.audio,
      signal: req.signal,
    });
  },
};

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

const registry = new Map<string, ModelAdapter>([[openaiCompatible.type, openaiCompatible]]);

export function registerAdapter(adapter: ModelAdapter) {
  registry.set(adapter.type, adapter);
}

export function listAdapters(): ModelAdapter[] {
  return [...registry.values()];
}

export function getAdapter(type: string): ModelAdapter | null {
  return registry.get(type) ?? null;
}

export function adaptersFor(capability: Capability): ModelAdapter[] {
  return [...registry.values()].filter((a) => a.capabilities.includes(capability));
}

export * from "./presets";
export * from "./voices";
export { fetchChannelPrices, channelPriceHint } from "./fetchPrices";
export type { ChannelPrices, PriceQuote } from "./prices";
export { hasAnyPrice, missingUnitPrice } from "./prices";
export { isLocalBaseUrl, localZeroPrices } from "./local";
