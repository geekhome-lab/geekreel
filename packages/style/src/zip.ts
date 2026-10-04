import { inflateRawSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 无压缩 zip，风格包文本很小，换机器不用装 zip 命令 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = new TextEncoder().encode(e.name.replaceAll("\\", "/"));
    const crc = crc32(e.data);
    const local = concat([
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(e.data.length),
      u32(e.data.length),
      u16(name.length),
      u16(0),
      name,
      e.data,
    ]);
    const central = concat([
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(e.data.length),
      u32(e.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralBlob = concat(centrals);
  const eocd = concat([
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBlob.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, centralBlob, eocd]);
}

export function readZip(buf: Uint8Array): ZipEntry[] {
  const out: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 < buf.length) {
    if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4b || buf[offset + 2] !== 0x03 || buf[offset + 3] !== 0x04) break;
    const method = buf[offset + 8]! | (buf[offset + 9]! << 8);
    const comp = buf[offset + 18]! | (buf[offset + 19]! << 8) | (buf[offset + 20]! << 16) | (buf[offset + 21]! << 24);
    const nameLen = buf[offset + 26]! | (buf[offset + 27]! << 8);
    const extraLen = buf[offset + 28]! | (buf[offset + 29]! << 8);
    const name = new TextDecoder().decode(buf.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + comp);
    offset = dataStart + comp;
    if (name.endsWith("/") || name.includes("__MACOSX") || name.split("/").pop()?.startsWith(".")) continue;
    try {
      const raw = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
      if (!raw) continue;
      out.push({ name: name.replaceAll("\\", "/"), data: raw instanceof Uint8Array ? raw : new Uint8Array(raw) });
    } catch {
      /* 坏条目跳过 */
    }
  }
  return out;
}

function walkFiles(absDir: string, prefix: string, acc: ZipEntry[]) {
  for (const name of readdirSync(absDir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const abs = join(absDir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) walkFiles(abs, rel, acc);
    else acc.push({ name: rel, data: new Uint8Array(readFileSync(abs)) });
  }
}

export function zipDirectory(absDir: string, zipRootName: string): Uint8Array {
  const entries: ZipEntry[] = [];
  walkFiles(absDir, zipRootName, entries);
  if (entries.length === 0) throw new Error("风格包是空的");
  return buildZip(entries);
}

export function safeZipPath(name: string): string | null {
  const clean = name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return null;
  return clean;
}

export function writeZipEntries(entries: ZipEntry[], dest: string): void {
  const root = resolve(dest);
  mkdirSync(root, { recursive: true });
  for (const e of entries) {
    const rel = safeZipPath(e.name);
    if (!rel) continue;
    const abs = resolve(join(root, rel));
    if (abs !== root && !abs.startsWith(root + sep)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, e.data);
  }
}

export function packPrefixInZip(entries: ZipEntry[]): string | null {
  const hit = entries.find((e) => e.name.split("/").pop() === "pack.json");
  if (!hit) return null;
  const parts = hit.name.split("/");
  parts.pop();
  return parts.join("/");
}

export function flattenPackEntries(entries: ZipEntry[]): ZipEntry[] | null {
  const prefix = packPrefixInZip(entries);
  if (prefix === null) return null;
  const head = prefix ? `${prefix}/` : "";
  return entries
    .filter((e) => (head ? e.name.startsWith(head) : true))
    .map((e) => ({ name: head ? e.name.slice(head.length) : e.name, data: e.data }))
    .filter((e) => e.name && !e.name.endsWith("/"));
}
