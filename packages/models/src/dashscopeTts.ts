import { dashscopeOrigin, isDashScope } from "./dashscopeImage";
import type { SpeechResult } from "./index";

export function isDashScopeTts(config: Record<string, string>): boolean {
  return isDashScope(config.baseUrl ?? "") && /tts/i.test(config.model ?? "");
}

function languageType(text: string): string {
  return /[\u4e00-\u9fff]/.test(text) ? "Chinese" : "Auto";
}

async function readDashError(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { message?: string; code?: string; output?: { message?: string } };
    return json.output?.message || json.message || json.code || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** 通义 qwen-tts 不走 compatible-mode /audio/speech，走 multimodal-generation。 */
export async function dashscopeGenerateSpeech(
  config: Record<string, string>,
  req: { text: string; voice?: string; signal?: AbortSignal },
): Promise<SpeechResult> {
  const text = req.text.replace(/\s+/g, " ").trim().slice(0, 600);
  if (!text) throw new Error("没有要配的词");
  const origin = dashscopeOrigin(config.baseUrl ?? "");
  const res = await fetch(`${origin}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model || "qwen3-tts-flash",
      input: {
        text,
        voice: req.voice || config.voice || "Cherry",
        language_type: languageType(text),
      },
    }),
    signal: req.signal ?? null,
  });
  if (!res.ok) throw new Error(await readDashError(res));
  const json = (await res.json()) as {
    output?: { audio?: { url?: string; data?: string } };
    message?: string;
  };
  const url = json.output?.audio?.url;
  const b64 = json.output?.audio?.data;
  if (url) {
    const audio = await fetch(url, { signal: req.signal ?? null });
    if (!audio.ok) throw new Error(`下载配音失败: HTTP ${audio.status}`);
    return { data: new Uint8Array(await audio.arrayBuffer()), mime: audio.headers.get("content-type") || "audio/wav" };
  }
  if (b64) {
    return { data: Uint8Array.from(Buffer.from(b64, "base64")), mime: "audio/wav" };
  }
  throw new Error(json.message || "通义配音没有返回音频");
}
