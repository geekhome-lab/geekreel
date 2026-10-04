import type { PushChannel, PushChannelType, PushLog, RadarSub } from "@vw/core";
import { sendPush, type PushMessage } from "@vw/push";
import { db } from "../db";
import { decrypt, encrypt, maskSecret } from "../lib/crypto";
import { newId, now } from "../lib/resp";
import { wsHub } from "../ws";

const SECRET_KEYS = new Set(["sendkey", "botToken", "deviceKey", "url", "pass"]);

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  configJson: string;
  enabled: number;
  createdAt: number;
}

function rowToChannel(row: ChannelRow, withSecret = false): PushChannel {
  const stored = JSON.parse(row.configJson) as Record<string, string>;
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (k.endsWith("Enc")) {
      const plainKey = k.slice(0, -3);
      const plain = decrypt(v);
      config[plainKey] = withSecret ? plain : maskSecret(plain);
    } else {
      config[k] = v;
    }
  }
  return {
    id: row.id,
    type: row.type as PushChannelType,
    name: row.name,
    config,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
  };
}

function encryptConfig(input: Record<string, string>, existing?: Record<string, string>): string {
  const out: Record<string, string> = {};
  const keys = new Set([...Object.keys(input), ...Object.keys(existing ?? {})]);
  for (const k of keys) {
    if (k.endsWith("Enc")) continue;
    const incoming = input[k];
    if (SECRET_KEYS.has(k)) {
      if (incoming) out[`${k}Enc`] = encrypt(incoming);
      else if (existing?.[k]) out[`${k}Enc`] = encrypt(existing[k]);
    } else if (incoming !== undefined) {
      out[k] = incoming;
    } else if (existing?.[k] !== undefined) {
      out[k] = existing[k]!;
    }
  }
  return JSON.stringify(out);
}

export function listChannels(): PushChannel[] {
  const rows = db.query("SELECT * FROM push_channels ORDER BY createdAt ASC").all() as ChannelRow[];
  return rows.map((r) => rowToChannel(r));
}

export function getChannel(id: string, withSecret = false): PushChannel | null {
  const row = db.query("SELECT * FROM push_channels WHERE id = ?").get(id) as ChannelRow | null;
  return row ? rowToChannel(row, withSecret) : null;
}

export function createChannel(input: { type: PushChannelType; name: string; config: Record<string, string> }): PushChannel {
  const id = newId();
  db.run(
    "INSERT INTO push_channels (id, type, name, configJson, createdAt) VALUES (?, ?, ?, ?, ?)",
    [id, input.type, input.name.trim(), encryptConfig(input.config), now()],
  );
  return getChannel(id)!;
}

export function updateChannel(
  id: string,
  patch: { name?: string; config?: Record<string, string>; enabled?: boolean },
): PushChannel | null {
  const existing = getChannel(id, true);
  if (!existing) return null;
  db.run("UPDATE push_channels SET name = ?, configJson = ?, enabled = ? WHERE id = ?", [
    patch.name ?? existing.name,
    encryptConfig(patch.config ?? {}, existing.config),
    (patch.enabled ?? existing.enabled) ? 1 : 0,
    id,
  ]);
  return getChannel(id);
}

export function deleteChannel(id: string): boolean {
  return db.run("DELETE FROM push_channels WHERE id = ?", [id]).changes > 0;
}

function writeLog(input: Omit<PushLog, "id" | "createdAt">): PushLog {
  const log: PushLog = { id: newId(), createdAt: now(), ...input };
  db.run(
    "INSERT INTO push_logs (id, subId, channelId, title, status, error, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [log.id, log.subId, log.channelId, log.title, log.status, log.error, log.createdAt],
  );
  wsHub.broadcast({ type: "push.log", log });
  return log;
}

export function listPushLogs(limit = 40): PushLog[] {
  return db.query("SELECT * FROM push_logs ORDER BY createdAt DESC LIMIT ?").all(limit) as PushLog[];
}

export async function deliver(
  channel: PushChannel,
  msg: PushMessage,
  subId: string | null,
): Promise<PushLog> {
  const full = getChannel(channel.id, true);
  if (!full) return writeLog({ subId, channelId: channel.id, title: msg.title, status: "failed", error: "渠道已删除" });
  const result = await sendPush(full.type, full.config, msg);
  return writeLog({
    subId,
    channelId: channel.id,
    title: msg.title,
    status: result.ok ? "sent" : "failed",
    error: result.error ?? null,
  });
}

export async function deliverToIds(
  channelIds: string[],
  msg: PushMessage,
  sub: RadarSub | null,
): Promise<void> {
  const ids = channelIds.length > 0 ? channelIds : listChannels().filter((c) => c.enabled).map((c) => c.id);
  for (const id of ids) {
    const ch = getChannel(id);
    if (!ch || !ch.enabled) continue;
    await deliver(ch, msg, sub?.id ?? null);
  }
}
