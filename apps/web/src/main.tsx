import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, confirmAllCleanupCandidates, confirmCleanupCandidate, createSubscription, getDiscoverSections, getMedia, getSettings, getSubscription, hasSession, listCleanupCandidates, listSubscriptions, login, logout, searchMedia, updateSubscription, type CleanupCandidatePreview, type DiscoverSection, type MediaMetadata, type SubscriptionAction, type SubscriptionActivity, type SubscriptionSummary } from "./api.js";
import { discoverFixture, formatRating, recommendationTag } from "./discover-fixture.js";
import { DesktopLayout } from "./desktop-layout.js";
import { MobileLayout } from "./mobile-layout.js";
import "./styles.css";

type Page = "discover" | "media" | "subscription" | "following" | "history" | "issues" | "cleanup" | "settings";
type SubscriptionStatus = "none" | "following" | "paused" | "stopped";
type RunStatus = "等待更新" | "检查中" | "补集中" | "已释放";
const episodes = Array.from({ length: 30 }, (_, index) => index + 1);
const activity = [["今天 10:24", "发现第 30 集", "最新资源已更新，正在等待下次检查。"], ["昨天 21:08", "已补齐第 29 集", "115 已有 29 / 30 集。"], ["8 月 18 日", "目录整理完成", "Season 02 文件已归档到目标目录。"], ["8 月 17 日", "当前无更新", "最新资源与 115 内容一致。"]];

function Button({ children, kind = "default", onClick }: { children: React.ReactNode; kind?: "default" | "primary" | "danger"; onClick?: (() => void) | undefined }) { return <button className={`button button--${kind}`} onClick={onClick}>{children}</button>; }
function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "gray" | "orange" }) { return <span className={`pill pill--${tone}`}>{children}</span>; }
function Poster() { return <div className="poster" role="img" aria-label="最后生还者第二季海报"><span>HBO<br />ORIGINAL</span><b>THE<br />LAST OF US</b><i>SEASON 02</i></div>; }
function Status({ runStatus }: { runStatus: RunStatus }) { return <span className={`run-status ${runStatus === "已释放" ? "released" : ""}`}><i />{runStatus}</span>; }
function Header({ page, setPage, onLogout }: { page: Page; setPage: (page: Page) => void; onLogout: () => Promise<void> }) { return <header className="topbar"><button className="brand" onClick={() => setPage("discover")}><span>115</span>追剧</button><nav><button className={["discover", "media"].includes(page) ? "active" : ""} onClick={() => setPage("discover")}>发现</button><button className={["subscription","following","history","issues","cleanup"].includes(page) ? "active" : ""} onClick={() => setPage("following")}>追剧</button><button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>设置</button></nav><button className="search">⌕ 搜索影视、演员…</button><button className="logout" onClick={() => void onLogout()}>退出</button><span className="avatar">G</span></header>; }

function MediaDetail({ status, onFollow, goSubscription }: { status: SubscriptionStatus; onFollow: () => void; goSubscription: () => void }) {
  const action = status === "none" ? "追剧" : status === "paused" ? "继续追剧" : status === "stopped" ? "重新追剧" : "查看追剧详情";
  return <main className="media-page"><section className="hero"><div className="hero-art"><div className="hero-glow" /></div><div className="hero-shade" /><div className="media-identity"><Poster /><div className="media-copy"><p className="eyebrow">THE LAST OF US · SEASON 02</p><h1>最后生还者 第二季</h1><p className="original-title">The Last of Us Season 2 <span>2025</span></p><div className="metadata"><Pill tone="orange">9.1</Pill><span>美国</span><span>剧情 / 动作 / 科幻</span><span>更新至 30 集</span></div><p className="summary">在文明崩塌后的美国，乔尔与艾莉继续寻找活下去的理由。一段被隐瞒的往事，让两人的关系走向难以挽回的裂缝。</p><p className="credits"><b>导演</b> 克雷格·麦辛、尼尔·德拉柯曼  <b>主演</b> 佩德罗·帕斯卡、贝拉·拉姆齐</p><div className="hero-actions"><Button kind="primary" onClick={status === "following" ? goSubscription : onFollow}>{action}</Button><Button>♡ 收藏</Button></div></div></div></section><section className="detail-body"><div className="main-column"><h2>剧情简介</h2><p className="body-copy">五年过去，乔尔与艾莉之间的冲突愈发深刻，世界也变得更加危险和难以预测。他们必须面对过去的选择，以及随之而来的残酷现实。</p><h2>演职人员</h2><div className="people"><div><span>佩德罗·帕斯卡</span><small>饰 Joel</small></div><div><span>贝拉·拉姆齐</span><small>饰 Ellie</small></div><div><span>凯特琳·德弗</span><small>饰 Abby</small></div></div></div><aside className="subscription-summary"><h3>{status === "none" ? "追剧提醒" : "追剧状态"}</h3>{status === "none" ? <><p>追剧后会自动查找资源并补齐缺失剧集。</p><div className="summary-line"><span>默认画质</span><b>4K / 2160P</b></div></> : <><Status runStatus="等待更新" /><div className="summary-line"><span>最新资源</span><b>30 集</b></div><div className="summary-line"><span>115 已有</span><b>29 / 30</b></div><div className="summary-line"><span>缺失</span><b className="missing">30</b></div><Button onClick={goSubscription}>查看追剧详情</Button></>}</aside></section></main>;
}

