import { Handle, Position, useReactFlow, type NodeProps, type Node } from "@xyflow/react";
import { iconPlay } from "../../lib/icons";
import { useCanvasActions } from "./canvasContext";

export type FfmpegNodeData = {
  op: "extract" | "transcode";
  atMs: number;
  status: "idle" | "running" | "done" | "failed";
  assetId?: string;
  error?: string;
};

export function FfmpegNode({ id, data, selected }: NodeProps<Node<FfmpegNodeData>>) {
  const { updateNodeData } = useReactFlow();
  const { runNode, runningIds } = useCanvasActions();
  const running = runningIds.has(id) || data.status === "running";

  return (
    <div className={`w-64 rounded-xl border bg-panel shadow-lg ${selected ? "border-accent" : "border-line"}`}>
      <Handle type="target" position={Position.Left} id="in" className="!h-3 !w-3 !border-2 !border-ink !bg-sky-400" />
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium text-fg-dim">ffmpeg</span>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-fg-faint">
          {data.status === "done" ? "已完成" : data.status === "failed" ? "失败" : running ? "处理中" : "待运行"}
        </span>
      </div>
      <div className="space-y-2 p-3">
        <select
          className="nodrag w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-[11px]"
          value={data.op}
          onChange={(e) => updateNodeData(id, { op: e.target.value as FfmpegNodeData["op"] })}
        >
          <option value="extract">抽一帧图片</option>
          <option value="transcode">转成预览 mp4</option>
        </select>
        {data.op === "extract" && (
          <label className="flex items-center gap-2 text-[11px] text-fg-dim">
            第
            <input
              className="nodrag w-16 rounded border border-line bg-panel-2 px-1 py-0.5"
              type="number"
              min={0}
              value={Math.round(data.atMs / 1000)}
              onChange={(e) => updateNodeData(id, { atMs: Number(e.target.value) * 1000 })}
            />
            秒
          </label>
        )}
        <p className="text-[10px] text-fg-faint">左边连资产或生成节点。</p>
        {data.error && <div className="rounded-lg bg-red-950/40 px-2 py-1.5 text-[10px] text-red-300">{data.error}</div>}
        {data.assetId && data.op === "extract" && (
          <img className="w-full rounded-lg border border-line" src={`/api/assets/${data.assetId}/file?variant=thumb`} alt="抽帧" />
        )}
        {data.assetId && data.op === "transcode" && (
          <video className="w-full rounded-lg" controls src={`/api/assets/${data.assetId}/file`} />
        )}
        <button
          className="nodrag flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-1.5 text-xs font-medium text-black disabled:opacity-40"
          disabled={running}
          onClick={() => runNode(id)}
        >
          {iconPlay({ width: 12, height: 12 })}
          {running ? "处理中…" : "运行"}
        </button>
      </div>
      <Handle type="source" position={Position.Right} id="out" className="!h-3 !w-3 !border-2 !border-ink !bg-emerald-400" />
    </div>
  );
}
