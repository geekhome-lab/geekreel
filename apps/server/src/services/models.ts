import { fetchChannelPrices, hasAnyPrice, missingUnitPrice, type Capability, type ModelEndpoint, type PriceQuote } from "@vw/models";
import { recomputeUsageCosts } from "./usage";
import { db } from "../db";
import { decrypt, encrypt, isPlaceholderSecret, maskSecret } from "../lib/crypto";
import { newId, now } from "../lib/resp";

/**
 * 模型端点存取。config 中的 apiKey 以密文存 apiKeyEnc，接口出参脱敏。
 */

interface EndpointRow {
  id: string;
  name: string;
  adapterType: string;
  capability: string;
  configJson: string;
  webSearch: number;
  vision?: number;
  enabled: number;
  isDefault: number;
  createdAt: number;
}

function rowToEndpoint(row: EndpointRow, withKey = false): ModelEndpoint {
  const config = JSON.parse(row.configJson) as Record<string, string>;
  if (config.apiKeyEnc) {
    const plain = decrypt(config.apiKeyEnc);
    config.apiKey = withKey ? plain : maskSecret(plain);
    if (!withKey) delete config.apiKeyEnc;
  }
  if (config.secretKeyEnc) {
    const plain = decrypt(config.secretKeyEnc);
    config.secretKey = withKey ? plain : maskSecret(plain);
    if (!withKey) delete config.secretKeyEnc;
  }
  return {
    id: row.id,
    name: row.name,
    adapterType: row.adapterType,
    capability: row.capability as Capability,
    config,
    webSearch: row.webSearch === 1,
    vision: Number(row.vision) === 1,
    enabled: row.enabled === 1,
    isDefault: row.isDefault === 1,
    createdAt: row.createdAt,
  };
}

export function listEndpoints(capability?: Capability): ModelEndpoint[] {
  const rows = (
    capability
      ? db.query("SELECT * FROM model_endpoints WHERE capability = ? ORDER BY createdAt ASC").all(capability)
      : db.query("SELECT * FROM model_endpoints ORDER BY createdAt ASC").all()
  ) as EndpointRow[];
  return rows.map((r) => rowToEndpoint(r));
}

export function getEndpoint(id: string, withKey = false): ModelEndpoint | null {
  const row = db.query("SELECT * FROM model_endpoints WHERE id = ?").get(id) as EndpointRow | null;
  return row ? rowToEndpoint(row, withKey) : null;
}

