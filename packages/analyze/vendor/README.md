独立 yt-dlp 二进制（不是本机 pipx 包装脚本）。
`bun install` 会按当前系统下载；macOS 版已随仓库带走，换一台 Mac 不用再配。
换 Linux/Windows 时 `.platform` 对不上会重拉对应平台文件。
禁止把 `~/.local/bin/yt-dlp` 那种 shebang 包装拷进来。
