import { createContext, useContext } from "react";

/** 画布页提供给节点组件的动作 */
export interface CanvasActions {
  /** 运行到该节点（含上游生成节点，按拓扑序） */
  runNode: (nodeId: string) => void;
  /** 打开资产选择器，选中后写入节点 data.assetId */
  pickAsset: (nodeId: string) => void;
  runningIds: Set<string>;
}

export const CanvasActionsContext = createContext<CanvasActions>({
  runNode: () => {},
  pickAsset: () => {},
  runningIds: new Set(),
});

export function useCanvasActions(): CanvasActions {
  return useContext(CanvasActionsContext);
}
