import type { KeyAssetNeed, ScriptDoc, ScriptLine, ScriptNote, ScriptScene } from "@vw/core";

export const SCRIPT_SYSTEM =
  "你是编剧。把用户的想法写成能拍的故事：分场、画面、台词，并给每场标上剧情时间轴（startSec/endSec）。用户提示词里如果自己写了时长或节奏，就按他的来；没写就按故事该有的篇幅来，不要擅自压成几秒预告片，也不要替用户规定总秒数。选了风格就要按那种画面想镜头。不要解释。只输出 JSON。";

export const SCRIPT_REVISE_SYSTEM =
  "你是编剧。按用户的话改剧本。用户说改时长、压场次、删台词，就照做并重标 startSec/endSec 和 durationSec。没点名的部分尽量留着。不要解释。只输出完整 JSON。";

export const KEYS_SYSTEM =
  "你是美术指导。从剧本里抽出关键视觉资产，写成可直接文生图的提示。必须遵守给定的画面风格；风格是手绘/白板/线稿时，只能出示意图，禁止写成写实定妆照。只输出 JSON。";

export function scriptPrompt(
  story: string,
  opts?: { styleName?: string; styleRules?: string },
): string {
  const style = [opts?.styleName, opts?.styleRules].filter(Boolean).join("\n");
  return `把下面的想法写成带剧情时间轴的剧本 JSON：
{"title":"短标题","logline":"一两句故事","durationSec":0,"scenes":[{"id":"C01","heading":"场次","startSec":0,"endSec":8,"action":"这段画面发生什么","lines":[{"id":"L01","speaker":"人名或旁白","text":"这段要说的台词"}]}]}

规则：
- 写成完整故事，场次按情节走。经典长故事覆盖开端、发展、高潮、收束；随口点子也按它该有的篇幅写。
- 每场写清 heading、action、能说出口的台词或旁白，并标 startSec/endSec（剧情时间，方便后面对齐出片）。各场首尾相接即可。讲解片、示意图也必须有旁白，不要只写画面。
- 用户如果在想法里自己写了「几秒 / 多长 / 几集」，按他写的来。没写就不要替他规定总秒数，也不要压成预告片。
- durationSec 填各场加总，不要自己改成固定 5 秒或 10 秒。
${style ? `- 画面风格（镜头和动作必须按这个写，禁止写成另一种风格的戏）：\n${style}\n` : ""}
想法：
${story.trim()}`;
}

export function reviseScriptPrompt(script: ScriptDoc, notes: ScriptNote[], instruction?: string): string {
  const talk = instruction?.trim() ?? "";
  const marks = notes.map((n) => `- 针对 ${n.targetId}：${n.text}`).join("\n");
  const ask = [talk && `用户说：${talk}`, marks && `台词批注：\n${marks}`].filter(Boolean).join("\n");
  return `按用户的话改这份剧本。
当前：${JSON.stringify({ title: script.title, logline: script.logline, durationSec: script.durationSec, scenes: script.scenes })}
${ask || "按原意写得更能拍一点"}

用户如果要求改总时长或场次数量，必须改 durationSec 和各场 startSec/endSec，让加总对上。没要求就不要乱改时长。
只输出完整 JSON：{"title","logline","durationSec","scenes":[{"id","heading","startSec","endSec","action","lines":[{"id","speaker","text"}]}]}`;
}

export function keysPrompt(script: ScriptDoc, styleHint: string): string {
  const whiteboard = /白板|线稿|示意图|素描/.test(styleHint);
  return `从剧本抽出关键视觉资产 JSON：
{"keys":[{"id":"K01","kind":"${whiteboard ? "scene" : "character"}","name":"名","prompt":"能出图的描述"}]}

规则：
- ${whiteboard ? "手绘白板：出概念示意图，不要写实人物定妆照。人物用简笔轮廓，场景用一张一概念的线稿。最多 4 张。" : "人物按出场重要角色来，最多 5 个；场景最多 3 个；总共不超过 8 张。"}
- prompt 写清楚能出图，不要镜头术语。
${styleHint ? `- 画面风格（必须写进每条 prompt）：\n${styleHint}\n` : ""}
剧本：
${JSON.stringify({ title: script.title, logline: script.logline, durationSec: script.durationSec, scenes: script.scenes })}`;
}

export function parseScript(text: string, fallbackStory: string): ScriptDoc {
  const raw = extractJson(text);
  if (raw) {
    try {
      return normalizeScript(JSON.parse(raw) as Record<string, unknown>, fallbackStory);
    } catch {
      /* 走兜底 */
    }
  }
  return fallbackScript(fallbackStory);
}

export function parseKeys(text: string, script: ScriptDoc, styleHint = ""): KeyAssetNeed[] {
  const raw = extractJson(text);
  if (raw) {
    try {
      const r = JSON.parse(raw) as { keys?: unknown };
      if (Array.isArray(r.keys)) {
        const keys = r.keys.map(normalizeKey).filter((k) => k.name && k.prompt).slice(0, 8);
        if (keys.length) return keys;
      }
    } catch {
      /* 走兜底 */
    }
  }
  return fallbackKeys(script, styleHint);
}

