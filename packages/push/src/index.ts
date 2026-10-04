/**
 * @vw/push —— 推送渠道适配器。
 * 密钥由调用方解密后传入；本包只负责组请求。
 */

import type { PushChannelType } from "@vw/core";

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
}

export interface PushResult {
  ok: boolean;
  error?: string;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function sendPush(
  type: PushChannelType,
  config: Record<string, string>,
  msg: PushMessage,
): Promise<PushResult> {
  try {
    switch (type) {
      case "webhook":
        return await sendWebhook(config, msg);
      case "serverchan":
        return await sendServerchan(config, msg);
      case "telegram":
        return await sendTelegram(config, msg);
      case "bark":
        return await sendBark(config, msg);
      default:
        return { ok: false, error: `未知渠道类型 ${type}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function sendWebhook(config: Record<string, string>, msg: PushMessage): Promise<PushResult> {
  const url = asText(config.url).trim();
  if (!url) return { ok: false, error: "缺少 Webhook 地址" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: msg.title, body: msg.body, url: msg.url ?? null }),
  });
  if (!res.ok) return { ok: false, error: `Webhook HTTP ${res.status}` };
  return { ok: true };
}

async function sendServerchan(config: Record<string, string>, msg: PushMessage): Promise<PushResult> {
  const key = asText(config.sendkey).trim();
  if (!key) return { ok: false, error: "缺少 SendKey" };
  const res = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: msg.title.slice(0, 32),
      desp: [msg.body, msg.url].filter(Boolean).join("\n\n"),
    }),
  });
  if (!res.ok) return { ok: false, error: `Server酱 HTTP ${res.status}` };
  const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
  if (json.code !== undefined && json.code !== 0) {
    return { ok: false, error: json.message || `Server酱 code ${json.code}` };
  }
  return { ok: true };
}

async function sendTelegram(config: Record<string, string>, msg: PushMessage): Promise<PushResult> {
  const token = asText(config.botToken).trim();
  const chatId = asText(config.chatId).trim();
  if (!token || !chatId) return { ok: false, error: "缺少 Bot Token 或 Chat ID" };
  const text = [msg.title, msg.body, msg.url].filter(Boolean).join("\n");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { description?: string };
    return { ok: false, error: err.description || `Telegram HTTP ${res.status}` };
  }
  return { ok: true };
}

async function sendBark(config: Record<string, string>, msg: PushMessage): Promise<PushResult> {
  const deviceKey = asText(config.deviceKey).trim();
  if (!deviceKey) return { ok: false, error: "缺少设备 Key" };
  const server = (asText(config.server).trim() || "https://api.day.app").replace(/\/+$/, "");
  const res = await fetch(`${server}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_key: deviceKey,
      title: msg.title,
      body: msg.body,
      url: msg.url,
    }),
  });
  if (!res.ok) return { ok: false, error: `Bark HTTP ${res.status}` };
  return { ok: true };
}

export const pushFieldSpecs: Record<PushChannelType, Array<{ key: string; label: string; secret?: boolean; placeholder: string }>> = {
  webhook: [{ key: "url", label: "地址", placeholder: "https://example.com/hook" }],
  serverchan: [{ key: "sendkey", label: "SendKey", secret: true, placeholder: "SCT…" }],
  telegram: [
    { key: "botToken", label: "Bot Token", secret: true, placeholder: "123456:ABC…" },
    { key: "chatId", label: "Chat ID", placeholder: "你的数字 ID 或 @channel" },
  ],
  bark: [
    { key: "deviceKey", label: "设备 Key", secret: true, placeholder: "Bark 里复制的 key" },
    { key: "server", label: "服务器（可空）", placeholder: "https://api.day.app" },
  ],
};
