# OpenKTV

不带房间系统的本地 Web KTV：一个全局曲库、一个全局队列，以及点歌台、大屏播放器和曲库管理三个界面。

完整设计与边界见 [docs/ktv-system-plan.md](docs/ktv-system-plan.md)。

## 快速启动

需要 Node.js 22.13+。

```bash
npm install
npm run build
```

分别启动后端和前端：

```bash
npm run backend
npm start
```

默认地址：

- 点歌台：<http://127.0.0.1:8787/>
- 大屏播放器：<http://127.0.0.1:8787/player>
- 曲库管理：<http://127.0.0.1:8787/admin>
- 后端健康检查：<http://127.0.0.1:8091/api/health>

后端首次启动时会创建 `data/openktv.db` 和一段可播放的系统试音。

## Docker Compose

```bash
docker compose up --build
```

Docker 部署使用 8787 和 8091 端口。`data/` 保存 SQLite 数据库，`media/` 保存歌曲和歌词。

## 导入本地曲库

1. 将媒体文件放入 `media/`。MV 支持 mp4、webm、m4v 和 mov；音频支持 mp3、m4a、wav、ogg 和 flac。
2. 可选：把同名 `.lrc` 歌词放在媒体文件旁边。
3. 推荐使用 `歌手 - 歌名 [MV].mp4` 的命名方式，也可以在媒体文件中写入 title、artist、language 和 genre 标签。
4. 打开 `/admin`，点击“扫描并刮削”。系统会读取内嵌标签、时长、媒体类型和同名歌词；Docker 部署已内置 ffprobe。

例如：

```text
media/
  周杰伦/
    晴天.mp4
    晴天.lrc
```

扫描和刮削只写入曲库索引，不移动或删除原始媒体文件。没有 ffprobe 的本机环境仍可按文件名建立曲库，安装 FFmpeg 后可读取完整内嵌元数据与时长。

## 局域网使用

Docker Compose 已监听所有网卡。手机和电视可以使用运行机器的局域网 IP：

```text
http://192.168.1.20:8787/
http://192.168.1.20:8787/player
```

点歌端会自动连接同一 IP 的 8091 端口。请确保系统防火墙允许局域网访问这两个端口。

## 开发与验证

```bash
npm run dev
npm run backend
npm run test:server
npm run build
```

媒体、歌词和 MV 的使用必须满足相应版权授权。项目不会从第三方音乐平台抓取受保护内容。
