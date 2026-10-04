import { Hono } from "hono";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import { advancePipeline, getPipeline, listPipelines, retryPipelineBible } from "../services/pipeline";
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
    url?: string;
    packId?: string;
    substyle?: string;
    projectId?: string;
    llmEndpointId?: string;
    imageEndpointId?: string;
    seriesId?: string;
    seriesName?: string;
    kind?: "drama" | "free" | "whiteboard";
    checkpoint?: boolean;
  };
  if (!body.story?.trim() && !body.url?.trim()) return err(c, "先上传小说、贴一段正文，或给一个能打开的链接");
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

pipelineRoutes.post("/:id/advance", (c) => {
  try {
    return ok(c, advancePipeline(c.req.param("id")));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

pipelineRoutes.post("/:id/retry-step", (c) => {
  try {
    return ok(c, retryPipelineBible(c.req.param("id")));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});