function SubscriptionDetail({ status, setStatus, runStatus, setRunStatus, back }: { status: SubscriptionStatus; setStatus: (value: SubscriptionStatus) => void; runStatus: RunStatus; setRunStatus: (value: RunStatus) => void; back: () => void }) {
  const [menu, setMenu] = useState(false); const [confirmRelease, setConfirmRelease] = useState(false); const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2200); }; const pause = () => { const next = status === "paused" ? "following" : "paused"; setStatus(next); notify(next === "paused" ? "已暂停追更" : "已恢复追更"); }; const release = () => { setConfirmRelease(false); setStatus("paused"); setRunStatus("已释放"); notify("已释放当前 Season 空间，并暂停追更"); };
  return <main className="subscription-page"><button className="back" onClick={back}>‹ 返回影视详情</button><section className="subscription-head"><Poster /><div className="subscription-title"><p className="eyebrow">THE LAST OF US · SEASON 02</p><h1>最后生还者 第二季</h1><p>2025 · 美国 · 剧情 / 动作 / 科幻</p><div><Pill tone={status === "paused" ? "gray" : "green"}>{status === "paused" ? "已暂停" : "追更中"}</Pill><Status runStatus={runStatus} /></div></div><div className="action-group"><Button onClick={() => notify("已创建当前 Season 的画质升级任务")}>升级画质</Button><Button onClick={pause}>{status === "paused" ? "恢复追更" : "暂停追更"}</Button><Button kind="danger" onClick={() => { setStatus("stopped"); notify("已停止追更，115 内容会继续保留"); }}>停追</Button><div className="more-wrap"><Button onClick={() => setMenu(!menu)}>···</Button>{menu && <div className="more-menu"><button onClick={() => { setRunStatus("检查中"); setMenu(false); notify("正在检查最新资源"); }}>立即检查</button><button onClick={() => notify("已打开 115 目录（mock）")}>打开 115 目录</button><button onClick={() => notify("重新绑定目录（mock）")}>重新绑定目录</button></div>}</div></div></section><div className="subscription-grid"><section className="progress-card card"><div className="card-heading"><div><h2>追剧进度</h2><p>最近检查：今天 10:24</p></div><Status runStatus={runStatus} /></div><div className="progress-stats"><div><span>最新资源</span><b>30 集</b></div><div><span>115 已有</span><b>29 / 30</b></div><div><span>缺失</span><b className="missing">1 集</b></div></div><div className="episode-legend"><span><i className="has" />已有</span><span><i className="missing-dot" />缺失</span><span><i className="working" />处理中</span><span><i className="error" />异常</span></div><div className="episode-grid">{episodes.map(n => <span key={n} className={n === 30 ? "episode missing-episode" : "episode"}>E{String(n).padStart(2, "0")}</span>)}</div></section><aside className="side-stack"><section className="storage-card card"><h2>115 存储</h2><p className="storage-path">影视库 / 美剧 / 最后生还者 (2023) / <b>Season 02</b></p><dl><div><dt>分类</dt><dd>美剧</dd></div><div><dt>目录 CID</dt><dd className="cid">305871942706</dd></div></dl><div className="storage-actions"><button onClick={() => notify("已打开 115 目录（mock）")}>打开 115 目录 ↗</button><button className="release-link" onClick={() => setConfirmRelease(true)}>释放空间</button></div><p className="release-note">清空当前 Season 目录内容，并暂停追更</p></section><section className="card quality-card"><h2>目标画质</h2><p><b>4K / 2160P</b> 当前无缺集时可手动升级。</p></section></aside></div><section className="activity card"><div className="card-heading"><div><h2>最近活动</h2><p>只显示结果型事件</p></div><button>查看全部</button></div>{activity.map(([time, title, detail]) => <div className="activity-row" key={title}><time>{time}</time><span className="activity-dot" /><div><b>{title}</b><p>{detail}</p></div></div>)}</section>{confirmRelease && <div className="dialog-backdrop"><section className="confirm-dialog"><span className="danger-icon">!</span><h2>释放当前 Season 空间？</h2><p>将清空 Season 02 目录内容，并暂停追更。文件夹与订阅会保留。</p><div><Button onClick={() => setConfirmRelease(false)}>取消</Button><Button kind="danger" onClick={release}>确认释放</Button></div></section></div>}{toast && <div className="toast">✓ {toast}</div>}</main>;
}

