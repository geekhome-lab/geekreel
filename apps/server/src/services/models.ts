import type { Capability, ModelEndpoint } from "@vw/models";
import { db } from "../db";
import { decrypt, encrypt, maskSecret } from "../lib/crypto";
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

  const config = { ...existing.config, ...patch.config };
  // apiKey 留空表示不修改；传入新值则重新加密
  if (patch.config && "apiKey" in patch.config) {
    if (patch.config.apiKey) {
      config.apiKeyEnc = encrypt(patch.config.apiKey);
      delete config.apiKey;
    } else {
      delete config.apiKey;
    }
  } else if (existing.config.apiKey) {
    config.apiKeyEnc = encrypt(existing.config.apiKey);
    delete config.apiKey;
  }
  if (patch.config && "secretKey" in patch.config) {
    if (patch.config.secretKey) {
      config.secretKeyEnc = encrypt(patch.config.secretKey);
      delete config.secretKey;
    } else {
      delete config.secretKey;
    }
  } else if (existing.config.secretKey) {
    config.secretKeyEnc = encrypt(existing.config.secretKey);
    delete config.secretKey;
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
