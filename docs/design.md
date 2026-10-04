# 视频工作台（Video Workbench）设计文档

> 版本：v0.11 · 更新日期：2026-10-04
> 概念参考：Toonflow-app（画布/工作区）、Hypit（爆款复刻）、smy-seedance-storyboard（上美影风）、srt-whiteboard-animation（白板动画）。仅借鉴思路，架构与代码自研。

---

## 0. 产品原则：小白优先（最高优先级）

**目标用户是不会剪辑、不懂提示词工程的普通人。** 所有设计决策先过这一关。

| 原则 | 落地 |
| --- | --- |
| 首页即对话 | 打开就是一个输入框：「想做什么视频？」——像和 ChatGPT 聊天一样开始 |
| 模型可见可选 | 输入框旁直接选文本/图片/视频模型（用已配置端点，默认选中默认项），小白不需要懂"端点"是什么 |
| 零提问建项目 | 不询问目录、不让填表单——系统自动建项目（资产库目录下 `projects/日期_标题/`），专业用户才去项目页自选目录 |
| 意图即流水线 | 用户说"把小说做成短剧"/"做成白板动画"，系统自动识别意图、搭好画布/流水线并直接开跑 |
| 渐进式复杂 | 画布、时间线、模型中心是"高级面板"，随时可深入，但永远不挡在新手路上 |
| 失败说人话 | 报错翻译成行动建议（"还没配图片模型，点这里去配"），不抛技术细节 |
| 离开本机也能用 | ffmpeg、yt-dlp 等本机工具打进项目；禁止依赖开发机 PATH / pipx / 家目录包装脚本 |

---

## 1. 定位与目标

**一句话定位**：运行在本地（或私有服务器）的一站式视频创作工作台——把「找选题 → 分析爆款 → 攒素材 → AI 生成 → 剪辑合成 → 导出」放进同一个工具。

**设计目标**：

| 目标 | 说明 |
| --- | --- |
| 本地优先 | 项目、资产、密钥都在本机，断网可用（除 AI 生成与联网取热点） |
| 资产有序 | 统一资产库：用户自选目录，按类型/时间/标题自动分类，永不乱 |
| 模型自由 | 文本/图片/视频/语音模型全部由用户自己配置端点，不绑定任何厂商 |
| 异步任务化 | 所有耗时操作统一进任务中心，可排队、取消、重试、看进度 |
| 可插拔 | 模型适配器、雷达源、推送渠道、**风格包**均为插件式注册，加能力不改主代码 |
| 可干预的自动化 | 流水线每步产出可人工修改后再继续，不做黑盒一键出片 |

---

## 2. 核心场景

0. **对话式首页（主入口）**：一个输入框 + 模型选择 + 意图快捷入口（小说转短剧/白板动画/复刻爆款/自由创作）。输入一句话 → 自动建项目、搭画布、开跑。未配模型时给出引导而非报错。
1. **热点雷达 + 话题推送**：用已配置的 AI 模型（联网搜索）定时取各平台热点，关键词订阅，命中自动推送到微信/TG/邮件；热点一键转创作项目。
2. **竞品视频分析**：丢一个竞品视频链接（抖音/TikTok/B站/YouTube）→ 自动下载、抽帧、转写、LLM 拆解出结构报告（钩子/节奏/分镜/台词）。
3. **爆款视频复刻**：分析报告一键转复刻模板 → 换主题/产品/人物/语言 → 批量生成变体成片。
4. **资产库**：所有文本（MD）/图片/视频/音频资产统一存进用户自选的文件夹，按时间+标题自动分类；专门的管理页浏览、筛选、预览、整理。
5. **画布编排**：无限画布组织脚本、分镜、素材与生成节点，连线即数据流，可整链运行。
6. **模型配置中心**：自己配文本/图片/视频/语音模型端点（OpenAI 兼容、豆包、可灵……），按能力设默认，节点级可覆盖。
7. **风格中心**：选风格包开工——当前内置上美影风短剧、手绘白板动画两个包；包结构开放，后续加风格 = 加一个目录。
8. **一键小说转短剧**：通读全文 → 角色档案（外貌/性格/身份/穿搭）→ 按章事件清单 → 用户点卡片对话改某一条 → 确认后再拆集上画布。不点选固定风格。

---

## 3. 功能模块设计

### 3.1 模块总览

