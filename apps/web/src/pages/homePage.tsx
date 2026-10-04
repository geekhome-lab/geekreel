import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Capability, ModelEndpoint } from "@vw/models";
import { capabilityLabels } from "@vw/models";
import type { Project } from "@vw/core";
import type { Job, StylePackPublic } from "@vw/core";
import { api, apiJson } from "../lib/api";
import { useAppStore } from "../lib/store";
import { waitForJob } from "../lib/runGen";
import { iconPlay } from "../lib/icons";

/**
 * 对话式首页：小白主入口。
 * 一句话 → 自动建项目（免选目录）→ 自动搭画布 → 自动开跑。
 */

type Intent = "free" | "drama" | "whiteboard" | "remake";

const intents: Array<{ key: Intent; label: string; hint: string; ready: boolean }> = [
  { key: "free", label: "自由创作", hint: "一句话出图", ready: true },
  { key: "drama", label: "小说转短剧", hint: "上美影风拆成 5 集", ready: true },
  { key: "whiteboard", label: "白板动画", hint: "贴字幕就能出片", ready: true },
  { key: "remake", label: "复刻爆款", hint: "贴链接拆结构再换成你的", ready: true },
];

const modelCaps: Capability[] = ["llm", "image", "video", "tts"];

export function HomePage() {
  const navigate = useNavigate();
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setPendingAutoRun = useAppStore((s) => s.setPendingAutoRun);

  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent>("free");
  const [substyle, setSubstyle] = useState("flat");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 模型选择：默认取各能力的默认端点，用户选择持久化到 localStorage
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
  const smy = packs?.find((p) => p.id === "smy-animation");

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

  const start = async () => {
    const input = text.trim();
    if (!input || busy) return;
    setError("");

    // 前置检查：说人话的引导。白板只靠项目自带 ffmpeg，不挡在模型后面。
    if (intent !== "whiteboard" && byCap.image.length === 0) {
      setError("还没有配置图片模型。先到「模型」页添加一个，回来就能出图了。");
      return;
    }
    if (intent === "drama" && byCap.llm.length === 0) {
      setError("「小说转短剧」需要文本模型来拆分镜。到「模型」页添加一个文本模型，或先用「自由创作」。");
      return;
    }

    if (intent === "remake") {
      if (/^https?:\/\//i.test(input)) navigate(`/analyze?url=${encodeURIComponent(input)}`);
      else navigate("/analyze");
      return;
    }

    setBusy(true);
    try {
      if (intent === "drama" || intent === "whiteboard") {
        const job = await apiJson<Job>("/api/pipelines/run", "post", {
          story: input,
          packId: intent === "whiteboard" ? "whiteboard" : "smy-animation",
          substyle: intent === "drama" ? substyle : undefined,
          llmEndpointId: pick("llm") || undefined,
          imageEndpointId: pick("image") || undefined,
        });
        const done = await waitForJob(job.id, 8 * 60_000);
        const result = JSON.parse(done.resultJson ?? "{}") as { projectId?: string };
        if (!result.projectId) throw new Error("没有建出项目");
        setCurrentProject(result.projectId);
        if (intent === "whiteboard") {
          navigate("/timeline");
        } else {
          setPendingAutoRun(true);
          navigate("/canvas");
        }
        return;
      }

      const name = input.replace(/\s+/g, " ").slice(0, 16) || "未命名项目";
      const project = await apiJson<Project>("/api/projects/quick", "post", { name });
      setCurrentProject(project.id);

      const canvasList = await api<Array<{ id: string }>>(`/api/canvas/project/${project.id}`);
      const canvasId = canvasList[0]!.id;
      await apiJson(`/api/canvas/${canvasId}`, "put", {
        doc: {
          version: 1,
          nodes: [
            { id: "text_0", type: "textNode", position: { x: 80, y: 120 }, data: { text: input } },
            {
              id: "gen_0",
              type: "imageGenNode",
              position: { x: 400, y: 100 },
              data: { prompt: "", size: "1024x1024", endpointId: pick("image") || null, status: "idle" },
            },
          ],
          edges: [{ id: "e_0", source: "text_0", sourceHandle: "out", target: "gen_0", targetHandle: "prompt", animated: true }],
          viewport: null,
        },
      });

      setPendingAutoRun(true);
      navigate("/canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* 标题 */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-wide">想做什么视频？</h1>
          <p className="mt-2 text-sm text-fg-faint">一句话开始。项目、画布、生成，都帮你自动搭好。</p>
        </div>

        {/* 输入框 */}
        <div className="rounded-2xl border border-line bg-panel shadow-xl">
          <textarea
            autoFocus
            rows={4}
            className="w-full resize-none rounded-t-2xl bg-transparent p-4 text-sm leading-relaxed outline-none placeholder:text-fg-faint"
            placeholder={
              intent === "whiteboard"
                ? "贴一段 SRT，或按行写口播。不用配模型也能出纸底片子。"
                : intent === "drama"
                  ? "粘贴一段小说或故事，按上美影风拆成 5 集…"
                  : "例如：上美影风格的武松打虎，Q 版人物…"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
            }}
          />

          {/* 模型选择 */}
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
            {modelCaps.map((cap) => (
              <ModelPick
                key={cap}
                cap={cap}
                list={byCap[cap]}
                value={pick(cap)}
                onChange={(id) => setPick(cap, id)}
              />
            ))}
            <span className="ml-auto text-[10px] text-fg-faint">⌘/Ctrl + Enter 开始</span>
          </div>
          {intent === "drama" && smy && smy.substyles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2">
              <span className="text-[10px] text-fg-faint">子风格</span>
              {smy.substyles.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                    substyle === s.id ? "bg-accent text-black" : "border border-line text-fg-dim"
                  }`}
                  onClick={() => setSubstyle(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          {/* 意图 + 发送 */}
          <div className="flex items-center gap-2 border-t border-line px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {intents.map((it) => (
                <button
                  key={it.key}
                  disabled={!it.ready}
                  title={it.ready ? it.hint : `${it.hint}，敬请期待`}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    intent === it.key
                      ? "bg-accent text-black"
                      : it.ready
                        ? "border border-line text-fg-dim hover:border-accent-dim hover:text-fg"
                        : "border border-line/50 text-fg-faint/50 cursor-not-allowed"
                  }`}
                  onClick={() => it.ready && setIntent(it.key)}
                >
                  {it.label}
                  {!it.ready && <span className="ml-1 text-[9px]">· 待上线</span>}
                </button>
              ))}
            </div>
            <button
              className="ml-auto flex items-center gap-1.5 rounded-xl bg-accent px-5 py-2 text-sm font-medium text-black hover:brightness-110 disabled:opacity-40"
              disabled={!text.trim() || busy}
              onClick={start}
            >
              {iconPlay({ width: 14, height: 14 })}
              {busy ? "准备中…" : "开始"}
            </button>
          </div>
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
          <button className="underline hover:text-fg" onClick={() => navigate("/radar")}>看看今天热点</button>
          {" · "}
          <button className="underline hover:text-fg" onClick={() => navigate("/styles")}>换一套风格</button>
          {" · "}出图后到「时间线」拼成片
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
        title={`还没有${capabilityLabels[props.cap]}，点击去配置`}
      >
        {capabilityLabels[props.cap]}：未配置 →
      </button>
    );
  }
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1 text-[11px] text-fg-dim">
      {capabilityLabels[props.cap]}
      <select
        className="max-w-32 bg-transparent text-fg outline-none"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        {props.list.map((ep) => (
          <option key={ep.id} value={ep.id}>{ep.name}</option>
        ))}
      </select>
    </label>
  );
}