type WatchItem = { id:number; title:string; meta:string; season:string; latest:string; owned:string; missing:string; state:string; check:string; tone:string };
const watchSeed: WatchItem[] = [
 {id:1,title:"藏海传",meta:"2025 · 古装 · 2160P",season:"Season 01",latest:"E30",owned:"29 / 30",missing:"E30",state:"补集中",check:"刚刚检查",tone:"blue"},
 {id:2,title:"折腰",meta:"2025 · 古装 · 2160P",season:"Season 01",latest:"E36",owned:"36 / 36",missing:"无缺失",state:"等待更新",check:"2 小时前",tone:"purple"},
 {id:3,title:"怪奇物语",meta:"2025 · 剧情 · 2160P",season:"Season 05",latest:"E08",owned:"7 / 8",missing:"E08",state:"异常",check:"18 分钟前",tone:"red"},
 {id:4,title:"临江仙",meta:"2025 · 古装 · 1080P",season:"Season 01",latest:"E24",owned:"24 / 24",missing:"无缺失",state:"等待更新",check:"6 小时前",tone:"gray"}
];
function MiniPoster({ tone }: { tone:string }) { return <span className={`mini-poster ${tone}`} aria-label="影视海报"/>; }
function WatchRow({ item, history, onRemove }: { item:WatchItem; history?:boolean; onRemove?:()=>void }) { const [paused,setPaused]=useState(false); return <article className="watch-row"><MiniPoster tone={item.tone}/><div className="watch-row-copy"><div><h2>{item.title}</h2><p>{item.meta}</p></div>{history?<><b className={`watch-status ${item.tone}`}>{item.state}</b><p className="watch-green">115 已保留 · 最近变更：{item.check}</p></>:<><p><b>当前季：</b>{item.season} <b>最新集：</b>{item.latest} <span className="watch-green">115 已有 {item.owned}</span></p><p><span className={item.missing==="无缺失"?"":"watch-red"}>缺失：{item.missing}</span> 目标：4K / 2160P</p><p className="watch-path">115：影视库 / 国产剧 / {item.title}</p></>}</div><div className="watch-row-actions">{!history&&<small>最近检查：{item.check}</small>}<div>{history?<Button>重新追</Button>:<><Button>升级</Button><Button onClick={()=>setPaused(!paused)}>{paused?"恢复":"暂停"}</Button><Button kind="danger" onClick={onRemove}>停追</Button><Button kind="danger">释放</Button></>}</div></div></article>; }
function FollowingPage({ setPage }:{setPage:(page:Page)=>void}) { const [shows,setShows]=useState(watchSeed); return <main className="watch-page"><header className="watch-page-head"><h1>我的追剧</h1><div className="watch-counters"><button><small>追更中</small><b>{shows.length}</b></button><button onClick={()=>setPage("issues")}><small>异常</small><b className="watch-red">1</b></button><button onClick={()=>setPage("cleanup")}><small>待清理</small><b className="watch-orange">3</b></button></div></header><div className="watch-tabs"><button className="active">当前追剧</button><button onClick={()=>setPage("history")}>历史</button><span>按订阅时间排序</span></div><section className="watch-rows">{shows.length?shows.map(item=><WatchRow key={item.id} item={item} onRemove={()=>setShows(shows.filter(show=>show.id!==item.id))}/>):<div className="empty-state">没有正在追更的影视</div>}</section></main>; }
function HistoryPage(){ const [filter,setFilter]=useState("全部"); const all=[{...watchSeed[0]!,state:"已完成剧集",check:"昨天"},{...watchSeed[1]!,title:"沙丘 2",meta:"2024 · 科幻电影",state:"已完成电影",check:"3 天前"},{...watchSeed[3]!,title:"边水往事",state:"已停追",check:"上周"}]; const rows=filter==="全部"?all:all.filter(item=>item.state===filter); return <main className="watch-page"><h1 className="history-heading">历史</h1><div className="watch-tabs history-tabs">{["全部","已完成剧集","已完成电影","已停追"].map(tab=><button key={tab} onClick={()=>setFilter(tab)} className={filter===tab?"active":""}>{tab}</button>)}</div><section className="watch-rows">{rows.map(item=><WatchRow key={`${item.title}-${item.state}`} item={item} history/>)}</section></main>; }
function IssuesPage(){ const [exception,setException]=useState(true); const [clean,setClean]=useState(["藏海传","折腰","临江仙"]); return <main className="issue-page"><section><header><h1>异常</h1><p>连续两轮未补齐的订阅，需要你留意。</p></header>{exception?<article className="issue-row"><MiniPoster tone="red"/><div><h2>怪奇物语</h2><p className="watch-red">缺失：E08</p><p>已连续 2 轮未补齐</p><p>原因：暂无可用资源 · 18 分钟前</p></div><aside><Button onClick={()=>setException(false)}>立即检查</Button><Button>查看详情</Button></aside></article>:<div className="empty-state">当前没有异常订阅</div>}</section><section><header><div><h1>待清理</h1><p>系统已计算推荐保留的版本。</p></div>{clean.length>0&&<Button kind="danger" onClick={()=>setClean([])}>全部清理</Button>}</header>{clean.length?clean.map((title,index)=><article className="cleanup-row" key={title}><div><h2>{title}</h2><p>第 {18+index*6} 集存在重复文件</p><p><b>保留：</b>2160P · 较早加入</p><p className="watch-red"><b>清理：</b>1080P · 后加入</p></div><Button kind="danger" onClick={()=>setClean(clean.filter(item=>item!==title))}>一键清理</Button></article>):<div className="empty-state">没有待清理的重复文件</div>}</section></main>; }

