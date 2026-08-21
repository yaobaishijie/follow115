export type DiscoverItem = { id: string; title: string; cardSubtitle: string; rating: number | undefined; posterUrl?: string };
export type DiscoverSection = { key: string; title: string; items: readonly DiscoverItem[] };

const categories = [["hot-movie", "热门电影"], ["latest-movie", "最新电影"], ["classic-movie", "冷门佳片"], ["hot-tv", "热门电视剧"], ["tv-domestic", "热门国产剧"], ["tv-american", "热门欧美剧"], ["tv-korean", "热门韩剧"], ["tv-japanese", "热门日剧"], ["tv-animation", "热门动画"], ["tv-documentary", "热门纪录片"], ["hot-show", "热门综艺"]] as const;
const titles = ["最后生还者 第二季", "藏海传", "折腰", "人生切割术 第二季", "沙丘 2", "苦尽柑来遇见你", "怪奇物语 第五季", "哪吒之魔童闹海", "黑镜 第七季"];
const years = [2025, 2025, 2024, 2024, 2023, 2022, 2021, 2020, 2019];

/** Local UI fixture. Replace this boundary with an injected adapter when the service is available. */
export const discoverFixture: readonly DiscoverSection[] = categories.map(([key, title], sectionIndex) => ({ key, title, items: titles.map((itemTitle, itemIndex) => ({ id: `${key}-${itemIndex}`, title: itemIndex === 0 ? itemTitle : `${itemTitle}${sectionIndex % 3 === 0 ? "" : ` · ${title}`}`, cardSubtitle: `${years[itemIndex]} / ${itemIndex % 2 === 0 ? "剧情" : "喜剧"}`, rating: itemIndex === 7 && sectionIndex % 2 === 0 ? undefined : Math.max(5.8, 9.1 - itemIndex * 0.28) })) }));

export function formatRating(value: number | undefined): string { return value !== undefined && value > 0 ? value.toFixed(1) : "--"; }
export function recommendationTag(value: number | undefined): "待评分" | "神作" | "推荐" | "可看" | "一般" { if (value === undefined || value <= 0) return "待评分"; if (value >= 8.5) return "神作"; if (value >= 7.5) return "推荐"; if (value >= 6.5) return "可看"; return "一般"; }
