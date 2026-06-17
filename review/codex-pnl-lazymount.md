**Findings**

- Medium: `Insights` placeholder height is likely too small on mobile. [PnlDashboard.tsx](C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/management/pnl/PnlDashboard.tsx:97) uses `minHeight={900}`, but `Insights` stacks 3 chart sections on mobile, each using `useChartHeight(280, 360, 420)`. Mobile actual height can easily exceed `900px`, so below content will jump when mounted. Desktop may be closer because the grid becomes two rows.

- Medium: `LazyMount` removes the placeholder `minHeight` after mount. [LazyMount.tsx](C:/Users/junghwan.yoon/workspace/1.테스트/stock_monitor/components/common/LazyMount.tsx:56) switches to `style={undefined}` once mounted. If the reserved height is larger than actual content, the page shifts upward; if smaller, it shifts downward. For CLS, keep `minHeight` after mount: `style={{ minHeight }}`. Natural content can still exceed it.

- Low: single numeric `minHeight` is not responsive enough for these sections. `MarginScatter` actual desktop height is chart `460` plus header/padding, so `minHeight={460}` under-reserves on desktop; on mobile it may over-reserve. Prefer `minHeight` as `number | string`, or add a `className`/`placeholderClassName` so callers can use responsive Tailwind min-heights.

Everything else looks acceptable.

`IntersectionObserver` lifecycle is sound: observes once, disconnects on first intersection, cleanup disconnects on unmount, and the `mounted` dependency does not cause a leak. SSR/hydration is also okay because both server and first client render start with `mounted=false`; the fallback only updates in an effect. The IO-missing fallback via `requestAnimationFrame` is a reasonable way to avoid immediate effect-time state churn.

Basis state behavior is unchanged, but the concern is real: lazy sections still start from local default `'consolidated'`. That is not a regression from this patch, just a product decision. If cross-section basis sync matters, lift basis to `PnlDashboard` before or during the later optimization work.

Priority after this patch: fix CLS height handling first, then `aggregate.ts` indexing, then `GroupMultiSelect` caching, then `React.memo`.