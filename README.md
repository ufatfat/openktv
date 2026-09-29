# OpenKTV

OpenKTV 是一套面向家庭、工作室和小型聚会的本地 Web KTV。它只有一份全局曲库、一个播放实例和一条全局点歌队列，不包含包厢或房间系统。

系统提供三个独立页面：

- **点歌台** `/`：搜索歌曲、点歌、置顶、调整队列和控制播放。
- **大屏播放器** `/player`：播放本地音频或 MV，并在画面上叠加同步歌词。
- **曲库管理** `/admin`：扫描媒体、维护歌曲、刮削元数据和同步歌词。

完整的产品边界和系统方案见 [docs/ktv-system-plan.md](docs/ktv-system-plan.md)。

## 功能

### 曲库与刮削

- 扫描本地硬盘或 NAS 挂载目录。
- 自动区分音频和 MV。
- 读取媒体内嵌的歌名、歌手、语言、流派和时长。
- 从 `歌手 - 歌名 [MV].mp4` 等文件名补全缺失信息。
- 通过歌词插件自动关联同名 KRC、QRC、TTML、LRC/ELRC、ASS/SSA、SRT 和 WebVTT 文件。
- 使用 MusicBrainz 补充专辑、发行年份和封面地址。
- 使用 LRCLIB 获取同步歌词。
- 根据歌名、歌手、专辑和时长计算匹配置信度。
- 高置信度结果自动应用；可疑结果只标记为“待复核”。

### 点歌与播放

- 按歌名、歌手、语言和分类检索。
- 点歌、置顶、上移、下移和移除。
- 播放、暂停、切歌、静音和音量控制。
- MV 保持原始画面比例，同步歌词叠加显示。
- 播放结束后自动切换下一首。
- 浏览器阻止自动播放时显示手动开始按钮。

### 本地服务

- SQLite 持久化曲库、队列和播放状态。
- WebSocket 在多个控制端之间实时同步。
- 支持 HTTP Range 请求，适合大文件和拖动播放进度。
- 提供健康检查和 Docker Compose 部署。
- 首次启动自动生成一段系统试音，用于验证播放链路。

## 系统架构

```text
手机 / 平板点歌台        电视 / 投影播放器        曲库管理
        │                       │                    │
        └────────── HTTP + WebSocket ──────────────┘
                                │
                         Node.js 本地服务
                         ├── SQLite 曲库
                         ├── 全局点歌队列
                         ├── 播放状态同步
                         ├── 媒体目录扫描
                         ├── 元数据刮削
                         └── 音视频 Range 服务
                                │
                         本地硬盘 / NAS
```

前端使用 React、Vinext 和 Tailwind CSS；后端使用 Node.js 内置 SQLite 与 `ws`，不需要单独安装数据库服务。

## 快速开始

### 方式一：Docker Compose

需要安装 Docker 和 Docker Compose。

```bash
docker compose up --build -d
```

启动后访问：

- 点歌台：<http://127.0.0.1:8787/>
- 大屏播放器：<http://127.0.0.1:8787/player>
- 曲库管理：<http://127.0.0.1:8787/admin>
- 后端健康检查：<http://127.0.0.1:8091/api/health>

Docker 部署会挂载：

```text
./data/   -> SQLite 数据和运行状态
./media/  -> 歌曲、MV 和歌词
```

Docker 镜像已经包含 FFmpeg 和 ffprobe，可读取媒体标签与时长。

常用管理命令：

```bash
docker compose logs -f
docker compose restart
docker compose down
```

`docker compose down` 不会删除宿主机上的 `data/` 和 `media/`。

### 方式二：直接运行

要求：

- Node.js 22.13 或更高版本。
- npm。
- FFmpeg/ffprobe，可选但推荐。

macOS 可以使用 Homebrew 安装 FFmpeg：

```bash
brew install ffmpeg
```

安装依赖并构建前端：

```bash
npm install
npm run build
```

分别启动后端和前端：

```bash
npm run backend
```

