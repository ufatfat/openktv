"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Database, FolderSearch, HardDrive, Plus, RefreshCw, Trash2 } from "lucide-react";
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
    try { const result = await ktvApi.scan(); setSongs(result.songs); setNotice(`扫描完成：发现 ${result.scanned} 个媒体文件，新增 ${result.added} 首`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "扫描失败"); }
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
      <header className="admin-header"><div><Link href="/" className="stage-back"><ArrowLeft />返回点歌台</Link><h1>曲库管理</h1><p>扫描本地媒体目录，维护歌曲元数据和播放资源。</p></div><div className="admin-metric"><Database /><span>{songs.length}</span><small>曲库歌曲</small></div></header>
      {notice && <div className="admin-notice">{notice}</div>}
      <section className="admin-grid">
        <div className="admin-card scan-card"><div className="admin-card-title"><HardDrive /><div><h2>媒体目录扫描</h2><p>识别音视频文件及同名 LRC 歌词</p></div></div><code>/media</code><Button onClick={() => void scan()} disabled={busy} className="w-full bg-fuchsia-500 text-white hover:bg-fuchsia-400">{busy ? <RefreshCw className="animate-spin" /> : <FolderSearch />}立即扫描</Button></div>
        <form className="admin-card" onSubmit={create}><div className="admin-card-title"><Plus /><div><h2>手工添加</h2><p>媒体路径必须位于媒体目录内</p></div></div><div className="admin-form"><Input required placeholder="歌名" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><Input placeholder="歌手" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} /><div className="grid grid-cols-2 gap-2"><Input placeholder="语言" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} /><Input placeholder="分类" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div><Input placeholder="相对路径，如 周杰伦/晴天.mp4" value={form.mediaPath} onChange={(e) => setForm({ ...form, mediaPath: e.target.value })} /><Button disabled={busy} type="submit" className="w-full">保存歌曲</Button></div></form>
      </section>

      <section className="admin-table-card"><div className="admin-table-head"><div><h2>全部歌曲</h2><p>缺少媒体的条目仍可点歌，但播放端会提示不可播放。</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw />刷新</Button></div><div className="admin-table-wrap"><table><thead><tr><th>歌曲</th><th>语言/分类</th><th>资源</th><th>时长</th><th aria-label="操作" /></tr></thead><tbody>{songs.map((song) => <tr key={song.id}><td><strong>{song.title}</strong><span>{song.artist}</span></td><td>{song.language}<span>{song.category}</span></td><td>{song.playable ? <span className="media-ready">可播放</span> : <span className="media-missing">缺少媒体</span>}</td><td>{song.durationSeconds ? `${Math.floor(song.durationSeconds / 60)}:${String(song.durationSeconds % 60).padStart(2, "0")}` : "--:--"}</td><td>
        <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-white/35 hover:bg-red-400/10 hover:text-red-300"><Trash2 /><span className="sr-only">删除</span></Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#151822] text-white"><AlertDialogHeader><AlertDialogTitle>删除《{song.title}》？</AlertDialogTitle><AlertDialogDescription className="text-white/45">歌曲会从曲库和点歌队列中移除，媒体文件不会被删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove(song.id)}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </td></tr>)}</tbody></table></div></section>
    </main>
  );
}
