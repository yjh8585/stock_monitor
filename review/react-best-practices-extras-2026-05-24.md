# Extras 진단 — compare / hansae / reports (2026-05-24)

> PnL 진단(review/react-best-practices-pnl-2026-05-24.md)에서 발견된 패턴을 다른 페이지로 확장.
> Vercel 공식 `react-best-practices` 64 규칙 / 4개 우선 카테고리(async/bundle/server/rerender) 적용.

## 요약

- 진단 범위: `/compare`, `/hansae`, `/reports`(list+detail)
- 발견: **3건** (HIGH 1, MEDIUM 1, LOW 1)
- Top recommendation: **§2-1 Hansae 회사 안 직렬 await → Promise.all** — 가장 큰 RTT 감소

---

## 1. /compare

`app/compare/page.tsx` + `lib/compareData.ts` + `components/compare/CompareDashboard.tsx`/`MetricCard.tsx`

### 1-1. ✅ 통과 — 모범 패턴

- `getCompareCompanies`/`getCompareFinancials` 모두 `'use cache'` + `cacheTag`
- `getCompareFinancials`는 **컬럼 명시 select** (이미 server-serialization 적용)
- `MetricCard`는 방금 `dynamic()`로 wrap (확장 #1)
- `useChartHeight` 단일 구독화 (S3) 자동 효과

### 1-2. 경미 — `getCompareCompanies` 2회 직렬 query

`lib/compareData.ts:19-39`
```ts
// company_pages → companies — 의존 쿼리 (ids → 본문)
const { data: mapping } = await sb.from('company_pages').select('company_id').eq('page', 'compare');
const ids = (mapping ?? []).map((r) => r.company_id);
const { data } = await sb.from('companies').select('id,name_kr').in('id', ids);
```

**평가**: 두 번째가 첫 번째 결과(ids)에 의존 → 직렬 정당. `'use cache'`로 hit 시 비용 0. **유지 권고**.

**선택 옵션**: Supabase nested select(`company_pages.companies(...)`)로 1회 RTT 축소 가능하지만 `cacheLife='hours'`라 ROI 미미.

---

## 2. /hansae 🚩

`app/hansae/page.tsx` + `lib/hansae/data.ts` + `components/hansae/HansaeDashboard.tsx`

### 2-1. **회사 안 7회 직렬 await — HIGH (Top recommendation)** 🚩

`app/hansae/page.tsx:48-60`

**Bad (현재)**
```ts
const initial = await Promise.all(
  companies.map(async (c) => ({
    company: c,
    daily: await getDailyPrices(c.id, 5),         // RTT 1
    intraday: await getIntradayQuotes(c.id),      // RTT 2
    posts: await getRecentBoardPosts(c.id, 5),    // RTT 3
    sentiment: await getSentimentSummary(c.id, 7),// RTT 4
    supply: await getRecentSupplyDemand(c.id, 5), // RTT 5
    intradaySupply: await getIntradaySupply(c.id),// RTT 6
    todayNews: await getTodayNews(c.id, 8),       // RTT 7
  }))
);
```

회사별 `Promise.all`로 회사 단위는 병렬이지만, **각 회사 안의 7개 query는 직렬** → 회사당 7 RTT. 4 회사 × 7 = 합산 시 가장 느린 회사의 7 RTT가 critical path.

**Good**
```ts
const initial = await Promise.all(
  companies.map(async (c) => {
    const [daily, intraday, posts, sentiment, supply, intradaySupply, todayNews] =
      await Promise.all([
        getDailyPrices(c.id, 5),
        getIntradayQuotes(c.id),
        getRecentBoardPosts(c.id, 5),
        getSentimentSummary(c.id, 7),
        getRecentSupplyDemand(c.id, 5),
        getIntradaySupply(c.id),
        getTodayNews(c.id, 8),
      ]);
    return { company: c, daily, intraday, posts, sentiment, supply, intradaySupply, todayNews };
  })
);
```

회사당 1 RTT (병렬). **`getDailyPrices`(가장 무거움, ~1250행 pagination 1~2 page)가 critical path**. 다른 쿼리는 그 동안 동시 완료.

규칙: `async-parallel`. **즉시 적용 안전 패치 가능**.

### 2-2. 경미 — `createSupabaseAnonClient()` 함수마다 새로 호출

`lib/hansae/data.ts`의 7개 fetch 함수가 모두 `const sb = createSupabaseAnonClient();` 시작. anon 클라이언트 생성 비용은 작지만 모범 패턴은 module-level 싱글톤 또는 caller가 한 번 만들어 전달.

**현재 코드**: 변경 안 함. 함수 단위 캡슐화가 명확함. ROI 작음.

---

## 3. /reports

`app/reports/page.tsx` (list) + `app/reports/[id]/page.tsx` (detail) + `lib/reports/repositories/post.repository.ts`

### 3-1. ✅ 통과 — 모범 패턴 (#3 적용 완료)

- list: `select(POST_LIST_COLUMNS)` — `content`/`key_scenes` 제외 (방금 #3 적용)
- detail: `select('*')` 적절 (본문 필요)
- 두 페이지 모두 `'use cache'` + `cacheTag` + `<Suspense fallback>` 구성
- detail은 `generateStaticParams + 'use cache' + cacheTag(`post:${id}`) + revalidateTag` Cache Components 풀 패턴

### 3-2. 경미 — `getPostsListData`의 3회 Promise.all ✅

`app/reports/page.tsx:64-74`
```ts
const [{ rows, total }, categories, sourceNames] = await Promise.all([
  repo.list(...),
  repo.getDistinctCategories(),
  repo.getDistinctSourceNames(),
]);
```
이미 병렬. 모범 ✅.

---

## 즉시 적용 안전 패치

| # | 위치 | 패치 |
| --- | --- | --- |
| **H1** | `app/hansae/page.tsx:48-60` | 회사 안 7회 직렬 await → `Promise.all`로 묶기 (§2-1) |

총 변경 라인 ~15. 비즈니스 로직 변경 없음, 단순 병렬화.

---

## 다음 단계 권고

1. **H1 즉시 적용 — 추천**: latency 7× 감소, 회귀 위험 매우 낮음
2. Compare/Reports 추가 작업 없음 (모범 패턴)
3. 다른 페이지(domestic/related-stocks/parts-top100/oem) — view 패턴이라 추가 hit 없음. 이전 진단(`react-best-practices-pnl-2026-05-24.md` §3-1) 의 PnL S2가 유일 남은 큰 작업.

— 진단 종료. 핫스팟 1건 (Hansae).