export function fallbackScript(story: string): ScriptDoc {
  const seed = story.replace(/\s+/g, " ").trim() || "一句话短片";
  const title = seed.slice(0, 12);
  return {
    title,
    logline: seed.slice(0, 40),
    durationSec: 30,
    scenes: [
      {
        id: "C01",
        heading: "开场",
        startSec: 0,
        endSec: 8,
        action: `把「${seed.slice(0, 20)}」摆到观众面前。`,
        lines: [
          { id: "L01", speaker: "旁白", text: `今儿说的，是${seed.slice(0, 16)}。` },
          { id: "L02", speaker: "主角", text: "这事，我认了。" },
        ],
      },
      {
        id: "C02",
        heading: "正事",
        startSec: 8,
        endSec: 22,
        action: "冲突起来。",
        lines: [
          { id: "L03", speaker: "旁白", text: "接着，事情就不一样了。" },
          { id: "L04", speaker: "主角", text: "来吧。" },
        ],
      },
      {
        id: "C03",
        heading: "收束",
        startSec: 22,
        endSec: 30,
        action: "定格收场。",
        lines: [{ id: "L05", speaker: "旁白", text: "就这样。" }],
      },
    ],
  };
}

export function fallbackKeys(script: ScriptDoc, styleHint = ""): KeyAssetNeed[] {
  const whiteboard = /白板|线稿|示意图|素描|手绘/.test(styleHint);
  if (whiteboard) {
    return script.scenes.slice(0, 4).map((s, i) => ({
      id: `K${String(i + 1).padStart(2, "0")}`,
      kind: "scene" as const,
      name: s.heading || `示意${i + 1}`,
      prompt: `手绘线稿示意图：${s.action || s.heading}。暖米黄纸底，深灰铅笔简笔轮廓，大面积留白。禁止真人、写实、照片。`,
    }));
  }
  const speakers = [...new Set(script.scenes.flatMap((s) => s.lines.map((l) => l.speaker)).filter((n) => n && n !== "旁白"))];
  const people = (speakers.length ? speakers : ["主角"]).slice(0, 5);
  const places = script.scenes.map((s) => s.heading).filter(Boolean).slice(0, 3);
  const keys: KeyAssetNeed[] = people.map((name, i) => ({
    id: `K${String(i + 1).padStart(2, "0")}`,
    kind: "character" as const,
    name,
    prompt: `${name}，全身，外貌清楚，和剧本「${script.title}」相符`,
  }));
  places.forEach((name, i) => {
    keys.push({
      id: `K${String(keys.length + 1).padStart(2, "0")}`,
      kind: "scene",
      name,
      prompt: `${name}，空镜，能看出地点，和「${script.title}」相符`,
    });
  });
  return keys.slice(0, 8);
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const raw = fenced?.[1] ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : null;
}

function normalizeScript(r: Record<string, unknown>, fallbackStory: string): ScriptDoc {
  const rawScenes = Array.isArray(r.scenes) ? r.scenes.map(normalizeScene).filter((s) => s.heading || s.lines.length) : [];
  const scenes = keepSceneTimes(rawScenes.length ? rawScenes : fallbackScript(fallbackStory).scenes);
  const last = scenes[scenes.length - 1]?.endSec ?? 0;
  const declared = Number(r.durationSec);
  return {
    title: String(r.title ?? "").trim() || fallbackStory.replace(/\s+/g, " ").slice(0, 12) || "未命名",
    logline: String(r.logline ?? "").trim() || fallbackStory.replace(/\s+/g, " ").slice(0, 40),
    durationSec: Number.isFinite(declared) && declared > 0 ? Math.round(declared) : last,
    scenes,
  };
}

/** 有剧情时间就原样留着；缺的才按出场顺序往后接，不改用户/模型已经写好的秒数。 */
export function keepSceneTimes(scenes: ScriptScene[]): ScriptScene[] {
  let cursor = 0;
  return scenes.map((s) => {
    if (s.endSec > s.startSec) {
      cursor = s.endSec;
      return s;
    }
    const startSec = cursor;
    const endSec = startSec + 8;
    cursor = endSec;
    return { ...s, startSec, endSec };
  });
}

function normalizeScene(raw: unknown, i: number): ScriptScene {
  const x = (raw ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(x.lines) ? x.lines.map(normalizeLine).filter((l) => l.text) : [];
  const startSec = Number(x.startSec);
  const endSec = Number(x.endSec);
  return {
    id: String(x.id ?? `C${String(i + 1).padStart(2, "0")}`),
    heading: String(x.heading ?? "").trim() || `第${i + 1}场`,
    action: String(x.action ?? "").trim(),
    lines,
    startSec: Number.isFinite(startSec) ? Math.max(0, startSec) : 0,
    endSec: Number.isFinite(endSec) ? Math.max(0, endSec) : 0,
  };
}

function normalizeLine(raw: unknown, i: number): ScriptLine {
  const x = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(x.id ?? `L${String(i + 1).padStart(2, "0")}`),
    speaker: String(x.speaker ?? "旁白").trim() || "旁白",
    text: String(x.text ?? "").trim(),
  };
}

function normalizeKey(raw: unknown, i: number): KeyAssetNeed {
  const x = (raw ?? {}) as Record<string, unknown>;
  const kind = x.kind === "scene" ? "scene" : "character";
  return {
    id: String(x.id ?? `K${String(i + 1).padStart(2, "0")}`),
    kind,
    name: String(x.name ?? "").trim(),
    prompt: String(x.prompt ?? "").trim(),
  };
}
