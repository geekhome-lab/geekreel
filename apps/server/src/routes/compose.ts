import { Hono } from "hono";
import type { FreePlan } from "@vw/core";
import { err, ok } from "../lib/resp";
import { draftFreePlan, reviseFreePlan } from "../services/compose";

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