```
┌──────────────────────────────────────────────────────────────────┐
│                         Web 前端 (React)                          │
│ 项目  资产库  画布  时间线  雷达  分析  复刻  风格中心  模型  任务  设置 │
└──────────────────────────────┬───────────────────────────────────┘
                               │ REST + WebSocket
┌──────────────────────────────┴───────────────────────────────────┐
│                       Server (Bun + Hono)                         │
│  项目/资产 │ 任务队列 │ 模型网关(ModelRegistry) │ 流水线引擎        │
│  雷达调度 │ 分析服务 │ 复刻引擎              │ 推送服务          │
│  媒体服务(ffmpeg) │ 文件服务 │ 风格包加载 │ 设置/密钥           │
└───┬──────────┬──────────────┬───────────────┬──────────────────┘
    │          │              │               │
 SQLite    资产库目录(用户自选)  外部模型 API   Python sidecar（可选）:
          + 项目目录                        白板渲染器 / faster-whisper
```

### 3.2 项目与工作区

- **项目制**：项目 = 一个本地目录，只放项目专属文件：`project.vw.json`（元数据）、`canvas/`（画布快照）、`pipeline/`（流水线状态）、`export/`（最终成片）。
- **媒体资产不进项目目录**，统一进全局资产库（见 3.3），项目通过库内相对路径引用，跨项目可复用。
- 成片导出默认到项目 `export/`，可一键「收入资产库」便于二次创作引用。
- **全局数据**：`~/.video-workbench/` 存 SQLite、模型密钥、雷达缓存、风格包。
- 文件写入一律原子写；画布自动保存防抖 1s。

### 3.3 资产库（Asset Library）

**统一存储：用户自选一个文件夹作为资产库根目录**（首次启动引导选择，设置里可改，改时可选「迁移文件」——后台 Job 批量移动，因库存的是相对路径，迁移无需改数据库）。

**目录布局：按类型 → 年月两级分类，文件名带日期+标题**：

```
<资产库根目录>/
├── image/2026-10/1004_武松打虎-角色三视图_a3f2.png
├── video/2026-10/1004_E01-醉闹五台山_e77a.mp4
├── audio/2026-10/1004_说书人旁白-E01_2b9d.mp3
├── text/2026-10/1004_剧本-武松打虎_c4d8.md
└── .cache/                 # 缩略图/代理/波形（可删可重建）
    ├── thumb/…  └── proxy/…
```

**命名规范**：`{MMDD}_{标题}_{4位hash}.{ext}`
- 标题取自资产名（生成类资产取 prompt 摘要/项目名/集数，导入类取原文件名），清洗非法字符、截断 40 字。
- 4 位 hash 取自资产 id，同一天同名资产不冲突。
- `assets.path` 存库内相对路径（如 `image/2026-10/1004_xxx_a3f2.png`），库根目录在设置里。

**导入即索引**：入队索引任务 → 缩略图、波形、时长/分辨率等元数据、视频 720p 代理（进 `.cache/`）。

**组织维度**（与目录正交，存库里）：标签 + 收藏夹 + 资产类型（角色/场景/道具/通用）+ 来源（导入/画布生成/流水线产出/复刻产出/分析下载）+ 所属项目。角色资产支持多视图挂同一实体。

**资产管理页**（独立一级页面）：

| 能力 | 说明 |
| --- | --- |
| 浏览 | 网格/列表切换；按类型 Tab；按月份分组（与目录结构一致，所见即所得） |
| 筛选搜索 | 类型/标签/来源/项目/时间范围；文件名与 prompt 全文搜索 |
| 预览 | 图片大图、视频/音频播放、MD 渲染预览、元数据面板 |
| 整理 | 重命名（同步改文件名的标题部分）、改标签、移入收藏夹、批量操作 |
| 删除保护 | 被画布/时间线/复刻模板引用的资产删除前强提示 |
| 存储统计 | 各类型占用、月度增长、大文件清单、缓存清理 |
| 直达文件 | 「在 Finder 中打开」，目录结构透明可手动管理 |

### 3.4 画布

React Flow 无限画布。节点类型：

| 类别 | 节点 | 说明 |
| --- | --- | --- |
| 资产节点 | image / video / audio / text | 引用资产库资产 |
| 生成节点 | 文生图 / 图生视频 / 文生视频 / TTS | 选模型端点 + prompt + 参数；连线输入参考图/文本 |
| 处理节点 | 转码 / 裁剪 / 拼接 / 字幕烧录 / 抽帧 | ffmpeg 能力节点化 |
| 叙事节点 | 分集 / 场景卡 / 分镜卡 | 结构化剧本内容，可喂给生成节点 |
| 装饰节点 | 分组框 / 注释 | 纯组织用 |

边有**数据流语义**：`文本 → 文生图 → 图生视频` 构成可执行链，整链运行时每步生成 Job，产物自动落资产库并回填节点。

### 3.5 时间线

