import { Hono } from "hono";
import type { FreePlan, ScriptDoc, ScriptNote } from "@vw/core";
import { err, ok } from "../lib/resp";
import { jobQueue } from "../jobs/queue";
import { listEndpoints } from "../services/models";
import { draftFreePlan, draftScript, reviseFreePlan, reviseScript } from "../services/compose";

export const composeRoutes = new Hono();

composeRoutes.post("/plan", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    story?: string;
    mode?: "free" | "remake";
    lockedLine?: string;
    llmEndpointId?: string;
  };
  if (!body.story?.trim()) return err(c, "先写一句想法");
  try {
    return ok(
      c,
      await draftFreePlan({
        story: body.story,
        mode: body.mode === "remake" ? "remake" : "free",
        lockedLine: body.lockedLine,
        llmEndpointId: body.llmEndpointId,
      }),
    );
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

composeRoutes.post("/revise", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    plan?: FreePlan;
    instruction?: string;
    llmEndpointId?: string;
  };
  if (!body.plan?.shots?.length) return err(c, "没有可改的分镜");
  try {
    return ok(
      c,
      await reviseFreePlan({
        plan: body.plan,
        instruction: body.instruction ?? "",
        llmEndpointId: body.llmEndpointId,
      }),
    );
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

composeRoutes.post("/script", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    story?: string;
    packId?: string | null;
    styleHint?: string;
    llmEndpointId?: string;
  };
  if (!body.story?.trim()) return err(c, "先写一句想法");
  if (!listEndpoints("llm").some((e) => e.enabled)) return err(c, "做剧本需要文本模型。到「模型」页加一个。", 422);
  try {
    return ok(
      c,
      await draftScript({
        story: body.story,
        packId: body.packId,
        styleHint: body.styleHint,
        llmEndpointId: body.llmEndpointId,
      }),
    );
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

composeRoutes.post("/script/revise", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    script?: ScriptDoc;
    notes?: ScriptNote[];
    instruction?: string;
    llmEndpointId?: string;
  };
  if (!body.script?.scenes?.length) return err(c, "没有可改的剧本");
  try {
    return ok(
      c,
      await reviseScript({
        script: body.script,
        notes: body.notes ?? [],
        instruction: body.instruction,
        llmEndpointId: body.llmEndpointId,
      }),
    );
  } catch (e) {
    return err(c, e instanceof Error ? e.message : String(e), 422);
  }
});

composeRoutes.post("/keys", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    script?: ScriptDoc;
    packId?: string | null;
    styleHint?: string;
    llmEndpointId?: string;
    imageEndpointId?: string;
    projectId?: string;
  };
  if (!body.script?.scenes?.length) return err(c, "先确认剧本");
  if (!body.projectId) return err(c, "先建一个项目再出图");
  if (!listEndpoints("image").some((e) => e.enabled)) {
    return err(c, "出人物和场景图需要图片模型。到「模型」页加一个。", 422);
  }
  const job = jobQueue.submit(
    "compose.keys",
    {
      script: body.script,
      packId: body.packId ?? null,
      styleHint: body.styleHint,
      llmEndpointId: body.llmEndpointId,
      imageEndpointId: body.imageEndpointId,
      projectId: body.projectId,
    },
    body.projectId,
  );
  return ok(c, job);
});