function DiscoverPage({ openDetail }:{openDetail:()=>void}) { const [query,setQuery]=useState(""); const needle=query.trim().toLowerCase(); const sections=discoverFixture.map(section=>({...section,items:section.items.filter(item=>!needle||item.title.toLowerCase().includes(needle)).slice(0,9)})).filter(section=>section.items.length); return <main className="discover-page"><section className="discover-search"><p className="eyebrow">DISCOVER</p><h1>找一部今晚想看的</h1><label><span>⌕</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索电影、电视剧、综艺、动漫……" aria-label="搜索影视"/><kbd>⌘ K</kbd></label></section><div className="discover-results-note">{needle?`“${query}” 的搜索结果`:"11 个豆瓣热门分区"}</div>{sections.map(section=><section className="discover-section" key={section.key}><div className="discover-section-head"><h2>{section.title}</h2><button type="button">更多 <span>›</span></button></div><div className="discover-grid">{section.items.map((item,index)=><button className="discover-card" key={item.id} onClick={openDetail}><span className={`discover-poster poster-tone-${index % 6}`} role="img" aria-label={`${item.title} 海报`}>{item.posterUrl&&<img src={item.posterUrl} alt=""/>}<span className="rating-badge">{formatRating(item.rating)}</span><span className={`recommendation-badge recommendation-${recommendationTag(item.rating)}`}>{recommendationTag(item.rating)}</span></span><b>{item.title}</b><small>{item.cardSubtitle}</small></button>)}</div></section>)}</main>; }

function CleanupPage(){ const [clean,setClean]=useState(["藏海传","折腰","临江仙"]); return <main className="issue-page cleanup-page"><section><header><div><h1>待清理</h1><p>系统已计算推荐保留的版本，不会影响正片文件。</p></div>{clean.length>0&&<Button kind="danger" onClick={()=>setClean([])}>全部清理</Button>}</header>{clean.length?clean.map((title,index)=><article className="cleanup-row" key={title}><div><h2>{title}</h2><p>第 {18+index*6} 集存在重复文件</p><p><b>保留：</b>2160P · 较早加入</p><p className="watch-red"><b>清理：</b>1080P · 后加入</p></div><Button kind="danger" onClick={()=>setClean(clean.filter(item=>item!==title))}>一键清理</Button></article>):<div className="empty-state">没有待清理的重复文件</div>}</section></main>; }

function WatchSubnav({ page, setPage }:{page:Page;setPage:(page:Page)=>void}) { return <nav className="watch-subnav"><button className={page==="following"?"active":""} onClick={()=>setPage("following")}>当前追剧</button><button className={page==="history"?"active":""} onClick={()=>setPage("history")}>历史</button><button className={page==="issues"?"active":""} onClick={()=>setPage("issues")}>异常 <i>1</i></button><button className={page==="cleanup"?"active":""} onClick={()=>setPage("cleanup")}>待清理 <i>3</i></button></nav>; }

type Channel = { id:number; name:string; channelId:string; enabled:boolean; status:"正常"|"异常"|"未检测" };
const directoryTypes = ["国产剧","美剧","日韩剧","电视剧","综艺","动漫","纪录片","电影"];
const channelSeed: Channel[] = [
  { id:1, name:"Lsp115", channelId:"@Lsp115", enabled:true, status:"正常" },
  { id:2, name:"vip115hot", channelId:"@vip115hot", enabled:true, status:"未检测" },
  { id:3, name:"Channel_Shares_115", channelId:"@Channel_Shares_115", enabled:true, status:"正常" }
];
function SettingsPage(){
  const [active,setActive]=useState("追剧设置"); const [toast,setToast]=useState("");
  const [channels,setChannels]=useState<Channel[]>(channelSeed); const [importing,setImporting]=useState(false); const [editing,setEditing]=useState<number|null>(null);
  const [cookie,setCookie]=useState(""); const [cookieSaved,setCookieSaved]=useState(false); const [sourceEnabled,setSourceEnabled]=useState(true); const [proxyEnabled,setProxyEnabled]=useState(false);
  const settings=["追剧设置","115 网盘","资源搜索频道","搜索源","代理设置"];
  const notify=(message:string)=>{setToast(message);window.setTimeout(()=>setToast(""),2200)};
  const test=(label:string)=>notify(`${label}测试已完成（本地演示，未发起网络请求）`);
  const move=(index:number,direction:-1|1)=>{const next=[...channels], target=index+direction;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target]!,next[index]!];setChannels(next)};
  const updateChannel=(id:number, patch:Partial<Channel>)=>setChannels(items=>items.map(item=>item.id===id?{...item,...patch}:item));
  return <main className="settings-page"><h1>设置</h1><div className="settings-layout"><aside>{settings.map(item=><button className={active===item?"active":""} onClick={()=>setActive(item)} key={item}>{item}</button>)}</aside><section className="settings-panel"><h2>{active}</h2>
    {active==="追剧设置"&&<><p>管理订阅时默认使用的目标画质。</p><div className="setting-choice"><b>默认目标画质</b><label><input type="radio" defaultChecked name="quality"/> 4K / 2160P <small>优先选择 4K 资源</small></label><label><input type="radio" name="quality"/> 1080P <small>优先选择 1080P 资源</small></label></div></>}
    {active==="115 网盘"&&<><p>账号连接、Cookie 与影视库目录映射。</p><div className="settings-stack"><div className="setting-choice"><div className="setting-row"><b className={cookieSaved?"connection-state":"connection-state unconfigured"}>● {cookieSaved?"已配置":"未配置"}</b>{cookieSaved&&<span>Cookie 已保存（已脱敏）</span>}</div><label className="cookie-field">115 Cookie<input type="text" value={cookieSaved?"••••••••••••••••":cookie} placeholder="粘贴 115 Cookie" onFocus={()=>cookieSaved&&setCookieSaved(false)} onChange={event=>{setCookie(event.target.value);setCookieSaved(false)}}/></label><span>{cookieSaved?"如需更新，请直接编辑 Cookie 后重新保存。":"尚未配置 115 Cookie，保存后可测试连接。"}</span><div className="settings-actions"><Button onClick={()=>{if(!cookie.trim()){notify("请先输入 115 Cookie");return;}setCookieSaved(true);notify("115 Cookie 已保存并脱敏显示（仅本地界面）")}}>保存 Cookie</Button><Button onClick={()=>cookieSaved?test("115 连接"):notify("请先保存 Cookie 后再测试连接")}>测试连接</Button></div></div><div className="setting-choice"><b>目录映射</b><span>一级目录：影视库。选择文件夹后将由服务端保存对应目录，不需要手填 CID。</span><div className="directory-list">{directoryTypes.map(type=><div key={type}><span>{type}</span><button onClick={()=>notify(`已打开「影视库 / ${type}」文件夹选择器（占位）`)}>选择文件夹</button></div>)}</div></div></div></>}
    {active==="资源搜索频道"&&<><div className="panel-heading"><p>排序越靠前，自动找资源时优先级越高。此处仅演示交互，不会检测 Telegram。</p><div className="settings-actions"><Button onClick={()=>setImporting(!importing)}>批量导入</Button><Button onClick={()=>{setChannels(items=>items.map(item=>({...item,status:"正常"})));test("全部频道")}}>检测全部</Button><Button kind="primary" onClick={()=>notify("频道设置已保存（本地演示）")}>保存设置</Button></div></div>{importing&&<div className="import-box"><input aria-label="批量导入频道" placeholder="粘贴频道名称或 t.me 链接，每行一个"/><Button kind="primary" onClick={()=>{setImporting(false);notify("已导入频道（本地演示）")}}>导入并检测</Button></div>}<div className="channel-list">{channels.map((channel,index)=><div className="channel-row" key={channel.id}><div className="channel-order"><button aria-label="上移" disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button aria-label="下移" disabled={index===channels.length-1} onClick={()=>move(index,1)}>↓</button></div><div className="channel-info">{editing===channel.id?<><input value={channel.name} onChange={event=>updateChannel(channel.id,{name:event.target.value})}/><input value={channel.channelId} onChange={event=>updateChannel(channel.id,{channelId:event.target.value})}/></>:<><b>{channel.name}</b><span>{channel.channelId}</span></>}</div><span className={`channel-status ${channel.status}`}>{channel.status}</span><label className="toggle"><input type="checkbox" checked={channel.enabled} onChange={event=>updateChannel(channel.id,{enabled:event.target.checked})}/><i /></label><div className="channel-actions"><button onClick={()=>test(`${channel.name} 频道`)}>检测</button><button onClick={()=>setEditing(editing===channel.id?null:channel.id)}>{editing===channel.id?"完成":"编辑"}</button><button className="delete" onClick={()=>setChannels(items=>items.filter(item=>item.id!==channel.id))}>删除</button></div></div>)}</div></>}
    {active==="搜索源"&&<><p>用于历史影视搜索、资源补充和每 12 小时最新集兜底校准，与 Search Channels 分离。</p><div className="setting-choice"><div className="setting-row"><b>btbtla</b><span className="channel-status 正常">正常</span><label className="toggle"><input type="checkbox" checked={sourceEnabled} onChange={event=>setSourceEnabled(event.target.checked)}/><i /></label></div><span>{sourceEnabled?"已启用：按需调用 + 每 12 小时兜底校准。":"已关闭：不会参与资源补充与校准。"}</span><Button onClick={()=>test("btbtla")}>测试连接</Button></div></>}
    {active==="代理设置"&&<><p>外部请求可选走 HTTP 代理；代理异常不会阻塞订阅主流程。</p><div className="setting-choice"><div className="setting-row"><b>启用代理</b><label className="toggle"><input type="checkbox" checked={proxyEnabled} onChange={event=>setProxyEnabled(event.target.checked)}/><i /></label></div><label>HTTP Proxy Host<input defaultValue="clash" disabled={!proxyEnabled}/></label><label>HTTP Proxy Port<input defaultValue="7890" inputMode="numeric" disabled={!proxyEnabled}/></label><Button onClick={()=>test("代理")}>测试连接</Button></div></>}
  </section></div>{toast&&<div className="toast">✓ {toast}</div>}</main>;
}

