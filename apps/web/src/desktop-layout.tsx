import { useEffect, useState, type ReactNode } from "react";
import { checkAllSearchChannels, checkSearchChannel, createSearchChannel, deleteSearchChannel, getSettings, importSearchChannels, listPan115Folders, listSearchChannels, reorderSearchChannels, saveDefaultTargetQuality, savePan115Credential, saveProxySettings, saveResourceSourceSettings, saveStorageCategoryMapping, testBtbtlaConnection, testPan115Credential, testProxyConnection, updateSearchChannel, type CleanupCandidatePreview, type DiscoverCard, type DiscoverSection, type MediaMetadata, type Pan115Folder, type ProxySettings, type SearchChannel, type Settings as ApiSettings, type SubscriptionAction, type SubscriptionActivity, type SubscriptionSummary } from "./api.js";
import "./desktop.css";

export type DesktopPage = "discover" | "media" | "subscription" | "following" | "history" | "issues" | "cleanup" | "settings";

export interface DesktopLayoutProps {
  page: DesktopPage;
  onNavigate: (page: DesktopPage) => void;
  selectedMedia: MediaMetadata | null;
  searchResults: readonly MediaMetadata[];
  searchMessage: string | null;
  discoverSections: readonly DiscoverSection[];
  discoverState: "loading" | "ready" | "error";
  subscriptionsByMedia: Readonly<Record<string, SubscriptionSummary>>;
  subscriptions: readonly SubscriptionSummary[];
  cleanupCandidates: readonly CleanupCandidatePreview[];
  onConfirmCleanup: (id: string) => void;
  onConfirmAllCleanup: () => void;
  cleanupActionBusy: boolean;
  onOpenSubscription: (id: string) => void;
  onCardSubscriptionAction: (subscription: SubscriptionSummary, action: SubscriptionAction) => void;
  onSearch: (query: string) => void;
  onSelectMedia: (id: string) => void;
  subscription: SubscriptionSummary | null;
  subscriptionActivities: readonly SubscriptionActivity[];
  onFollow: () => void;
  onSubscriptionAction: (action: SubscriptionAction) => void;
  onReleaseRequested: () => void;
  subscriptionActionBusy: boolean;
  toast: string | null;
}


const categories = ["国产剧", "美剧", "日韩剧", "电视剧", "综艺", "动漫", "纪录片", "电影"];

