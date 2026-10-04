import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { JobHandler } from "../jobs/queue";
import { setLibraryRoot } from "./library";

/** 把旧资产库目录拷到新目录。相对路径不变，数据库不用改。 */
export const migrateLibraryHandler: JobHandler = async (job, ctx) => {
  const { from, to } = JSON.parse(job.payloadJson) as { from?: string; to?: string };
  if (!from || !to) throw new Error("缺少迁移路径");
  if (from === to) return { copied: 0, to };
  if (!existsSync(from)) throw new Error("原来的资产库目录找不到了，请手动把文件拷过去");
  mkdirSync(to, { recursive: true });

  const names = readdirSync(from).filter((n) => n !== ".DS_Store");
  let copied = 0;
  for (const name of names) {
    ctx.progress(copied / Math.max(1, names.length), `正在搬 ${name}`);
    cpSync(join(from, name), join(to, name), { recursive: true, force: false });
    copied++;
  }
  setLibraryRoot(to);
  ctx.progress(1, "搬家完成");
  return { copied, to };
};
