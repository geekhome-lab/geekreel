/**
 * @vw/models —— 模型适配器抽象 + 内置适配器。
 * 两层设计：适配器（内置，懂协议） × 端点（用户自建，存配置与密钥）。
 * 新厂商接入 = 新增一个适配器文件并在 registry 注册。
 */

export type Capability = "llm" | "image" | "video" | "tts";

export const capabilityLabels: Record<Capability, string> = {
  llm: "文本模型",
  image: "图片模型",
  video: "视频模型",
  tts: "语音模型",
};

export interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "number" | "checkbox";
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
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface ImageGenResult {
  /** 图片二进制内容（PNG） */
  data: Uint8Array;
  mime: string;
}

export interface ModelAdapter {
  type: string;
  label: string;
  capabilities: Capability[];
  configFields: FieldSpec[];
  test(config: Record<string, string>): Promise<TestResult>;
  chat?(
    config: Record<string, string>,
    req: { prompt: string; system?: string; webSearch?: boolean },
  ): Promise<string>;
  generateImage?(
    config: Record<string, string>,
    req: { prompt: string; size?: string; signal?: AbortSignal },
  ): Promise<ImageGenResult>;
}

// ---------------------------------------------------------------------------
// OpenAI 兼容适配器：一套配置通吃 文本/图片/语音（DeepSeek、通义、豆包、智谱…）
// ---------------------------------------------------------------------------

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function openaiFetch(
  config: Record<string, string>,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(joinUrl(config.baseUrl ?? "", path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey ?? ""}`,
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
  capabilities: ["llm", "image", "tts"],
  configFields: [
    { key: "baseUrl", label: "Base URL", type: "text", required: true, placeholder: "https://api.deepseek.com/v1" },
    { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "sk-…" },
    { key: "model", label: "模型名", type: "text", required: true, placeholder: "deepseek-chat / gpt-image-1 / …" },
  ],

  async test(config) {
    const start = Date.now();
    try {
      const res = await openaiFetch(config, "/models");
      const latencyMs = Date.now() - start;
      if (!res.ok) return { ok: false, latencyMs, message: await readError(res) };
      return { ok: true, latencyMs, message: "连接成功" };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, message: e instanceof Error ? e.message : String(e) };
    }
  },

  async chat(config, req) {
    const messages = [
      ...(req.system ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: req.prompt },
    ];
    const once = async (extra: Record<string, unknown> = {}) => {
      const res = await openaiFetch(config, "/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: config.model, messages, ...extra }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new Error("模型返回为空");
      return text;
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
    const body: Record<string, unknown> = {
      model: config.model,
      prompt: req.prompt,
      n: 1,
    };
    if (req.size) body.size = req.size;

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
};

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

const registry = new Map<string, ModelAdapter>([[openaiCompatible.type, openaiCompatible]]);

export function listAdapters(): ModelAdapter[] {
  return [...registry.values()];
}

export function getAdapter(type: string): ModelAdapter | null {
  return registry.get(type) ?? null;
}

export function adaptersFor(capability: Capability): ModelAdapter[] {
  return [...registry.values()].filter((a) => a.capabilities.includes(capability));
}