- **M3 已落地**：1 条视频轨 + N 条音频轨 + 1 条字幕轨；硬切（无转场）；图片按静帧 loop 上视频轨。
- **M11**：片段可设变速（0.5×–2×）与淡入淡出；导出进 ffmpeg `setpts` / `atempo` / `fade`。
- 片段 = 资产引用 + in/out + 音量 + 可选 speed/transition；字幕片段带文本，支持 SRT 导入。
- 小白路径：画布出图后点「送到时间线」/「从画布装上」——文生图节点按从左到右排成镜头，对应文本写成字幕。
- 预览：浏览器时钟驱动播放头，视频走代理、静帧走原图；导出走 bundled ffmpeg `filter_complex` 进任务队列，成片写入项目 `export/` 并收入资产库。
- 词级对齐走 Whisper API（verbose_json），不再依赖 Python sidecar。远期可加滤镜。

### 3.6 模型配置中心（Model Center）

**两层设计：协议适配器（内置） × 模型端点（用户自建）**。

```ts
// 协议适配器：内置，懂某家 API 的协议细节
interface ModelAdapter {
  type: string;                    // "openai-compatible" | "doubao-seedance" | "kling" | ...
  capabilities: Capability[];      // "llm" | "image" | "video" | "tts"
  configFields: Field[];           // 动态渲染配置表单
  submit(endpoint: ModelEndpoint, req: GenRequest): Promise<JobHandle>;
  poll(handle: JobHandle): Promise<JobProgress>;
  test(endpoint: ModelEndpoint): Promise<TestResult>;
}

// 模型端点：用户在设置里自己加，可加任意多个
interface ModelEndpoint {
  id: string;
  name: string;                    // "我的 DeepSeek"、"即梦 4.0"
  adapterType: string;
  baseUrl?: string; apiKey?: string; model?: string;
  defaultParams?: Record<string, unknown>;
  webSearch?: boolean;             // 文本端点标记：支持联网搜索（雷达依赖此能力）
  vision?: boolean;                // 文本端点能看图（分析读帧）
  enabled: boolean;
}
```

- **四种能力**：文本 / 图片 / 视频 / 语音，每种能力可配多个端点，设一个**全局默认**；画布节点、流水线步骤可指定端点，不指定走默认。
- **能力路由**：`resolve("video", preferredId?)` → 返回可用端点；端点失效给明确错误，不静默换模型。
- **连通性测试**：一键 test，返回延迟与模型列表。
- **用量与成本**：每次调用记录（tokens / 张数 / 秒数）× 用户填的单价 → 成本看板（按项目/按端点）。
- 密钥 SQLite 加密存储，请求日志脱敏；支持从环境变量导入。
- 内置适配器第一批：OpenAI 兼容（文本/图片/语音通吃大多数厂商）、豆包 Seedream（图）/ Seedance（视频）、可灵；ComfyUI 本地（远期）。

### 3.7 热点雷达 + 话题推送

**热点获取方式：用模型中心已配置的文本模型（联网搜索）取热点，不内置爬虫。**

```
雷达源 = 一条「观察配置」：名称 + 关注平台/领域 + 查询模板(prompt) + 间隔（半小时/小时/6小时/每天）+ 指定端点(可选)
调度器到点 → 用文本端点(需标记 webSearch 能力)执行查询
  → 模型返回结构化 JSON：标题/平台/链接/热度描述/一句话摘要
  → 归一化 → 去重(hash) → 打分入库 → 命中订阅则推送
```

- **内置源模板**（都是 prompt 模板，开箱即用）：微博热搜、抖音热点、B站热门、知乎热榜、小红书热点 + 领域观察（科技/财经/电商/娱乐…），用户可改模板或自建源。
- **源种类**：`ai-query`（联网文本模型）/ `rss`（公开 RSS/Atom）/ `http-api`（返回 `{ items: [{ title, url, heat, summary }] }` 的 JSON）。刷新时只有 AI 源才要求联网模型。
- **热度取舍**：热度值为模型估计（0–100）并附原文描述（如"热搜第 3"），UI 标注「AI 估计」；准确性依赖所选模型的联网能力——这是用简洁架构换掉的精度，文档明示。
- 端点不支持联网时，该源给出明确错误并引导去模型中心换端点。

**话题自动推送**：

- 订阅规则：关键词 + 平台范围 + 热度阈值 + 免打扰时段。
- 推送渠道插件：Webhook / Server酱 / Telegram Bot / Bark / 邮件（SMTP）。
- 两种推送：**实时命中**与**每日早报**（固定时间汇总 Top N + 趋势）。
- 推送消息带深链，点击直达 Web UI「一键建项目」。

