"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, AudioLines, Captions, Database, FolderSearch, Globe2, HardDrive, Plus, RefreshCw, Trash2, Video, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ktvApi, type Song } from "@/lib/ktv-api";

const blankForm = { title: "", artist: "", language: "国语", category: "本地曲库", mediaPath: "" };

export default function AdminPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [form, setForm] = useState(blankForm);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => setSongs((await ktvApi.songs()).songs);
  useEffect(() => { void load(); }, []);

  const scan = async () => {
    setBusy(true);
    try { const result = await ktvApi.scan(); setSongs(result.songs); setNotice(`扫描完成：发现 ${result.scanned} 个媒体文件，新增 ${result.added} 首，刮削 ${result.scraped} 首`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "扫描失败"); }
    finally { setBusy(false); }
  };

  const scrape = async () => {
    setBusy(true);
    try { const result = await ktvApi.scrape(); setSongs(result.songs); setNotice(`元数据刮削完成：已更新 ${result.updated} 首歌曲`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "刮削失败"); }
    finally { setBusy(false); }
  };

  const scrapeOnline = async () => {
    setBusy(true);
    try {
      const result = await ktvApi.scrapeOnline({ limit: 10, onlyIncomplete: true, fetchLyrics: true });
      setSongs(result.songs);
      setNotice(`在线增强完成：处理 ${result.processed} 首，自动匹配 ${result.matched} 首，待复核 ${result.review} 首，未匹配 ${result.notFound} 首${result.failed ? `，失败 ${result.failed} 首` : ""}${result.remaining ? `，还有 ${result.remaining} 首待处理` : ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "在线增强失败"); }
    finally { setBusy(false); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await ktvApi.createSong(form); setForm(blankForm); await load(); setNotice("歌曲已添加"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "添加失败"); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => { await ktvApi.deleteSong(id); await load(); setNotice("歌曲已删除"); };

  return (
    <main className="admin-page">
      <header className="admin-header"><div><a href="/" className="stage-back"><ArrowLeft />返回点歌台</a><h1>曲库管理</h1><p>扫描本地媒体目录，维护歌曲元数据和播放资源。</p></div><div className="admin-metric"><Database /><span>{songs.length}</span><small>曲库歌曲</small></div></header>
      {notice && <div className="admin-notice">{notice}</div>}
      <section className="admin-grid">
        <div className="admin-card scan-card"><div className="admin-card-title"><HardDrive /><div><h2>媒体目录扫描</h2><p>本地标签优先，支持可信候选自动匹配</p></div></div><code>/media</code><div className="admin-actions"><Button onClick={() => void scan()} disabled={busy} className="bg-fuchsia-500 text-white hover:bg-fuchsia-400">{busy ? <RefreshCw className="animate-spin" /> : <FolderSearch />}扫描并刮削</Button><Button onClick={() => void scrape()} disabled={busy} variant="outline"><WandSparkles />本地重新刮削</Button><AlertDialog><AlertDialogTrigger asChild><Button disabled={busy} variant="outline"><Globe2 />在线智能增强</Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#151822] text-white"><AlertDialogHeader><AlertDialogTitle>使用在线元数据增强？</AlertDialogTitle><AlertDialogDescription className="text-white/45">将最多 10 首歌曲的歌名、歌手、专辑和时长发送给 MusicBrainz 与 LRCLIB，用于匹配专辑、年份、封面地址和同步歌词。低置信度结果只标记为待复核，不会覆盖现有信息。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">取消</AlertDialogCancel><AlertDialogAction onClick={() => void scrapeOnline()}>开始在线增强</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>
        <form className="admin-card" onSubmit={create}><div className="admin-card-title"><Plus /><div><h2>手工添加歌曲 / MV</h2><p>视频文件自动识别为 MV；同名 .lrc 会自动关联</p></div></div><div className="admin-form"><Input required placeholder="歌名" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><Input placeholder="歌手" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} /><div className="grid grid-cols-2 gap-2"><Input placeholder="语言" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} /><Input placeholder="分类" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div><Input placeholder="相对路径，如 周杰伦/晴天.mp4" value={form.mediaPath} onChange={(e) => setForm({ ...form, mediaPath: e.target.value })} /><Button disabled={busy} type="submit" className="w-full">保存到曲库</Button></div></form>
      </section>

      <section className="admin-table-card"><div className="admin-table-head"><div><h2>全部歌曲</h2><p>MV、歌词、匹配置信度和来源会在这里标记。</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw />刷新</Button></div><div className="admin-table-wrap"><table><thead><tr><th>歌曲</th><th>语言/分类</th><th>媒体</th><th>歌词</th><th>刮削状态</th><th>时长</th><th aria-label="操作" /></tr></thead><tbody>{songs.map((song) => <tr key={song.id}><td><strong>{song.title}</strong><span>{song.artist}{song.album ? ` · ${song.album}${song.releaseYear ? ` (${song.releaseYear})` : ""}` : ""}</span></td><td>{song.language}<span>{song.category} · {song.metadataSource === "musicbrainz" ? "MusicBrainz" : song.metadataSource === "embedded" ? "内嵌标签" : song.metadataSource === "filename" ? "文件名" : "手工"}</span></td><td>{song.playable ? <span className={`media-ready ${song.mediaType === "mv" ? "media-mv" : ""}`}>{song.mediaType === "mv" ? <Video /> : <AudioLines />}{song.mediaType === "mv" ? "MV" : "音频"}</span> : <span className="media-missing">缺少媒体</span>}</td><td>{song.hasLyrics ? <span className="media-ready"><Captions />LRC</span> : <span className="media-missing">无歌词</span>}</td><td><span title={song.scrapeNote || undefined} className={`scrape-status scrape-${song.scrapeStatus}`}>{song.scrapeStatus === "matched" ? `已匹配 ${Math.round((song.matchScore || 0) * 100)}%` : song.scrapeStatus === "review" ? `待复核 ${Math.round((song.matchScore || 0) * 100)}%` : song.scrapeStatus === "failed" ? "失败" : song.scrapeStatus === "not_found" ? "未找到" : "仅本地"}</span></td><td>{song.durationSeconds ? `${Math.floor(song.durationSeconds / 60)}:${String(song.durationSeconds % 60).padStart(2, "0")}` : "--:--"}</td><td>
        <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-white/35 hover:bg-red-400/10 hover:text-red-300"><Trash2 /><span className="sr-only">删除</span></Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#151822] text-white"><AlertDialogHeader><AlertDialogTitle>删除《{song.title}》？</AlertDialogTitle><AlertDialogDescription className="text-white/45">歌曲会从曲库和点歌队列中移除，媒体文件不会被删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove(song.id)}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </td></tr>)}</tbody></table></div></section>
    </main>
  );
}
