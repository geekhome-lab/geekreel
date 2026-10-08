import { dirname } from "node:path";

/** 在系统文件管理器中打开目录，或选中文件。 */
export function revealInFileManager(abs: string, selectFile = false): ReturnType<typeof Bun.spawn> {
  if (process.platform === "darwin") {
    return selectFile ? Bun.spawn(["open", "-R", abs]) : Bun.spawn(["open", abs]);
  }
  if (process.platform === "win32") {
    return selectFile
      ? Bun.spawn(["explorer.exe", `/select,${abs}`])
      : Bun.spawn(["explorer.exe", abs]);
  }
  return Bun.spawn(["xdg-open", selectFile ? dirname(abs) : abs]);
}