export function createEndpoint(input: {
  name: string;
  adapterType: string;
  capability: Capability;
  config: Record<string, string>;
  webSearch?: boolean;
  vision?: boolean;
}): ModelEndpoint {
  const id = newId();
  const config = { ...input.config };
  if (config.apiKey) {
    config.apiKeyEnc = encrypt(config.apiKey);
    delete config.apiKey;
  }
  if (config.secretKey) {
    config.secretKeyEnc = encrypt(config.secretKey);
    delete config.secretKey;
  }
  db.run(
    `INSERT INTO model_endpoints (id, name, adapterType, capability, configJson, webSearch, vision, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.adapterType, input.capability, JSON.stringify(config), input.webSearch ? 1 : 0, input.vision ? 1 : 0, now()],
  );
  return getEndpoint(id)!;
}

export function updateEndpoint(
  id: string,
  patch: {
    name?: string;
    config?: Record<string, string>;
    webSearch?: boolean;
    vision?: boolean;
    enabled?: boolean;
  },
): ModelEndpoint | null {
  const existing = getEndpoint(id, true);
  if (!existing) return null;

  const raw = db.query("SELECT configJson FROM model_endpoints WHERE id = ?").get(id) as { configJson: string } | null;
  const stored = raw ? (JSON.parse(raw.configJson) as Record<string, string>) : {};
  const incoming = { ...(patch.config ?? {}) };
  const config = { ...stored, ...existing.config, ...incoming };
  delete config.apiKey;
  delete config.secretKey;

  const nextApi = incoming.apiKey;
  if (!isPlaceholderSecret(nextApi)) {
    config.apiKeyEnc = encrypt(nextApi!.trim());
  } else if (stored.apiKeyEnc) {
    config.apiKeyEnc = stored.apiKeyEnc;
  } else if (existing.config.apiKey && !isPlaceholderSecret(existing.config.apiKey)) {
    config.apiKeyEnc = encrypt(existing.config.apiKey);
  }

  const nextSecret = incoming.secretKey;
  if (!isPlaceholderSecret(nextSecret)) {
    config.secretKeyEnc = encrypt(nextSecret!.trim());
  } else if (stored.secretKeyEnc) {
    config.secretKeyEnc = stored.secretKeyEnc;
  } else if (existing.config.secretKey && !isPlaceholderSecret(existing.config.secretKey)) {
    config.secretKeyEnc = encrypt(existing.config.secretKey);
  }

  db.run(
    `UPDATE model_endpoints SET name = ?, configJson = ?, webSearch = ?, vision = ?, enabled = ? WHERE id = ?`,
    [
      patch.name ?? existing.name,
      JSON.stringify(config),
      (patch.webSearch ?? existing.webSearch) ? 1 : 0,
      (patch.vision ?? existing.vision) ? 1 : 0,
      (patch.enabled ?? existing.enabled) ? 1 : 0,
      id,
    ],
  );
  return getEndpoint(id);
}

export function deleteEndpoint(id: string): boolean {
  return db.run("DELETE FROM model_endpoints WHERE id = ?", [id]).changes > 0;
}

/** 设为某能力的默认端点（同能力其他端点取消默认） */
export function setDefaultEndpoint(id: string): ModelEndpoint | null {
  const ep = getEndpoint(id);
  if (!ep) return null;
  db.run("UPDATE model_endpoints SET isDefault = 0 WHERE capability = ?", [ep.capability]);
  db.run("UPDATE model_endpoints SET isDefault = 1 WHERE id = ?", [id]);
  return getEndpoint(id);
}

/** 能力路由：优先指定端点，否则用该能力默认端点 */
export async function importFromEnv(): Promise<{ created: string[]; skipped: string[] }> {
  const key = (process.env.VW_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const baseUrl = (process.env.VW_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").trim();
  const created: string[] = [];
  const skipped: string[] = [];
  if (!key) return { created, skipped: ["环境变量里没有 VW_API_KEY 或 OPENAI_API_KEY"] };

  const specs: Array<{ name: string; capability: Capability; model: string; vision?: boolean }> = [
    { name: "环境变量 · 文本", capability: "llm", model: process.env.VW_LLM_MODEL || "gpt-4o-mini", vision: true },
    { name: "环境变量 · 图片", capability: "image", model: process.env.VW_IMAGE_MODEL || "gpt-image-1" },
    { name: "环境变量 · 视频", capability: "video", model: process.env.VW_VIDEO_MODEL || "sora-2" },
    { name: "环境变量 · 语音", capability: "tts", model: process.env.VW_TTS_MODEL || "tts-1" },
  ];
  for (const spec of specs) {
    const exists = listEndpoints(spec.capability).some((e) => e.name === spec.name);
    if (exists) {
      skipped.push(spec.name);
      continue;
    }
    const ep = createEndpoint({
      name: spec.name,
      adapterType: "openai-compatible",
      capability: spec.capability,
      config: { baseUrl, apiKey: key, model: spec.model },
      vision: spec.vision,
    });
    if (!listEndpoints(spec.capability).some((e) => e.isDefault)) setDefaultEndpoint(ep.id);
    await attachChannelPrices(ep.id);
    created.push(spec.name);
  }
  return { created, skipped };
}

export async function attachChannelPrices(
  id: string,
): Promise<{ ok: true; quote: PriceQuote } | { ok: false; reason: string }> {
  try {
    const { quote } = await applyChannelPrices(id);
    return { ok: true, quote };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyChannelPrices(id: string): Promise<{ quote: PriceQuote; recomputed: number }> {
  const ep = getEndpoint(id, true);
  if (!ep) throw new Error("端点不存在");
  const quote = await fetchChannelPrices(ep.config);
  const prices: Record<string, string> = {};
  for (const key of ["priceInput", "priceOutput", "priceImage", "priceTts", "priceVideo"] as const) {
    if (quote[key]) prices[key] = quote[key]!;
  }
  if (!hasAnyPrice(prices)) throw new Error("渠道没有返回单价");
  const updated = updateEndpoint(id, { config: prices });
  if (!updated) throw new Error("写入单价失败");
  const recomputed = recomputeUsageCosts(id, { ...ep.config, ...prices });
  return { quote, recomputed };
}

export async function syncChannelPrices(): Promise<{
  filled: Array<{ id: string; name: string; model: string; source: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
}> {
  const filled: Array<{ id: string; name: string; model: string; source: string }> = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];
  for (const ep of listEndpoints()) {
    try {
      const { quote } = await applyChannelPrices(ep.id);
      filled.push({ id: ep.id, name: ep.name, model: quote.model, source: quote.source });
    } catch (e) {
      skipped.push({ id: ep.id, name: ep.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { filled, skipped };
}

export function resolveEndpoint(capability: Capability, preferredId?: string): ModelEndpoint | null {
  if (preferredId) {
    const ep = getEndpoint(preferredId, true);
    if (!ep) throw new Error("指定的模型端点不存在");
    if (!ep.enabled) throw new Error(`端点「${ep.name}」已停用`);
    if (ep.capability !== capability) throw new Error(`端点「${ep.name}」不是${capability}能力`);
    return ep;
  }
  const row = db
    .query("SELECT * FROM model_endpoints WHERE capability = ? AND enabled = 1 AND isDefault = 1 LIMIT 1")
    .get(capability) as EndpointRow | null;
  if (row) return rowToEndpoint(row, true);
  // 无默认时取该能力第一个可用端点
  const fallback = db
    .query("SELECT * FROM model_endpoints WHERE capability = ? AND enabled = 1 ORDER BY createdAt ASC LIMIT 1")
    .get(capability) as EndpointRow | null;
  return fallback ? rowToEndpoint(fallback, true) : null;
}
