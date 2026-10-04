import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";

export type EpisodeNodeData = { title: string; synopsis: string };

export function EpisodeNode({ id, data, selected }: NodeProps<Node<EpisodeNodeData>>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div className={`w-72 rounded-xl border bg-panel shadow-lg ${selected ? "border-accent" : "border-line"}`}>
      <div className="border-b border-line px-3 py-1.5 text-[11px] font-medium text-fg-dim">分集</div>
      <div className="space-y-1.5 p-3">
        <input
          className="nodrag w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none"
          placeholder="这一集叫什么"
          value={data.title}
          onChange={(e) => updateNodeData(id, { title: e.target.value })}
        />
        <textarea
          className="nodrag h-16 w-full resize-y rounded-lg border border-line bg-panel-2 p-2 text-xs outline-none"
          placeholder="这一集发生什么"
          value={data.synopsis}
          onChange={(e) => updateNodeData(id, { synopsis: e.target.value })}
        />
      </div>
      <Handle type="source" position={Position.Right} id="out" className="!h-3 !w-3 !border-2 !border-ink !bg-accent" />
    </div>
  );
}

export function episodePrompt(data: EpisodeNodeData): string {
  return [data.title.trim(), data.synopsis.trim()].filter(Boolean).join("\n");
}
