# 리뷰 범위 (SCOPE)

> 1차 Claude / 2차 Codex 리뷰 대상 범위.
> Tier 1은 **필수**, Tier 2는 **권고**, Tier 3은 **컨텍스트로만**.

---

## 페이지 의존성 트리

```
app/related-stocks/page.tsx (Server Component)
├── lib/supabase/server.ts          ← createSupabaseServerClient
├── lib/types.ts                    ← RelatedStockRow, ExchangeRates
├── lib/logger.ts                   ← Pino
└── components/related-stocks/StockTable.tsx (Client)
    ├── components/common/StickyTable.tsx
    ├── components/related-stocks/StockRow.tsx
    │   ├── components/related-stocks/NewsModal.tsx
    │   │   └── /api/news/search                ← fetch
    │   ├── components/related-stocks/CustomerBadges.tsx
    │   ├── components/related-stocks/ProductCell.tsx
    │   └── components/common/StickyTable.tsx (stickyLeftStyle)
    └── components/related-stocks/FilterBar.tsx
        └── components/common/ToggleFilterBar.tsx

app/domestic/page.tsx (Server Component)
├── lib/supabase/server.ts
├── lib/types.ts                    ← DomesticStockRow, ExchangeRates
├── lib/logger.ts
└── components/domestic/DomesticTable.tsx (Client)
    ├── components/common/StickyTable.tsx
    ├── components/domestic/DomesticRow.tsx
    │   ├── components/related-stocks/NewsModal.tsx   ← 재사용
    │   └── components/common/StickyTable.tsx (stickyLeftStyle)
    └── components/domestic/DomesticFilterBar.tsx
```

행 클릭 시 띄우는 **주가 팝업**:
- `app/stock-popup/[id]/page.tsx`
- `components/stock-popup/IframePanel.tsx` (`AppLayout`에서 사용)

---

## Tier 1 — 필수 리뷰 대상

### 페이지 진입점
- `app/related-stocks/page.tsx`
- `app/domestic/page.tsx`

### 관련주식 컴포넌트
- `components/related-stocks/StockTable.tsx`
- `components/related-stocks/StockRow.tsx`
- `components/related-stocks/FilterBar.tsx`
- `components/related-stocks/NewsModal.tsx` (양쪽 페이지에서 재사용)
- `components/related-stocks/CustomerBadges.tsx`
- `components/related-stocks/ProductCell.tsx`

### 국내자동차 컴포넌트
- `components/domestic/DomesticTable.tsx`
- `components/domestic/DomesticRow.tsx`
- `components/domestic/DomesticFilterBar.tsx`

### 직접 의존하는 lib·types
- `lib/types.ts` (`RelatedStockRow`, `DomesticStockRow`, `ExchangeRates` 등 DTO)
- `lib/supabase/server.ts`
- `lib/logger.ts`

### 두 페이지가 공유하는 공통 컴포넌트
- `components/common/StickyTable.tsx`
- `components/common/ToggleFilterBar.tsx`

### API 라우트
- `app/api/news/search/route.ts`

---

## Tier 2 — 권고 리뷰 대상 (간접 의존)

### 주가 팝업 흐름
- `app/stock-popup/[id]/page.tsx`
- `components/stock-popup/IframePanel.tsx`

### 레이아웃 (관련 페이지가 사용)
- `components/layout/AppLayout.tsx`
- `components/layout/Sidebar.tsx`

### 포맷·헬퍼 lib
- `lib/format.ts`
- `lib/financialFormatter.ts`
- `lib/customerLogos.ts`

### Supabase migrations (관련주식·국내자동차 view 정의)
- `supabase/migrations/20260506000004_create_related_stocks_view.sql` ← 관련주식 view 생성
- `supabase/migrations/20260507000001_add_latest_quarter_to_view.sql`
- `supabase/migrations/20260507000002_add_fin_currency_fx_to_view.sql`
- `supabase/migrations/20260507000003_add_financials_by_quarter_to_view.sql`
- `supabase/migrations/20260507000004_drop_financials_by_quarter_add_yoy.sql`
- `supabase/migrations/20260507000005_drop_unused_tables_and_view.sql`
- `supabase/migrations/20260507000006_add_domestic_page_support.sql` ← 국내자동차 view 지원

---

## Tier 3 — 컨텍스트로만 (깊이 리뷰 X)

- `app/layout.tsx`, `app/globals.css`, `app/page.tsx` (홈)
- `lib/supabase/client.ts`, `lib/utils.ts`
- 기반 테이블 migrations (`create_companies`, `create_financials`, `create_news` 등) — view를 이해하기 위한 컨텍스트
- `components/ui/*` — shadcn/ui 그대로 (커스터마이즈 거의 없음 가정)
- `scripts/` — 데이터 수집 Python 스크립트는 별도 리뷰 사이클로 분리 권장

---

## 제외 (이번 리뷰 대상 아님)

- `app/api/news/search/route.ts` 외 API 라우트 (현재 다른 라우트 없음)
- `next.config.*`, `tsconfig.json`, `tailwind.config.*` (인프라 설정 — 별도)
- 테스트 코드 (현재 테스트 파일 없음)
- `node_modules/`, `.next/`

---

## 최근 관련 커밋 (참고)

```
c28a0e1 chore: 이전 세션 누적 변경사항 일괄 commit
1beb0d3 feat(domestic): 신원/DH그룹 정정 + 제품명 한글 통일
614be44 feat(domestic): /domestic 상장/비상장 필터 + 데이터 정합성 보강
b07750e feat(domestic): /domestic 데이터 보완 — SK이노 제거 + 에스케이온 추가
021c7b9 refactor: 관련회사 페이지 공통 자산 추출
f8c4cf0 feat: DAUCH(DCH) 교체 + 비상장사 홈페이지 링크
6a18d88 fix(ui): 해외 주식 팝업 TradingView 전환 + 상장사 파란색
279a646 feat(ui): 관련주식 페이지 완성 + Phase 3.5 DB/스크립트 추가
```

---

_작성: 2026-05-08_
