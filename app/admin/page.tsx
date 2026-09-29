"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, AudioLines, Captions, Database, FolderSearch, FolderTree, Globe2, HardDrive, Pencil, Plus, RefreshCw, Target, Trash2, Video, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentLink } from "@/components/document-link";
import { ktvApi, type MediaConverterPluginManifest, type MetadataScraperPluginManifest, type Song, type StemSeparatorPluginManifest } from "@/lib/ktv-api";

const blankForm = { title: "", artist: "", language: "国语", category: "本地曲库", mediaPath: "" };
const blankEditForm = { title: "", artist: "", album: "", releaseYear: "", language: "", category: "", coverUrl: "" };

export default function AdminPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [form, setForm] = useState(blankForm);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [converterPlugins, setConverterPlugins] = useState<MediaConverterPluginManifest[]>([]);
  const [scraperPlugins, setScraperPlugins] = useState<MetadataScraperPluginManifest[]>([]);
  const [selectedScraperId, setSelectedScraperId] = useState("");
  const [stemSeparatorPlugins, setStemSeparatorPlugins] = useState<StemSeparatorPluginManifest[]>([]);
  const [selectedStemSeparatorId, setSelectedStemSeparatorId] = useState("");
  const [generatingScoreId, setGeneratingScoreId] = useState<number | null>(null);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [editForm, setEditForm] = useState(blankEditForm);
  const [organizeAfterSave, setOrganizeAfterSave] = useState(true);
  const load = async () => setSongs((await ktvApi.songs()).songs);
  useEffect(() => {
    let active = true;
    void ktvApi.songs().then((result) => { if (active) setSongs(result.songs); });
    void ktvApi.mediaConverters().then((result) => { if (active) setConverterPlugins(result.plugins); });
    void ktvApi.metadataScrapers().then((result) => {
      if (!active) return;
      setScraperPlugins(result.plugins);
      setSelectedScraperId((current) => current || result.plugins.find((plugin) => plugin.available)?.id || "");
    });
    void ktvApi.stemSeparators().then((result) => { if (active) setStemSeparatorPlugins(result.plugins); });
    return () => { active = false; };
  }, []);

  const scan = async () => {
    setBusy(true);
    try { const result = await ktvApi.scan(); setSongs(result.songs); setNotice(`曲库刷新完成：发现 ${result.scanned} 个媒体文件，新增 ${result.added} 首，刮削 ${result.scraped} 首${result.missing ? `，${result.missing} 首媒体文件已缺失` : ""}`); }
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
      const result = await ktvApi.scrapeOnline({ limit: 10, onlyIncomplete: true, fetchLyrics: true, pluginId: selectedScraperId || undefined });
      setSongs(result.songs);
      setNotice(`在线增强完成：处理 ${result.processed} 首，自动匹配 ${result.matched} 首，待复核 ${result.review} 首，未匹配 ${result.notFound} 首${result.failed ? `，失败 ${result.failed} 首` : ""}${result.sourceWarnings ? `，${result.sourceWarnings} 个数据源请求降级` : ""}${result.remaining ? `，还有 ${result.remaining} 首待处理` : ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "在线增强失败"); }
    finally { setBusy(false); }
  };

  const convertMedia = async () => {
    setBusy(true);
    try {
      const result = await ktvApi.convertMedia();
      setSongs(result.songs);
      const blocked = result.unavailable ? `，${result.unavailable} 个文件缺少可用转换后端` : "";
      const failed = result.failed ? `，失败 ${result.failed} 个` : "";
      setNotice(`格式转换完成：发现 ${result.discovered} 个，转换 ${result.converted} 个，跳过 ${result.skipped} 个${blocked}${failed}；新增曲库 ${result.added} 首`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "媒体格式转换失败"); }
    finally { setBusy(false); }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await ktvApi.createSong(form); setForm(blankForm); await load(); setNotice("歌曲已添加"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "添加失败"); }
    finally { setBusy(false); }
  };

  const remove = async (id: number) => { await ktvApi.deleteSong(id); await load(); setNotice("歌曲已删除"); };

  const openEditor = (song: Song) => {
    setEditingSong(song);
    setEditForm({ title: song.title, artist: song.artist, album: song.album, releaseYear: song.releaseYear, language: song.language, category: song.category, coverUrl: song.coverUrl });
    setOrganizeAfterSave(true);
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingSong) return;
    setBusy(true);
    try {
      const result = await ktvApi.updateSong(editingSong.id, { ...editForm, organize: organizeAfterSave });
      await load();
      setEditingSong(null);
      setNotice(result.organization?.status === "moved" ? `歌曲信息已保存，文件已整理到 ${result.organization.to}` : `歌曲信息已保存${result.organization?.reason ? `；${result.organization.reason}` : ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  };

  const organizeLibrary = async () => {
    setBusy(true);
    try {
      const result = await ktvApi.organizeLibrary();
      setSongs(result.songs);
      setNotice(`曲库整理完成：移动 ${result.moved} 首，跳过 ${result.skipped} 首${result.failed ? `，失败 ${result.failed} 首` : ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "曲库整理失败"); }
    finally { setBusy(false); }
  };

  const generateScore = async (song: Song) => {
    setGeneratingScoreId(song.id);
    try {
      const result = await ktvApi.generateScoring(song.id, { separatorId: selectedStemSeparatorId || undefined, useVocalStem: true });
      await load();
      const analysis = result.profile.analysis;
      const source = analysis?.audioSource === "vocals" ? `人声音轨${analysis.cachedStem ? "（缓存）" : ""}` : "原始音轨";
      const guide = analysis?.guidedByLyrics ? `，QRC 引导 ${analysis.lyricWindows} 个词段` : "";
      setNotice(`《${song.title}》评分谱已生成，共 ${result.profile.notes.length} 个音符；来源：${source}${guide}${analysis?.warning ? `；${analysis.warning}` : ""}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "评分谱生成失败"); }
    finally { setGeneratingScoreId(null); }
  };

  return (
    <main className="admin-page">
      <header className="admin-header"><div><DocumentLink href="/" className="stage-back"><ArrowLeft />返回点歌台</DocumentLink><h1>曲库管理</h1><p>扫描本地媒体目录，维护歌曲元数据和播放资源。</p></div><div className="admin-metric"><Database /><span>{songs.length}</span><small>曲库歌曲</small></div></header>
      {notice && <div className="admin-notice">{notice}</div>}
      <Dialog open={Boolean(editingSong)} onOpenChange={(open) => { if (!open) setEditingSong(null); }}><DialogContent className="border-white/10 bg-[#151822] text-white"><form onSubmit={saveEdit} className="grid gap-4"><DialogHeader><DialogTitle>编辑歌曲信息</DialogTitle><DialogDescription className="text-white/45">手工修改会优先于后续自动刮削。选择整理文件后，媒体、歌词和评分谱会一起移动。</DialogDescription></DialogHeader><div className="grid gap-3"><Input required placeholder="歌名" value={editForm.title} onChange={(event) => setEditForm({ ...editForm, title: event.target.value })} /><Input placeholder="歌手" value={editForm.artist} onChange={(event) => setEditForm({ ...editForm, artist: event.target.value })} /><Input placeholder="专辑" value={editForm.album} onChange={(event) => setEditForm({ ...editForm, album: event.target.value })} /><div className="grid grid-cols-2 gap-2"><Input placeholder="发行年份" value={editForm.releaseYear} onChange={(event) => setEditForm({ ...editForm, releaseYear: event.target.value })} /><Input placeholder="语言" value={editForm.language} onChange={(event) => setEditForm({ ...editForm, language: event.target.value })} /></div><Input placeholder="分类" value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} /><Input placeholder="封面地址" value={editForm.coverUrl} onChange={(event) => setEditForm({ ...editForm, coverUrl: event.target.value })} /><label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={organizeAfterSave} onChange={(event) => setOrganizeAfterSave(event.target.checked)} />保存后按“歌手 / 专辑 / 歌曲”整理文件</label></div><DialogFooter><Button type="button" variant="outline" onClick={() => setEditingSong(null)}>取消</Button><Button type="submit" disabled={busy}>保存修改</Button></DialogFooter></form></DialogContent></Dialog>
      <section className="admin-grid">
        <div className="admin-card scan-card"><div className="admin-card-title"><HardDrive /><div><h2>媒体目录扫描</h2><p>本地标签优先，音频与 MV 均支持可信候选自动匹配</p></div></div><code>/media</code>{converterPlugins.length > 0 && <p className="text-xs text-white/40">转换插件：{converterPlugins.map((plugin) => `${plugin.name} ${plugin.available ? "可用" : `未就绪（${plugin.reason}）`}`).join("；")}</p>}{scraperPlugins.length > 0 && <><label className="text-xs text-white/40" htmlFor="metadata-scraper">刮削插件</label><select id="metadata-scraper" value={selectedScraperId} onChange={(event) => setSelectedScraperId(event.target.value)} className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"><option value="">自动选择</option>{scraperPlugins.map((plugin) => <option key={plugin.id} value={plugin.id} disabled={!plugin.available}>{plugin.name} · {plugin.mediaTypes.map((type) => type === "mv" ? "MV" : "音频").join("/")}{plugin.available ? "" : `（${plugin.reason}）`}</option>)}</select></>}{stemSeparatorPlugins.length > 0 && <><label className="text-xs text-white/40" htmlFor="stem-separator">评分谱人声分离插件</label><select id="stem-separator" value={selectedStemSeparatorId} onChange={(event) => setSelectedStemSeparatorId(event.target.value)} className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"><option value="">自动选择（无可用插件时回退原音轨）</option>{stemSeparatorPlugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.name}{plugin.available ? " · 可用" : ` · 未就绪（${plugin.reason}）`}</option>)}</select></>}<div className="admin-actions"><Button onClick={() => void scan()} disabled={busy} className="bg-fuchsia-500 text-white hover:bg-fuchsia-400">{busy ? <RefreshCw className="animate-spin" /> : <FolderSearch />}刷新曲库</Button><AlertDialog><AlertDialogTrigger asChild><Button disabled={busy} variant="outline"><FolderTree />整理曲库</Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#151822] text-white"><AlertDialogHeader><AlertDialogTitle>按歌手 / 专辑 / 歌曲整理曲库？</AlertDialogTitle><AlertDialogDescription className="text-white/45">媒体文件、同名歌词和评分谱会一起移动到新的目录层级。已有目标文件不会被覆盖，系统试音文件不会移动。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">取消</AlertDialogCancel><AlertDialogAction onClick={() => void organizeLibrary()}>开始整理</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Button onClick={() => void convertMedia()} disabled={busy} variant="outline"><AudioLines />转换加密音乐</Button><Button onClick={() => void scrape()} disabled={busy} variant="outline"><WandSparkles />本地重新刮削</Button><AlertDialog><AlertDialogTrigger asChild><Button disabled={busy || !scraperPlugins.some((plugin) => plugin.available)} variant="outline"><Globe2 />在线智能增强</Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#151822] text-white"><AlertDialogHeader><AlertDialogTitle>使用在线元数据增强？</AlertDialogTitle><AlertDialogDescription className="text-white/45">将最多 10 首音频或 MV 的歌名、歌手、专辑和时长发送给当前选择的刮削插件。智能多源匹配会并行查询多个数据源并统一评分；低置信度结果只标记为待复核，不会覆盖现有信息。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">取消</AlertDialogCancel><AlertDialogAction onClick={() => void scrapeOnline()}>开始在线增强</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>
        <form className="admin-card" onSubmit={create}><div className="admin-card-title"><Plus /><div><h2>手工添加歌曲 / MV</h2><p>自动关联同名 KRC、QRC、TTML、LRC、ASS、SRT/VTT 与评分谱</p></div></div><div className="admin-form"><Input required placeholder="歌名" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /><Input placeholder="歌手" value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} /><div className="grid grid-cols-2 gap-2"><Input placeholder="语言" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} /><Input placeholder="分类" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div><Input placeholder="相对路径，如 周杰伦/晴天.mp4" value={form.mediaPath} onChange={(e) => setForm({ ...form, mediaPath: e.target.value })} /><Button disabled={busy} type="submit" className="w-full">保存到曲库</Button></div></form>
      </section>

      <section className="admin-table-card"><div className="admin-table-head"><div><h2>全部歌曲</h2><p>MV、歌词、评分谱、匹配置信度和来源会在这里标记。</p></div><Button variant="outline" disabled={busy} onClick={() => void scan()}>{busy ? <RefreshCw className="animate-spin" /> : <RefreshCw />}刷新曲库</Button></div><div className="admin-table-wrap"><table><thead><tr><th>歌曲</th><th>语言/分类</th><th>媒体</th><th>歌词</th><th>评分</th><th>刮削状态</th><th>时长</th><th aria-label="操作" /></tr></thead><tbody>{songs.map((song) => <tr key={song.id}><td><strong>{song.title}</strong><span>{song.artist}{song.album ? ` · ${song.album}${song.releaseYear ? ` (${song.releaseYear})` : ""}` : ""}</span></td><td>{song.language}<span>{song.category} · {song.metadataSource === "musicbrainz" ? "MusicBrainz" : song.metadataSource === "embedded" ? "内嵌标签" : song.metadataSource === "filename" ? "文件名" : song.metadataSource === "manual" || song.metadataSource === "manual-edit" ? "手工" : song.metadataSource}</span></td><td>{song.playable ? <span className={`media-ready ${song.mediaType === "mv" ? "media-mv" : ""}`}>{song.mediaType === "mv" ? <Video /> : <AudioLines />}{song.mediaType === "mv" ? "MV" : "音频"}</span> : <span className="media-missing">缺少媒体</span>}</td><td>{song.hasLyrics ? <span className="media-ready"><Captions />{song.lyricFormat?.toUpperCase() || "歌词"}</span> : <span className="media-missing">无歌词</span>}</td><td><div className="score-admin-cell">{song.hasScore ? <span className="media-ready score-ready"><Target />可评分</span> : <span className="media-missing">无评分谱</span>}{song.playable && <button disabled={generatingScoreId !== null} onClick={() => void generateScore(song)}>{generatingScoreId === song.id ? "生成中…" : song.hasScore ? "重新提取" : "自动提取"}</button>}</div></td><td><span title={song.scrapeNote || undefined} className={`scrape-status scrape-${song.scrapeStatus}`}>{song.scrapeStatus === "matched" ? `已匹配 ${Math.round((song.matchScore || 0) * 100)}%` : song.scrapeStatus === "review" ? `待复核 ${Math.round((song.matchScore || 0) * 100)}%` : song.scrapeStatus === "failed" ? "失败" : song.scrapeStatus === "not_found" ? "未找到" : "仅本地"}</span></td><td>{song.durationSeconds ? `${Math.floor(song.durationSeconds / 60)}:${String(song.durationSeconds % 60).padStart(2, "0")}` : "--:--"}</td><td>
        <Button variant="ghost" size="icon" className="text-white/35 hover:bg-white/10 hover:text-white" onClick={() => openEditor(song)}><Pencil /><span className="sr-only">编辑</span></Button>
        <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="text-white/35 hover:bg-red-400/10 hover:text-red-300"><Trash2 /><span className="sr-only">删除</span></Button></AlertDialogTrigger><AlertDialogContent className="border-white/10 bg-[#151822] text-white"><AlertDialogHeader><AlertDialogTitle>删除《{song.title}》？</AlertDialogTitle><AlertDialogDescription className="text-white/45">歌曲会从曲库和点歌队列中移除，媒体文件不会被删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white">取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove(song.id)}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </td></tr>)}</tbody></table></div></section>
    </main>
  );
}
