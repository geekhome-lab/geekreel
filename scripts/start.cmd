@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0\.."
if exist "%USERPROFILE%\.bun\bin\bun.exe" set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
where bun >nul 2>nul
if errorlevel 1 (
  echo 这台机器还没有 Bun。打开 https://bun.sh 安装后再跑。
  exit /b 1
)
bun install
bun run --filter=@vw/web build
cd /d "%~dp0\..\apps\server"
bun src/index.ts
