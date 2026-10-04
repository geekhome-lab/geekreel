import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Capability, ModelEndpoint } from "@vw/models";
import { capabilityLabels } from "@vw/models";
import { spokenLine, type Job, type KeyAssetNeed, type Project, type ScriptDoc, type ScriptLine, type ScriptNote, type StylePackPublic } from "@vw/core";
import { api, apiJson } from "../lib/api";
import {
  listHomeWorks,
  loadHomeDraft,
  loadShelf,
  markHomeDone,
  parkCurrent,
  removeHomeWork,
  resumeStep,
  saveHomeDraft,
  syncHomeWorks,
  workStatusLabels,
  type HomeDraft,
  type HomeStep,
} from "../lib/homeDraft";
import { usePrefs } from "../lib/prefs";
import { useAppStore } from "../lib/store";
import { submitImageGen, waitForJob } from "../lib/runGen";
import { iconPlay } from "../lib/icons";

const modelCaps: Capability[] = ["llm", "image", "video", "tts"];

function sceneSec(sc: { startSec?: number; endSec?: number }): number {
  const dur = Math.round((sc.endSec ?? 0) - (sc.startSec ?? 0));
  return dur > 0 ? dur : 8;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function HomePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);
  const autoSubtitles = usePrefs((s) => s.autoSubtitles);
  const patchPrefs = usePrefs((s) => s.patch);

  const restored = loadHomeDraft();
  const [step, setStep] = useState<HomeStep>(
    params.get("return") === "home" && restored ? resumeStep(restored) : "write",
  );
  const [idea, setIdea] = useState(restored?.idea ?? "");
  const [script, setScript] = useState<ScriptDoc | null>(restored?.script ?? null);
  const [notes, setNotes] = useState<ScriptNote[]>(restored?.notes ?? []);
  const [packId, setPackId] = useState<string | null>(restored?.packId ?? null);
  const [packLabel, setPackLabel] = useState(restored?.packLabel ?? "");
  const [keys, setKeys] = useState<KeyAssetNeed[]>(restored?.keys ?? []);
  const [projectId, setProjectId] = useState<string | null>(restored?.projectId ?? null);
  const [pickedLine, setPickedLine] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keyRev, setKeyRev] = useState<Record<string, number>>({});
  const [asSeries, setAsSeries] = useState(restored?.asSeries ?? false);
  const [source, setSource] = useState<HomeDraft["source"]>(restored?.source ?? "home");
  const [radarPlatform, setRadarPlatform] = useState(restored?.radarPlatform ?? "");
  const [radarItemId, setRadarItemId] = useState<string | null>(restored?.radarItemId ?? null);
  const [works, setWorks] = useState<HomeDraft[]>(() => listHomeWorks());

  const [pref, setPref] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("vw.modelPref") ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });

  const { data: endpoints } = useQuery({
    queryKey: ["model-endpoints"],
    queryFn: () => api<ModelEndpoint[]>("/api/models/endpoints"),
  });
  const { data: packs } = useQuery({
    queryKey: ["styles"],
    queryFn: () => api<StylePackPublic[]>("/api/styles"),
  });

  const byCap = useMemo(() => {
    const map: Record<Capability, ModelEndpoint[]> = { llm: [], image: [], video: [], tts: [] };
    for (const ep of endpoints ?? []) if (ep.enabled) map[ep.capability]?.push(ep);
    return map;
  }, [endpoints]);

  const pick = (cap: Capability): string => {
    const chosen = pref[cap];
    const list = byCap[cap];
    if (chosen && list.some((e) => e.id === chosen)) return chosen;
    return list.find((e) => e.isDefault)?.id ?? list[0]?.id ?? "";
  };
  const setPick = (cap: Capability, id: string) => {
    const next = { ...pref, [cap]: id };
    setPref(next);
    localStorage.setItem("vw.modelPref", JSON.stringify(next));
  };

  const readyPacks = (packs ?? []).filter((p) => p.ready);

  const persist = (patch: Partial<HomeDraft> & { step?: HomeStep }) => {
    const draft: HomeDraft = {
      idea,
      script,
      notes,
      packId,
      packLabel,
      keys,
      projectId,
      step,
      asSeries,
      durationSec: script?.durationSec ?? 0,
      source,
      radarItemId,
      radarPlatform,
      updatedAt: Date.now(),
      ...patch,
    };
    saveHomeDraft(draft);
    setWorks(listHomeWorks());
  };

  useEffect(() => {
    if (params.get("return") !== "home") return;
    const draft = loadHomeDraft();
    if (!draft?.script) return;
    setIdea(draft.idea);
    setScript(draft.script);
    setNotes(draft.notes);
    setPackId(draft.packId);
    setPackLabel(draft.packLabel);
    setKeys(draft.keys);
    setProjectId(draft.projectId);
    setAsSeries(draft.asSeries);
    setStep(resumeStep(draft));
    setSource(draft.source);
    setRadarPlatform(draft.radarPlatform ?? "");
    setRadarItemId(draft.radarItemId ?? null);
  }, [params]);

  useEffect(() => {
    if (params.get("from") !== "radar") return;
    const draft = loadHomeDraft();
    if (!draft?.idea) return;
    setIdea(draft.idea);
    setScript(draft.script);
    setNotes(draft.notes);
    setPackId(draft.packId);
    setPackLabel(draft.packLabel);
    setKeys(draft.keys);
    setProjectId(draft.projectId);
    setAsSeries(draft.asSeries);
    setStep("write");
    setSource("radar");
    setRadarPlatform(draft.radarPlatform ?? "");
    setRadarItemId(draft.radarItemId ?? null);
    setWorks(listHomeWorks());
  }, [params]);

  useEffect(() => {
    void Promise.all([
      api<{ items: Job[] }>("/api/jobs?type=compose.keys&pageSize=40"),
      api<{ items: Job[] }>("/api/jobs?type=gen.video&status=done&pageSize=40"),
    ])
      .then(([keys, videos]) => {
        syncHomeWorks([...(keys.items ?? []), ...(videos.items ?? [])]);
        setWorks(listHomeWorks());
      })
      .catch(() => {
        /* 没有旧任务就算了 */
      });
  }, []);

  const applyDraft = (draft: HomeDraft) => {
    saveHomeDraft(draft);
    setIdea(draft.idea);
    setScript(draft.script);
    setNotes(draft.notes);
    setPackId(draft.packId);
    setPackLabel(draft.packLabel);
    setKeys(draft.keys);
    setProjectId(draft.projectId);
    setAsSeries(draft.asSeries);
    setStep(resumeStep(draft));
    setSource(draft.source);
    setRadarPlatform(draft.radarPlatform ?? "");
    setRadarItemId(draft.radarItemId ?? null);
    setWorks(listHomeWorks());
    if (draft.step === "shot" && draft.projectId) {
      setCurrentProject(draft.projectId);
      navigate("/canvas");
    }
  };

  const makeScript = async () => {
    const story = idea.trim();
    if (!story || busy) return;
    if (!pick("llm")) {
      setError("做剧本需要文本模型。到「模型」页加一个。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await apiJson<ScriptDoc>("/api/compose/script", "post", {
        story,
        packId,
        styleHint: packId ? undefined : packLabel || undefined,
        llmEndpointId: pick("llm") || undefined,
      });
      setScript(next);
      setNotes([]);
      setStep("script");
      persist({ idea: story, script: next, notes: [], step: "script", durationSec: next.durationSec });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addNote = () => {
    if (!pickedLine || !noteDraft.trim()) return;
    const next = [...notes, { id: `N${Date.now().toString(36)}`, targetId: pickedLine, text: noteDraft.trim() }];
    setNotes(next);
    setNoteDraft("");
    persist({ notes: next });
  };

  const rewriteScript = async () => {
    let talk = noteDraft.trim();
    if (pickedLine && talk) talk = `针对「${lineLabel(pickedLine)}」：${talk}`;
    if (!script || busy) return;
    if (!talk && notes.length === 0) return;
    if (!pick("llm")) {
      setError("改剧本需要文本模型。到「模型」页加一个。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await apiJson<ScriptDoc>("/api/compose/script/revise", "post", {
        script,
        notes,
        instruction: talk || undefined,
        llmEndpointId: pick("llm") || undefined,
      });
      setScript(next);
      setNotes([]);
      setNoteDraft("");
      setPickedLine(null);
      persist({ script: next, notes: [], step: "script", durationSec: next.durationSec });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmScript = () => {
    if (!script) return;
    if (packLabel) {
      void pickStyle(packId, packLabel);
      return;
    }
    setStep("style");
    persist({ step: "style" });
  };

  const pickStyle = async (id: string | null, label: string) => {
    if (busy) return;
    if (!script) return;
    if (!pick("image")) {
      setError("出人物和场景图需要图片模型。到「模型」页加一个。");
      return;
    }
    useAppStore.getState().setPendingAutoRun(false);
    setPackId(id);
    setPackLabel(label);
    setBusy(true);
    setError("");
    try {
      let pid = projectId;
      if (!pid) {
        const project = await apiJson<Project>("/api/projects/quick", "post", {
          name: script.title || idea.trim().slice(0, 16) || "未命名",
          seriesName: asSeries ? script.title || idea.trim().slice(0, 16) || "未命名" : undefined,
          kind: "free",
          stylePackId: id || undefined,
        });
        pid = project.id;
        setProjectId(pid);
        setCurrentProject(pid);
      } else {
        await apiJson(`/api/projects/${pid}`, "patch", { stylePackId: id });
      }
      const job = await apiJson<Job>("/api/compose/keys", "post", {
        script,
        packId: id,
        styleHint: id ? undefined : "AI 自己选一种适合这个故事的画面风格，不要水印",
        llmEndpointId: pick("llm") || undefined,
        imageEndpointId: pick("image") || undefined,
        projectId: pid,
      });
      const done = await waitForJob(job.id, 20 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { keys?: KeyAssetNeed[] };
      const nextKeys = result.keys ?? [];
      setKeys(nextKeys);
      setStep("keys");
      persist({ packId: id, packLabel: label, keys: nextKeys, projectId: pid, step: "keys" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const redoKey = async (slot: KeyAssetNeed, instruction: string) => {
    if (!projectId || busy) return;
    setBusy(true);
    setError("");
    try {
      const job = await submitImageGen({
        prompt: instruction.trim() ? `${slot.prompt}\n按这个改：${instruction.trim()}` : slot.prompt,
        size: slot.kind === "character" ? "1024x1536" : "1024x1024",
        endpointId: pick("image") || null,
        projectId,
        replaceAssetId: slot.assetId,
      });
      const done = await waitForJob(job.id, 8 * 60_000);
      const result = JSON.parse(done.resultJson ?? "{}") as { assetId?: string };
      if (!result.assetId) throw new Error("没换出来");
      const next = keys.map((k) => (k.id === slot.id ? { ...k, assetId: result.assetId } : k));
      setKeys(next);
      setKeyRev((m) => ({ ...m, [slot.id]: Date.now() }));
      persist({ keys: next, step: "keys" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const goEditAsset = (slot: KeyAssetNeed) => {
    if (!slot.assetId) return;
    persist({ step: "keys" });
    navigate(`/assets?focus=${encodeURIComponent(slot.assetId)}&return=home&slot=${encodeURIComponent(slot.id)}`);
  };

  const startCanvas = async () => {
    if (!script || !projectId || busy) return;
    if (!pick("video")) {
      setError("出片需要视频模型。到「模型」页加一个，不要再铺一堆图。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setCurrentProject(projectId);
      if (asSeries) {
        await apiJson(`/api/projects/${projectId}/ensure-series`, "post", {
          name: script.title || idea.trim().slice(0, 16) || "未命名",
          kind: "free",
        });
      }
      await apiJson(`/api/projects/${projectId}`, "patch", { stylePackId: packId });
      await apiJson(`/api/projects/${projectId}/script`, "put", { script });
      const canvasList = await api<Array<{ id: string }>>(`/api/canvas/project/${projectId}`);
      const canvasId = canvasList[0]!.id;
      const pack = (packs ?? []).find((p) => p.id === packId);
      const styleText = pack?.stylePrompt || (packLabel && packLabel !== "其他风格，AI自由发挥" ? `风格：${packLabel}` : "");
      const handDrawn = packId === "whiteboard" || /白板|手绘|线稿|示意图/.test(`${packLabel}\n${styleText}`);
      const faces = keys.filter((k) => k.kind === "character" && k.assetId);
      const lock = handDrawn
        ? [
            "必须是手绘线稿示意图，暖米黄纸底，深灰铅笔线。禁止真人、写实、照片、三维、电影。",
            "【画面风格，必须遵守】",
            styleText,
            "直接按风格文生视频，不要写成真人短剧。画面里不要出现文字。",
          ]
            .filter(Boolean)
            .join("\n")
        : [
            faces.map((k) => `角色锁定「${k.name}」：必须和定妆同一张脸、同一套衣服。`).join("\n"),
            styleText ? `【画面风格，必须遵守】\n${styleText}` : "",
          ]
            .filter(Boolean)
            .join("\n");
      const nodes: unknown[] = [];
      const edges: unknown[] = [];
      keys.forEach((k, i) => {
        if (!k.assetId) return;
        nodes.push({
          id: `key_${k.id}`,
          type: "assetNode",
          position: { x: 40, y: 40 + i * 180 },
          data: { assetId: k.assetId },
        });
      });
      const faceId = faces[0] ? `key_${faces[0].id}` : null;
      script.scenes.forEach((scene, i) => {
        const line = scene.lines.map((l) => `${l.speaker}：${l.text}`).join("\n");
        const spoken = spokenLine(scene);
        const prompt = [
          lock,
          `${formatClock(scene.startSec)}–${formatClock(scene.endSec)}（${sceneSec(scene)}秒）`,
          scene.action || scene.heading,
          line,
        ]
          .filter(Boolean)
          .join("\n");
        const textId = `t_${i}`;
        const genId = `g_${i}`;
        nodes.push(
          { id: textId, type: "textNode", position: { x: 360, y: 40 + i * 260 }, data: { text: prompt } },
          {
            id: genId,
            type: "videoGenNode",
            position: { x: 700, y: 20 + i * 260 },
            data: {
              prompt: "",
              durationSec: sceneSec(scene),
              endpointId: pick("video") || null,
              status: "idle",
              line: spoken,
            },
          },
        );
        edges.push({ id: `e_${i}`, source: textId, sourceHandle: "out", target: genId, targetHandle: "prompt", animated: true });
        // 手绘包必须走文生视频。图生会锁死参考图长相，Skill 就失效了。
        if (!handDrawn && faceId) {
          edges.push({ id: `e_ref_${i}`, source: faceId, target: genId, targetHandle: "image" });
        }
      });
      await apiJson(`/api/canvas/${canvasId}`, "put", {
        doc: { version: 1, nodes, edges, viewport: null },
      });
      persist({ step: "shot", projectId });
      const done = loadHomeDraft();
      if (done) markHomeDone({ ...done, step: "shot", projectId });
      parkCurrent();
      sessionStorage.setItem("vw.autoDub", projectId);
      sessionStorage.setItem("vw.autoRun", projectId);
      setPendingAutoRun(true);
      navigate("/canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const reset = () => {
    persist({ step });
    parkCurrent();
    setStep("write");
    setScript(null);
    setNotes([]);
    setPackId(null);
    setPackLabel("");
    setKeys([]);
    setProjectId(null);
    setPickedLine(null);
    setNoteDraft("");
    setBusy(false);
    setError("");
    setAsSeries(false);
    setIdea("");
    setSource("home");
    setRadarPlatform("");
    setRadarItemId(null);
    setWorks(listHomeWorks());
  };

  const dropRadar = () => {
    const cur = loadHomeDraft();
    const itemId = cur?.radarItemId;
    const ideaText = (cur?.idea ?? idea).trim();
    if (cur?.source === "radar") removeHomeWork(cur);
    for (const w of [...listHomeWorks(), ...loadShelf()]) {
      if (itemId && w.radarItemId === itemId) removeHomeWork(w);
      else if (w.source === "radar" && ideaText && w.idea.trim() === ideaText) removeHomeWork(w);
    }
    setSource("home");
    setRadarPlatform("");
    setRadarItemId(null);
    setIdea("");
    persist({
      idea: "",
      source: "home",
      radarItemId: null,
      radarPlatform: "",
      step: "write",
    });
    if (params.get("from") === "radar") setParams({}, { replace: true });
    setWorks(listHomeWorks());
  };

  const workKeySafe = (d: HomeDraft) => d.projectId || d.script?.title || d.idea || String(d.updatedAt);

  const lineLabel = (id: string) => {
    for (const sc of script?.scenes ?? []) {
      const line = sc.lines.find((l) => l.id === id);
      if (line) return `${line.speaker}：${line.text}`;
    }
    return id;
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide">想做什么视频？</h1>
          <p className="mt-2 text-sm text-fg-faint">
            先选风格再出剧本。剧情上会标时间，你之后能改；时长写在想法里也行。
          </p>
          <ol className="mt-4 flex flex-wrap justify-center gap-1.5 text-[11px]">
            {(
              [
                ["write", "1 想法"],
                ["script", "2 剧本"],
                ["style", "3 风格"],
                ["keys", "4 定妆"],
                ["shoot", "5 出片"],
              ] as const
            ).map(([id, label]) => {
              const order = ["write", "script", "style", "keys", "shoot"] as const;
              const here = { write: 0, script: 1, style: 2, keys: 3, shot: 4 }[step];
              const idx = order.indexOf(id);
              const on = idx === here;
              const done = idx < here;
              return (
                <li
                  key={id}
                  className={`rounded-full px-2.5 py-1 ${
                    on ? "bg-accent text-black" : done ? "bg-accent/15 text-accent" : "bg-panel-2 text-fg-faint"
                  }`}
                >
                  {label}
                </li>
              );
            })}
          </ol>
        </div>

        {step === "write" && works.length > 0 && (
          <div className="mb-5 rounded-2xl border border-line bg-panel p-3">
            <div className="mb-2 text-[11px] text-fg-faint">没做完的还能接着做</div>
            <div className="flex flex-wrap gap-1.5">
              {works.map((w) => {
                const title = w.script?.title || w.idea || "未命名";
                return (
                  <span key={workKeySafe(w)} className="flex items-center gap-1 rounded-full border border-line bg-panel-2 pl-2.5 pr-1 py-1">
                    <button className="text-[11px] text-fg" onClick={() => applyDraft(w)}>
                      {title.slice(0, 16)}
                      <span className="ml-1 text-fg-faint">{workStatusLabels[w.step]}</span>
                    </button>
                    <button
                      className="rounded-full px-1 text-[10px] text-fg-faint hover:text-red-400"
                      title="从待办去掉"
                      onClick={() => {
                        removeHomeWork(w);
                        setWorks(listHomeWorks());
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-line bg-panel shadow-xl">
          {step === "write" && (
            <div className="space-y-3 p-4">
              {source === "radar" && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-fg-faint">
                  <span>来自{radarPlatform || "雷达"}热点</span>
                  <button type="button" className="text-fg-dim underline-offset-2 hover:text-fg hover:underline" onClick={dropRadar}>
                    不用这条
                  </button>
                </div>
              )}
              <textarea
                autoFocus
                rows={4}
                className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-fg-faint"
                placeholder="例如：武松打虎。想卡多长、几场，写在这句话里就行"
                value={idea}
                onChange={(e) => {
                  const next = e.target.value;
                  setIdea(next);
                  if (source === "radar" && !next.trim()) dropRadar();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void makeScript();
                }}
              />
              <div>
                <p className="mb-1.5 text-xs text-fg-faint">先选风格，后面出的文案和画面都按它来</p>
                <div className="flex flex-wrap gap-1.5">
                  {readyPacks.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs ${
                        packId === p.id ? "border-accent bg-accent/15 text-accent" : "border-line text-fg-dim hover:text-fg"
                      }`}
                      onClick={() => {
                        setPackId(p.id);
                        setPackLabel(p.name);
                        persist({ packId: p.id, packLabel: p.name, step: "write" });
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs ${
                      packLabel === "其他风格，AI自由发挥" ? "border-accent bg-accent/15 text-accent" : "border-line text-fg-dim hover:text-fg"
                    }`}
                    onClick={() => {
                      setPackId(null);
                      setPackLabel("其他风格，AI自由发挥");
                      persist({ packId: null, packLabel: "其他风格，AI自由发挥", step: "write" });
                    }}
                  >
                    其他
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "script" && script && (
            <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
              <div>
                <div className="text-sm font-medium">{script.title}</div>
                <p className="mt-1 text-xs text-fg-dim">
                  {script.durationSec ? `剧情约 ${script.durationSec} 秒` : ""}
                  {packLabel ? `${script.durationSec ? " · " : ""}${packLabel}` : ""}
                  {script.logline ? ` · ${script.logline}` : ""}
                </p>
              </div>
              {script.scenes.map((sc) => (
                <section key={sc.id} className="rounded-xl border border-line bg-panel-2 p-3">
                  <div className="text-[11px] text-fg-faint">
                    {formatClock(sc.startSec)}–{formatClock(sc.endSec)} · {sceneSec(sc)}秒 · {sc.heading}
                  </div>
                  {sc.action ? <p className="mt-1 text-xs text-fg-dim">{sc.action}</p> : null}
                  <ul className="mt-2 space-y-1">
                    {sc.lines.map((line) => (
                      <ScriptLineRow
                        key={line.id}
                        line={line}
                        active={pickedLine === line.id}
                        marked={notes.some((n) => n.targetId === line.id)}
                        onPick={() => setPickedLine(line.id === pickedLine ? null : line.id)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
              {notes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {notes.map((n) => (
                    <button
                      key={n.id}
                      className="rounded-full border border-amber-900/50 bg-amber-950/30 px-2.5 py-1 text-[11px] text-amber-200"
                      onClick={() => {
                        const next = notes.filter((x) => x.id !== n.id);
                        setNotes(next);
                        persist({ notes: next });
                      }}
                      title="点掉这条批注"
                    >
                      {lineLabel(n.targetId).slice(0, 16)} · {n.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "style" && (
            <div className="space-y-3 p-4">
              <p className="text-sm text-fg">剧本过了。用哪套画面？</p>
              <ol className="space-y-2">
                {readyPacks.map((p, i) => (
                  <li key={p.id}>
                    <button
                      className="flex w-full items-start gap-3 rounded-xl border border-line px-3 py-2 text-left hover:border-accent-dim"
                      disabled={busy}
                      onClick={() => void pickStyle(p.id, p.name)}
                    >
                      <span className="text-sm text-fg-faint">{i + 1}.</span>
                      <span>
                        <span className="text-sm">{p.name}</span>
                        <span className="mt-0.5 block text-[11px] text-fg-faint">{p.summary}</span>
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    className="flex w-full items-start gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-left hover:border-accent-dim"
                    disabled={busy}
                    onClick={() => void pickStyle(null, "其他风格，AI自由发挥")}
                  >
                    <span className="text-sm text-fg-faint">{readyPacks.length + 1}.</span>
                    <span>
                      <span className="text-sm">其他风格，AI自由发挥</span>
                      <span className="mt-0.5 block text-[11px] text-fg-faint">不套现成包，让模型自己选一种适合这个故事的画法</span>
                    </span>
                  </button>
                </li>
              </ol>
            </div>
          )}

          {step === "keys" && (
            <div className="max-h-[28rem] space-y-3 overflow-y-auto p-4">
              <p className="text-sm text-fg">
                {packLabel || "定妆"}。
                {packId === "whiteboard" || /白板|手绘|线稿/.test(packLabel)
                  ? "手绘白板出的是线稿示意图，不是写实定妆。出片按风格文生视频，不会拿这张图去图生。"
                  : "这些是人物和场景锁，用来出片，不是要你留下一堆图。脸对了就点下面出片。"}
                出完会装字幕。配音到时间线里选音色、试听再铺。
              </p>
              {!pick("tts") ? (
                <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                  还没有语音模型。可以先出片加字幕，配音到「模型」页加一家再在时间线里选音色。
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {keys.map((k) => (
                  <KeyCard
                    key={k.id}
                    item={k}
                    bust={keyRev[k.id]}
                    busy={busy}
                    onEdit={() => goEditAsset(k)}
                    onRedo={(msg) => void redoKey(k, msg)}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
            {modelCaps.map((cap) => (
              <ModelPick key={cap} cap={cap} list={byCap[cap]} value={pick(cap)} onChange={(id) => setPick(cap, id)} />
            ))}
          </div>

          {step === "write" && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              <label className="flex items-center gap-2 text-xs text-fg-dim">
                <input
                  type="checkbox"
                  className="accent-amber-400"
                  checked={asSeries}
                  onChange={(e) => {
                    setAsSeries(e.target.checked);
                    persist({ asSeries: e.target.checked });
                  }}
                />
                做成连载（进连载菜单，按第01集、第02集收）
              </label>
              <button
                className="ml-auto flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
                disabled={!idea.trim() || !packLabel || busy}
                onClick={() => void makeScript()}
              >
                {iconPlay({ width: 14, height: 14 })}
                {busy ? "正在写剧本…" : packLabel ? "按风格出剧本" : "先选风格再出剧本"}
              </button>
            </div>
          )}

          {step === "script" && (
            <div className="space-y-2 border-t border-line px-4 py-3">
              <textarea
                rows={2}
                className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm outline-none placeholder:text-fg-faint"
                placeholder={
                  pickedLine
                    ? `改「${lineLabel(pickedLine).slice(0, 18)}」，或整段压成 10 秒`
                    : "比如：压成 10 秒、少两场、旁白再狠一点。点台词也能一起改。"
                }
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void rewriteScript();
                  }
                }}
              />
              {pickedLine && (
                <div className="flex items-center gap-2 text-[11px] text-fg-faint">
                  <span>已点「{lineLabel(pickedLine).slice(0, 24)}」</span>
                  <button className="underline hover:text-fg" onClick={addNote} disabled={!noteDraft.trim()}>
                    先记下再改
                  </button>
                  <button className="underline hover:text-fg" onClick={() => setPickedLine(null)}>
                    取消
                  </button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim disabled:opacity-40"
                  disabled={busy || (!noteDraft.trim() && notes.length === 0)}
                  onClick={() => void rewriteScript()}
                >
                  {busy ? "按你的话在改…" : "按这句话改"}
                </button>
                <button
                  className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                  disabled={busy}
                  onClick={confirmScript}
                >
                  确认剧本
                </button>
                <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-faint" onClick={reset}>
                  重来
                </button>
              </div>
            </div>
          )}

          {step === "style" && (
            <div className="flex gap-2 border-t border-line px-4 py-3">
              <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim" onClick={() => setStep("script")}>
                回剧本
              </button>
              <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-faint" onClick={reset}>
                重来
              </button>
              {busy ? <span className="ml-auto text-xs text-fg-faint">在出人物和场景…</span> : null}
            </div>
          )}

          {step === "keys" && (
            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
              <label className="flex items-center gap-2 text-xs text-fg-dim">
                <input
                  type="checkbox"
                  className="accent-amber-400"
                  checked={asSeries}
                  onChange={(e) => {
                    setAsSeries(e.target.checked);
                    persist({ asSeries: e.target.checked, step: "keys" });
                  }}
                />
                做成连载
              </label>
              <label className="mr-auto flex items-center gap-2 text-xs text-fg-dim">
                <input
                  type="checkbox"
                  className="accent-amber-400"
                  checked={autoSubtitles}
                  onChange={(e) => patchPrefs({ autoSubtitles: e.target.checked })}
                />
                配字幕
              </label>
              <button
                className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                disabled={busy || keys.length === 0}
                onClick={() => void startCanvas()}
              >
                {iconPlay({ width: 14, height: 14 })}
                {busy ? "在搭出片画布…" : "确认定妆，开始出片"}
              </button>
              <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim" onClick={() => setStep("style")}>
                换风格
              </button>
              <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-faint" onClick={reset}>
                重来
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-xs text-amber-300">
            {error}{" "}
            <button className="underline hover:text-amber-200" onClick={() => navigate("/models")}>
              去配置 →
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-[11px] text-fg-faint">
          <button className="underline hover:text-fg" onClick={() => navigate("/drama")}>
            小说转短剧
          </button>
          {" · "}
          <button className="underline hover:text-fg" onClick={() => navigate("/radar")}>
            看看今天热点
          </button>
          {" · "}
          <button className="underline hover:text-fg" onClick={() => navigate("/styles")}>
            风格中心
          </button>
        </p>
      </div>
    </div>
  );
}

function ScriptLineRow(props: {
  line: ScriptLine;
  active: boolean;
  marked: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${
          props.active ? "bg-accent/15 text-fg" : props.marked ? "bg-amber-950/40 text-amber-100" : "hover:bg-panel text-fg"
        }`}
        onClick={props.onPick}
      >
        <span className="mr-2 text-[11px] text-fg-faint">{props.line.speaker}</span>
        {props.line.text}
      </button>
    </li>
  );
}

function KeyCard(props: {
  item: KeyAssetNeed;
  bust?: number;
  busy: boolean;
  onEdit: () => void;
  onRedo: (instruction: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const k = props.item;
  return (
    <article className="rounded-xl border border-line bg-panel-2 p-2">
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-black/30">
        {k.assetId ? (
          <img
            src={`/api/assets/${k.assetId}/file?variant=original&v=${props.bust ?? 0}`}
            alt={k.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-[11px] text-fg-faint">还没有图</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <div>
          <div className="text-xs font-medium">{k.name}</div>
          <div className="text-[10px] text-fg-faint">{k.kind === "character" ? "人物" : "场景"}</div>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <button className="rounded-md border border-line px-2 py-0.5 text-[10px] text-fg-dim" disabled={!k.assetId} onClick={props.onEdit}>
          去资产库改
        </button>
        <button className="rounded-md border border-line px-2 py-0.5 text-[10px] text-fg-dim" disabled={props.busy} onClick={() => setOpen((v) => !v)}>
          换一张
        </button>
      </div>
      {open && (
        <div className="mt-1.5 flex gap-1">
          <input
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] outline-none"
            placeholder="例如：脸再凶一点"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
          <button
            className="rounded-md bg-accent px-2 py-1 text-[10px] font-medium text-black disabled:opacity-40"
            disabled={props.busy}
            onClick={() => props.onRedo(msg)}
          >
            出
          </button>
        </div>
      )}
    </article>
  );
}

function ModelPick(props: {
  cap: Capability;
  list: ModelEndpoint[];
  value: string;
  onChange: (id: string) => void;
}) {
  const navigate = useNavigate();
  if (props.list.length === 0) {
    return (
      <button
        className="flex items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1 text-[11px] text-fg-faint hover:border-accent-dim hover:text-accent"
        onClick={() => navigate("/models")}
      >
        {capabilityLabels[props.cap]}：未配置 →
      </button>
    );
  }
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1 text-[11px] text-fg-dim">
      {capabilityLabels[props.cap]}
      <select className="max-w-32 bg-transparent text-fg outline-none" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.list.map((ep) => (
          <option key={ep.id} value={ep.id}>
            {ep.name}
          </option>
        ))}
      </select>
    </label>
  );
}
