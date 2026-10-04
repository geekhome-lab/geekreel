import { getAdapter } from "@vw/models";
import {
  FREE_PLAN_SYSTEM,
  FREE_REVISE_SYSTEM,
  REMAKE_PLAN_SYSTEM,
  fallbackPlan,
  freePlanPrompt,
  parseFreePlan,
  remakePlanPrompt,
  reviseFreePlanPrompt,
} from "@vw/pipeline";
import type { FreePlan } from "@vw/core";
import { resolveEndpoint } from "./models";
import { chatMetered } from "./usage";

export async function draftFreePlan(input: {
  story: string;
  mode?: "free" | "remake";
  lockedLine?: string;
  llmEndpointId?: string;
}): Promise<FreePlan> {
  const story = input.story.trim();
  if (!story) throw new Error("先写一句想法");
  const endpoint = resolveEndpoint("llm", input.llmEndpointId);
  if (!endpoint) return fallbackPlan(story);
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) return fallbackPlan(story);
  const remake = input.mode === "remake";
  try {
    const text = await chatMetered(
      adapter,
      endpoint,
      {
        system: remake ? REMAKE_PLAN_SYSTEM : FREE_PLAN_SYSTEM,
        prompt: remake ? remakePlanPrompt(story) : freePlanPrompt(story, input.lockedLine),
      },
      { jobType: remake ? "compose.remake-plan" : "compose.plan" },
    );
    return parseFreePlan(text, story);
  } catch {
    return fallbackPlan(story);
  }
}

export async function reviseFreePlan(input: {
  plan: FreePlan;
  instruction: string;
  llmEndpointId?: string;
}): Promise<FreePlan> {
  const endpoint = resolveEndpoint("llm", input.llmEndpointId);
  if (!endpoint) {
    const note = input.instruction.trim();
    return {
      ...input.plan,
      summary: note ? `${input.plan.summary}（按：${note}）` : input.plan.summary,
    };
  }
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) return input.plan;
  try {
    const text = await chatMetered(
      adapter,
      endpoint,
      { system: FREE_REVISE_SYSTEM, prompt: reviseFreePlanPrompt(input.plan, input.instruction) },
      { jobType: "compose.revise" },
    );
    return parseFreePlan(text, input.plan.summary || input.plan.title);
  } catch {
    return input.plan;
  }
}
