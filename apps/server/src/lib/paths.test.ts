import { expect, test } from "bun:test";
import { isAbsolutePath, isForbiddenProjectDir, isFsRootPath, isInsideRoot } from "./paths";

test("Windows 盘符是绝对路径", () => {
  expect(isAbsolutePath("C:\\Users\\a\\VideoWorkbench", "win32")).toBe(true);
  expect(isAbsolutePath("C:/Users/a", "win32")).toBe(true);
  expect(isAbsolutePath("\\\\server\\share", "win32")).toBe(true);
  expect(isAbsolutePath("Users\\a", "win32")).toBe(false);
  expect(isAbsolutePath("/Users/a", "linux")).toBe(true);
  expect(isAbsolutePath("C:\\Users\\a", "linux")).toBe(false);
});

test("磁盘根与家目录不能当项目目录", () => {
  expect(isForbiddenProjectDir("C:\\", "C:\\Users\\a", "win32")).toBe(true);
  expect(isForbiddenProjectDir("C:\\Users\\a", "C:\\Users\\a", "win32")).toBe(true);
  expect(isForbiddenProjectDir("C:\\Users\\a\\proj", "C:\\Users\\a", "win32")).toBe(false);
  expect(isForbiddenProjectDir("/", "/home/a", "linux")).toBe(true);
  expect(isForbiddenProjectDir("/home/a", "/home/a", "linux")).toBe(true);
  expect(isForbiddenProjectDir("/home/a/proj", "/home/a", "linux")).toBe(false);
});

test("资产库越界保护在 Windows 上忽略盘符大小写", () => {
  expect(isInsideRoot("C:\\lib\\a.mp4", "C:\\lib", "win32")).toBe(true);
  expect(isInsideRoot("c:\\Lib\\a.mp4", "C:\\lib", "win32")).toBe(true);
  expect(isInsideRoot("C:\\library\\a.mp4", "C:\\lib", "win32")).toBe(false);
  expect(isInsideRoot("/lib/a.mp4", "/lib", "linux")).toBe(true);
  expect(isInsideRoot("/library/a.mp4", "/lib", "linux")).toBe(false);
});

test("isFsRootPath", () => {
  expect(isFsRootPath("C:\\", "win32")).toBe(true);
  expect(isFsRootPath("C:\\Users", "win32")).toBe(false);
  expect(isFsRootPath("/", "linux")).toBe(true);
});