前端：总榜/分源榜、趋势曲线、源管理（模板/频率/端点）、订阅管理、推送记录。

### 3.8 竞品视频分析

**输入**：视频链接（yt-dlp 支持抖音/TikTok/B站/YouTube/快手）或本地文件/资产库资产。

**分析流水线**（每步是任务中心的一个 Job，可单独重跑）：

```
下载(yt-dlp) → 元数据(时长/分辨率/发布信息)
  → 场景切分抽帧(ffmpeg scene detect，每场景代表帧)
  → 语音转写(Whisper API verbose_json，词级时间戳)
  → LLM 结构化分析(文本模型；端点勾选 vision 时把抽帧 JPEG 一并送去)
```

**分析报告**（结构化 JSON + 可视化报告页）：

| 板块 | 内容 |
| --- | --- |
| 逐镜拆解 | 时间轴：每镜头起止、画面描述、台词、字幕样式 |
| 结构分析 | 钩子（前 3s）→ 展开 → 高潮 → CTA 的划分与论证 |
| 节奏数据 | 镜头时长分布、台词密度（字/秒）、BGM 卡点、静音点 |
| 爆款因子 | LLM 归纳的留人技巧、情绪曲线、争议点/共鸣点 |

报告存库，可对比多条视频；**「转为复刻模板」按钮**是分析模块的出口。

### 3.9 爆款视频复刻

借鉴 Hypit 的核心思想——**复刻产出的是可重跑的模板，不是一次性成片；时间锚定到台词（语义）而非秒数**——但不引入其 SVML 语言体系，用我们自己的 JSON 模板 + 时间线实现。

**复刻模板**（从分析报告提炼）：

```json
{
  "name": "街访三段式 reveal",
  "slots": [
    { "id": "hook", "type": "a-roll", "maxSec": 3,
      "shotDesc": "近景，采访者抛争议问题", "lineSlot": "争议提问台词" },
    { "id": "answer-1", "type": "a-roll", "shotDesc": "受访者第一条规则", "lineSlot": "规则1台词" },
    { "id": "reveal-board", "type": "mg", "shotDesc": "音效同步的揭示板动画" },
    { "id": "cta", "type": "a-roll", "lineSlot": "行动号召台词" }
  ],
  "captionStyle": { "type": "karaoke", "position": "bottom-third" },
  "variables": ["主题", "产品", "人物设定", "语言"]
}
```

**复刻流程**：

```
选模板 → 填变量（换成我的主题/产品/人物）
  → LLM 生成新台词与逐槽位分镜 prompt（保持原结构骨架）
  → 批量生成素材（A-roll 视频 / 图片 / TTS，走模型中心）
  → 词级对齐 + 按槽位自动装配时间线
  → 人工微调 → 导出
```

- **一变体多**：同一模板可批量跑 N 个变体（换钩子/换人物/换语言），每个变体一个时间线实例，批量进任务队列。
- 模板可保存、命名、复用、导出分享（JSON 文件）。

### 3.10 风格中心（Style Center）

**设计原则：风格包是完全开放的扩展点。当前只内置 2 个包，但加新风格 = 往 `stylePacks/` 目录丢一个符合契约的目录，无需改任何主代码。**

**风格包契约**（文件制，注册制加载）：

```
stylePacks/<name>/
├── pack.json          # 清单：名称/版本/简介/封面/所需模型能力/入口流水线
├── prompts/           # 风格咒语块、负面清单、色盘模板等提示词资产
├── templates/         # 分镜/生成 prompt 模板（如 Seedance 时间轴格式）
├── pipeline.json      # 绑定的流水线模板（步骤图 + 检查点）
└── samples/           # 示例图/视频（风格中心预览用）
```

```ts
interface StylePack {
  manifest: PackManifest;            // pack.json
  requiredCapabilities: Capability[];// 需要的模型能力（如 image+video+tts）
  pipelineTemplate: PipelineTemplate;// pipeline.json 解析结果
  resolvePrompt(slot: string, ctx: object): string; // 模板渲染，引擎自动注入风格约束
}
```

- **加载机制**：启动扫描 `stylePacks/`，校验清单与所需能力，注册进风格中心；包损坏/缺能力时标记不可用并说明原因，不影响其他包。
- **风格中心 UI**：卡片浏览 → 详情 →「用此风格做成片」。**添加风格**：贴 GitHub 技能链接 / 平台代写 / 上传 SKILL.md，起名后转成风格包（写入 `stylePacks/`，换机器能带走）。
- **远期**：包市场、zip 一键分享。
- **远期**：用户自制包导入（拖目录/zip）、包导出分享、包市场。

