import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../config";

/**
 * 密钥对称加密：机器级密钥存于 dataDir/.secret（首次运行生成，权限 600）。
 * 绑定本机回环访问，后续可换系统 Keychain（见设计文档开放问题 1）。
 */

function loadKey(): Buffer {
  const keyPath = join(dataDir, ".secret");
  if (existsSync(keyPath)) return readFileSync(keyPath);
  const key = randomBytes(32);
  writeFileSync(keyPath, key);
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* Windows 等平台忽略 */
  }
  return key;
}

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [v, ivB64, tagB64, dataB64] = payload.split(".");
  if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("密文格式错误");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf-8");
}

/** 脱敏展示：sk-…1234 */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "****";
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}

/** 编辑回传的打码/空值，不能当新密钥写入。 */
export function isPlaceholderSecret(value: string | undefined | null): boolean {
  const s = (value ?? "").trim();
  if (!s) return true;
  if (s === "****" || /^\*+$/.test(s)) return true;
  if (s.includes("…") || s.includes("...")) return true;
  return false;
}
