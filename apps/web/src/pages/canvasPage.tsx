import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { extractDialogue, type Asset, type Job, type PipelineRun } from "@vw/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "../lib/store";
import { api, apiJson } from "../lib/api";
import { submitFfmpeg, submitImageGen, submitTimelineFinish, submitTts, submitVideoGen, waitForJob } from "../lib/runGen";
import { usePrefs } from "../lib/prefs";
import { iconPlus } from "../lib/icons";
import { CanvasActionsContext } from "../components/canvas/canvasContext";
import { TextNode, type TextNodeData } from "../components/canvas/textNode";
import { AssetNode, type AssetNodeData } from "../components/canvas/assetNode";
import { ImageGenNode, type ImageGenNodeData } from "../components/canvas/imageGenNode";
import { VideoGenNode, type VideoGenNodeData } from "../components/canvas/videoGenNode";
import { TtsNode, type TtsNodeData } from "../components/canvas/ttsNode";
import { FfmpegNode, type FfmpegNodeData } from "../components/canvas/ffmpegNode";
import { ShotNode, shotPrompt, type ShotNodeData } from "../components/canvas/shotNode";
import { SceneNode, scenePrompt, type SceneNodeData } from "../components/canvas/sceneNode";
import { EpisodeNode, episodePrompt, type EpisodeNodeData } from "../components/canvas/episodeNode";
import { NoteNode, type NoteNodeData } from "../components/canvas/noteNode";
import { GroupNode, type GroupNodeData } from "../components/canvas/groupNode";
import { AssetPickerModal } from "../components/canvas/assetPickerModal";

const GEN_TYPES = new Set(["imageGenNode", "videoGenNode", "ttsNode", "ffmpegNode"]);

const nodeTypes = {
  textNode: TextNode,
  assetNode: AssetNode,
  imageGenNode: ImageGenNode,
  videoGenNode: VideoGenNode,
  ttsNode: TtsNode,
  ffmpegNode: FfmpegNode,
  shotNode: ShotNode,
  sceneNode: SceneNode,
  episodeNode: EpisodeNode,
  noteNode: NoteNode,
  groupNode: GroupNode,
};

interface CanvasMeta {
  id: string;
  projectId: string;
  name: string;
  path: string;
  updatedAt: number;
}

interface CanvasDoc {
  version: number;
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number } | null;
}

let nodeSeq = 0;
function newNodeId() {
  return `n${Date.now().toString(36)}_${nodeSeq++}`;
}

let homeShootRunning: string | null = null;

