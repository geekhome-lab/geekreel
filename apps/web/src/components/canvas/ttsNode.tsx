import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import type { ModelEndpoint } from "@vw/models";
import { api } from "../../lib/api";
import { iconPlay } from "../../lib/icons";
import { useCanvasActions } from "./canvasContext";

export type TtsNodeData = {
  text: string;
  endpointId: string | null;
  status: "idle" | "running" | "done" | "failed";
  assetId?: string;
  error?: string;
};

export function TtsNode({ id, data, selected }: NodeProps<Node<TtsNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const { runNode, runningIds } = useCanvasActions();
  const running = runningIds.has(id) || data.status === "running";
  const { data: endpoints } = useQuery({
    queryKey: ["model-endpoints", "tts"],
    queryFn: () => api<ModelEndpoint[]>("/api/models/endpoints?capability=tts"),
  });

  return (
    <div className={`w-72 rounded-xl border bg-panel shadow-lg ${selected ? "border-accent" : "border-line"}`}>
      <Handle type="target" position={Position.Left} id="prompt" className="!h-3 !w-3 !border-2 !border-ink !bg-accent" />
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium text-fg-dim">配音</span>
        <Status status={data.status} running={running} />
      </div>
      <div className="space-y-2 p-3">
        <textarea
          className="nodrag h-16 w-full resize-y rounded-lg border border-line bg-panel-2 p-2 text-xs outline-none"
          placeholder="要说的话（连入文本节点时以文本为准）"
          value={data.text}
          onChange={(e) => updateNodeData(id, { text: e.target.value })}
        />
        <select
          className="nodrag w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-[11px]"
          value={data.endpointId ?? ""}
          onChange={(e) => updateNodeData(id, { endpointId: e.target.value || null })}
        >
          <option value="">默认语音模型</option>
          {endpoints?.map((ep) => (
            <option key={ep.id} value={ep.id}>{ep.name}</option>
          ))}
        </select>
        {data.error && <div className="rounded-lg bg-red-950/40 px-2 py-1.5 text-[10px] text-red-300">{data.error}</div>}
        {data.assetId && <audio className="w-full" controls src={`/api/assets/${data.assetId}/file`} />}
        <button
          className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-1.5 text-xs font-medium text-black disabled:opacity-40"
          disabled={running}
          onClick={() => runNode(id)}
        >
          {iconPlay({ width: 12, height: 12 })}
          {running ? "配音中…" : "运行"}
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="!h-3 !w-3 !border-2 !border-ink !bg-emerald-400" />
    </div>
  );
}

function Status(props: { status: TtsNodeData["status"]; running: boolean }) {
  const label = props.status === "done" ? "已完成" : props.status === "failed" ? "失败" : props.running ? "生成中" : "待运行";
  return <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-fg-faint">{label}</span>;
}
