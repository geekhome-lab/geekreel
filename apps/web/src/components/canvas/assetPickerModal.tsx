import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assetTypeLabels, type Asset, type AssetType } from "@vw/core";
import { api } from "../../lib/api";
import { Modal } from "../modal";

/** 资产选择器：从资产库挑一个资产挂到节点上 */
export function AssetPickerModal(props: { onSelect: (asset: Asset) => void; onClose: () => void }) {
  const [type, setType] = useState("");

  const { data: assets } = useQuery({
    queryKey: ["assets", "picker", type],
    queryFn: () => api<Asset[]>(`/api/assets${type ? `?type=${type}` : ""}`),
  });

  return (
    <Modal title="选择资产" onClose={props.onClose} width="w-[680px]">
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {["", "image", "video", "audio", "text"].map((t) => (
            <button
              key={t}
              className={`rounded-md px-3 py-1 text-xs ${
                type === t ? "bg-panel-2 text-accent" : "text-fg-dim hover:text-fg"
              }`}
              onClick={() => setType(t)}
            >
              {t === "" ? "全部" : assetTypeLabels[t as AssetType]}
            </button>
          ))}
        </div>
        <div className="grid max-h-[50vh] grid-cols-4 gap-2 overflow-y-auto">
          {assets?.length === 0 && (
            <div className="col-span-4 py-8 text-center text-xs text-fg-faint">资产库为空，请先到「资产库」页导入</div>
          )}
          {assets?.map((a) => (
            <button
              key={a.id}
              className="overflow-hidden rounded-lg border border-line bg-panel-2 text-left hover:border-accent-dim"
              onClick={() => props.onSelect(a)}
            >
              <div className="flex h-20 items-center justify-center bg-black/30 text-[10px] text-fg-faint">
                {a.thumbPath || a.type === "image" ? (
                  <img
                    className="h-full w-full object-cover"
                    src={`/api/assets/${a.id}/file?variant=${a.thumbPath ? "thumb" : "original"}`}
                    alt={a.title}
                  />
                ) : (
                  assetTypeLabels[a.type]
                )}
              </div>
              <div className="truncate px-2 py-1.5 text-[11px]" title={a.title}>{a.title}</div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
