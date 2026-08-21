export type DoubanHotCategoryKey =
  | "hot-movie" | "latest-movie" | "classic-movie" | "hot-tv" | "tv-domestic"
  | "tv-american" | "tv-korean" | "tv-japanese" | "tv-animation" | "hot-show" | "tv-documentary";

export interface DoubanHotCategory {
  key: DoubanHotCategoryKey;
  title: string;
  type: string;
  category: string;
  api: "movie" | "tv";
}

/** Fixed CloudSaver 0.9.0 mapping; it is intentionally unrelated to 115 storage categories. */
export const doubanHotCategories: readonly DoubanHotCategory[] = [
  { key: "hot-movie", title: "热门电影", type: "全部", category: "热门", api: "movie" },
  { key: "latest-movie", title: "最新电影", type: "全部", category: "最新", api: "movie" },
  { key: "classic-movie", title: "冷门佳片", type: "全部", category: "冷门佳片", api: "movie" },
  { key: "hot-tv", title: "热门电视剧", type: "tv", category: "tv", api: "tv" },
  { key: "tv-domestic", title: "热门国产剧", type: "tv_domestic", category: "tv", api: "tv" },
  { key: "tv-american", title: "热门欧美剧", type: "tv_american", category: "tv", api: "tv" },
  { key: "tv-korean", title: "热门韩剧", type: "tv_korean", category: "tv", api: "tv" },
  { key: "tv-japanese", title: "热门日剧", type: "tv_japanese", category: "tv", api: "tv" },
  { key: "tv-animation", title: "热门动画", type: "tv_animation", category: "tv", api: "tv" },
  // PRD §22.5 is the final verified category mapping and ordering.
  { key: "hot-show", title: "热门综艺", type: "show", category: "show", api: "tv" },
  { key: "tv-documentary", title: "热门纪录片", type: "tv_documentary", category: "tv", api: "tv" }
];
