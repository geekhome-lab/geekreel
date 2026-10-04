import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";

export type SceneNodeData = { place: string; time: string; mood: string };

export function SceneNode({ id, data, selected }: NodeProps<Node<SceneNodeData>>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div className={`w-64 rounded-xl border bg-panel shadow-lg ${selected ? "border-accent" : "border-line"}`}>
      <div className="border-b border-line px-3 py-1.5 text-[11px] font-medium text-fg-dim">场景卡</div>
      <div className="space-y-1.5 p-3">
        <input
          className="nodrag w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none"
          placeholder="地点"
          value={data.place}
          onChange={(e) => updateNodeData(id, { place: e.target.value })}
        />
        <input
          className="nodrag w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none"
          placeholder="时间"
          value={data.time}
          onChange={(e) => updateNodeData(id, { time: e.target.value })}
        />
        <input
          className="nodrag w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs outline-none"
          placeholder="气氛"
          value={data.mood}
          onChange={(e) => updateNodeData(id, { mood: e.target.value })}
        />
      </div>
      <Handle type="source" position={Position.Right} id="out" className="!h-3 !w-3 !border-2 !border-ink !bg-accent" />
    </div>
  );
}

export function scenePrompt(data: SceneNodeData): string {
  return [
    data.place.trim() && `场景：${data.place.trim()}`,
    data.time.trim() && `时间：${data.time.trim()}`,
    data.mood.trim() && `气氛：${data.mood.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}
