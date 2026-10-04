import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import type { ModelEndpoint } from "@vw/models";
import { api } from "../../lib/api";
import { iconPlay } from "../../lib/icons";
import { useCanvasActions } from "./canvasContext";

export type VideoGenNodeData = {
  prompt: string;
  durationSec: number;
  endpointId: string | null;
  status: "idle" | "running" | "done" | "failed";
  assetId?: string;
  error?: string;
  /** 这场要说的台词，出片后交给时间线配音 */
  line?: string;
};

export function VideoGenNode({ id, data, selected }: NodeProps<Node<VideoGenNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const { runNode, runningIds } = useCanvasActions();
  const running = runningIds.has(id) || data.status === "running";
  const { data: endpoints } = useQuery({
    queryKey: ["model-endpoints", "video"],
    queryFn: () => api<ModelEndpoint[]>("/api/models/endpoints?capability=video"),
  });

  return (
    <div className={`w-72 rounded-xl border bg-panel shadow-lg ${selected ? "border-accent" : "border-line"}`}>
      <Handle type="target" position={Position.Left} id="prompt" className="!h-3 !w-3 !border-2 !border-ink !bg-accent" />
      <Handle type="target" position={Position.Top} id="image" className="!h-3 !w-3 !border-2 !border-ink !bg-sky-400" />
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium text-fg-dim">文生 / 图生视频</span>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-fg-faint">
          {data.status === "done" ? "已完成" : data.status === "failed" ? "失败" : running ? "生成中" : "待运行"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <textarea
          className="nodrag h-16 w-full resize-y rounded-lg border border-line bg-panel-2 p-2 text-xs outline-none"
          placeholder="画面说明。上面可连一张参考图做图生视频。"
          value={data.prompt}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
        />
        <div className="flex gap-2">
          <select
            className="nodrag min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-[11px]"
            value={data.endpointId ?? ""}
            onChange={(e) => updateNodeData(id, { endpointId: e.target.value || null })}
          >
            <option value="">默认视频模型</option>
            {endpoints?.map((ep) => (
              <option key={ep.id} value={ep.id}>{ep.name}</option>
            ))}
          </select>
          <select
            className="nodrag rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-[11px]"
            value={String(data.durationSec)}
            onChange={(e) => updateNodeData(id, { durationSec: Number(e.target.value) })}
          >
            {[...new Set([3, 4, 5, 6, 8, 10, 12, 15, 20, 30, data.durationSec])]
              .filter((s) => s >= 1)
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>{s} 秒</option>
              ))}
          </select>
        </div>
        {data.error && <div className="rounded-lg bg-red-950/40 px-2 py-1.5 text-[10px] text-red-300">{data.error}</div>}
        {data.assetId && (
          <video className="w-full rounded-lg border border-line" controls src={`/api/assets/${data.assetId}/file`} />
        )}
        <button
          className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-1.5 text-xs font-medium text-black disabled:opacity-40"
          disabled={running}
          onClick={() => runNode(id)}
        >
          {iconPlay({ width: 12, height: 12 })}
          {running ? "生成中…" : "运行"}
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="!h-3 !w-3 !border-2 !border-ink !bg-emerald-400" />
    </div>
  );
}