**内置风格包 ①：上美影风短剧**（借鉴 smy-seedance-storyboard 的方法论）

| 机制 | 我们的实现 |
| --- | --- |
| 色盘声明 | 项目级 `palette` 字段，流水线开始时 LLM 生成（主四色+扩展色），之后所有出图/出视频 prompt **由引擎自动逐字注入**，机制上防跑色 |
| 风格咒语 | `prompts/style-block.md` 固定前缀，引擎自动拼到每条 prompt 开头 |
| 强约束结尾 | 「必须纯2D平涂！绝对不要阴影、渐变、3D体积感！大面积留白！」+ 负面词清单，自动追加 |
| 子风格 | 手绘平涂 / 石蓝淡墨绘本 / 水墨淡彩 / 剪纸风 / 敦煌重彩，建项目时单选 |
| 分镜格式 | Seedance 时间轴模板（0-3s / 3-6s …），引擎按模板生成 |
| 集间衔接 | 每集末帧描述存档，下一集生成时自动携带（或用视频延长能力） |

流水线：故事输入 → 分集剧本（说书人旁白体制）→ 色盘声明 → 素材清单（角色 C01-/场景 S01-/道具 P01- 编号出图）→ 逐集分镜 → 批量出片 → 配音配乐 → 合成。

**内置风格包 ②：手绘白板动画**（借鉴 srt-whiteboard-animation 的分幕思路，不照搬 Python 渲染器）

- 输入 **SRT 字幕**或按行口播文案，按约 30 秒自动分幕。
- 视觉规范内置：暖米黄纸底 `#F5EBD7`、深灰素描线、红/橙/蓝少量点缀、大留白。
- **M7 成片路径（便携）**：SRT/文案 → 分幕 → 项目自带 ffmpeg 出纸底静帧 → 写入 `timeline/main.json`（静帧视频轨 + 字幕轨）→ 立刻可 `timeline.render` 出 MP4。不依赖本机 Python / pipx。
- 配了图片模型后，画布上仍可按幕出线稿，再替换时间线静帧。流式笔迹 sidecar 刻意不做，以免换机必挂。

**候选方向**（展示扩展性，不在本期做）：像素风、扁平 MG、黏土定格、赛博国潮、老电影胶片……任何「一套提示词规范 + 一条流水线」都能包成风格包。

### 3.11 流水线引擎

通用能力，模板注册制。内置模板：

| 模板 | 来源 |
| --- | --- |
| 小说转短剧（通用） | 引擎自带：先出角色档案+事件清单（检查点），点卡片对话改，确认后再拆集 |
| 上美影风短剧 | 风格包①绑定 |
| 白板动画 | 风格包②绑定 |
| 爆款复刻 | 复刻模板驱动 |

引擎能力：有向步骤图、检查点（人工确认/可编辑）、单步重跑（下游标记过期）、批量并发控制、状态持久化（页面离开任务照跑）。

### 3.12 任务中心

- 任务类型：`asset.index` / `asset.migrate` / `media.transcode` / `gen.image` / `gen.video` / `gen.tts` / `timeline.render` / `pipeline.step` / `radar.fetch` / `analyze.*` / `push.send` / `whiteboard.render`。
- 内存队列 + SQLite 持久化（重启恢复）；按类型并发上限（ffmpeg 2、生成 4、雷达 1，可配）。
- WS 推送 `job.progress/done/failed`；支持取消与重试；错误详情可展开。

---

## 4. 技术架构

### 4.1 技术选型

| 层 | 选型 | 理由 |
| --- | --- | --- |
| Runtime | **Bun** | 快、内置 SQLite/TS、单二进制可分发 |
| Server | **Hono** | 轻量、Bun 友好、自带 WS |
| DB | **SQLite**（`bun:sqlite`）+ Drizzle | 零部署，schema 迁移可控 |
| 前端 | **React 19 + Vite + TS** | 团队偏好 |
| 画布 | **React Flow** | 受控模型好扩展 |
| 状态 | **Zustand** + **TanStack Query** | 本地态与服务端态分离 |
| UI | **Tailwind + shadcn/ui** | 快速专业 |
| 媒体 | 项目自带 **ffmpeg-static / ffprobe-static** | 换机器不用装；可用 `VW_FFMPEG` 覆盖 |
| 视频下载 | 项目 `vendor/` **独立 yt-dlp 二进制** | 不拷 pipx 包装；`bun install` 按当前系统补全 |
| 热点获取 | **模型中心文本端点（联网搜索）** | 零爬虫合规问题、零 cookie、架构最简 |
| 语音转写 | Whisper API（默认）/ faster-whisper sidecar（可选） | 词级时间戳 |
| Python sidecar | FastAPI 薄壳 + HTTP 调用 | 仅白板渲染、本地转写；主进程不混 Python 依赖 |

