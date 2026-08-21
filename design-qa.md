**Source visual truth**

- Mobile discovery reference: `/var/folders/ps/8b2bkzqx78s1rmytsmgc8_fc0000gn/T/codex-clipboard-9c1472fa-da65-4fe4-af68-c8531e16b9a6.png`
- PC discovery reference: `/var/folders/ps/8b2bkzqx78s1rmytsmgc8_fc0000gn/T/codex-clipboard-b1c10176-7525-46ae-b163-f4efe20cf807.png`
- Where labels conflict, PRD §3.1 / §14 takes precedence: the 11 discover sections are CloudSaver’s fixed native categories, rather than the images’ placeholder section names.

**Verification evidence**

- Implementation: `http://127.0.0.1:5173/?preview=layout` (development-only visual preview; production keeps its authentication gate)
- Mobile capture: `580 × 852` CSS pixels. DOM contains `.mobile-layout` and `.m-tabs`; it contains neither `.desktop-layout` nor `.desktop-header`.
- Desktop capture: `1440 × 1024` CSS pixels. DOM contains `.desktop-layout` and `.desktop-header`; it contains neither `.mobile-layout` nor `.m-tabs`. The discovery grid has five computed columns.

**Comparison history**

1. PC discovery initially exposed a three-card row; changed it to the five-card desktop density shown by the PC reference.
2. Mobile and PC references were captured alongside their corresponding implementation screenshots in the in-app browser. Both retain their intended navigation pattern: mobile bottom tabs only; PC top navigation only.
3. Discover data was aligned to PRD’s exact 11-category order: 热门电影、最新电影、冷门佳片、热门电视剧、热门国产剧、热门欧美剧、热门韩剧、热门日剧、热门动画、热门纪录片、热门综艺.

**Findings**

- [Resolved P1] No responsive-shell mixing remains at either verified breakpoint.
- [Resolved P2] PC discovery uses a five-card row; mobile uses a three-column, three-row card grid.
- [Intentional] The first visual section reads `热门电影`, not the reference’s `热门推荐`, because PRD explicitly calls the image labels placeholders and fixes the category order.

**Implementation checklist**

- [x] Exactly one independent layout renders at each breakpoint.
- [x] Desktop uses only top navigation; mobile uses only bottom navigation.
- [x] Settings uses PRD’s five entries and eight storage categories.
- [x] PC channel settings supports add, edit, enable/disable, check, delete, order, and batch import.
- [x] Root build, lint, typecheck, and test suite pass.

final result: passed
