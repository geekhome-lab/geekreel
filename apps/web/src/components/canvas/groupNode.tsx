import { NodeResizer, useReactFlow, type Node, type NodeProps } from "@xyflow/react";

export type GroupNodeData = { label: string };

export function GroupNode({ id, data, selected }: NodeProps<Node<GroupNodeData>>) {
  const { updateNodeData } = useReactFlow();
  return (
    <div className={`h-full w-full rounded-2xl border-2 border-dashed bg-panel/40 ${selected ? "border-accent" : "border-line"}`}>
      <NodeResizer minWidth={200} minHeight={120} isVisible={selected} color="#d4a017" />
      <input
        className="nodrag mx-3 mt-2 w-[calc(100%-1.5rem)] bg-transparent text-xs font-medium text-fg-dim outline-none"
        value={data.label}
        placeholder="分组"
        onChange={(e) => updateNodeData(id, { label: e.target.value })}
      />
    </div>
  );
}
