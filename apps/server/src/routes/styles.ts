import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { deleteUserStyle, type StyleImportPayload } from "../services/styleImport";
import { listPacks, loadPack, packCover } from "../services/styles";

export const stylesRoutes = new Hono();

stylesRoutes.get("/", (c) => ok(c, listPacks()));

stylesRoutes.post("/import", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as StyleImportPayload;
  if (!body.name?.trim()) return err(c, "先给这套风格起个名字，比如「电商带货」");
  if (body.mode === "url" && !body.url?.trim()) return err(c, "把 GitHub 技能链接贴进来");
  if (body.mode === "write" && !body.brief?.trim() && !body.text?.trim()) {
    return err(c, "请描述这套风格的视觉特征，将据此生成风格包");
  }
  if (body.mode === "upload" && !body.text?.trim()) return err(c, "上传 SKILL.md，或把内容贴进来");
  const job = jobQueue.submit("style.import", {
    mode: body.mode,
    name: body.name.trim(),
    url: body.url,
    brief: body.brief,
    text: body.text,
    filename: body.filename,
    endpointId: body.endpointId,
  });
  return ok(c, job);
});

stylesRoutes.delete("/:id", (c) => {
  try {
    if (!deleteUserStyle(c.req.param("id"))) return err(c, "风格不存在", 404);
    return ok(c, { removed: true });
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e));
  }
});

stylesRoutes.get("/:id/cover", (c) => {
  const cover = packCover(c.req.param("id"));
  if (!cover) return err(c, "没有封面", 404);
  const data = readFileSync(cover.path);
  return new Response(Buffer.from(data), {
    headers: { "Content-Type": cover.mime, "Cache-Control": "public, max-age=3600" },
  });
});

stylesRoutes.get("/:id", (c) => {
  const pack = loadPack(c.req.param("id"));
  if (!pack) return err(c, "风格包不存在。点「添加风格」或把目录放到 stylePacks/。", 404);
  return ok(c, pack.public);
});