另开一个终端：

```bash
npm start
```

源码直接运行时，默认数据位置是：

```text
data/openktv.db
data/media/
```

没有 ffprobe 时仍可以扫描曲库，但只能使用文件名和已有数据，无法可靠读取内嵌标签与媒体时长。

## 导入歌曲和 MV

### 推荐目录结构

Docker 部署把文件放入项目根目录的 `media/`；源码直接运行默认放入 `data/media/`。

```text
media/
├── 周杰伦/
│   └── 叶惠美/
│       ├── 晴天.mp4
│       ├── 晴天.krc
│       └── 晴天.score.json
├── 陈奕迅/
│   └── 黑白灰/
│       └── 十年.mp3
└── Adele/
    └── 25/
        ├── Hello.webm
        └── Hello.lrc
```

曲库采用“歌手 / 专辑 / 歌曲”的三级目录。放入文件后打开 `/admin`，点击“刷新曲库”；系统会从这个目录层级识别歌手和专辑。已有歌曲需要重新读取标签时，可以点击“本地重新刮削”。

每首歌曲右侧的编辑按钮可以修改歌名、歌手、专辑、发行年份、语言、分类和封面地址。保存时可同时把媒体、同名歌词和评分谱移动到上述目录；也可以使用“整理曲库”批量处理全部歌曲。目录名中的非法字符会被清理，已有目标文件不会被覆盖，系统试音文件不会移动。手工编辑的字段优先级高于后续自动刮削，除非明确要求覆盖。

### 支持的文件格式

| 类型 | 格式 |
| --- | --- |
| MV | `.mp4`、`.webm`、`.m4v`、`.mov` |
| 音频 | `.mp3`、`.m4a`、`.wav`、`.ogg`、`.flac` |
| 歌词 | `.krc`、`.qrc`、`.qm.qrc`、`.ttml`、`.dfxp`、`.xml`、`.lrc`、`.elrc`、`.ass`、`.ssa`、`.srt`、`.vtt` |
| 评分谱 | `.score.json`，与媒体文件保持同名 |

文件容器受支持不代表其中的编码一定能被浏览器播放。为了获得最好的电视和浏览器兼容性，建议使用：

- MP4：H.264 视频 + AAC 音频。
- WebM：VP9 视频 + Opus 音频。

### 文件命名

推荐格式：

```text
歌手 - 歌名.ext
歌手 - 歌名 [MV].mp4
```

如果媒体已经包含 `title`、`artist`、`language` 和 `genre` 标签，系统会优先读取内嵌标签。扫描和本地刮削不会移动文件，也不会改写原始音视频文件。

### 同步歌词与插件

将歌词文件放在媒体旁边，并保持主文件名一致：

```text
周杰伦 - 晴天 [MV].mp4
周杰伦 - 晴天 [MV].lrc
```

示例内容：

```lrc
[00:12.30]故事的小黄花
[00:16.80]从出生那年就飘着
```

播放器会根据媒体当前时间高亮对应歌词。

### 音乐格式转换插件

媒体转换系统位于 `server/media-converters/`。管理页面点击“转换加密音乐”后，系统会扫描媒体目录，把转换结果安全地写在原文件旁边，然后自动扫描曲库和刮削元数据。原始文件不会删除。

内置的 `qmcdecode` 插件是纯 Node.js 实现，在 macOS、Windows 和 Linux 使用同一套解码内核：

| 主要输入 | 输出 |
| --- | --- |
| `.qmcflac`、`.qmflac`、`.mflac`、`.mflac0`、`.bkcflac` | `.flac` |
| `.qmc0`、`.qmc3`、`.bkcmp3` | `.mp3` |
| `.qmc2`、`.qmcogg`、`.mgg`、`.mgg0`、`.mgg1`、`.mggl` | `.ogg` |
| `.tkm`、`.mmp4`、`.bkcm4a`、`.bkcwav` 及文件类型十六进制扩展名 | `.m4a`、`.wav`、`.flac`、`.mp3` 或 `.ogg` |

