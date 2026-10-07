import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import type { ModelEndpoint } from "@vw/models";
import { endpointOptionLabel } from "@vw/models";
import { api } from "../../lib/api";
import { iconPlay } from "../../lib/icons";
import { useCanvasActions } from "./canvasContext";

export type ImageGenNodeData = {
  prompt: string;
  size: string;
  endpointId: string | null;
  status: "idle" | "running" | "done" | "failed";
  assetId?: string;
  error?: string;
};

const sizes = ["1024x1024", "1024x1536", "1536x1024", "2048x2048"];

/** 文生图节点：文本节点连入 prompt，产物自动入资产库并回填 */
export function ImageGenNode({ id, data, selected }: NodeProps<Node<ImageGenNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const { runNode, runningIds } = useCanvasActions();
  const running = runningIds.has(id) || data.status === "running";

  const { data: endpoints } = useQuery({
    queryKey: ["model-endpoints", "image"],
    queryFn: () => api<ModelEndpoint[]>("/api/models/endpoints?capability=image"),
  });

  return (
    <div
      className={`w-72 rounded-xl border bg-panel shadow-lg transition-colors ${
        selected ? "border-accent" : "border-line"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        className="!h-3 !w-3 !border-2 !border-ink !bg-accent"
      />
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium text-fg-dim">文生图</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            data.status === "done"
              ? "bg-emerald-500/15 text-emerald-400"
              : data.status === "failed"
                ? "bg-red-500/15 text-red-400"
                : running
                  ? "bg-accent/15 text-accent"
                  : "bg-panel-2 text-fg-faint"
          }`}
        >
          {data.status === "done" ? "已完成" : data.status === "failed" ? "失败" : running ? "生成中" : "待运行"}
        </span>
      </div>

      <div className="space-y-2 p-3">
        <textarea
          className="nodrag h-20 w-full resize-y rounded-lg border border-line bg-panel-2 p-2 text-xs outline-none placeholder:text-fg-faint focus:border-accent-dim"
          placeholder="提示词（连入文本节点时以文本为准）"
          value={data.prompt}
          onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
        />

        <div className="flex gap-2">
          <select
            className="nodrag min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-[11px] outline-none"
            value={data.endpointId ?? ""}
            onChange={(e) => updateNodeData(id, { endpointId: e.target.value || null })}
          >
            <option value="">默认图片模型</option>
            {endpoints?.map((ep) => (
              <option key={ep.id} value={ep.id}>{endpointOptionLabel(ep)}</option>
            ))}
          </select>
          <select
            className="nodrag rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-[11px] outline-none"
            value={data.size}
            onChange={(e) => updateNodeData(id, { size: e.target.value })}
          >
            {sizes.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {data.error && (
          <div className="rounded-lg bg-red-950/40 px-2 py-1.5 text-[10px] whitespace-pre-wrap text-red-300">
            {data.error}
          </div>
        )}

        {data.assetId && (
          <img
            className="w-full rounded-lg border border-line"
            src={`/api/assets/${data.assetId}/file?variant=thumb`}
            alt="生成结果"
          />
        )}

        <button
          className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:opacity-40"
          disabled={running}
          onClick={() => runNode(id)}
        >
          {iconPlay({ width: 12, height: 12 })}
          {running ? "生成中…" : "运行"}
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!h-3 !w-3 !border-2 !border-ink !bg-emerald-400"
      />
    </div>
  );
}