### 4.2 Monorepo 结构

```
video_workbench/
├── apps/
│   ├── server/              # Bun + Hono：API、WS、队列、调度
│   └── web/                 # React + Vite
├── packages/
│   ├── core/                # 领域类型、事件定义（前后端共享）
│   ├── models/              # 模型适配器抽象 + 内置适配器（OpenAI兼容/豆包/可灵…）
│   ├── media/               # ffmpeg 封装：探测/转码/缩略图/抽帧/渲染脚本
│   ├── pipeline/            # 流水线引擎 + 通用模板（小说转短剧）
│   ├── radar/               # 雷达：AI 查询源 + 调度 + 打分（接口预留 rss/api 源）
│   ├── push/                # 推送渠道插件（Webhook/Server酱/TG/Bark/邮件）
│   ├── analyze/             # 竞品分析：yt-dlp/抽帧/转写/LLM报告
│   ├── remake/              # 复刻：模板提炼/变量替换/批量装配
│   └── style/               # 风格包契约 + 加载器（内置包资产在 stylePacks/）
├── sidecars/                # 可选 Python 服务（docker-compose 编排）
│   ├── whiteboard/          # 白板动画渲染器
│   └── whisper/             # faster-whisper 转写
├── stylePacks/              # 风格包目录（内置 2 个，用户可自加）
│   ├── smy-animation/       # 上美影风短剧
│   └── whiteboard/          # 手绘白板动画
├── docs/
└── package.json             # bun workspaces
```

依赖方向：`apps → packages`，packages 间单向依赖（`remake → analyze`、`pipeline → models` 等），禁止环。sidecar 独立部署，主进程仅 HTTP 调用，缺席时对应功能优雅降级（转写走 API、白板包提示需启动服务）。

### 4.3 进程与部署

- 主进程：`bun run apps/server` 单进程服务 API + WS + 前端静态产物；默认 `127.0.0.1:4780`。
- sidecar：`docker compose up whiteboard whisper` 按需启动；server 启动时探测健康，功能列表动态呈现。
- 远期桌面化：Tauri 壳内嵌 server，架构不变。

### 4.4 关键数据流

**热点 → 成片**：

```
雷达调度 → 文本端点(联网)取热点 → 入库 → 命中订阅 → 推送(TG/微信)
  → 点深链 → 一键建项目(LLM 出 3 个选题大纲) → 画布/流水线开工
  → 生成产物按 类型/年月/日期_标题 落资产库
```

**竞品分析 → 复刻**：

```
粘贴链接 → analyze 流水线(下载/抽帧/转写/LLM) → 报告页
  → 「转为复刻模板」→ 填变量 → LLM 生成新台词/分镜
  → 批量 gen.* 任务 → 自动装配时间线 → 精修导出
```

---

## 5. 数据模型（SQLite 主要表）

```sql
projects        (id, name, directory, stylePackId?, paletteJson?, coverAssetId, createdAt, updatedAt)
assets          (id, type, path, name, title, source, projectId?, durationMs, width, height,
                 sizeBytes, thumbPath, proxyPath, metaJson, createdAt)
                -- path 为资产库内相对路径；source: import/canvas/pipeline/remake/analyze
asset_tags      (assetId, tag)
canvas_docs     (id, projectId, name, path, updatedAt)
jobs            (id, projectId, type, status, progress, payloadJson, resultJson,
                 error, createdAt, startedAt, finishedAt)
model_endpoints (id, name, adapterType, capability, baseUrl, apiKeyEnc, model,
                 defaultParamsJson, webSearch, enabled, isDefault, createdAt)
model_usage     (id, endpointId, jobId, quantity, unit, costMicros, createdAt)
pipelines       (id, projectId, templateId, status, currentStep, stateJson)
radar_sources   (id, name, kind, queryTemplate, scheduleCron, endpointId?, enabled)
                -- kind: ai-query(默认) | rss | http-api(预留)
radar_items     (id, sourceId, title, url, heat, heatText, summary, fetchedAt, hash)
radar_subs      (id, keyword, platformsJson, heatThreshold, quietHoursJson,
                 channelsJson, enabled, createdAt)
push_channels   (id, type, name, configJson, enabled)
push_logs       (id, subId, channelId, title, status, error, createdAt)
analysis_reports(id, sourceUrl, videoAssetId, title, reportJson, createdAt)
remake_templates(id, analysisId, name, slotsJson, captionStyleJson, variablesJson, createdAt)
remake_runs     (id, templateId, variablesJson, timelineId, status, createdAt)
style_packs     (id, name, version, directory, enabled)
settings        (key, valueJson)   -- 含 libraryRoot(资产库根目录)
```