function CanvasInner(props: { projectId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { screenToFlowPosition, updateNodeData, getNodes, getEdges } = useReactFlow();
  const { data: pipes } = useQuery({
    queryKey: ["pipelines", props.projectId],
    queryFn: () => api<PipelineRun[]>(`/api/pipelines?projectId=${props.projectId}`),
  });
  const waiting = pipes?.find((p) => p.status === "waiting") ?? null;
  const [canvasMeta, setCanvasMeta] = useState<CanvasMeta | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">("saved");
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [homeShoot, setHomeShoot] = useState(
    () =>
      useAppStore.getState().pendingAutoRun ||
      sessionStorage.getItem("vw.autoDub") === props.projectId ||
      sessionStorage.getItem("vw.autoRun") === props.projectId,
  );
  const [homeShootNote, setHomeShootNote] = useState("");
  const liveJobs = useAppStore((s) => s.liveJobs);
  const autoSubtitles = usePrefs((s) => s.autoSubtitles);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportRef = useRef<CanvasDoc["viewport"]>(null);

  // 加载画布
  useEffect(() => {
    setLoaded(false);
    (async () => {
      const list = await api<CanvasMeta[]>(`/api/canvas/project/${props.projectId}`);
      const meta = list[0]!;
      const { doc } = await api<{ meta: CanvasMeta; doc: CanvasDoc }>(`/api/canvas/${meta.id}`);
      setCanvasMeta(meta);
      setNodes(doc.nodes ?? []);
      setEdges(doc.edges ?? []);
      viewportRef.current = doc.viewport;
      setLoaded(true);
    })();
  }, [props.projectId]);

  // 防抖保存（1s）
  const scheduleSave = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      if (!canvasMeta) return;
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaveState("saving");
        try {
          await apiJson(`/api/canvas/${canvasMeta.id}`, "put", {
            doc: { version: 1, nodes: nextNodes, edges: nextEdges, viewport: viewportRef.current },
          });
          setSaveState("saved");
        } catch {
          setSaveState("dirty");
        }
      }, 1000);
    },
    [canvasMeta],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => {
        const next = applyNodeChanges(changes, ns);
        scheduleSave(next, getEdges());
        return next;
      });
    },
    [scheduleSave, getEdges],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((es) => {
        const next = applyEdgeChanges(changes, es);
        scheduleSave(getNodes(), next);
        return next;
      });
    },
    [scheduleSave, getNodes],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setEdges((es) => {
        const next = addEdge({ ...conn, animated: true }, es);
        scheduleSave(getNodes(), next);
        return next;
      });
    },
    [scheduleSave, getNodes],
  );

  // ---------------------------------------------------------------------------
  // 节点工厂
  // ---------------------------------------------------------------------------

  const addNode = useCallback(
    (
      type:
        | "textNode"
        | "assetNode"
        | "imageGenNode"
        | "videoGenNode"
        | "ttsNode"
        | "ffmpegNode"
        | "shotNode"
        | "sceneNode"
        | "episodeNode"
        | "noteNode"
        | "groupNode",
    ) => {
      const position = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 - 100 });
      const id = newNodeId();
      const dataByType = {
        textNode: { text: "" } satisfies TextNodeData,
        assetNode: { assetId: null } satisfies AssetNodeData,
        imageGenNode: {
          prompt: "",
          size: "1024x1024",
          endpointId: null,
          status: "idle",
        } satisfies ImageGenNodeData,
        videoGenNode: { prompt: "", durationSec: 5, endpointId: null, status: "idle" } satisfies VideoGenNodeData,
        ttsNode: { text: "", endpointId: null, status: "idle" } satisfies TtsNodeData,
        ffmpegNode: { op: "extract", atMs: 1000, text: "", status: "idle" } satisfies FfmpegNodeData,
        shotNode: { visual: "", line: "" } satisfies ShotNodeData,
        sceneNode: { place: "", time: "", mood: "" } satisfies SceneNodeData,
        episodeNode: { title: "", synopsis: "" } satisfies EpisodeNodeData,
        noteNode: { text: "" } satisfies NoteNodeData,
        groupNode: { label: "分组" } satisfies GroupNodeData,
      };
      setNodes((ns) => {
        const next = [
          ...ns,
          {
            id,
            type,
            position,
            data: dataByType[type],
            ...(type === "groupNode" ? { style: { width: 360, height: 220 }, zIndex: -1 } : {}),
          },
        ];
        scheduleSave(next, getEdges());
        return next;
      });
      if (type === "assetNode") setPickingFor(id);
    },
    [screenToFlowPosition, scheduleSave, getEdges],
  );

  // ---------------------------------------------------------------------------
  // 链式运行：收集上游生成节点 → 拓扑序逐个运行
  // ---------------------------------------------------------------------------

  const runNode = useCallback(
    async (nodeId: string) => {
      const allNodes = getNodes();
      const allEdges = getEdges();

      // 上游生成节点（递归）
      const upstreamGen: string[] = [];
      const walk = (id: string) => {
        for (const e of allEdges.filter((e) => e.target === id)) {
          const src = allNodes.find((n) => n.id === e.source);
          if (src && GEN_TYPES.has(src.type ?? "") && !upstreamGen.includes(src.id)) {
            walk(src.id);
            upstreamGen.push(src.id);
          }
        }
      };
      walk(nodeId);

      const queue = [...upstreamGen, nodeId].filter((id) => {
        const n = allNodes.find((n) => n.id === id);
        return n && GEN_TYPES.has(n.type ?? "");
      });

      setRunningIds((s) => new Set([...s, ...queue]));
      try {
        for (const id of queue) {
          const node = getNodes().find((n) => n.id === id);
          if (!node) continue;

          // prompt：连入的文本节点内容优先，否则用节点自身 prompt
          const currentEdges = getEdges();
          const textInputs = currentEdges
            .filter((e) => e.target === id && (e.targetHandle === "prompt" || !e.targetHandle))
            .map((e) => getNodes().find((n) => n.id === e.source))
            .map((n) => {
              if (n?.type === "textNode") return (n.data as TextNodeData).text.trim();
              if (n?.type === "shotNode") return shotPrompt(n.data as ShotNodeData);
              if (n?.type === "sceneNode") return scenePrompt(n.data as SceneNodeData);
              if (n?.type === "episodeNode") return episodePrompt(n.data as EpisodeNodeData);
              return "";
            })
            .filter(Boolean);
          const ownPrompt =
            node.type === "ttsNode"
              ? ((node.data as TtsNodeData).text ?? "").trim()
              : node.type === "videoGenNode"
                ? ((node.data as VideoGenNodeData).prompt ?? "").trim()
                : ((node.data as ImageGenNodeData).prompt ?? "").trim();
          const prompt = textInputs.length > 0 ? textInputs.join("\n\n") : ownPrompt;

          if (node.type !== "ffmpegNode" && !prompt) {
            updateNodeData(id, { status: "failed", error: "缺少提示词：请填写或连入文本节点" });
            throw new Error(`节点 ${id} 缺少提示词`);
          }

          updateNodeData(id, { status: "running", error: undefined });
          try {
            const assetFrom = (handle?: string) =>
              currentEdges
                .filter((e) => e.target === id && (!handle || e.targetHandle === handle || (!e.targetHandle && handle === "in")))
                .map((e) => getNodes().find((n) => n.id === e.source))
                .map((n) => {
                  if (!n) return "";
                  if (n.type === "assetNode") return (n.data as AssetNodeData).assetId ?? "";
                  const gen = n.data as { assetId?: string };
                  return gen.assetId ?? "";
                })
                .find(Boolean);

            const incomingAsset = assetFrom("in") || assetFrom();
            const incomingImage = assetFrom("image") || incomingAsset;
            const incomingB = assetFrom("in2");

            let job;
            if (node.type === "videoGenNode") {
              const data = node.data as VideoGenNodeData;
              job = await submitVideoGen({
                prompt,
                durationSec: data.durationSec,
                endpointId: data.endpointId,
                projectId: props.projectId,
                imageAssetId: incomingImage || undefined,
                dialogue: data.line?.trim() || extractDialogue(prompt) || undefined,
              });
            } else if (node.type === "ttsNode") {
              const data = node.data as TtsNodeData;
              job = await submitTts({
                text: prompt || data.text,
                endpointId: data.endpointId,
                projectId: props.projectId,
              });
            } else if (node.type === "ffmpegNode") {
              const data = node.data as FfmpegNodeData;
              if (!incomingAsset) throw new Error("左边先连一段素材");
              job = await submitFfmpeg({
                op: data.op,
                assetId: incomingAsset,
                assetIdB: incomingB || undefined,
                text: data.text,
                atMs: data.atMs,
                projectId: props.projectId,
              });
            } else {
              const data = node.data as ImageGenNodeData;
              job = await submitImageGen({
                prompt,
                size: data.size,
                endpointId: data.endpointId,
                projectId: props.projectId,
              });
            }
            const done = await waitForJob(job.id, node.type === "videoGenNode" ? 12 * 60_000 : 10 * 60_000);
            const result = JSON.parse(done.resultJson ?? "{}") as { assetId?: string };
            updateNodeData(id, { status: "done", assetId: result.assetId });
          } catch (e) {
            updateNodeData(id, {
              status: "failed",
              error: e instanceof Error ? e.message : String(e),
            });
            throw e;
          }
        }
      } finally {
        setRunningIds((s) => {
          const next = new Set(s);
          for (const id of queue) next.delete(id);
          return next;
        });
        // 运行结束后触发一次保存（节点 data 里有新 assetId/status）
        setNodes((ns) => {
          scheduleSave(ns, getEdges());
          return ns;
        });
      }
    },
    [getNodes, getEdges, updateNodeData, props.projectId, scheduleSave],
  );

  const pickAsset = useCallback((nodeId: string) => setPickingFor(nodeId), []);

  const actions = useMemo(
    () => ({ runNode, pickAsset, runningIds }),
    [runNode, pickAsset, runningIds],
  );

  // 首页出片：出完视频后服务端会排队配音。这里只负责把视频跑完，并盯配音进度。
  useEffect(() => {
    if (!loaded) return;
    const pid = props.projectId;
    const should =
      useAppStore.getState().pendingAutoRun ||
      sessionStorage.getItem("vw.autoRun") === pid ||
      sessionStorage.getItem("vw.autoDub") === pid;
    if (!should) return;
    if (homeShootRunning === pid) return;
    homeShootRunning = pid;
    useAppStore.getState().setPendingAutoRun(false);
    sessionStorage.removeItem("vw.autoRun");
    setHomeShoot(true);
    const videoIds = nodes.filter((n) => n.type === "videoGenNode").map((n) => n.id);
    void (async () => {
      let made = 0;
      for (const id of videoIds) {
        try {
          await runNode(id);
          if ((getNodes().find((n) => n.id === id)?.data as { assetId?: string } | undefined)?.assetId) made += 1;
        } catch {
          /* 单镜失败不阻塞 */
        }
      }
      const latest = getNodes();
      const edgesNow = getEdges();
      if (canvasMeta) {
        try {
          await apiJson(`/api/canvas/${canvasMeta.id}`, "put", {
            doc: { version: 1, nodes: latest, edges: edgesNow, viewport: viewportRef.current },
          });
        } catch {
          /* 防抖保存兜底 */
        }
      }
      if (made === 0) {
        setHomeShootNote("视频还没出成，先在节点上重跑。出完会装字幕，配音到时间线选。");
        homeShootRunning = null;
        return;
      }
      setHomeShootNote("视频齐了，在装字幕…");
      try {
        const job = await submitTimelineFinish(pid, { withSubtitles: usePrefs.getState().autoSubtitles, dub: false });
        await waitForJob(job.id, 15 * 60_000);
      } catch (e) {
        homeShootRunning = null;
        setHomeShootNote(e instanceof Error ? e.message : "字幕没装上，可到时间线再试");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, props.projectId]);

  useEffect(() => {
    const finish = Object.values(liveJobs).find(
      (j) => j.projectId === props.projectId && j.type === "timeline.finish",
    );
    if (!finish) return;
    if (finish.status === "running" || finish.status === "queued") {
      setHomeShoot(true);
      setHomeShootNote(finish.message || "正在装画面和字幕…");
    }
    if (finish.status === "done") {
      sessionStorage.removeItem("vw.autoDub");
      homeShootRunning = null;
      setHomeShootNote("画面和字幕齐了，去时间线选音色");
      navigate("/timeline");
    }
    if (finish.status === "failed") {
      homeShootRunning = null;
      setHomeShoot(true);
      setHomeShootNote(finish.error || "没装上，可到时间线再试");
    }
  }, [liveJobs, navigate, props.projectId]);

  if (!loaded) {
    return <div className="flex h-full items-center justify-center text-sm text-fg-faint">画布加载中…</div>;
  }

  return (
    <CanvasActionsContext.Provider value={actions}>
      <div className="relative h-full">
        {homeShoot && !waiting && (
          <div className="absolute top-14 left-3 z-10 max-w-md rounded-xl border border-accent-dim bg-panel/95 p-3 text-xs shadow-xl">
            <div className="mb-1 font-medium text-accent">正在出片</div>
            <p className="text-fg-dim">先出视频。全部出完会装字幕，配音到时间线里选音色。</p>
            {homeShootNote ? <p className="mt-1 text-amber-300">{homeShootNote}</p> : null}
            <button className="mt-2 text-[11px] text-fg-faint underline" onClick={() => setHomeShoot(false)}>
              知道了
            </button>
          </div>
        )}
        {waiting && (
          <div className="absolute top-14 left-3 z-10 max-w-lg rounded-xl border border-accent-dim bg-panel/95 p-3 text-xs shadow-xl">
            {waiting.currentStep === "cast" ? (
              <>
                <div className="mb-1 font-medium text-accent">人物和事件已列好</div>
                <p className="mb-2 text-fg-dim">
                  {waiting.bible?.title ?? "短剧"} · {waiting.bible?.cast?.length ?? 0} 人 · {waiting.bible?.events?.length ?? 0} 条事件
                </p>
                <button
                  className="rounded-lg bg-accent px-3 py-1 text-black"
                  onClick={() => navigate(`/drama?pipeline=${waiting.id}`)}
                >
                  去看档案
                </button>
              </>
            ) : (
              <>
                <div className="mb-1 font-medium text-accent">剧本已拆好，先看一眼再搭画布</div>
                <p className="mb-2 text-fg-dim">
                  {waiting.bible?.title ?? "短剧"} · {waiting.bible?.episodes.length ?? 0} 集
                </p>
                <ul className="mb-2 max-h-24 overflow-auto text-fg-faint">
                  {waiting.bible?.episodes.map((ep) => (
                    <li key={ep.index}>第 {ep.index} 集 {ep.title}</li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button
                    className="rounded-lg bg-accent px-3 py-1 text-black"
                    onClick={async () => {
                      await apiJson(`/api/pipelines/${waiting.id}/advance`, "post");
                      qc.invalidateQueries({ queryKey: ["pipelines", props.projectId] });
                      window.location.reload();
                    }}
                  >
                    确认，搭画布
                  </button>
                  <button
                    className="rounded-lg border border-line px-3 py-1 text-fg-dim"
                    onClick={async () => {
                      await apiJson(`/api/pipelines/${waiting.id}/retry-step`, "post");
                      qc.invalidateQueries({ queryKey: ["pipelines", props.projectId] });
                    }}
                  >
                    重拆
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {/* 工具栏 */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-xl border border-line bg-panel/90 p-1.5 backdrop-blur">
          <ToolbarButton label="文本" onClick={() => addNode("textNode")} />
          <ToolbarButton label="分集" onClick={() => addNode("episodeNode")} />
          <ToolbarButton label="场景卡" onClick={() => addNode("sceneNode")} />
          <ToolbarButton label="分镜卡" onClick={() => addNode("shotNode")} />
          <ToolbarButton label="分组" onClick={() => addNode("groupNode")} />
          <ToolbarButton label="注释" onClick={() => addNode("noteNode")} />
          <ToolbarButton label="资产" onClick={() => addNode("assetNode")} />
          <ToolbarButton label="文生图" onClick={() => addNode("imageGenNode")} />
          <ToolbarButton label="文生视频" onClick={() => addNode("videoGenNode")} />
          <ToolbarButton label="配音" onClick={() => addNode("ttsNode")} />
          <ToolbarButton label="ffmpeg" onClick={() => addNode("ffmpegNode")} />
          <div className="mx-1 h-4 w-px bg-line" />
          <span className="px-1 text-[10px] text-fg-faint">
            {saveState === "saved" ? "已保存" : saveState === "saving" ? "保存中…" : "待保存"}
          </span>
          <button
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-fg-dim hover:text-fg"
            onClick={async () => {
              try {
                const job = await apiJson<Job>("/api/pipelines/render-episode", "post", {
                  projectId: props.projectId,
                  withSubtitles: autoSubtitles,
                });
                await waitForJob(job.id, 20 * 60_000);
                navigate("/timeline");
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            出这一集
          </button>
          <button
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110"
            onClick={async () => {
              try {
                const latest = getNodes();
                const edgesNow = getEdges();
                if (canvasMeta) {
                  await apiJson(`/api/canvas/${canvasMeta.id}`, "put", {
                    doc: { version: 1, nodes: latest, edges: edgesNow, viewport: viewportRef.current },
                  });
                }
                const job = await submitTimelineFinish(props.projectId, { withSubtitles: autoSubtitles, dub: false });
                await waitForJob(job.id, 15 * 60_000);
                navigate("/timeline");
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            送到时间线
          </button>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onMoveEnd={(_, vp) => {
            viewportRef.current = vp;
            scheduleSave(getNodes(), getEdges());
          }}
          defaultViewport={viewportRef.current ?? undefined}
          colorMode="dark"
          fitView={!viewportRef.current}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background gap={20} size={1} color="#262a35" />
          <Controls position="bottom-right" />
        </ReactFlow>

        {/* 空画布提示 */}
        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center text-fg-faint">
              <p className="mb-1 text-sm">空白画布</p>
              <p className="text-xs">从左上角添加「文本」和「文生图」节点，连线后即可运行</p>
            </div>
          </div>
        )}
      </div>

      {pickingFor && (
        <AssetPickerModal
          onClose={() => setPickingFor(null)}
          onSelect={(asset: Asset) => {
            updateNodeData(pickingFor, { assetId: asset.id });
            setPickingFor(null);
            setNodes((ns) => {
              scheduleSave(ns, getEdges());
              return ns;
            });
          }}
        />
      )}

    </CanvasActionsContext.Provider>
  );
}

function ToolbarButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-fg-dim hover:bg-panel-2 hover:text-fg"
      onClick={props.onClick}
    >
      {iconPlus({ width: 12, height: 12 })}
      {props.label}
    </button>
  );
}

export function CanvasPage() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const navigate = useNavigate();

  if (!currentProjectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-faint">
        <p className="text-sm">请先在「项目」页选择或创建一个项目</p>
        <button
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:brightness-110"
          onClick={() => navigate("/projects")}
        >
          去项目页
        </button>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <CanvasInner projectId={currentProjectId} />
    </ReactFlowProvider>
  );
}
