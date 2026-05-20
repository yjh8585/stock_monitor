# Tier 1 Frontend 리뷰

## 🔴 Critical (즉시 수정 권장)
- [app/api/revalidate/route.ts:14,59] Route Handler에서 `updateTag()`를 호출하고 있습니다. Next.js 16 로컬 문서 기준 `updateTag`는 Server Action 전용이며, Route Handler에서는 `revalidateTag(tag, 'max')`를 써야 합니다. 현재 `/api/revalidate`가 런타임에서 실패하거나 캐시 무효화가 동작하지 않을 수 있습니다.

## 🟠 High (사용자 영향 큼)
- [app/api/revalidate/route.ts:17-26,54-55] `tag=all` 설명은 “모든 페이지 캐시 무효화”인데 실제 `ALL_TAGS`에는 `oem_sales_model_country_month`, `oem_model_outlook`, `pnl_entries`, `pnl_cost_structure`, `stock_prices`, `stock_quotes_5min`, `posts` 등이 빠져 있습니다. `app/oem/page.tsx`, `app/management/pnl/page.tsx`, `lib/stockPrices.ts` 캐시는 `all`로 갱신되지 않아 화면이 오래 stale 상태로 남을 수 있습니다.
- [app/layout.tsx:32-34, components/layout/AppShell.tsx:5] 루트 `<body>` 전체를 `Suspense fallback={null}`로 감싸고 그 안에서 `cookies()` 기반 `getCurrentUser()`를 기다립니다. cacheComponents/PPR 관점에서 초기 shell이 빈 화면이 될 수 있고, auth 조회 지연이 모든 페이지 LCP를 막습니다. 사이드바/auth만 별도 Suspense로 분리하거나 최소한 레이아웃 skeleton을 제공하는 편이 안전합니다.
- [components/management/pnl/YoyMonthlyCompare.tsx:25-39] 등 PNL 차트들이 Recharts primitive를 각각 `next/dynamic(..., { ssr:false })`로 쪼개 import합니다. 여러 컴포넌트에서 같은 패턴이 반복되어 chunk/waterfall이 커질 가능성이 큽니다. 차트별 client wrapper 하나에서 Recharts를 정적 import하거나 공용 chart client module로 묶는 쪽이 낫습니다.

## 🟡 Medium (개선 필요)
- [components/related-stocks/NewsModal.tsx:68-70] `opened`를 첫 클릭 때 바로 `true`로 고정해 실패/빈 결과 이후 재시도가 불가능합니다. 모달을 닫았다 열어도 다시 fetch하지 않아 뉴스가 계속 비어 보일 수 있습니다.
- [components/hansae/HansaeNewsPanel.tsx:21-38], [components/stock-popup/PopupNewsSection.tsx:58-85] fetch 취소를 boolean flag로만 처리합니다. stale setState는 막지만 네트워크 요청은 계속 살아 있습니다. `AbortController`를 붙이면 모달/카드 전환 시 불필요한 요청과 rate limit 소모를 줄일 수 있습니다.
- [lib/hansae/data.ts:211-253] Supabase client에 `as any`를 사용하고 eslint를 끄고 있습니다. strict TS 범위에서 테이블 타입 누락을 감추는 형태라, 컬럼명 변경/타입 변경이 컴파일에서 잡히지 않습니다.
- [components/common/StickyTable.tsx:121-133] `touchmove` 리스너는 `{ passive: true }`로 등록하고 제거 시 옵션 없이 제거합니다. 일부 브라우저 조합에서 리스너 제거 일관성이 떨어질 수 있으므로 동일 옵션 객체/boolean을 맞추는 편이 안전합니다.

## 🟢 Low / Nit
- [components/related-stocks/NewsModal.tsx:82,100,104] 클라이언트 `console.error`가 사용자 동작마다 남습니다. 운영 환경에서는 logger/telemetry 또는 dev guard가 더 적절합니다.
- [components/related-stocks/CustomerBadges.tsx:61] key가 `${customerName(c)}-${i}`라 순서 변경 시 remount가 발생할 수 있습니다. 로고/고객의 안정 ID가 있으면 그 값을 key로 쓰는 편이 좋습니다.
- [app/compare/page.tsx], [app/reports/page.tsx], [app/hansae/page.tsx] 등 일부 app route에 segment-level `loading.tsx`/`error.tsx`가 없습니다. 현재 일부는 직접 Suspense를 쓰지만, route navigation UX와 에러 복구 일관성은 segment 파일을 맞추는 쪽이 좋습니다.

## 📁 파일별 요약
- app/api/revalidate/: `updateTag` 오용과 `tag=all` 누락이 가장 큰 캐시 리스크입니다.
- app/layout.tsx / components/layout/: 루트 Suspense가 빈 화면 fallback이라 초기 렌더 성능에 불리합니다.
- components/management/pnl/: Recharts dynamic import 방식이 과도하게 분산되어 번들/로딩 비용이 커질 수 있습니다.
- components/related-stocks, stock-popup, hansae/: 뉴스 fetch 재시도/취소 처리 개선 여지가 있습니다.
- lib/hansae/data.ts: `any` 우회가 남아 있어 타입 안정성이 약합니다.

## ⚠️ 검토 제한
- 현재 권한 정책에서 `npm run typecheck` 실행이 차단되어 실제 타입체크/빌드 결과는 확인하지 못했습니다. 코드 근거와 Next.js 16 로컬 문서 기준으로 정적 리뷰했습니다.