原则：媒体文件在资产库目录，画布/流水线文档在项目目录，库只存索引与状态；所有 `path` 均为相对路径，目录可整体搬走。

---

## 6. API 概要

| 前缀 | 说明 |
| --- | --- |
| `/api/projects/*` | 项目 CRUD / 打开 |
| `/api/assets/*` · `GET /api/assets/stats` · `POST /api/assets/batch` | 资产查询/导入/重命名/删除/批量/存储统计 |
| `GET /api/assets/:id/file` | 取文件（Range 支持） |
| `/api/canvas/:id` | 画布读写（原子写） |
| `/api/jobs/*` | 任务中心（提交/列表/取消/重试） |
| `/api/models/endpoints/*` · `POST /api/models/endpoints/:id/test` | 模型端点 CRUD 与连通性测试 |
| `/api/models/adapters` · `/api/models/usage` | 适配器清单 / 用量成本 |
| `/api/radar/sources/*` · `POST /api/radar/sources/:id/run` | 雷达源管理/立即执行 |
| `/api/radar/board` · `POST /api/radar/to-project` | 榜单 / 一键建项目 |
| `/api/radar/subs/*` · `/api/push/channels/*` · `/api/push/test` | 订阅与推送渠道 |
| `/api/analyze` · `/api/analyze/:id` | 竞品分析（提交/报告） |
| `/api/remake/templates/*` · `POST /api/remake/run` | 复刻模板与批量变体 |
| `/api/styles` · `POST /api/styles/:id/apply` | 风格包列表 / 应用到项目 |
| `/api/pipelines/*` | 流水线控制（advance / retry-step） |
| `GET/PUT /api/timeline/project/:projectId` · `POST .../from-canvas` · `POST /api/timeline/render` | 时间线读写、从画布装配、导出 |
| `/api/settings` 含 `libraryRoot` 读写与迁移 | 全局设置 |
| `WS /ws` | `job.*` `pipeline.*` `radar.*` `push.*` 事件 |

统一响应 `{ ok, data, error }`；写操作幂等（客户端请求 ID）。

---

## 7. 关键设计决策记录（ADR 摘要）

| # | 决策 | 备选 | 理由 |
| --- | --- | --- | --- |
| 1 | 本地 Web（Bun server + 浏览器） | Electron | 迭代最快；Tauri 壳预留 |
| 2 | **统一资产库**：用户自选目录，类型/年月分类 + 日期_标题命名 | 资产散在项目目录 | 用户明确要求；跨项目复用；目录透明可手动管理 |
| 3 | 项目目录只存项目文件，资产存库内相对路径 | 资产随项目 | 库根目录可换可迁移（相对路径不变，DB 免改） |
| 4 | 统一异步 Job 模型 | 同步调用 | 视频生成分钟级，必须任务化 |
| 5 | 模型「适配器×端点」两层，用户自建端点 | 内置固定厂商列表 | 模型自由；新厂商只需加适配器 |
| 6 | **雷达用 AI 联网查询取热点，不内置爬虫** | MediaCrawler 等爬虫框架 | 零合规风险、零 cookie、零 Python 依赖；代价是热度为估计值（UI 标注），源接口预留扩展口 |
| 7 | Python sidecar 只留白板渲染与本地转写 | 更多 sidecar | 依赖隔离、按需启停、优雅降级 |
| 8 | 复刻用 JSON 槽位模板 + 自有时间线 | 引入 Hypit SVML 体系 | 不照搬；与画布/时间线/任务中心复用最大化 |
| 9 | **风格包文件制 + 注册制，加风格 = 加目录** | 写死在代码里 | 用户明确的扩展要求；本期只内置 2 个包 |
| 10 | 时间线预览用「代理+预览渲染」 | 实时 GPU 渲染 | 复杂度可控，接口预留替换 |
| 11 | 流水线引擎通用化 | 每功能硬编码流程 | 短剧/白板/复刻共用检查点、重跑、批量能力 |

**借鉴但不照搬**：Toonflow 的工作区/画布思路；Hypit 的「模板可重跑、锚定台词、一变体多」思想（不引入 SVML）；上美影的色盘与咒语机制（变为引擎强制注入）；白板动画的分区标注与流式笔迹（渲染器自研为 sidecar）。

---