function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setError(""); setSubmitting(true); try { await login(username.trim(), password); setPassword(""); onLoggedIn(); } catch (reason) { setError(reason instanceof ApiError && reason.status === 401 ? "账号或密码不正确。" : "登录未完成，请稍后重试。"); } finally { setSubmitting(false); } };
  return <main className="login-page"><section className="login-card"><div className="login-brand"><span>115</span>追剧</div><h1>登录</h1><p>使用所有者账号进入。</p><form onSubmit={submit}><label>账号<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label><label>密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="button button--primary login-submit" disabled={submitting}>{submitting ? "登录中…" : "登录"}</button></form></section></main>;
}
export function LegacyApp() { const [authenticated, setAuthenticated] = useState<boolean | null>(null); const [authError, setAuthError] = useState(""); const [page, setPage] = useState<Page>("discover"); const [status, setStatus] = useState<SubscriptionStatus>("none"); const [runStatus, setRunStatus] = useState<RunStatus>("等待更新"); useEffect(() => { void hasSession().then(setAuthenticated); }, []); if (authenticated === null) return <main className="login-page" aria-live="polite"><p className="session-check">正在检查登录状态…</p></main>; if (!authenticated) return <LoginPage onLoggedIn={() => setAuthenticated(true)} />; const handleLogout = async () => { setAuthError(""); try { await logout(); setAuthenticated(false); } catch { setAuthError("退出失败，请稍后重试。"); } }; const body=page === "discover" ? <DiscoverPage openDetail={() => setPage("media")}/> : page === "media" ? <MediaDetail status={status} onFollow={() => setStatus("following")} goSubscription={() => setPage("subscription")} /> : page === "subscription" ? <SubscriptionDetail status={status === "none" ? "following" : status} setStatus={setStatus} runStatus={runStatus} setRunStatus={setRunStatus} back={() => setPage("following")} /> : page === "following" ? <FollowingPage setPage={setPage}/> : page === "history" ? <HistoryPage/> : page === "issues" ? <IssuesPage/> : page === "cleanup" ? <CleanupPage/> : <SettingsPage/>; const tracking=["following","history","issues","cleanup"].includes(page); return <div className="app-shell"><Header page={page} setPage={setPage} onLogout={handleLogout} />{authError&&<p className="auth-notice" role="alert">{authError}</p>}{tracking&&<WatchSubnav page={page} setPage={setPage}/>} {body}<nav className="bottom-nav"><button className={["discover","media"].includes(page) ? "active" : ""} onClick={() => setPage("discover")}>⌂<span>发现</span></button><button className={["subscription","following","history","issues","cleanup"].includes(page) ? "active" : ""} onClick={() => setPage("following")}>▣<span>追剧</span></button><button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>⚙<span>设置</span></button></nav></div>; }

