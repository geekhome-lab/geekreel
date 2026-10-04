import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Capability, ModelEndpoint } from "@vw/models";
import { capabilityLabels } from "@vw/models";
import type { DramaBible, FreePlan, Project, Series, StylePackPublic } from "@vw/core";
import type { Job } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlay } from "../lib/icons";

type Intent = "free" | "whiteboard" | "remake";
type SeriesMode = "new" | "continue" | "none";

const intents: Array<{ key: Intent; label: string; hint: string }> = [
  { key: "free", label: "自由创作", hint: "一句话出图，一步步确认" },
  { key: "whiteboard", label: "白板动画", hint: "贴字幕就能出片" },
  { key: "remake", label: "复刻爆款", hint: "贴链接拆结构再换成你的" },
];

const modelCaps: Capability[] = ["llm", "image", "video", "tts"];

type ChatLine = { role: "bot" | "user"; text: string };

export function HomePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);
  const prefSeries = params.get("series") ?? "";
  const prefKind = params.get("kind");

  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent>(prefKind === "whiteboard" ? "whiteboard" : prefKind === "remake" ? "remake" : "free");
  const [step, setStep] = useState<"write" | "guide">("write");
  const [guide, setGuide] = useState<"idea" | "series" | "name" | "pick" | "style" | "go" | "plan" | "revise">("idea");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [seriesMode, setSeriesMode] = useState<SeriesMode>(prefSeries ? "continue" : "new");
  const [seriesName, setSeriesName] = useState("");
  const [seriesId, setSeriesId] = useState(prefSeries);
  const [packId, setPackId] = useState("");
  const [plan, setPlan] = useState<FreePlan | null>(null);
  const [reviseText, setReviseText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
  const { data: seriesList } = useQuery({
    queryKey: ["series"],
    queryFn: () => api<Series[]>("/api/series"),
  });
  const { data: seriesDetail } = useQuery({
    queryKey: ["series", seriesId],
    queryFn: () => api<Series & { bible: DramaBible | null }>(`/api/series/${seriesId}`),
    enabled: !!seriesId,
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

  const chosenSeries = seriesList?.find((s) => s.id === seriesId) ?? null;
  const readyPacks = (packs ?? []).filter((p) => p.ready);

  const push = (role: ChatLine["role"], msg: string) => setLines((xs) => [...xs, { role, text: msg }]);

  const beginGuide = () => {
    const input = text.trim();
    if (!input || busy) return;
    setError("");
    setStep("guide");
    setGuide("idea");
    setLines([
      { role: "user", text: input },
      {
        role: "bot",
        text:
          intent === "whiteboard"
            ? "按「白板动画」来做。下面这段当口播/字幕，对吗？"
            : intent === "remake"
              ? "按「复刻爆款」来做。我拿这段当参考（链接或说明），对吗？"
              : "按「自由创作」来做。我把这句话当成这一集的想法，对吗？",
      },
    ]);
  };

  const confirmIdea = () => {
    push("user", "对，就这段");
    if (prefSeries || (seriesMode === "continue" && seriesId)) {
      const sid = seriesId || prefSeries;
      const s = seriesList?.find((x) => x.id === sid);
      if (s) {
        confirmPick(s.id);
        return;
      }
    }
    setGuide("series");
    push("bot", "这是新开一部连载，接到已经在做的一部，还是这次单独做？连载会锁风格和人物，下次能接着拍。");
  };

  const chooseSeries = (mode: SeriesMode) => {
    setSeriesMode(mode);
    if (mode === "new") {
      push("user", "新开一部连载");
      setGuide("name");
      push("bot", "给这部起个名字。以后做下一集时，选这部就能沿用人物和风格。");
      return;
    }
    if (mode === "continue") {
      push("user", "接到已有连载");
      if (!seriesList?.length) {
        push("bot", "还没有连载。先新开一部，或这次单独做。");
        return;
      }
      setGuide("pick");
      push("bot", "接到哪一部？");
      return;
    }
    push("user", "这次单独做");
    afterSeries();
  };

  const afterSeries = () => {
    if (intent === "free") {
      setGuide("style");
      push("bot", "要套一套风格吗？也可以先不套，只出图。");
      return;
    }
    setGuide("go");
    push("bot", summaryLine());
  };

  const summaryLine = () => {
    const serial =
      seriesMode === "new"
        ? `新连载「${seriesName.trim() || text.trim().slice(0, 12)}」第 1 集`
        : seriesMode === "continue" && chosenSeries
          ? `「${chosenSeries.name}」第 ${(chosenSeries.episodeCount || 0) + 1} 集`
          : "不挂连载";
    if (intent === "whiteboard") return `确认：白板动画 · ${serial}。开始做纸底片子？`;
    if (intent === "remake") return `确认：去拆这条参考 · ${serial}。下一步打开分析页。`;
    const style = packId ? readyPacks.find((p) => p.id === packId)?.name : "不套风格";
    return `确认：自由创作 · ${serial} · ${style}。按这个开做？`;
  };

  const confirmName = () => {
    const name = seriesName.trim() || text.trim().slice(0, 12) || "未命名连载";
    setSeriesName(name);
    push("user", name);
    afterSeries();
  };

  const confirmPick = (id: string) => {
    const s = seriesList?.find((x) => x.id === id);
    if (!s) return;
    setSeriesId(id);
    if (s.stylePackId) setPackId(s.stylePackId);
    push("user", `接到「${s.name}」`);
    afterSeries();
  };

  const finishStyle = (id: string) => {
    setPackId(id);
    const label = id ? `用「${readyPacks.find((p) => p.id === id)?.name}」` : "先不套风格";
    setLines((xs) => [
      ...xs,
      { role: "user", text: label },
      {
        role: "bot",
        text:
          seriesMode === "new"
            ? `确认：自由创作 · 新连载「${seriesName.trim() || text.trim().slice(0, 12)}」第 1 集 · ${id ? readyPacks.find((p) => p.id === id)?.name : "不套风格"}。按这个开做？`
            : seriesMode === "continue" && chosenSeries
              ? `确认：自由创作 · 「${chosenSeries.name}」第 ${(chosenSeries.episodeCount || 0) + 1} 集 · ${id ? readyPacks.find((p) => p.id === id)?.name : "沿用连载风格"}。按这个开做？`
              : `确认：自由创作 · 不挂连载 · ${id ? readyPacks.find((p) => p.id === id)?.name : "不套风格"}。按这个开做？`,
      },
    ]);
    setGuide("go");
  };

  const lockedLine = () => {
    const cast = seriesDetail?.bible?.cast ?? [];
    if (seriesMode !== "continue" || !cast.length) return "";
    return cast.map((c) => `${c.name}${c.appearance ? `（${c.appearance}）` : ""}`).join("、");
  };

  const draftPlan = async () => {
    const input = text.trim();
    if (!input || busy) return;
    if (intent === "remake" && /^https?:\/\//i.test(input)) {
      navigate(`/analyze?url=${encodeURIComponent(input)}&from=home`);
      return;
    }
    if (intent === "whiteboard") {
      await run();
      return;
    }
    setBusy(true);
    setError("");
    push("user", "确认，先看分镜");
    push("bot", "我按这句话列几镜。不对就点那一镜改，或整份重列。");
    try {
      const next = await apiJson<FreePlan>("/api/compose/plan", "post", {
        story: input,
        mode: intent === "remake" ? "remake" : "free",
        lockedLine: lockedLine() || undefined,
        llmEndpointId: pick("llm") || undefined,
      });
      setPlan(next);
      setGuide("plan");
      push("bot", `${next.title}：${next.summary}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyRevise = async () => {
    if (!plan || busy) return;
    const instruction = reviseText.trim();
    if (!instruction) return;
    setBusy(true);
    setError("");
    push("user", instruction);
    try {
      const next = await apiJson<FreePlan>("/api/compose/revise", "post", {
        plan,
        instruction,
        llmEndpointId: pick("llm") || undefined,
      });
      setPlan(next);
      setReviseText("");
      setGuide("plan");
      push("bot", `改好了。${next.title}：${next.summary}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    const input = text.trim();
    if (!input || busy) return;
    if (intent !== "whiteboard" && byCap.image.length === 0) {
      setError("还没有配置图片模型。分镜可以先看，出图要到「模型」页加一个。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (intent === "remake" && /^https?:\/\//i.test(input)) {
        navigate(`/analyze?url=${encodeURIComponent(input)}&from=home`);
        return;
      }

      const serialPayload = {
        seriesId: seriesMode === "continue" ? seriesId || undefined : undefined,
        seriesName: seriesMode === "new" ? seriesName.trim() || input.slice(0, 12) : undefined,
        kind: intent === "whiteboard" ? ("whiteboard" as const) : ("free" as const),
      };

      if (intent === "whiteboard") {
        const job = await apiJson<Job>("/api/pipelines/run", "post", {
          story: input,
          packId: "whiteboard",
          ...serialPayload,
        });
        const done = await waitForJob(job.id, 8 * 60_000);
        const result = JSON.parse(done.resultJson ?? "{}") as { projectId?: string };
        if (!result.projectId) throw new Error("没有建出项目");
        setCurrentProject(result.projectId);
        navigate("/timeline");
        return;
      }

      const name = input.replace(/\s+/g, " ").slice(0, 16) || "未命名项目";
      const project = await apiJson<Project>("/api/projects/quick", "post", {
        name,
        ...serialPayload,
        stylePackId: packId || undefined,
      });
      setCurrentProject(project.id);

      const locked = chosenSeries && seriesMode === "continue"
        ? `这是连载「${chosenSeries.name}」第 ${(chosenSeries.episodeCount || 0) + 1} 集。人物造型、场景和色盘必须和前几集一致。\n\n`
        : seriesMode === "new"
          ? `这是连载「${serialPayload.seriesName}」第 1 集。后面几集会沿用这次的人物和场景。\n\n`
          : "";
      const canvasList = await api<Array<{ id: string }>>(`/api/canvas/project/${project.id}`);
      const canvasId = canvasList[0]!.id;
      const shots = plan?.shots?.length ? plan.shots : [{ id: "S01", visual: input, line: "", imagePrompt: input }];
      const nodes = shots.flatMap((shot, i) => [
        {
          id: `text_${i}`,
          type: "textNode",
          position: { x: 80, y: 80 + i * 220 },
          data: { text: `${i === 0 ? locked : ""}${shot.visual}${shot.line ? `\n${shot.line}` : ""}` },
        },
        {
          id: `gen_${i}`,
          type: "imageGenNode",
          position: { x: 420, y: 60 + i * 220 },
          data: { prompt: shot.imagePrompt, size: "1024x1024", endpointId: pick("image") || null, status: "idle" },
        },
      ]);
      const edges = shots.map((_, i) => ({
        id: `e_${i}`,
        source: `text_${i}`,
        sourceHandle: "out",
        target: `gen_${i}`,
        targetHandle: "prompt",
        animated: true,
      }));
      await apiJson(`/api/canvas/${canvasId}`, "put", {
        doc: { version: 1, nodes, edges, viewport: null },
      });
      setPendingAutoRun(true);
      navigate("/canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("write");
    setGuide("idea");
    setLines([]);
    setSeriesMode("new");
    setSeriesName("");
    setSeriesId("");
    setPackId("");
    setPlan(null);
    setReviseText("");
    setBusy(false);
    setError("");
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide">想做什么视频？</h1>
          <p className="mt-2 text-sm text-fg-faint">
            写一句想法，我一步步问你确认。小说转短剧在左边单独一栏。
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-panel shadow-xl">
          {step === "write" && (
            <textarea
              autoFocus
              rows={4}
              className="w-full resize-none rounded-t-2xl bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-fg-faint"
              placeholder={
                intent === "whiteboard"
                  ? "贴一段 SRT，或按行写口播。"
                  : intent === "remake"
                    ? "贴一条爆款链接，或写你想复刻的点。"
                    : "例如：武松在景阳冈打虎，Q 版人物…"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) beginGuide();
              }}
            />
          )}

          {step === "guide" && (
            <div className="max-h-80 space-y-3 overflow-y-auto p-4">
              {lines.filter((l) => l.text).map((l, i) => (
                <div key={i} className={l.role === "user" ? "text-right" : "text-left"}>
                  <div
                    className={`inline-block max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                      l.role === "user" ? "bg-accent text-black" : "bg-panel-2 text-fg"
                    }`}
                  >
                    {l.text}
                  </div>
                </div>
              ))}
              {plan && (guide === "plan" || guide === "revise") && (
                <ol className="space-y-1.5">
                  {plan.shots.map((s, i) => (
                    <li key={s.id} className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-xs">
                      <div className="text-[10px] text-fg-faint">第 {i + 1} 镜</div>
                      <div className="text-sm text-fg">{s.visual || s.imagePrompt}</div>
                      {s.line && <div className="text-fg-dim">台词：{s.line}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
            {modelCaps.map((cap) => (
              <ModelPick key={cap} cap={cap} list={byCap[cap]} value={pick(cap)} onChange={(id) => setPick(cap, id)} />
            ))}
          </div>

          {step === "write" && (
            <div className="flex items-center gap-2 border-t border-line px-4 py-3">
              <div className="flex flex-wrap gap-1.5">
                {intents.map((it) => (
                  <button
                    key={it.key}
                    title={it.hint}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      intent === it.key ? "bg-accent text-black" : "border border-line text-fg-dim hover:text-fg"
                    }`}
                    onClick={() => setIntent(it.key)}
                  >
                    {it.label}
                  </button>
                ))}
              </div>
              <button
                className="ml-auto flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
                disabled={!text.trim()}
                onClick={beginGuide}
              >
                {iconPlay({ width: 14, height: 14 })}
                下一步
              </button>
            </div>
          )}

          {step === "guide" && (
            <div className="space-y-2 border-t border-line px-4 py-3">
              {guide === "idea" && (
                <div className="flex gap-2">
                  <button className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black" onClick={confirmIdea}>
                    对，就这段
                  </button>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim" onClick={reset}>
                    我改一下
                  </button>
                </div>
              )}
              {guide === "series" && (
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black" onClick={() => chooseSeries("new")}>
                    新开连载
                  </button>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim" onClick={() => chooseSeries("continue")}>
                    接到已有连载
                  </button>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim" onClick={() => chooseSeries("none")}>
                    这次单独做
                  </button>
                </div>
              )}
              {guide === "name" && (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    className="flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none"
                    placeholder="连载名字，例如：景阳冈"
                    value={seriesName}
                    onChange={(e) => setSeriesName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && confirmName()}
                  />
                  <button className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black" onClick={confirmName}>
                    就叫这个
                  </button>
                </div>
              )}
              {guide === "pick" && (
                <div className="flex flex-wrap gap-1.5">
                  {seriesList?.map((s) => (
                    <button
                      key={s.id}
                      className="rounded-full border border-line px-3 py-1 text-xs text-fg-dim hover:border-accent-dim"
                      onClick={() => confirmPick(s.id)}
                    >
                      {s.name} · 已 {s.episodeCount} 集
                    </button>
                  ))}
                </div>
              )}
              {guide === "style" && (
                <div className="flex flex-wrap gap-1.5">
                  <button className="rounded-full border border-line px-3 py-1 text-xs" onClick={() => finishStyle("")}>
                    先不套
                  </button>
                  {readyPacks.map((p) => (
                    <button
                      key={p.id}
                      className="rounded-full border border-line px-3 py-1 text-xs text-fg-dim hover:border-accent-dim"
                      onClick={() => finishStyle(p.id)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              {guide === "go" && (
                <div className="flex gap-2">
                  <button
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void draftPlan()}
                  >
                    {iconPlay({ width: 14, height: 14 })}
                    {busy ? "列分镜…" : intent === "whiteboard" ? "确认，开始" : intent === "remake" && /^https?:\/\//i.test(text.trim()) ? "确认，去拆" : "确认，先看分镜"}
                  </button>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim" onClick={reset}>
                    重来
                  </button>
                </div>
              )}
              {guide === "plan" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-black disabled:opacity-40"
                    disabled={busy}
                    onClick={() => void run()}
                  >
                    {iconPlay({ width: 14, height: 14 })}
                    {busy ? "搭画布…" : "就这样，开做"}
                  </button>
                  <button
                    className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim"
                    disabled={busy}
                    onClick={() => setGuide("revise")}
                  >
                    我改一下
                  </button>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-faint" onClick={reset}>
                    重来
                  </button>
                </div>
              )}
              {guide === "revise" && (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    className="flex-1 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm outline-none"
                    placeholder="例如：第一镜改成夜景，钩子再狠一点"
                    value={reviseText}
                    onChange={(e) => setReviseText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void applyRevise()}
                  />
                  <button
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40"
                    disabled={busy || !reviseText.trim()}
                    onClick={() => void applyRevise()}
                  >
                    {busy ? "在改…" : "按这个重列"}
                  </button>
                  <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim" onClick={() => setGuide("plan")}>
                    取消
                  </button>
                </div>
              )}
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
          <button className="underline hover:text-fg" onClick={() => navigate("/drama")}>小说转短剧</button>
          {" · "}
          <button className="underline hover:text-fg" onClick={() => navigate("/radar")}>看看今天热点</button>
          {" · "}
          <button className="underline hover:text-fg" onClick={() => navigate("/styles")}>风格中心</button>
        </p>
      </div>
    </div>
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
          <option key={ep.id} value={ep.id}>{ep.name}</option>
        ))}
      </select>
    </label>
  );
}