## 8. MVP 路线图

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M1 骨架 + 资产库**（1.5 周） | monorepo、server+web 打通、项目 CRUD、**统一资产库（选目录/分类存储/命名规范）**、导入+索引、资产管理页基础版（浏览/预览/删除）、任务中心 + WS | 选定资产库目录，导入视频自动按 `video/2026-10/1004_xxx.mp4` 落盘，管理页可见可播 |
| **M2 模型中心 + 画布**（1.5 周） | 适配器×端点（含 webSearch 标记）、OpenAI 兼容适配器、连通性测试；React Flow 画布、资产/文本/文生图节点、链式运行 | 自配文本+图片端点，文本→文生图跑通，产物自动入库 |
| **M3 时间线**（已落地） | 视频/音频/字幕轨、拖拽裁剪、静帧图、SRT、预览、ffmpeg 导出；「从画布装上」零操作成片 | 画布出图一键上时间线，3 段素材加字幕导出 mp4 |
| **M4 雷达 + 推送**（已落地） | AI 查询源 5 个、间隔调度、榜单、关键词订阅、Webhook/Server酱/TG/Bark、每日早报、热点一键建项目 | 配好联网文本端点后刷新出榜；关键词命中推送，点链接做成视频 |
| **M5 竞品分析 + 复刻**（已落地） | 项目自带 yt-dlp、抽帧、LLM 报告、转模板、变量复刻并自动搭画布 | 贴链接或选资产出报告，换成自己的主题开做 |
| **M6 风格中心 + 上美影包**（已落地） | 文件制风格包、中心 UI、上美影 5 集流水线（色盘注入/子风格/尾帧衔接）、白板占位可被发现 | 一句话出 5 集初稿；stylePacks/ 丢新包刷新即见 |
| **M7 白板动画包**（已落地） | 打开白板包、SRT/文案分幕、bundled ffmpeg 纸底静帧、自动写时间线；首页/风格中心可开工 | 贴 SRT 或口播出一条纸底+字幕 MP4，换机器不用装 Python |
| **M8 成本 / 配音 / 便携**（已落地） | 用量记账×单价成本看板、OpenAI 兼容 TTS/转写、时间线字幕配音、资产库搬家、删除引用检查、换机启动脚本 | 模型页能看到花费；字幕一键配音；`./scripts/start.sh` 换机可跑 |
| **M9 引导式首页 + 连载**（已落地） | 小说转短剧独立页（上传/链接）；首页自由创作/复刻一步确认；连载锁风格与人物资产 | 子风格不再挂在首页按钮旁；下一集接到同一部连载 |
| **M10 画布补齐 + 复刻变体 + 资产整理**（已落地） | 文生视频/配音/ffmpeg 节点；可灵与豆包视频适配器；资产标签收藏用途；复刻一变体多并按台词装时间线；短剧拆完先确认再搭画布 | 画布能出视频和配音；分析页一次开多个变体；小说拆集后可确认或重拆 |
| **M11 读帧 / 词级 / 雷达源 / 时间线**（已落地） | 文本端点 vision 读抽帧；Whisper 词级时间戳并按原镜对齐复刻；雷达 RSS/HTTP API；复刻模板 JSON 导出导入；时间线变速与淡入淡出 | 勾选「能看图」后报告标注已看画面；导入 RSS 也能刷新榜；选中片段可改倍速 |
| **M12 小说先建档再拆集**（已落地） | 短剧页去掉点选风格；通读出人物档案和事件清单；点卡片对话+参考图重生成 | 做成连载后先看人、看事件，满意再往下走 |
| **M13 连载中心 / 定妆 / 对比**（已落地） | 侧栏连载页同时盯多部；有图模型时给角色出定妆照；分析页勾两份报告并排对比 | 连载页能接到下一集；档案卡能看到脸；两份爆款能对照钩子和节奏 |

---

## 9. 开放问题

1. 密钥存储：SQLite 对称加密 vs 系统 Keychain（第一版先对称加密 + 回环绑定）。
2. AI 热点的热度呈现：除「AI 估计」标注外，是否让模型同时给出原文热度描述（如"热搜第3"）一并展示？（当前设计：都展示）
3. 白板渲染器：已决定不用 Python sidecar。M7 用项目自带 ffmpeg 出纸底+字幕；有图模型再走画布换线稿。
4. 竞品分析的多模态读帧：已走模型中心 `vision` 标记，用户自选能看图的文本端点。
5. 复刻模板的「词级锚定」精度：第一版 Whisper 词级 + 原镜时长等比；不够再考虑 sidecar。
6. 资产库迁移时大库（几十 GB）的移动策略：后台 Job 断点续传式迁移，还是先只支持小库迁移、大库引导手动搬？