function Button({ children, danger, disabled, onClick }: { children: ReactNode; danger?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" className={`desktop-button${danger ? " desktop-button--danger" : ""}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

function Poster({ title, tone = "blue" }: { title: string; tone?: string }) {
  return <div className={`desktop-poster desktop-poster--${tone}`} aria-label={`${title} 海报`} role="img"><span>{title}</span></div>;
}

function DesktopHeader({ page, onNavigate, onSearch }: DesktopLayoutProps) {
  const [query, setQuery] = useState("");
  const active = page === "discover" || page === "media" ? "discover" : ["following", "history", "issues", "cleanup", "subscription"].includes(page) ? "following" : "settings";
  return <header className="desktop-header">
    <div className="desktop-header__inner">
      <button className="desktop-brand" onClick={() => onNavigate("discover")} aria-label="115追剧首页"><b>115</b><strong>115追剧</strong></button>
      <nav aria-label="主导航"><button className={active === "discover" ? "is-active" : ""} onClick={() => onNavigate("discover")}>发现</button><button className={active === "following" ? "is-active" : ""} onClick={() => onNavigate("following")}>追剧</button><button className={active === "settings" ? "is-active" : ""} onClick={() => onNavigate("settings")}>设置</button></nav>
      <form className="desktop-header__search" onSubmit={(event) => { event.preventDefault(); onSearch(query); onNavigate("discover"); }}><span>搜索</span><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索影视" placeholder="搜索影视…" /></form>
      <span className="desktop-avatar" aria-label="当前用户" />
    </div>
  </header>;
}

function stateLabel(subscription: SubscriptionSummary): string { return subscription.runStatus === "checking" ? "检查中" : subscription.runStatus === "backfilling" ? "补集中" : subscription.runStatus === "exception" ? "异常" : subscription.runStatus === "released" ? "已释放" : subscription.subscriptionStatus === "paused" ? "已暂停" : subscription.subscriptionStatus === "stopped" ? "已停追" : "等待更新"; }
function qualityLabel(quality: SubscriptionSummary["targetQuality"]): string { return quality === "2160p" ? "4K / 2160P" : quality === "1080p" ? "1080P" : "--"; }
function checkedLabel(value: SubscriptionSummary["lastCheckedAt"]): string {
  if (!value) return "最近检查：--";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "最近检查：--";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  return minutes < 1 ? "最近检查：刚刚" : minutes < 60 ? `最近检查：${minutes} 分钟前` : minutes < 1_440 ? `最近检查：${Math.floor(minutes / 60)} 小时前` : `最近检查：${Math.floor(minutes / 1_440)} 天前`;
}
function changedLabel(value: SubscriptionSummary["updatedAt"]): string { return checkedLabel(value ?? null).replace("最近检查", "最近变更"); }
function WatchCard({ subscription, onOpen, onAction, busy }: { subscription: SubscriptionSummary; onOpen: (id: string) => void; onAction: (subscription: SubscriptionSummary, action: SubscriptionAction) => void; busy: boolean }) {
  const latest = subscription.latestEpisode ?? subscription.resolvedLatestEpisode;
  const owned = subscription.existingEpisodeCount === undefined || subscription.existingEpisodeCount === null ? "--" : `${subscription.existingEpisodeCount} / ${latest || "--"}`;
  const missing = subscription.missingEpisodeKeys.length ? subscription.missingEpisodeKeys.join("、") : "无";
  return <article className="desktop-watch-card"><Poster title={subscription.title} tone={subscription.runStatus === "exception" ? "red" : subscription.runStatus === "backfilling" ? "violet" : "blue"} /><div className="desktop-watch-card__identity"><h2>{subscription.title}</h2><p>当前季：Season {String(subscription.seasonNumber).padStart(2, "0")}</p><div className="desktop-watch-card__facts"><b>最新集：E{latest || "--"}</b><em>115 已有：{owned}</em><strong className={missing === "无" ? "" : "is-missing"}>缺失集：{missing}</strong><b>目标画质：{qualityLabel(subscription.targetQuality)}</b></div><small>115：{subscription.targetSeasonPath || "--"}</small></div><div className="desktop-watch-card__state"><span className="desktop-state desktop-state--blue">{stateLabel(subscription)}</span><small>{checkedLabel(subscription.lastCheckedAt)}</small></div><div className="desktop-watch-card__actions"><Button onClick={() => onOpen(subscription.id)}>查看详情</Button><Button disabled={busy} onClick={() => onAction(subscription, "upgradeQuality")}>升级画质</Button><Button disabled={busy} onClick={() => onAction(subscription, subscription.subscriptionStatus === "paused" ? "resume" : "pause")}>{subscription.subscriptionStatus === "paused" ? "恢复追更" : "暂停追更"}</Button><Button danger disabled={busy} onClick={() => onAction(subscription, "stop")}>停追</Button>{subscription.runStatus === "released" ? <span>已释放</span> : <Button danger disabled={busy} onClick={() => { if (window.confirm(releaseConfirmation)) onAction(subscription, "release"); }}>{busy ? "释放中…" : "释放空间"}</Button>}</div></article>;
}

function Following({ page, onNavigate, subscriptions, cleanupCandidates, onOpenSubscription, onCardSubscriptionAction, subscriptionActionBusy }: DesktopLayoutProps) {
  const [historyFilter, setHistoryFilter] = useState<"全部" | "已完成剧集" | "已完成电影" | "已停追">("全部");
  const active = subscriptions.filter((item) => item.subscriptionStatus !== "stopped" && item.lifecycleStatus === "active");
  const history = subscriptions.filter((item) => item.subscriptionStatus === "stopped" || item.lifecycleStatus === "completed");
  const historyEntries = historyFilter === "全部" ? history : historyFilter === "已完成剧集" ? history.filter((item) => item.lifecycleStatus === "completed" && item.mediaType !== "movie") : historyFilter === "已完成电影" ? history.filter((item) => item.lifecycleStatus === "completed" && item.mediaType === "movie") : history.filter((item) => item.subscriptionStatus === "stopped");
  if (page === "history") return <section className="desktop-page"><h1>历史</h1><div className="desktop-filter">{(["全部", "已完成剧集", "已完成电影", "已停追"] as const).map((filter) => <button key={filter} className={historyFilter === filter ? "is-selected" : ""} onClick={() => setHistoryFilter(filter)}>{filter}</button>)}</div><div className="desktop-history-list">{historyEntries.length ? historyEntries.map((item) => <article key={item.id}><Poster title={item.title} /><div><h2>{item.title}</h2><p>{item.year ?? "--"} · {item.mediaType === "movie" ? "电影" : `Season ${String(item.seasonNumber).padStart(2, "0")}`}</p><em>{item.runStatus === "released" || item.hasStoredFiles === false ? "已释放" : "115 已保留"} · {item.lifecycleStatus === "completed" ? item.mediaType === "movie" ? "电影已保存" : "剧集已完成" : "已停追"}</em><small>{changedLabel(item.updatedAt)}</small></div><div><Button onClick={() => onOpenSubscription(item.id)}>查看详情</Button><Button disabled={subscriptionActionBusy} onClick={() => onCardSubscriptionAction(item, "refollow")}>{item.mediaType === "movie" && item.lifecycleStatus === "completed" ? "重新获取" : item.lifecycleStatus === "completed" ? "重新检查" : "重新追"}</Button></div></article>) : <p>暂无历史追剧。</p>}</div></section>;
  return <section className="desktop-page"><h1>我的追剧</h1><div className="desktop-stat-row"><button><span>追更中</span><b>{active.filter((item) => item.subscriptionStatus === "following").length}</b></button><button onClick={() => onNavigate("issues")}><span>异常</span><b className="is-red">{subscriptions.filter((item) => item.runStatus === "exception").length}</b></button><button onClick={() => onNavigate("cleanup")}><span>待清理</span><b className="is-orange">{cleanupCandidates.length}</b></button></div><div className="desktop-switch"><button className="is-selected">当前追剧</button><button onClick={() => onNavigate("history")}>历史</button><small>按最新订阅排序</small></div><div className="desktop-watch-list">{active.length ? active.map((item) => <WatchCard key={item.id} subscription={item} onOpen={onOpenSubscription} onAction={onCardSubscriptionAction} busy={subscriptionActionBusy} />) : <p>还没有追剧，去发现页添加一部吧。</p>}</div></section>;
}

function recommendation(media: Pick<DiscoverCard, "rating">): string { return media.rating === null ? "待评分" : media.rating >= 8.5 ? "神作" : media.rating >= 7.5 ? "推荐" : media.rating >= 6.5 ? "可看" : "一般"; }
function subscriptionLabel(media: Pick<DiscoverCard, "mediaType">, subscription: SubscriptionSummary | undefined): string | null {
  if (!subscription) return null;
  if (media.mediaType === "movie" && subscription.lifecycleStatus === "completed") return "已保存";
  if (subscription.subscriptionStatus === "paused") return "已暂停";
  if (subscription.subscriptionStatus === "stopped") return "已停追";
  return "✓ 已追";
}
function cardMeta(media: Pick<DiscoverCard, "year" | "mediaType" | "genres" | "cardSubtitle">): string {
  if (media.cardSubtitle) return media.cardSubtitle;
  return `${media.year || "--"} · ${media.mediaType === "movie" ? "电影" : media.genres.join(" / ") || "电视剧"}`;
}
function cardProgress(media: Pick<DiscoverCard, "episodesInfo" | "latestEpisode" | "totalEpisodes">): string | null {
  if (media.episodesInfo) return media.episodesInfo;
  if (media.latestEpisode === null) return null;
  return `更新至 ${media.latestEpisode}${media.totalEpisodes === null ? " 集" : ` / ${media.totalEpisodes} 集`}`;
}

function Discover({ onNavigate, onSearch, onSelectMedia, searchResults, searchMessage, discoverSections, discoverState, subscriptionsByMedia }: DesktopLayoutProps) {
  const [query, setQuery] = useState("");
  const select = (id: string) => { onSelectMedia(id); onNavigate("media"); };
  const hasSearch = searchMessage !== null || searchResults.length > 0;
  const cards = (items: readonly DiscoverCard[]) => <div className="desktop-hot-grid">{items.slice(0, 9).map((media, index) => <button className="desktop-hot-card" key={media.id} onClick={() => select(media.id)}><Poster title={media.title} tone={["blue", "violet", "red", "gray"][index % 4]!} /><b>{media.title}</b><small>{cardMeta(media)}</small>{cardProgress(media) && <small>{cardProgress(media)}</small>}<em>{recommendation(media)}</em>{subscriptionLabel(media, subscriptionsByMedia[media.id]) && <i>{subscriptionLabel(media, subscriptionsByMedia[media.id])}</i>}</button>)}</div>;
  return <section className="desktop-page desktop-discover"><div className="desktop-discover__intro"><h1>发现想看的内容</h1><p>搜索电影、电视剧、综艺和动漫。</p><form onSubmit={(event) => { event.preventDefault(); onSearch(query); }}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索电影、电视剧、综艺、动漫…" aria-label="发现页搜索" /><Button>搜索</Button></form></div>{hasSearch ? <section className="desktop-hot-section"><div><h2>搜索结果</h2></div>{searchMessage ? <p>{searchMessage}</p> : cards(searchResults)}</section> : discoverState === "loading" ? <p aria-live="polite">正在加载热门影视…</p> : discoverState === "error" ? <p role="alert">热门内容暂时不可用，请稍后重试。</p> : discoverSections.length === 0 ? <p>暂无热门影视</p> : discoverSections.map((section) => <section className="desktop-hot-section" key={section.key}><div><h2>{section.title}</h2><button type="button">更多</button></div>{section.items.length === 0 ? <p>暂无热门影视</p> : cards(section.items)}</section>)}</section>;
}

function Issues({ page, subscriptions, cleanupCandidates, onConfirmCleanup, onConfirmAllCleanup, cleanupActionBusy }: DesktopLayoutProps) {
  const cleanup = page === "cleanup";
  const exceptions = subscriptions.filter((item) => item.runStatus === "exception");
  return <section className="desktop-page desktop-issues"><div className="desktop-issues__column"><h1>{cleanup ? "待清理" : "异常"}</h1><p>{cleanup ? "只处理已确定的同集重复文件，执行前会重新核对 Season。" : "连续 2 轮仍未补齐才进入异常，恢复后自动退出。"}</p>{cleanup && cleanupCandidates.length > 0 && <Button danger disabled={cleanupActionBusy} onClick={() => { if (window.confirm(`将清理 ${cleanupCandidates.length} 个重复文件，保留系统推荐版本。`)) onConfirmAllCleanup(); }}>全部清理</Button>}{cleanup ? cleanupCandidates.length ? cleanupCandidates.map((item) => <article className="desktop-cleanup-card" key={item.id}><div><h2>{item.title} · {item.episodeKey}</h2><p><b>保留：</b>{item.keep.name} · {qualityLabel(item.keep.quality)}</p><p><b>清理：</b>{item.remove.name} · {qualityLabel(item.remove.quality)}</p><p>{item.reason}</p></div><Button danger disabled={cleanupActionBusy} onClick={() => { if (window.confirm("将清理这个重复文件，保留系统推荐版本。")) onConfirmCleanup(item.id); }}>一键清理</Button></article>) : <p>暂无待清理的重复文件。</p> : exceptions.length ? exceptions.map((item) => <article className="desktop-issue-card" key={item.id}><div><h2>{item.title}</h2><b>缺失：{item.missingEpisodeKeys.join("、") || "待确认"}</b><p>当前订阅状态为异常。</p></div></article>) : <p>暂无异常订阅。</p>}</div></section>;
}

const desktopStorageKeys: Record<string, string> = { 国产剧: "cn_drama", 美剧: "us_drama", 日韩剧: "jp_kr_drama", 电视剧: "tv", 综艺: "variety", 动漫: "animation", 纪录片: "documentary", 电影: "movie" };

function Settings() {
  const [section, setSection] = useState("115 网盘"); const [settings, setSettings] = useState<ApiSettings | null>(null); const [channels, setChannels] = useState<SearchChannel[]>([]); const [cookie, setCookie] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [name, setName] = useState(""); const [channelId, setChannelId] = useState(""); const [bulkInput, setBulkInput] = useState(""); const [editingId, setEditingId] = useState<string | null>(null); const [editingName, setEditingName] = useState(""); const [editingChannelId, setEditingChannelId] = useState(""); const [btbtlaEnabled, setBtbtlaEnabled] = useState(true); const [proxy, setProxy] = useState<ProxySettings>({ isProxyEnabled: false, httpProxyHost: "", httpProxyPort: "" }); const [settingsBusy, setSettingsBusy] = useState(false);
  const [picker, setPicker] = useState<{ key: string; label: string; path: string; folders: Pan115Folder[] } | null>(null);
  const loadSettings = () => { void getSettings().then(setSettings).catch(() => setError("设置加载失败。")); };
  const loadChannels = () => { void listSearchChannels().then(setChannels).catch(() => setError("频道列表加载失败。")); };
  const refresh = () => { loadSettings(); if (section === "资源搜索频道") loadChannels(); };
  useEffect(loadSettings, []);
  useEffect(() => {
    if (!settings) return;
    setBtbtlaEnabled(settings.searchSourceProxy.btbtlaEnabled);
    setProxy({ isProxyEnabled: settings.searchSourceProxy.isProxyEnabled, httpProxyHost: settings.searchSourceProxy.httpProxyHost, httpProxyPort: String(settings.searchSourceProxy.httpProxyPort) });
  }, [settings]);
  useEffect(() => { if (section === "资源搜索频道") loadChannels(); }, [section]);
  const withCookie = (operation: (value: string) => Promise<unknown>) => { if (!cookie.trim()) { setError("请输入 115 Cookie。"); return; } setError(""); void operation(cookie.trim()).then(() => { setCookie(""); refresh(); }).catch(() => setError("115 Cookie 无效或连接不可用。")); };
  const openPicker = (label: string) => { void listPan115Folders().then(folders => setPicker({ key: desktopStorageKeys[label]!, label, path: "115", folders })).catch(() => setError("请先保存并验证 115 Cookie。")); };
  const enter = (folder: Pan115Folder) => { void listPan115Folders(folder.cid, folder.path).then(folders => setPicker(current => current ? { ...current, path: folder.path, folders } : current)).catch(() => setError("目录读取失败。")); };
  const choose = (folder: Pan115Folder) => { if (!picker) return; void saveStorageCategoryMapping(picker.key, folder.cid, folder.path).then(() => { setPicker(null); refresh(); }).catch(() => setError("目录映射保存失败。")); };
  const create = () => { if (!name.trim() || !channelId.trim()) { setError("请输入频道名称与 channelId。"); return; } void createSearchChannel({ name: name.trim(), channelId: channelId.trim() }).then(() => { setName(""); setChannelId(""); refresh(); }).catch(() => setError("频道保存或检测失败。")); };
  const move = (index: number, direction: -1 | 1) => { const next = [...channels]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; setChannels(next); void reorderSearchChannels(next.map(channel => channel.id)).catch(() => { setError("频道排序保存失败。"); loadChannels(); }); };
  const importMany = () => { const entries = bulkInput.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => { const [entryName, entryChannelId] = line.split(/[，,\t]/).map(value => value.trim()); return { name: entryName ?? "", channelId: entryChannelId ?? "" }; }); if (!entries.length || entries.some(entry => !entry.name || !entry.channelId)) { setError("每行请填写“频道名称, channelId”。"); return; } void importSearchChannels(entries).then(() => { setBulkInput(""); refresh(); }).catch(() => setError("批量导入或检测失败。")); };
  const startEdit = (channel: SearchChannel) => { setEditingId(channel.id); setEditingName(channel.name); setEditingChannelId(channel.channelId); };
  const saveEdit = () => { if (!editingId || !editingName.trim() || !editingChannelId.trim()) { setError("请输入频道名称与 channelId。"); return; } void updateSearchChannel(editingId, { name: editingName.trim(), channelId: editingChannelId.trim() }).then(() => { setEditingId(null); refresh(); }).catch(() => setError("频道编辑保存失败。")); };
  const checkAll = () => { setSettingsBusy(true); setError(""); void checkAllSearchChannels().then(() => { setNotice("全部频道检测完成。"); loadChannels(); }).catch(() => setError("全部频道检测失败。")).finally(() => setSettingsBusy(false)); };
  const saveSource = () => { setSettingsBusy(true); setError(""); void saveResourceSourceSettings({ btbtlaEnabled }).then(() => setNotice("搜索源设置已保存。 ")).catch(() => setError("搜索源设置接口暂不可用。 ")).finally(() => setSettingsBusy(false)); };
  const testSource = () => { setSettingsBusy(true); setError(""); void testBtbtlaConnection().then(result => setNotice(result.message ?? (result.ok ? "btbtla 连接测试成功。" : "btbtla 连接测试未通过。"))).catch(() => setError("btbtla 连接测试暂不可用。 ")).finally(() => setSettingsBusy(false)); };
  const saveProxy = () => { setSettingsBusy(true); setError(""); void saveProxySettings(proxy).then(() => setNotice("代理设置已保存。代理异常不会阻塞订阅主流程。")).catch(() => setError("代理设置接口暂不可用。 ")).finally(() => setSettingsBusy(false)); };
  const testProxy = () => { if (!proxy.isProxyEnabled || !proxy.httpProxyHost.trim() || !proxy.httpProxyPort.trim()) { setError("请先启用代理并填写 Host 与 Port。"); return; } setSettingsBusy(true); setError(""); void testProxyConnection(proxy).then(result => setNotice(result.message ?? (result.ok ? "代理连接测试成功。" : "代理连接测试未通过。"))).catch(() => setError("代理连接测试暂不可用。 ")).finally(() => setSettingsBusy(false)); };
  const mapping = new Map(settings?.storageCategories.map(item => [item.label, item]) ?? []);
  return <section className="desktop-page desktop-settings"><h1>设置</h1>{error && <p className="desktop-error" role="alert">{error}</p>}{notice && <p className="desktop-notice" role="status">{notice}</p>}<div className="desktop-settings__layout"><aside>{["追剧设置", "115 网盘", "资源搜索频道", "搜索源", "代理设置"].map(item => <button key={item} className={section === item ? "is-active" : ""} onClick={() => setSection(item)}>{item}</button>)}</aside><main><h2>{section}</h2>{section === "追剧设置" && <div className="desktop-setting-card"><h3>默认目标画质</h3><label><input type="radio" name="quality" checked={settings?.defaultTargetQuality === "2160p"} onChange={() => { void saveDefaultTargetQuality("2160p").then(refresh).catch(() => setError("默认画质保存失败。")); }} /> 4K / 2160P</label><label><input type="radio" name="quality" checked={settings?.defaultTargetQuality !== "2160p"} onChange={() => { void saveDefaultTargetQuality("1080p").then(refresh).catch(() => setError("默认画质保存失败。")); }} /> 1080P</label></div>}{section === "115 网盘" && <><div className="desktop-setting-card desktop-connection"><div><span>连接状态</span><b>{settings?.pan115.connected ? "已连接" : "未配置"}</b></div><input type="password" value={cookie} autoComplete="off" onChange={e => setCookie(e.target.value)} placeholder="粘贴 115 Cookie" /><Button onClick={() => withCookie(testPan115Credential)}>测试连接</Button><Button onClick={() => withCookie(savePan115Credential)}>保存并验证</Button></div><h3>影视目录映射</h3><div className="desktop-mapping-list">{categories.map(category => <div key={category}><b>{category}</b><span>{mapping.get(category)?.folderPath ?? "尚未选择"}</span><em>{mapping.get(category)?.configured ? "正常" : "未配置"}</em><Button onClick={() => openPicker(category)}>重新选择</Button></div>)}</div></>}{section === "资源搜索频道" && <div className="desktop-setting-card"><p>排序越靠前，自动找资源时越优先。批量导入每行填写“频道名称, channelId”。</p><div className="desktop-channel-create"><input value={name} onChange={e => setName(e.target.value)} placeholder="频道名称" /><input value={channelId} onChange={e => setChannelId(e.target.value)} placeholder="公开 channelId" /><Button onClick={create}>新增并检测</Button></div><textarea className="desktop-channel-import" value={bulkInput} onChange={e => setBulkInput(e.target.value)} placeholder={"影视资源, media115\n资源备选, media_backup"} /><div className="desktop-channel-actions"><Button onClick={importMany}>批量导入并检测</Button><Button onClick={checkAll} disabled={settingsBusy}>检测全部</Button></div>{channels.map((channel, index) => <div className="desktop-channel" key={channel.id}>{editingId === channel.id ? <><span>{index + 1}</span><input value={editingName} onChange={e => setEditingName(e.target.value)} aria-label="频道名称" /><input value={editingChannelId} onChange={e => setEditingChannelId(e.target.value)} aria-label="频道 channelId" /><Button onClick={saveEdit}>保存</Button><Button onClick={() => setEditingId(null)}>取消</Button></> : <><span>{index + 1}</span><b>{channel.name}</b><small>@{channel.channelId}</small><em>{channel.lastCheckStatus === "ok" ? "正常" : channel.lastCheckStatus === "failed" ? "异常" : "未检测"}</em><label><input type="checkbox" checked={channel.isEnabled} onChange={e => { void updateSearchChannel(channel.id, { isEnabled: e.target.checked }).then(refresh).catch(() => setError("频道状态保存失败。")); }} /> 启用</label><div className="desktop-channel-actions"><Button onClick={() => move(index, -1)}>上移</Button><Button onClick={() => move(index, 1)}>下移</Button><Button onClick={() => startEdit(channel)}>编辑</Button><Button onClick={() => { void checkSearchChannel(channel.id).then(refresh).catch(() => setError("频道检测失败。")); }}>检测</Button><Button danger onClick={() => { if (!window.confirm(`删除频道「${channel.name}」？`)) return; void deleteSearchChannel(channel.id).then(refresh).catch(() => setError("频道删除失败。")); }}>删除</Button></div></>}</div>)}</div>}{section === "搜索源" && <div className="desktop-setting-card"><h3>btbtla</h3><p>用于历史影视搜索、资源补充与每 12 小时最新集兜底校准。</p><label>启用 btbtla <input type="checkbox" checked={btbtlaEnabled} onChange={e => setBtbtlaEnabled(e.target.checked)} /></label><p>{btbtlaEnabled ? "已启用：按需调用 + 每 12 小时兜底校准。" : "已关闭：不会参与资源补充与校准。"}</p><div className="desktop-channel-actions"><Button onClick={saveSource} disabled={settingsBusy}>保存设置</Button><Button onClick={testSource} disabled={settingsBusy}>测试连接</Button></div></div>}{section === "代理设置" && <div className="desktop-setting-card"><p>代理异常不会阻塞订阅主流程。</p><label>启用代理 <input type="checkbox" checked={proxy.isProxyEnabled} onChange={e => setProxy(current => ({ ...current, isProxyEnabled: e.target.checked }))} /></label><label>HTTP Proxy Host <input disabled={!proxy.isProxyEnabled} value={proxy.httpProxyHost} onChange={e => setProxy(current => ({ ...current, httpProxyHost: e.target.value }))} placeholder="127.0.0.1 或 clash" /></label><label>HTTP Proxy Port <input disabled={!proxy.isProxyEnabled} value={proxy.httpProxyPort} inputMode="numeric" onChange={e => setProxy(current => ({ ...current, httpProxyPort: e.target.value }))} placeholder="7890" /></label><div className="desktop-channel-actions"><Button onClick={saveProxy} disabled={settingsBusy}>保存设置</Button><Button onClick={testProxy} disabled={settingsBusy}>测试连接</Button></div></div>}</main></div>{picker && <section className="desktop-folder-picker" role="dialog" aria-modal="true"><header><h2>选择「{picker.label}」目录</h2><Button onClick={() => setPicker(null)}>关闭</Button></header><p>{picker.path}</p>{picker.folders.map(folder => <article key={folder.cid}><b>{folder.name}</b><div><Button onClick={() => enter(folder)}>进入</Button><Button onClick={() => choose(folder)}>选择</Button></div></article>)}</section>}</section>;
}

const releaseConfirmation = "释放当前 Season 空间？\n\n将清空当前 Season 目录中的全部内容。会保留 Season 文件夹、CID、Series 父目录与订阅记录；释放后暂停追更。";

function Detail({ selectedMedia, subscription, subscriptionActivities, onFollow, onSubscriptionAction, onReleaseRequested, onNavigate, subscriptionActionBusy }: Pick<DesktopLayoutProps, "selectedMedia" | "subscription" | "subscriptionActivities" | "onFollow" | "onSubscriptionAction" | "onReleaseRequested" | "onNavigate" | "subscriptionActionBusy">) {
  if (!selectedMedia) return <section className="desktop-detail"><h1>未选择影视</h1><p>请从搜索结果中选择一部影视。</p></section>;
  const media = selectedMedia;
  const progress = media.latestEpisode === null ? "暂无剧集信息" : `更新至 ${media.latestEpisode} 集${media.totalEpisodes === null ? "" : ` / 全 ${media.totalEpisodes} 集`}`;
  const recommendation = media.rating === null ? "待评分" : media.rating >= 8.5 ? "神作" : media.rating >= 7.5 ? "推荐" : media.rating >= 6.5 ? "可看" : "一般";
  const stateLabel = subscription?.runStatus === "released" ? "已释放" : subscription?.subscriptionStatus === "paused" ? "已暂停" : subscription?.subscriptionStatus === "stopped" ? "已停追" : "追更中";
  const mainAction = subscription === null ? "追剧" : subscription.subscriptionStatus === "paused" ? "继续追剧" : subscription.subscriptionStatus === "stopped" ? "重新追剧" : "查看追剧详情";
  const mainClick = () => { if (subscription === null) onFollow(); else if (subscription.subscriptionStatus === "paused") onSubscriptionAction("resume"); else if (subscription.subscriptionStatus === "stopped") onSubscriptionAction("refollow"); else onNavigate("subscription"); };
  return <section className="desktop-detail"><div className="desktop-detail__hero"><Poster title={media.title} tone="blue" /><div><div className="desktop-badges"><b>{media.rating?.toFixed(1) ?? "--"}</b><b>{recommendation}</b></div><h1>{media.title}</h1><p>{media.year || "--"} · {media.mediaType === "movie" ? "电影" : "电视剧"} · {[media.region, ...media.genres].filter(Boolean).join(" / ")}</p><strong>{progress}</strong><p>{media.summary || "暂无剧情简介。"}</p><Button onClick={mainClick} disabled={subscriptionActionBusy}>{mainAction}</Button></div></div>{subscription !== null && <><section><h2>追剧进度</h2><div className="desktop-detail__stats"><div><span>最新资源</span><b>{media.latestEpisode ?? "--"} 集</b></div><div><span>115 已有</span><b>{subscription.resolvedLatestEpisode}{media.latestEpisode === null ? "" : ` / ${media.latestEpisode}`}</b></div><div><span>缺失剧集</span><b className={subscription.missingEpisodeKeys.length ? "is-red" : ""}>{subscription.missingEpisodeKeys.length ? subscription.missingEpisodeKeys.join("、") : "无缺失"}</b></div><div><span>当前状态</span><b>{stateLabel}</b></div></div></section><section className="desktop-detail__lower"><div><h2>操作</h2><div className="desktop-setting-card"><Button disabled={subscriptionActionBusy} onClick={() => onSubscriptionAction("upgradeQuality")}>升级画质</Button><Button disabled={subscriptionActionBusy} onClick={() => onSubscriptionAction(subscription.subscriptionStatus === "paused" ? "resume" : "pause")}>{subscription.subscriptionStatus === "paused" ? "恢复追更" : "暂停追更"}</Button><Button danger disabled={subscriptionActionBusy} onClick={() => onSubscriptionAction("stop")}>停追</Button><Button disabled={subscriptionActionBusy} onClick={() => onSubscriptionAction("check")}>立即检查</Button>{subscription.runStatus === "released" ? <span>已释放</span> : <Button danger disabled={subscriptionActionBusy} onClick={() => { if (window.confirm(releaseConfirmation)) onReleaseRequested(); }}>{subscriptionActionBusy ? "释放中…" : "释放空间"}</Button>}</div></div><div><h2>115 存储</h2><div className="desktop-setting-card"><p>清空当前 Season 目录内容，并暂停追更。</p><small>会保留 Season 文件夹、CID、Series 父目录与订阅记录。</small></div></div></section><section><h2>最近活动</h2><div className="desktop-setting-card">{subscriptionActivities.length ? subscriptionActivities.map(activity => <p key={`${activity.time}-${activity.type}`}>{activity.time} · {activity.message}</p>) : <p>暂无最近活动。</p>}</div></section></>}</section>;
}
export function DesktopLayout(props: DesktopLayoutProps) {
  return <div className="desktop-layout"><DesktopHeader {...props} />{props.page === "discover" ? <Discover {...props} /> : props.page === "following" || props.page === "history" ? <Following {...props} /> : props.page === "issues" || props.page === "cleanup" ? <Issues {...props} /> : props.page === "settings" ? <Settings /> : <Detail selectedMedia={props.selectedMedia} subscription={props.subscription} subscriptionActivities={props.subscriptionActivities} onFollow={props.onFollow} onSubscriptionAction={props.onSubscriptionAction} onReleaseRequested={props.onReleaseRequested} onNavigate={props.onNavigate} subscriptionActionBusy={props.subscriptionActionBusy} />}{props.toast && <p role="status" className="desktop-error">{props.toast}</p>}</div>;
}
