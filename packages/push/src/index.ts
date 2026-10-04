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
      case "email":
        return await sendEmail(config, msg);
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
  email: [
    { key: "host", label: "SMTP 主机", placeholder: "smtp.qq.com" },
    { key: "port", label: "端口", placeholder: "465" },
    { key: "user", label: "账号", placeholder: "you@example.com" },
    { key: "pass", label: "密码/授权码", secret: true, placeholder: "邮箱授权码" },
    { key: "from", label: "发件人（可空）", placeholder: "默认用账号" },
    { key: "to", label: "收件人", placeholder: "me@example.com" },
  ],
};

export function buildSmtpMessage(from: string, to: string, msg: PushMessage): string {
  const subject = msg.title.replace(/[\r\n]+/g, " ").slice(0, 80);
  const body = [msg.body, msg.url].filter(Boolean).join("\n\n");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    "",
  ].join("\r\n");
}

async function sendEmail(config: Record<string, string>, msg: PushMessage): Promise<PushResult> {
  const host = asText(config.host).trim();
  const user = asText(config.user).trim();
  const pass = asText(config.pass).trim();
  const to = asText(config.to).trim();
  const from = asText(config.from).trim() || user;
  const port = Number(config.port) || 465;
  if (!host || !user || !pass || !to) return { ok: false, error: "邮件要填 SMTP 主机、账号、密码和收件人" };
  const url = port === 587 ? `smtp://${host}:${port}` : `smtps://${host}:${port}`;
  const args = [
    "curl", "-sS", "--max-time", "30",
    ...(port === 587 ? ["--ssl-reqd"] : []),
    "--url", url,
    "--user", `${user}:${pass}`,
    "--mail-from", from,
    "--mail-rcpt", to,
    "-T", "-",
  ];
  const proc = Bun.spawn(args, { stdin: new Blob([buildSmtpMessage(from, to, msg)]), stdout: "pipe", stderr: "pipe" });
  const [errText, exit] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (exit !== 0) return { ok: false, error: errText.trim() || `邮件发送失败（${exit}）` };
  return { ok: true };
}