插件按 MIT 许可的 [`Afle520/music-geshizhuanhuan`](https://github.com/Afle520/music-geshizhuanhuan) 重新实现，支持 QMC v1 静态密钥、QMC v2 Map/分段 RC4、两层 EKey、STag、QTag、PcV1Legacy 和 MusicEx 尾包。它不需要启动 QQMusic、不依赖 Windows DLL 或外部可执行文件，也不会一次把整首歌曲载入内存。参考项目许可证保存在 `vendor/music-geshizhuanhuan.LICENSE.md`。

旧版 QMC 和带内嵌 EKey 的 QTag/PcV1Legacy 文件无需配置即可转换。新版 MusicEx 和 STag 文件不携带 EKey，需要通过以下任一方式提供密钥：

```bash
# 推荐：QQ 音乐安卓端 player_process_db，插件会按原文件名、MID 和媒体文件名查找
OPENKTV_QMC_EKEY_DB=/absolute/path/to/player_process_db npm run backend

# 单文件调试：直接提供 EKey。不要把真实密钥提交到仓库
OPENKTV_QMC_EKEY='your-ekey' npm run backend
```

启动后管理页面会显示 `QMC 跨平台转换 可用`，并明确提示外部 EKey 是否已配置。Docker 部署也使用相同内置插件。请只处理自己有权使用的媒体文件。

插件会在发布转换结果前校验 FLAC、MP3、OGG、M4A 或 WAV 文件头。MusicEx/STag 缺少外部 EKey、密钥不匹配或解码结果无效时，插件会报告具体失败原因、删除临时结果并保留原文件，不会把伪音频登记为转换成功。

插件状态与转换接口：

```bash
curl http://127.0.0.1:8091/api/media/converters
curl -X POST http://127.0.0.1:8091/api/media/convert \
  -H 'content-type: application/json' \
  -d '{"overwrite":false}'
```

新增转换插件时，实现 `{ id, name, extensions, outputs, availability, outputPath, convertBatch }` 并在 `server/media-converters/index.mjs` 注册。插件应保留源文件，并通过临时文件加原子重命名发布转换结果。

歌词系统由两类插件组成：

- **格式插件**位于 `server/lyrics/plugins/`，负责识别和解析一种或一组文件格式。
- **显示插件**位于 `plugins/lyrics-display/`，由播放器按接口返回的 `displayPlugin` 动态加载。

所有格式插件都会输出统一的 `lines / segments` 时间模型，因此 KRC、QRC、TTML 和 ASS 的逐字时间可以直接使用传统 KTV 扫字显示；只有行时间的 LRC、SRT 和 WebVTT 会自动按字符均分本行时间。存在多个同名歌词时，默认优先级为 KRC、QRC、TTML、LRC、ASS、SRT/WebVTT。

内置插件：

| 插件 ID | 输入格式 | 时间能力 |
| --- | --- | --- |
| `krc` | 酷狗二进制 `.krc` | 行级、逐字开始及持续时间 |
| `qrc` | QQ 音乐 `.qrc`、`.qm.qrc` | 明文 XML/文本、API 十六进制密文、本地缓存密文；行级与逐字时间 |
| `ttml` | `.ttml`、`.dfxp`、TTML `.xml` | 行级、逐词开始和结束时间 |
| `lrc` | LRC、Enhanced LRC | 行级或 `<mm:ss.xx>` 逐词时间 |
| `ass` | `.ass`、`.ssa` | 行级及 `\\k`、`\\kf`、`\\ko` 卡拉 OK 时间 |
| `subtitle` | `.srt`、`.vtt` | 行级开始和结束时间 |

后端插件清单可以通过以下接口查看：

```bash
curl http://127.0.0.1:8091/api/lyrics/plugins
```

新增格式插件时，实现 `{ id, name, extensions, displayPlugin, parse }` 并在 `server/lyrics/registry.mjs` 注册；新增显示插件时，实现 `LyricsDisplayProps` 组件并在 `plugins/lyrics-display/registry.ts` 注册动态加载器。播放器页面不需要感知具体歌词格式。

QRC 是 QQ 音乐的私有格式。插件会先识别已解密的 `LyricContent` XML 或 QRC 时间轴文本；对于加密文件，会依次尝试 API 十六进制载荷、带二进制包装的载荷和 QQ 音乐 PC 本地 `.qm.qrc` 动态掩码，再执行兼容 3DES 解密与 zlib 解压。解密兼容代码包含 MIT 许可实现，许可文本保存在 `vendor/LRC-GET.LICENSE.md`。

### 演唱评分

评分歌曲需要在媒体旁边放置同名 `.score.json` 标准旋律文件：

```text
周杰伦 - 晴天 [MV].mp4
周杰伦 - 晴天 [MV].score.json
```

评分谱以秒为时间单位，`midi` 使用标准 MIDI 音高编号（中央 C 为 60）：

```json
{
  "version": 1,
  "title": "晴天标准旋律",
  "notes": [
    { "start": 12.3, "end": 12.8, "midi": 64, "lyric": "故", "singer": "a" },
    { "start": 12.8, "end": 13.2, "midi": 66, "lyric": "事", "singer": "b" },
    { "start": 13.2, "end": 14.0, "midi": 69, "lyric": "啊", "singer": "both" }
  ]
}
```

`singer` 可选值为 `a`、`b` 或 `both`，用于标记对唱双方和合唱段落。不填写时按合唱处理。

播放器检测到评分谱后会显示“开启演唱评分”。麦克风音频只在浏览器本地进行音高分析，不会录音或上传；总分由音准 60%、节奏 20%、稳定性 10% 和完整度 10% 组成，并允许男声、女声相差一个或多个八度。评分结束后会把分数和分项结果保存到本地 SQLite，并显示本曲排行榜。局域网中的非 localhost 页面需要 HTTPS 才能使用浏览器麦克风权限。

双人评分需要两个不同的浏览器音频输入设备。播放器分别为歌手 A、歌手 B 选择麦克风并启动两条独立的音高检测链路：A 只按 `a` 和 `both` 音符评分，B 只按 `b` 和 `both` 音符评分；两人的分项、总分、连击和成绩记录完全独立。如果电脑只有一个麦克风输入，双人评分按钮会保持禁用。USB 双麦接收器如果在系统中只暴露为一个混合输入，也不能拆分成两个独立成绩，需要设备或驱动提供两个独立输入端点。

管理页面可以点击“自动提取”。系统会先尝试通过人声分离插件得到 `vocals.wav`，再用 `ffmpeg` 解码；当歌词包含 QRC、KRC 等逐字时间时，每个字词的开始和结束时间会成为音高检测窗口，评分谱中的音符同时写入对应歌词。没有可用分离插件、分离失败或只有行级歌词时会安全回退到原始音轨或普通连续旋律提取，并在评分谱的 `analysis` 字段记录音源、插件、歌词引导和告警。

#### 人声分离插件

后端内置两个可选插件：

| 插件 | 用途 | 就绪条件 |
| --- | --- | --- |
| `demucs` | 跨平台、可无人值守的自动人声分离 | PATH 中存在 `demucs`，或设置 `OPENKTV_DEMUCS_COMMAND` |
| `logic-pro` | 使用 Logic Pro Stem Splitter 的 macOS 本地增强 | Apple Silicon、已安装 Logic Pro，并配置 `OPENKTV_LOGIC_STEM_COMMAND` |

推荐把 Demucs 作为默认自动链路：

```bash
python3 -m venv data/tools/demucs-venv
data/tools/demucs-venv/bin/python -m pip install -U pip demucs soundfile
OPENKTV_DEMUCS_MODEL=htdemucs npm run backend
```

项目会自动发现上述虚拟环境中的 Demucs；也可以使用 `OPENKTV_DEMUCS_COMMAND` 指向其它安装位置。`soundfile` 是 macOS 下写出 WAV 所需的音频后端。

Logic Pro 没有公开的 Stem Splitter CLI 或 AppleScript 接口，因此 OpenKTV 不假设某个固定界面版本。`OPENKTV_LOGIC_STEM_COMMAND` 应指向用户自己的、已授予 macOS 辅助功能权限的桥接可执行文件。插件使用以下稳定参数协议调用它：

```text
your-logic-bridge \
  --input /absolute/source.mp4 \
  --output /absolute/cache-key.vocals.wav \
  --logic-app "/Applications/Logic Pro.app"
```

桥接程序负责打开 Logic、执行已配置的 Stem Splitter 人声预设并把单独的人声音轨导出到 `--output`。退出码必须为 0，且输出必须是非空 WAV。由于该流程依赖前台 GUI、辅助功能权限和 Logic 快捷键，适合本机批量预处理，不适合作为 Docker 或无桌面服务器的主链路。

分离结果缓存在 `STEM_CACHE_DIR`；缓存键包含媒体路径、大小、修改时间和插件 ID，因此修改媒体后会自动重新生成。缓存目录位于曲库之外，不会被“刷新曲库”误识别为新歌曲。

插件状态与评分生成接口：

```bash
curl http://127.0.0.1:8091/api/stem-separators
curl -X POST http://127.0.0.1:8091/api/scoring/1/generate \
  -H 'content-type: application/json' \
  -d '{"separatorId":"demucs","useVocalStem":true}'
```

完整商业混音、现场版、对唱、和声和强混响仍可能选错主旋律，所以自动生成文件始终标记为“建议复核”；可以直接编辑同名 `.score.json` 校准时间、音高和对唱角色。

## 元数据刮削

### 本地刮削顺序

系统按照以下优先级组合歌曲信息：

1. 媒体内嵌标签。
2. 现有曲库数据。
3. 文件名和父目录名称。
4. 同名歌词插件文件。

手工维护的数据不会因为文件名解析而被无条件覆盖。

### 在线智能增强

在线增强是管理页面中的显式操作。确认后，系统会把歌名、歌手、专辑和时长发送给 MusicBrainz 与 LRCLIB：

1. 从 MusicBrainz 获取多个候选结果。
2. 综合比较歌名、歌手、专辑和时长。
3. 高置信度候选自动写入曲库。
4. 中等置信度候选标记为“待复核”。
5. 没有可信候选时保留原有数据。
6. 匹配成功后尝试从 LRCLIB 获取同步歌词。

MV 使用同一套在线增强入口，但会按视频素材做专门处理：

- 读取容器、视频流和音频流中的标题、歌手、专辑、年份、语言与流派标签。
- 查询前自动去除 `Official Music Video`、`MV`、`4K`、`高清`、`官方MV` 等文件名装饰。
- 匹配时降低时长权重，避免 MV 片头、片尾或剧情段落导致正确候选被误判。
- 在线匹配不会用录音室音轨时长覆盖本地 MV 的真实播放时长。
- 匹配成功后仍会尝试下载同步歌词，并保存为 MV 旁边的同名 `.lrc` 文件。

在线歌词会保存为媒体旁边的同名 `.lrc` 文件。系统默认不覆盖已有歌词。每次最多处理 10 首歌曲，并遵守 MusicBrainz 每秒最多一次请求的限制。

建议设置可识别的 MusicBrainz User-Agent：

```bash
export MUSICBRAINZ_USER_AGENT="OpenKTV/0.1 (your-email@example.com)"
```

Docker Compose 可以在 `api.environment` 中加入同名环境变量。

### 元数据刮削插件

在线刮削通过 `server/metadata-scrapers/` 中的插件注册器加载。实现思路参考了 [`xhongc/music-tag-web`](https://github.com/xhongc/music-tag-web) 的多来源查询、统一候选字段和按歌名/歌手/专辑打分模式；OpenKTV 使用独立的 JavaScript 实现，没有复制该 GPL-3.0 项目的代码。

默认插件包括：

| 插件 | 数据源与能力 |
| --- | --- |
| `smart-multi-source` | 并行查询所有可用来源，合并候选并统一排序，单个来源失败不会中断其它来源 |
| `musicbrainz-lrclib` | MusicBrainz 元数据、Cover Art Archive 封面、LRCLIB 同步歌词 |
| `netease` | 网易云音乐元数据、封面与同步歌词 |
| `qqmusic` | QQ 音乐元数据、封面与 QRC 逐字歌词；不可用时降级为 LRC |
| `migu` | 咪咕音乐元数据、封面与同步歌词 |
| `acoustid` | 使用 Chromaprint 音频指纹识别缺少可靠文件名或标签的媒体，再通过 MusicBrainz/LRCLIB 补全信息 |

所有默认插件均支持音频与 MV。管理页面可以选择指定来源；默认使用“智能多源匹配”。

咪咕公开搜索端点目前会在部分网络环境返回网页而不是 JSON，因此插件默认禁用，不影响其它来源。确认所在网络仍可访问该接口后，可以设置 `OPENKTV_ENABLE_MIGU=1` 强制启用；智能多源插件会隔离单个数据源的失败。

AcoustID 插件默认处于未就绪状态。启用它需要安装包含 `fpcalc` 的 Chromaprint，并设置自己的 API Key：

```bash
brew install chromaprint
export ACOUSTID_API_KEY="your-acoustid-client-key"
```

插件清单接口：

```bash
curl http://127.0.0.1:8091/api/metadata/scrapers
```

新增插件时，实现 `{ id, name, providers, mediaTypes, capabilities, availability, scrape }`，并在 `server/metadata-scrapers/index.mjs` 注册。`mediaTypes` 可以声明 `audio`、`mv` 或两者；`scrape` 返回现有的 `matched / review / not_found` 结果模型。在线增强接口可以通过 `pluginId` 明确选择插件，未指定时使用第一个支持当前媒体类型的可用插件。

## 局域网使用

Docker Compose 默认监听所有网卡。假设部署机器的局域网地址为 `192.168.1.20`：

```text
手机点歌：http://192.168.1.20:8787/
电视播放：http://192.168.1.20:8787/player
曲库管理：http://192.168.1.20:8787/admin
```

前端会自动连接同一主机的 `8091` 端口。需要确保系统防火墙允许局域网访问 TCP 8787 和 8091。

典型使用方式：

1. 在电视或投影仪上打开 `/player`。
2. 在手机和平板上打开 `/`。
3. 任意控制端点歌或调整队列。
4. 大屏播放器实时接收状态并播放下一首。

## 配置

后端支持以下环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 后端监听地址 |
| `PORT` | `8091` | 后端端口 |
| `DB_PATH` | `./data/openktv.db` | SQLite 数据库路径 |
| `MEDIA_DIR` | `./data/media` | 媒体目录 |
| `STEM_CACHE_DIR` | `./data/stems` | 分离后人声音轨缓存目录，应位于媒体目录之外 |
| `OPENKTV_DEMUCS_COMMAND` | `demucs` | Demucs 可执行文件 |
| `OPENKTV_DEMUCS_MODEL` | `htdemucs` | Demucs 模型名称 |
| `OPENKTV_LOGIC_APP` | `/Applications/Logic Pro.app` | Logic Pro 应用路径 |
| `OPENKTV_LOGIC_STEM_COMMAND` | 空 | Logic Pro GUI 自动化桥接程序路径 |
| `MUSICBRAINZ_USER_AGENT` | OpenKTV 默认标识 | MusicBrainz 请求标识，建议显式配置 |

浏览器默认连接当前页面主机的 `8091` 端口。

## 开发

启动后端：

```bash
npm run backend
```

启动前端开发服务器：

```bash
npm run dev
```

运行后端测试：

```bash
npm run test:server
```

生成生产构建：

```bash
npm run build
```

验证 Docker Compose 配置：

```bash
docker compose config -q
```

## 项目结构

```text
项目根目录/
├── app/                  # 点歌台、大屏播放器、曲库管理页面
├── hooks/                # 前端状态与 WebSocket 同步
├── lib/                  # 前端 API 客户端
├── plugins/lyrics-display/ # 可动态加载的歌词显示插件
├── server/lyrics/        # 歌词格式插件、注册器与统一解析模型
├── server/media-converters/ # 音乐格式转换插件与注册器
├── server/stem-separators/ # Demucs 与 Logic Pro 人声分离插件
├── server/               # Node.js API、SQLite、媒体服务和刮削器
├── data/                 # 本地运行数据，默认不提交
├── docs/                 # 系统方案
├── compose.yaml          # Docker Compose 部署
└── Dockerfile            # 前后端共用镜像
```

## 健康检查与验收

检查后端：

```bash
curl http://127.0.0.1:8091/api/health
```

正常响应类似：

```json
{"status":"ok","service":"openktv","time":"2026-09-28T02:00:00.000Z"}
```

播放大屏 `/player` 是纯输出端，不提供任何操作控件。有歌词文件时只在媒体上叠加同步歌词；没有歌词文件时不渲染歌词层，只播放媒体。播放、音量、切歌和其它操作统一在点歌台完成。若浏览器阻止带声音的自动播放，首次点击或按键只用于解除浏览器限制，页面不会显示按钮或提示层。

建议按照以下顺序验收：

1. 打开三个页面，确认后端显示已连接。
2. 播放系统试音。
3. 将一首带同名歌词文件的 MV 放入媒体目录。
4. 在曲库管理执行扫描。
5. 在点歌台搜索并加入队列。
6. 确认大屏播放 MV 且歌词同步显示。
7. 用两个浏览器窗口修改队列，确认状态实时一致。
8. 重启服务，确认曲库、队列和播放设置仍然存在。

## 常见问题

### 页面显示“等待后端”

确认后端已经启动，并检查：

```bash
curl http://127.0.0.1:8091/api/health
```

局域网使用时还要确认 8091 端口没有被防火墙拦截。

### 扫描后没有歌曲

- 确认文件位于正确的媒体目录。
- Docker 部署检查 `./media:/media` 挂载。
- 确认扩展名属于支持列表。
- 查看后端日志是否存在目录权限问题。

### 歌曲存在但显示“缺少媒体”

数据库中可能只有歌曲信息，没有关联实际媒体文件。把文件放入媒体目录后重新执行扫描。

### 能看到 MV 但无法播放

通常是浏览器不支持文件内部的音视频编码。优先转码为 H.264/AAC MP4 或 VP9/Opus WebM。

### 无法自动播放

浏览器可能禁止未经过用户交互的有声播放。点击大屏页面上的“点击开始播放”即可。

### 在线刮削失败

- 检查部署机器能否访问 MusicBrainz 和 LRCLIB。
- 配置有效的 `MUSICBRAINZ_USER_AGENT`。
- 稍后重试，避免连续重复提交。
- 失败不会删除或覆盖现有曲库信息。

## 数据与版权

- SQLite 数据库和媒体文件全部保存在本地部署环境。
- 只有主动确认“在线智能增强”时，歌曲查询字段才会发送给外部元数据服务。
- OpenKTV 不提供歌曲、MV 或伴奏内容。
- 使用者需要自行确认歌曲、MV、封面和歌词的存储、播放及展示授权。
- 在线元数据和歌词可能存在错误，正式使用前应检查“待复核”记录。

## 当前边界

OpenKTV 当前不包含：

- 房间、包厢或多播放实例。
- 用户注册、会员、支付和社交关系。
- 门店、POS、酒水和服务员呼叫。
- 专业麦克风低延迟混音、啸叫抑制和演唱评分。
- 未经授权的在线商业曲库下载。

专业麦克风链路建议交给声卡、调音台或后续原生播放代理。Web 层负责曲库、点歌、播放和状态同步。