function useDesktopLayout(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => { const media = window.matchMedia("(min-width: 768px)"); const update = () => setDesktop(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  return desktop;
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [page, setPage] = useState<Page>("discover");
  const [selectedMedia, setSelectedMedia] = useState<MediaMetadata | null>(null);
  const [searchResults, setSearchResults] = useState<MediaMetadata[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [discoverSections, setDiscoverSections] = useState<DiscoverSection[]>([]);
  const [discoverState, setDiscoverState] = useState<"loading" | "ready" | "error">("loading");
  const [subscriptionsByMedia, setSubscriptionsByMedia] = useState<Record<string, SubscriptionSummary>>({});
  const [subscriptions, setSubscriptions] = useState<SubscriptionSummary[]>([]);
  const [cleanupCandidates, setCleanupCandidates] = useState<CleanupCandidatePreview[]>([]);
  const [cleanupActionBusy, setCleanupActionBusy] = useState(false);
  const [openedSubscription, setOpenedSubscription] = useState<SubscriptionSummary | null>(null);
  const [subscriptionActivities, setSubscriptionActivities] = useState<SubscriptionActivity[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [subscriptionActionBusy, setSubscriptionActionBusy] = useState(false);
  const desktop = useDesktopLayout();
  const preview = window.location.port === "5173" && new URLSearchParams(window.location.search).has("preview");
  useEffect(() => { void hasSession().then(setAuthenticated); }, []);
  useEffect(() => {
    if (!preview && authenticated !== true) return;
    setDiscoverState("loading");
    void getDiscoverSections().then((result) => {
      setDiscoverSections(result.sections);
      setDiscoverState("ready");
    }).catch(() => {
      setDiscoverSections([]);
      setDiscoverState("error");
    });
  }, [authenticated, preview]);
  useEffect(() => {
    if (authenticated !== true) return;
    void listSubscriptions().then((result) => setSubscriptions(result.items)).catch(() => setSubscriptions([]));
    void listCleanupCandidates().then((result) => setCleanupCandidates(result.items)).catch(() => setCleanupCandidates([]));
  }, [authenticated]);
  const runSearch = (value: string) => {
    const query = value.trim();
    if (!query) { setSearchResults([]); setSearchMessage(null); return; }
    setSearchResults([]); setSearchMessage(null);
    void searchMedia(query).then((result) => { setSearchResults(result.items); setSearchMessage(result.items.length === 0 ? "没找到这部影视" : null); }).catch(() => setSearchMessage("没找到这部影视"));
  };
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 2400); };
  const selectMedia = (id: string) => { setOpenedSubscription(null); setSubscriptionActivities([]); setSelectedMedia(null); void getMedia(id).then(setSelectedMedia).catch(() => setSelectedMedia(null)); };
  const selectedSubscription = openedSubscription ?? (selectedMedia === null ? null : subscriptionsByMedia[selectedMedia.id] ?? null);
  const upsertSubscription = (subscription: SubscriptionSummary) => setSubscriptions((current) => {
    const index = current.findIndex((item) => item.id === subscription.id);
    return index < 0 ? [subscription, ...current] : current.map((item) => item.id === subscription.id ? subscription : item);
  });
  const openSubscription = (id: string) => {
    void getSubscription(id).then((detail) => { setSelectedMedia(detail.media); setOpenedSubscription(detail); setSubscriptionActivities(detail.activities); setPage("subscription"); })
      .catch(() => notify("追剧详情暂时不可用，请稍后重试。"));
  };
  const follow = () => {
    if (selectedMedia === null) return;
    void getSettings().then((settings) => createSubscription({ mediaMetadataId: selectedMedia.id, seasonNumber: 1, targetQuality: settings.defaultTargetQuality })).then((subscription) => {
      setSubscriptionsByMedia((current) => ({ ...current, [selectedMedia.id]: subscription }));
      setOpenedSubscription(subscription); upsertSubscription(subscription);
      notify("已加入追剧");
    }).catch((error: unknown) => notify(error instanceof ApiError ? error.message : "追剧未完成，请稍后重试。"));
  };
  const runSubscriptionAction = (currentSubscription: SubscriptionSummary, action: SubscriptionAction, mediaId?: string) => {
    if (subscriptionActionBusy) return;
    setSubscriptionActionBusy(true);
    void updateSubscription(currentSubscription.id, action).then((subscription) => {
      if (mediaId) setSubscriptionsByMedia((current) => ({ ...current, [mediaId]: subscription }));
      setOpenedSubscription((current) => current?.id === subscription.id ? subscription : current);
      upsertSubscription(subscription);
      void listSubscriptions().then((result) => setSubscriptions(result.items)).catch(() => undefined);
      notify(action === "release" ? "已暂停追更，正在释放当前 Season 内容" : action === "check" ? "已加入检查队列" : action === "upgradeQuality" ? "已加入画质升级队列" : "追剧状态已更新");
    }).catch((error: unknown) => notify(error instanceof ApiError ? error.message : "操作未完成，请稍后重试。")).finally(() => setSubscriptionActionBusy(false));
  };
  const subscriptionAction = (action: SubscriptionAction) => {
    if (selectedSubscription === null) return;
    runSubscriptionAction(selectedSubscription, action, selectedMedia?.id);
  };
  const requestCleanup = (candidateIds: readonly string[]) => {
    if (cleanupActionBusy || candidateIds.length === 0) return;
    setCleanupActionBusy(true);
    const operation = candidateIds.length === 1 ? confirmCleanupCandidate(candidateIds[0]!) : confirmAllCleanupCandidates(candidateIds);
    void operation.then((result) => { setCleanupCandidates((current) => current.filter((item) => !candidateIds.includes(item.id))); notify(`已加入清理队列，共 ${result.accepted} 项`); }).catch((error: unknown) => notify(error instanceof ApiError ? error.message : "清理请求未完成，请稍后重试。 ")).finally(() => setCleanupActionBusy(false));
  };
  const layoutProps = { page, onNavigate: setPage, selectedMedia, searchResults, searchMessage, discoverSections, discoverState, subscriptionsByMedia, subscriptions, cleanupCandidates, onConfirmCleanup: (id: string) => requestCleanup([id]), onConfirmAllCleanup: () => requestCleanup(cleanupCandidates.map((item) => item.id)), cleanupActionBusy, onOpenSubscription: openSubscription, onCardSubscriptionAction: runSubscriptionAction, onSearch: runSearch, onSelectMedia: selectMedia, subscription: selectedSubscription, subscriptionActivities, onFollow: follow, onSubscriptionAction: subscriptionAction, onReleaseRequested: () => subscriptionAction("release"), subscriptionActionBusy, toast };
  if (preview) return desktop ? <DesktopLayout {...layoutProps} /> : <MobileLayout {...layoutProps} />;
  if (authenticated === null) return <main className="login-page" aria-live="polite"><p className="session-check">正在检查登录状态…</p></main>;
  if (!authenticated) return <LoginPage onLoggedIn={() => setAuthenticated(true)} />;
  return desktop ? <DesktopLayout {...layoutProps} /> : <MobileLayout {...layoutProps} />;
}
createRoot(document.getElementById("root")!).render(<App />);
