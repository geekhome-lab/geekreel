import { getAdapter } from "@vw/models";
import { injectImagePrompt } from "@vw/style";
import {
  FREE_PLAN_SYSTEM,
  FREE_REVISE_SYSTEM,
  KEYS_SYSTEM,
  REMAKE_PLAN_SYSTEM,
  SCRIPT_REVISE_SYSTEM,
  SCRIPT_SYSTEM,
  fallbackKeys,
  fallbackPlan,
  freePlanPrompt,
  keysPrompt,
  parseFreePlan,
  parseKeys,
  parseScript,
  remakePlanPrompt,
  reviseFreePlanPrompt,
  reviseScriptPrompt,
  scriptPrompt,
} from "@vw/pipeline";
import type { FreePlan, KeyAssetNeed, ScriptDoc, ScriptNote } from "@vw/core";
import { db } from "../db";
import type { JobHandler } from "../jobs/queue";
import { storeAsset, updateAssetMeta } from "./library";
import { resolveEndpoint } from "./models";
import { loadPack } from "./styles";
import { saveProjectScript } from "./scriptStore";
import { chatMetered, recordUsage } from "./usage";

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

export async function draftScript(input: {
  story: string;
  packId?: string | null;
  styleHint?: string;
  llmEndpointId?: string;
}): Promise<ScriptDoc> {
  const story = input.story.trim();
  if (!story) throw new Error("先写一句想法");
  const endpoint = resolveEndpoint("llm", input.llmEndpointId);
  if (!endpoint) throw new Error("做剧本需要文本模型。到「模型」页加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) throw new Error("这个文本模型不会写剧本，换一个。");
  const pack = input.packId ? loadPack(input.packId) : null;
  const styleName = pack?.public.name || input.styleHint?.trim() || "";
  const styleRules = pack ? [pack.styleBlock, pack.hardConstraint].filter(Boolean).join("\n") : input.styleHint?.trim() || "";
  const text = await chatMetered(
    adapter,
    endpoint,
    {
      system: SCRIPT_SYSTEM,
      prompt: scriptPrompt(story, { styleName, styleRules }),
    },
    { jobType: "compose.script" },
  );
  return parseScript(text, story);
}

export async function reviseScript(input: {
  script: ScriptDoc;
  notes: ScriptNote[];
  instruction?: string;
  llmEndpointId?: string;
}): Promise<ScriptDoc> {
  if (!input.script.scenes?.length) throw new Error("没有可改的剧本");
  if (!input.instruction?.trim() && !input.notes?.length) throw new Error("先说要怎么改");
  const endpoint = resolveEndpoint("llm", input.llmEndpointId);
  if (!endpoint) throw new Error("改剧本需要文本模型。到「模型」页加一个。");
  const adapter = getAdapter(endpoint.adapterType);
  if (!adapter?.chat) return input.script;
  try {
    const text = await chatMetered(
      adapter,
      endpoint,
      {
        system: SCRIPT_REVISE_SYSTEM,
        prompt: reviseScriptPrompt(input.script, input.notes ?? [], input.instruction),
      },
      { jobType: "compose.script-revise" },
    );
    return parseScript(text, input.script.title);
  } catch {
    return input.script;
  }
}

export const composeKeysHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as {
    script?: ScriptDoc;
    packId?: string | null;
    styleHint?: string;
    llmEndpointId?: string;
    imageEndpointId?: string;
    projectId?: string;
  };
  const script = payload.script;
  if (!script?.scenes?.length) throw new Error("先确认剧本");
  const projectId = payload.projectId ?? job.projectId ?? undefined;
  if (projectId) {
    try {
      saveProjectScript(projectId, script);
    } catch {
      /* 剧本文件写失败不挡出图 */
    }
    if (payload.packId) {
      db.run("UPDATE projects SET stylePackId = ? WHERE id = ?", [payload.packId, projectId]);
    }
  }

  ctx.progress(0.08, "从剧本里认人物和场景");
  const pack = payload.packId ? loadPack(payload.packId) : null;
  const styleHint = pack
    ? `${pack.public.name}。${pack.styleBlock}\n${pack.hardConstraint}`
    : payload.styleHint?.trim() || "AI 自己选一种适合这个故事的画面风格，不要水印";

  let keys: KeyAssetNeed[] = fallbackKeys(script, styleHint);
  const llm = resolveEndpoint("llm", payload.llmEndpointId);
  const llmAd = llm ? getAdapter(llm.adapterType) : null;
  if (llmAd?.chat && llm) {
    try {
      const text = await chatMetered(
        llmAd,
        llm,
        { system: KEYS_SYSTEM, prompt: keysPrompt(script, styleHint) },
        { jobType: "compose.keys" },
      );
      keys = parseKeys(text, script, styleHint);
    } catch {
      keys = fallbackKeys(script, styleHint);
    }
  }

  const image = resolveEndpoint("image", payload.imageEndpointId);
  const imageAd = image ? getAdapter(image.adapterType) : null;
  if (!imageAd?.generateImage || !image) {
    throw new Error("出人物和场景图需要图片模型。到「模型」页加一个。");
  }

  const out: KeyAssetNeed[] = [];
  for (let i = 0; i < keys.length; i++) {
    const item = keys[i]!;
    ctx.progress(0.2 + (i / Math.max(1, keys.length)) * 0.7, `在出「${item.name}」`);
    let prompt = item.prompt;
    if (pack) {
      prompt = injectImagePrompt({ pack, raw: item.prompt });
    } else {
      prompt = `${styleHint}\n${item.prompt}`;
    }
    const still = await imageAd.generateImage(image.config, {
      prompt,
      size: item.kind === "character" ? "1024x1536" : "1024x1024",
      signal: ctx.signal,
    });
    const asset = storeAsset({
      type: "image",
      title: item.name,
      ext: "png",
      source: "pipeline",
      projectId,
      data: still.data,
    });
    updateAssetMeta(asset.id, { kind: item.kind });
    recordUsage({ endpoint: image, projectId, jobType: "compose.keys", images: 1 });
    out.push({ ...item, prompt, assetId: asset.id });
  }

  ctx.progress(1, "人物和场景图好了，回来确认");
  return { keys: out, projectId };
};
