import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { assetTypeLabels, type Asset } from "@vw/core";
import { api } from "../../lib/api";
import { iconAudio, iconImage, iconText, iconVideo } from "../../lib/icons";
import { useCanvasActions } from "./canvasContext";

export type AssetNodeData = { assetId: string | null };

const typeIcon = (type: Asset["type"]) => {
  if (type === "image") return iconImage({});
  if (type === "video") return iconVideo({});
  if (type === "audio") return iconAudio({});
  return iconText({});
};

/** 资产节点：引用资产库中的素材；双击更换资产 */
export function AssetNode({ id, data, selected }: NodeProps<Node<AssetNodeData>>) {
  const { pickAsset } = useCanvasActions();
  const { data: asset } = useQuery({
    queryKey: ["asset", data.assetId],
    queryFn: () => api<Asset>(`/api/assets/${data.assetId}`),
    enabled: !!data.assetId,
  });

  return (
    <div
      className={`w-52 rounded-xl border bg-panel shadow-lg transition-colors ${
        selected ? "border-accent" : "border-line"
      }`}
      onDoubleClick={() => pickAsset(id)}
      title="双击更换资产"
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium text-fg-dim">资产</span>
        {asset && (
          <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-fg-faint">
            {assetTypeLabels[asset.type]}
          </span>
        )}
      </div>
      {asset ? (
        <div>
          {asset.thumbPath || asset.type === "image" ? (
            <img
              className="h-28 w-full object-cover"
              src={`/api/assets/${asset.id}/file?variant=${asset.thumbPath ? "thumb" : "original"}`}
              alt={asset.title}
            />
          ) : (
            <div className="flex h-28 items-center justify-center text-fg-faint">{typeIcon(asset.type)}</div>
          )}
          <div className="truncate px-3 py-2 text-xs" title={asset.title}>{asset.title}</div>
        </div>
      ) : (
        <div className="flex h-28 items-center justify-center text-[11px] text-fg-faint">未选择资产</div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="!h-3 !w-3 !border-2 !border-ink !bg-sky-400"
      />
    </div>
  );
}
