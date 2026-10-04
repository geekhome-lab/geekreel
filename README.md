# 视频工作台

本地网页里做视频：素材、剪辑、风格流水线、热点、复刻。模型自己配。

## 换机器怎么跑

整份项目拷走即可。ffmpeg、yt-dlp、风格包都在仓库里，不要去装 pipx，也不要依赖原来那台电脑的 PATH。

1. 安装 [Bun](https://bun.sh)
2. 开发：`./scripts/dev.sh`（网页 http://127.0.0.1:5473 ，接口 4780）
3. 只跑成品：`./scripts/start.sh`（服务自己托管网页，默认 http://127.0.0.1:4780 ）

数据在 `~/.video-workbench`，素材默认在 `~/VideoWorkbench`，可在设置里改。
