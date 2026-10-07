import { Hono } from "hono";
import { jobQueue } from "../jobs/queue";
import { err, ok } from "../lib/resp";
import {
  advancePipeline,
  bindPipelineEntity,
  getPipeline,
  listPipelines,
  retryPipelineBible,
  revisePipelineBible,
  revisePipelineCast,
} from "../services/pipeline";
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
  if (!body.packId && !listEndpoints("llm").some((e) => e.enabled)) {
    return err(c, "通读全文认人物需要文本模型。请到「模型」页添加一个。", 422);
  }
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

pipelineRoutes.post("/render-episode", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    projectId?: string;
    episodeIndex?: number;
  };
  if (!body.projectId) return err(c, "先打开一个短剧项目");
  if (!listEndpoints("image").some((e) => e.enabled) && !listEndpoints("video").some((e) => e.enabled)) {
    return err(c, "出集至少要有图片或视频模型。到「模型」页加上再来。", 422);
  }
  const job = jobQueue.submit("pipeline.episode", body, body.projectId);
  return ok(c, job);
});

pipelineRoutes.post("/:id/advance", async (c) => {
  try {
    return ok(c, await advancePipeline(c.req.param("id")));
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

pipelineRoutes.post("/:id/revise", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    target?: "character" | "event" | "all";
    targetId?: string;
    instruction?: string;
    images?: Array<{ mime: string; dataBase64: string }>;
  };
  if (body.target === "all") {
    try {
      return ok(c, await revisePipelineBible(c.req.param("id"), body.instruction ?? ""));
    } catch (e) {
      return err(c, e instanceof Error ? e.message : String(e), 422);
    }
  }
  if (body.target !== "character" && body.target !== "event") return err(c, "请点一个角色或一条事件，或改整份");
  if (!body.targetId?.trim()) return err(c, "缺少要改的条目");
  try {
    return ok(
      c,
      await revisePipelineCast(c.req.param("id"), {
        target: body.target,
        targetId: body.targetId.trim(),
        instruction: body.instruction ?? "",
        images: body.images,
      }),
    );
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

pipelineRoutes.post("/:id/bind-entity", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    entityId?: string;
    assetId?: string;
    view?: "face" | "front" | "side" | "full";
  };
  if (!body.entityId?.trim() || !body.assetId?.trim()) return err(c, "先选一个角色或场景，再从资产库挑一张");
  try {
    return ok(
      c,
      bindPipelineEntity(c.req.param("id"), {
        entityId: body.entityId.trim(),
        assetId: body.assetId.trim(),
        view: body.view,
      }),
    );
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
