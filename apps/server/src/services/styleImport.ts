import { getAdapter } from "@vw/models";
import {
  CONVERT_SYSTEM,
  convertPrompt,
  extractTextFromZip,
  fetchSkillText,
  heuristicDraft,
  parseSkillMarkdown,
  parseStyleDraft,
  removeUserPackDir,
  writePrompt,
  writeStylePack,
  type StyleDraft,
} from "@vw/style";
import type { JobHandler } from "../jobs/queue";
import { resolveEndpoint } from "./models";
import { extraPackDirs, loadPack } from "./styles";
import { chatMetered } from "./usage";

export interface StyleImportPayload {
  mode: "url" | "write" | "upload";
  name: string;
  url?: string;
  brief?: string;
  text?: string;
  filename?: string;
  endpointId?: string;
}

async function draftFromLlm(system: string, prompt: string, endpointId: string | undefined, fallback: () => StyleDraft): Promise<StyleDraft> {
  const endpoint = resolveEndpoint("llm", endpointId);
  const adapter = endpoint ? getAdapter(endpoint.adapterType) : null;
  if (!endpoint || !adapter?.chat) return fallback();
  try {
    const text = await chatMetered(adapter, endpoint, { system, prompt }, { jobType: "style.import" });
    const parsed = parseStyleDraft(text, fallback().name, undefined);
    return parsed.styleBlock ? parsed : fallback();
  } catch {
    return fallback();
  }
}

export const styleImportHandler: JobHandler = async (job, ctx) => {
  const payload = JSON.parse(job.payloadJson) as StyleImportPayload;
  const name = payload.name?.trim();
  if (!name) throw new Error("先给这套风格起个名字，比如「电商带货」");

  let originUrl: string | null = null;
  let draft: StyleDraft;

  if (payload.mode === "url") {
    const url = payload.url?.trim();
    if (!url) throw new Error("把 GitHub 技能链接贴进来");
    ctx.progress(0.15, "拉取技能");
    const fetched = await fetchSkillText(url);
    originUrl = payload.url!.trim();
    const skill = parseSkillMarkdown(fetched.text);
    ctx.progress(0.45, "转成风格包");
    draft = await draftFromLlm(
      CONVERT_SYSTEM,
      convertPrompt(name, skill, payload.brief ?? ""),
      payload.endpointId,
      () => heuristicDraft(skill, name),
    );
  } else if (payload.mode === "write") {
    const brief = payload.brief?.trim() || payload.text?.trim();
    if (!brief) throw new Error("请描述这套风格的视觉特征，将据此生成风格包");
    ctx.progress(0.3, "正在生成风格包");
    draft = await draftFromLlm(
      CONVERT_SYSTEM,
      writePrompt(name, brief),
      payload.endpointId,
      () => heuristicDraft({ name, description: brief, body: brief }, name),
    );
  } else {
    let text = payload.text ?? "";
    const filename = payload.filename ?? "";
    if (!text.trim()) throw new Error("还没有文件。上传 SKILL.md，或把内容贴进来。");
    if (filename.toLowerCase().endsWith(".zip")) {
      ctx.progress(0.2, "解开压缩包");
      const bin = Uint8Array.from(Buffer.from(text, "base64"));
      const extracted = extractTextFromZip(bin);
      if (!extracted) throw new Error("压缩包里没找到 SKILL.md 或说明文件");
      text = extracted;
    }
    ctx.progress(0.4, "读技能");
    const skill = parseSkillMarkdown(text);
    draft = await draftFromLlm(
      CONVERT_SYSTEM,
      convertPrompt(name, skill, payload.brief ?? ""),
      payload.endpointId,
      () => heuristicDraft(skill, name),
    );
  }

  draft.name = name;
  ctx.progress(0.8, "写入风格包");
  const written = writeStylePack({ draft, originUrl, extraDirs: extraPackDirs() });
  ctx.progress(1, "已添加");
  return { packId: written.id, name: draft.name, directory: written.directory };
};

export function deleteUserStyle(id: string): boolean {
  const pack = loadPack(id);
  if (!pack) return false;
  if (!pack.public.editable) throw new Error("内置风格不能删，只能停用或再加一套");
  removeUserPackDir(pack.directory);
  return true;
}
