# 更新说明

功能以本仓库实现为准。设置页显示的版本号来自服务端。

## 0.1.1 · 2026-10-07

短剧出片更像一条完整生产线：人物场景可复用，声音不只人声，对白按成片对嘴，不再把整份剧本灌进一条短视频。

### 成片与配音

- **按成片写词**：配音只念这一镜画面里的事，5 秒片子不会配出 30 秒旁白。
- **对白先配音再对嘴**：角色开口的镜头用 TTS 驱动可灵 / 万相对口型；旁白和空镜只铺声。
- **音轨铺满**：配乐、环境底、音效可上时间线；人声段落自动压低配乐；可导出剪映草稿。

### 资产与镜头

- **角色 / 场景 / 道具是可复用资产**：定妆支持多视图，出片按名字对上资产库。
- **镜头语言**：景别、运镜、机位写进分镜，不再只丢一句画面说明。
- **质检闭环**：对照生成结果看漂脸换装，没过只重做这一镜。
- **多参考图**：万相 / Sora / 可灵按模型能力带上首帧、尾帧和主体库，不把不支持的字段硬塞给旧模型。

### 使用注意

- 配音仍要在时间线里选音色再点，不会在出片时擅自铺上。
- 对口型依赖视频模型。对不上时保留原视频并铺声，界面会说明。

---

# Changelog

## 0.1.1 · 2026-10-07

Short-drama finish is a full pass: reusable looks, more than TTS, dialogue driven from the clip, lips synced from speech.

- Dubbing writes lines from the generated clip; a 5s shot is not filled with a 30s script.
- Talking shots: TTS first, then Kling / Wan lip-sync. Narration and empty shots only lay audio.
- BGM, ambience, and SFX on the timeline; duck BGM under speech; Jianying draft export.
- Characters / scenes / props are library assets with multi-view looks.
- Shot size, move, and angle land on each beat. QA retries a drifted shot only.
- Extra reference images are sent only to models that accept them.

Dubbing stays opt-in on the timeline. If lip-sync fails, the original video stays and a note is shown.
