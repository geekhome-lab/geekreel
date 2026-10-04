import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { err, ok } from "../lib/resp";
import { listPacks, loadPack, packCover } from "../services/styles";

export const stylesRoutes = new Hono();

stylesRoutes.get("/", (c) => ok(c, listPacks()));

stylesRoutes.get("/:id", (c) => {
  const pack = loadPack(c.req.param("id"));
  if (!pack) return err(c, "风格包不存在。把符合契约的目录放到 stylePacks/ 再刷新。", 404);
  return ok(c, pack.public);
});

stylesRoutes.get("/:id/cover", (c) => {
  const cover = packCover(c.req.param("id"));
  if (!cover) return err(c, "没有封面", 404);
  const data = readFileSync(cover.path);
  return new Response(Buffer.from(data), {
    headers: { "Content-Type": cover.mime, "Cache-Control": "public, max-age=3600" },
  });
});
