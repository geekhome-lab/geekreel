import { Hono } from "hono";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { getPipeline, listPipelines } from "../services/pipeline";
import { loadPack } from "../services/styles";
import { listEndpoints } from "../services/models";

export const pipelineRoutes = new Hono();

pipelineRoutes.get("/", (c) => ok(c, listPipelines(c.req.query("projectId") || undefined)));

pipelineRoutes.get("/:id", (c) => {
  const run = getPipeline(c.req.param("id"));
  if (!run) return err(c, "流水线不存在", 404);
  return ok(c, run);
});

pipelineRoutes.post("/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    story?: string;
    packId?: string;
    substyle?: string;
    projectId?: string;
    llmEndpointId?: string;
    imageEndpointId?: string;
  };
  if (!body.story?.trim()) return err(c, "先写一句故事或贴一段小说");
  if (body.packId) {
    const pack = loadPack(body.packId);
    if (!pack) return err(c, "没找到这套风格");
    if (!pack.public.ready) return err(c, pack.public.unavailableReason || "这套风格还不能用");
    for (const cap of pack.public.requiredCapabilities) {
      if (cap === "llm" && !listEndpoints("llm").some((e) => e.enabled)) {
        return err(c, "还没有文本模型。拆集和色盘要靠它，请到「模型」页添加。");
      }
      if (cap === "image" && !listEndpoints("image").some((e) => e.enabled)) {
        return err(c, "还没有图片模型。出图要靠它，请到「模型」页添加。");
      }
    }
  }
  const job = jobQueue.submit("pipeline.run", body, body.projectId ?? null);
  return ok(c, job);
});
