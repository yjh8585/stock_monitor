# 기타(/etc) 차트 끝점 라이브 갱신 확장 — 구현 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 환율 라이브 끝점 패턴을 미국 국채를 제외한 지수·원자재·코인(16종) + 개별 종목 차트로 확장해, 일봉 차트 끝점이 매시간 현재가로 갱신되게 한다.

**Architecture:** 신규 `market_series_live` 테이블(매시 yfinance fast_info upsert) + `getMarketSeriesLive()` + 공용 `appendLivePoint()`. 개별 종목은 기존 `stock_quotes_5min`(한세 전용) 합성에 `companies.last_price` fallback 추가. 환율(`exchange_rates_live`/`collect_fx_live`)과 1:1 대칭.

**Tech Stack:** Next.js 16 (`'use cache'`/`cacheTag`), Supabase(anon read / service write RLS), Python 3.13 + yfinance + WriteSession, GitHub Actions cron, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-etc-live-chart-endpoints-design.md`

**라이브 대상(16종)**: KOSPI KOSDAQ SPX IXIC GOLD SILVER BTC ETH ALU COPPER HRC LIT WTI BRENT DXY EURUSD — `market_series`에서 `yf_symbol IS NOT NULL AND series_code NOT IN ('UST10Y','UST30Y')`로 자동 선별.

---

## Task 1: `appendLivePoint`를 순수 모듈로 분리 + `{ value }`로 일반화 (TDD)

기존 `lib/series.ts`는 `next/cache`를 import해 Vitest(node)에서 로드 불가. 프로젝트 패턴(순수 로직은 next/cache 없는 별도 파일)에 맞춰 순수 함수를 분리한다.

**Files:**
- Create: `lib/seriesLive.ts`
- Create: `lib/seriesLive.test.ts`
- Modify: `lib/series.ts` (정의 제거 → re-export)

- [ ] **Step 1: 실패 테스트 작성** — `lib/seriesLive.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { appendLivePoint, type SeriesPoint } from './seriesLive';

describe('appendLivePoint', () => {
  const base: SeriesPoint[] = [
    { time: '2026-06-01', value: 100 },
    { time: '2026-06-02', value: 110 },
  ];

  it('live가 null이면 원본 그대로', () => {
    expect(appendLivePoint(base, null)).toEqual(base);
  });

  it('live 일자(KST)가 마지막보다 미래면 새 점 추가', () => {
    const r = appendLivePoint(base, { value: 120, updated_at: '2026-06-03T01:00:00Z' });
    expect(r).toHaveLength(3);
    expect(r.at(-1)).toEqual({ time: '2026-06-03', value: 120 });
  });

  it('live 일자가 마지막과 같으면 끝점 덮어쓰기', () => {
    const r = appendLivePoint(base, { value: 999, updated_at: '2026-06-02T05:00:00Z' });
    expect(r).toHaveLength(2);
    expect(r.at(-1)).toEqual({ time: '2026-06-02', value: 999 });
  });

  it('live 일자가 과거면 원본 그대로', () => {
    expect(appendLivePoint(base, { value: 50, updated_at: '2026-05-30T05:00:00Z' })).toEqual(base);
  });

  it('빈 시리즈면 live 점 1개', () => {
    const r = appendLivePoint([], { value: 77, updated_at: '2026-06-03T01:00:00Z' });
    expect(r).toEqual([{ time: '2026-06-03', value: 77 }]);
  });

  it('updated_at 파싱 불가면 원본 그대로', () => {
    expect(appendLivePoint(base, { value: 1, updated_at: 'invalid' })).toEqual(base);
  });

  it('UTC 20:00Z는 +9h 적용되어 다음날 KST 일자로 추가', () => {
    const r = appendLivePoint(base, { value: 130, updated_at: '2026-06-02T20:00:00Z' });
    expect(r.at(-1)).toEqual({ time: '2026-06-03', value: 130 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- seriesLive`
Expected: FAIL — `Cannot find module './seriesLive'`

- [ ] **Step 3: 순수 모듈 구현** — `lib/seriesLive.ts`

```ts
/**
 * 차트 시계열의 순수 헬퍼. next/cache를 import하지 않아 Vitest(node)에서 단위 테스트 가능.
 * 'use cache' 데이터 액세스는 lib/series.ts에 둔다.
 */

export type SeriesPoint = { time: string; value: number }; // time: 'YYYY-MM-DD'

/** 일봉 끝점에 합성할 라이브 1점 (환율·지수·개별종목 공용) */
export type LivePoint = { value: number; updated_at: string };

/**
 * 일봉 시리즈 끝에 라이브 가격 점을 합쳐 반환.
 *
 * - live KST 일자 > 일봉 마지막 일자 → 새 점 추가 ("오늘" 끝점)
 * - live KST 일자 == 일봉 마지막 일자 → 마지막 점 값을 live로 덮어쓰기
 * - live가 더 오래되거나 없으면 일봉 그대로
 *
 * 과거 일자는 손대지 않음 — 종가가 그대로 유지된다.
 */
export function appendLivePoint(series: SeriesPoint[], live: LivePoint | null): SeriesPoint[] {
  if (!live) return series;
  // updated_at(UTC) → KST(=+9) 기준 'YYYY-MM-DD' 추출
  const utcMs = new Date(live.updated_at).getTime();
  if (!Number.isFinite(utcMs)) return series;
  const kstDate = new Date(utcMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const last = series.at(-1);
  if (!last) return [{ time: kstDate, value: live.value }];
  if (kstDate < last.time) return series;
  if (kstDate === last.time) {
    return [...series.slice(0, -1), { time: kstDate, value: live.value }];
  }
  return [...series, { time: kstDate, value: live.value }];
}
```

- [ ] **Step 4: `lib/series.ts`에서 기존 정의 제거 후 re-export**

`lib/series.ts` line 9 `export type SeriesPoint = ...` 제거하고, import 블록(line 5-7) 아래에 추가:

```ts
import { cacheLife, cacheTag } from 'next/cache';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import logger from '@/lib/logger';
import { appendLivePoint, type SeriesPoint, type LivePoint } from '@/lib/seriesLive';

// 기존 호출부 호환 — SeriesPoint/LivePoint/appendLivePoint는 seriesLive에서 재공급
export { appendLivePoint, type SeriesPoint, type LivePoint };
```

그리고 기존 `appendLivePoint` 함수 정의(현재 line 103-119)와 그 JSDoc(line 94-102)을 **삭제**(seriesLive.ts로 이동했으므로).

- [ ] **Step 5: 테스트 통과 + 타입 확인**

Run: `npm test -- seriesLive`
Expected: PASS (7 tests)

Run: `npm run typecheck`
Expected: 에러 없음 (기존 `import { ..., type SeriesPoint } from '@/lib/series'` 호출부는 re-export로 호환)

- [ ] **Step 6: 커밋**

```bash
git add lib/seriesLive.ts lib/seriesLive.test.ts lib/series.ts
git commit -m "refactor(series): appendLivePoint 순수 모듈 분리 + LivePoint{value} 일반화"
```

---

## Task 2: DB 마이그레이션 — `market_series_live` 테이블

**Files:**
- Create: `supabase/migrations/20260604000001_create_market_series_live.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 지수·원자재·코인 라이브(현재가) 끝점용 테이블.
-- market_series_daily(일봉 종가) 차트 끝점을 매시 yfinance fast_info 값으로 갱신.
-- RLS: exchange_rates_live / market_series_daily와 동일 — anon read, service write.
CREATE TABLE market_series_live (
  series_code text PRIMARY KEY REFERENCES market_series(series_code) ON DELETE CASCADE,
  price       numeric NOT NULL,
  updated_at  timestamptz NOT NULL
);

ALTER TABLE market_series_live ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_read_market_series_live
  ON market_series_live FOR SELECT USING (true);

CREATE POLICY service_write_market_series_live
  ON market_series_live FOR ALL USING (true);
```

- [ ] **Step 2: 원격 DB에 적용**

Supabase MCP `apply_migration` (project_id `tvexumxeobciihlqncal`, name `create_market_series_live`)로 위 SQL 적용.
Expected: 성공, 에러 없음.

- [ ] **Step 3: 적용 확인**

`execute_sql`: `SELECT count(*) FROM market_series_live;` → 0 (빈 테이블 생성 확인).
`execute_sql`로 RLS 정책 2개(anon_read/service_write) 존재 확인.

- [ ] **Step 4: 커밋**

```bash
git add supabase/migrations/20260604000001_create_market_series_live.sql
git commit -m "feat(db): market_series_live 테이블 (지수·원자재 라이브 끝점)"
```

---

## Task 3: TypeScript 타입 재생성

**Files:**
- Modify: `lib/database.types.ts`

- [ ] **Step 1: 타입 재생성**

Supabase MCP `generate_typescript_types`(project_id `tvexumxeobciihlqncal`) 실행 → 결과로 `lib/database.types.ts` 전체 덮어쓰기. `market_series_live` Row/Insert/Update 타입이 포함되는지 확인.

- [ ] **Step 2: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add lib/database.types.ts
git commit -m "chore(types): market_series_live 반영"
```

---

## Task 4: 수집 스크립트 + 캐시 무효화 매핑

**Files:**
- Create: `scripts/collect_market_series_live.py`
- Modify: `scripts/lib/revalidate.py` (COLUMN_TO_TAGS)
- Modify: `app/api/revalidate/route.ts` (ALL_TAGS)

- [ ] **Step 1: 수집 스크립트 작성** — `scripts/collect_market_series_live.py`

```python
#!/usr/bin/env python3
"""
지수·원자재·코인 현재가를 yfinance에서 수집해 market_series_live 테이블을 갱신한다.
대상: market_series에서 yf_symbol이 있고 미국 국채(UST10Y/UST30Y)가 아닌 시리즈.
일봉(market_series_daily) 차트 끝점을 매시 라이브 값으로 갈아치우기 위한 보조 데이터.
"""
import sys
from datetime import datetime, timezone

import yfinance as yf
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import get_client, WriteSession  # noqa: E402

# 미국 국채는 라이브 대상에서 제외 (사용자 정책)
EXCLUDED = {'UST10Y', 'UST30Y'}


def collectMarketSeriesLive() -> None:
  client = get_client()
  meta = (
    client.table('market_series')
    .select('series_code, yf_symbol')
    .not_.is_('yf_symbol', 'null')
    .execute()
    .data
    or []
  )
  targets = [m for m in meta if m['series_code'] not in EXCLUDED]
  if not targets:
    logger.warning('라이브 수집 대상 없음 (market_series.yf_symbol 확인)')
    return

  now_iso = datetime.now(timezone.utc).isoformat()
  rows: list[dict] = []
  for m in targets:
    code, symbol = m['series_code'], m['yf_symbol']
    try:
      price = yf.Ticker(symbol).fast_info.last_price
      if price is None:
        logger.warning(f'{code}({symbol}): last_price 없음, 스킵')
        continue
      rows.append({'series_code': code, 'price': float(price), 'updated_at': now_iso})
    except Exception as e:
      logger.error(f'{code}({symbol}) 현재가 수집 실패: {e}')

  if not rows:
    logger.warning('수집된 라이브 데이터 없음')
    return

  # WriteSession이 __exit__에서 revalidate_for_tables(['market_series_live'])를 자동 호출.
  with WriteSession() as w:
    w.table('market_series_live').upsert(rows, on_conflict='series_code').execute()
  logger.info(f'지수·원자재 라이브 갱신 완료 — {len(rows)}개 시리즈')


if __name__ == '__main__':
  try:
    collectMarketSeriesLive()
  except Exception as e:
    logger.error(f'지수·원자재 라이브 수집 실패: {e}')
    sys.exit(1)
```

> 참고: `init_script(__file__)`가 dotenv + sys.path를 처리한다(`scripts/lib/bootstrap.py`). `not_.is_('yf_symbol','null')` 필터가 동작하지 않으면 전체 조회 후 파이썬에서 `if m.get('yf_symbol')`로 필터.

- [ ] **Step 2: revalidate 매핑 추가** — `scripts/lib/revalidate.py` `COLUMN_TO_TAGS`

line 59 `'market_series_daily': ['market_series_daily'],` 아래에 추가:

```python
    'market_series_live': ['market_series_live'],
```

- [ ] **Step 3: ALL_TAGS 동기화** — `app/api/revalidate/route.ts`

line 25 `'market_series_daily',` 아래에 추가:

```ts
  'market_series_live',
```

- [ ] **Step 4: 스크립트 import 무결성 확인**

Run: `cd scripts; ./venv/Scripts/python -c "import ast; ast.parse(open('collect_market_series_live.py',encoding='utf-8').read()); print('OK')"`
Expected: `OK` (문법 검증. 실제 수집은 Task 10에서 dry-run)

- [ ] **Step 5: 커밋**

```bash
git add scripts/collect_market_series_live.py scripts/lib/revalidate.py app/api/revalidate/route.ts
git commit -m "feat(collect): 지수·원자재 라이브 현재가 수집 + 캐시 태그 매핑"
```

---

## Task 5: GitHub Actions 워크플로

**Files:**
- Create: `.github/workflows/collect-market-series-live.yml`

- [ ] **Step 1: 워크플로 작성**

```yaml
name: 지수·원자재 라이브 수집 (실시간)

on:
  schedule:
    # 24/7 코인·선물 변동 반영 — 매일 매시 :30 (fx-live :0 / fx :5 / market-series :15 와 분 분산)
    - cron: '30 * * * *'
  workflow_dispatch:

jobs:
  collect:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: scripts

    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: Python 3.13 설정
        uses: actions/setup-python@v5
        with:
          python-version: '3.13'
          cache: 'pip'
          cache-dependency-path: scripts/requirements.txt

      - name: 의존성 설치
        run: pip install -r requirements.txt

      - name: 지수·원자재 라이브 수집
        run: python collect_market_series_live.py
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

          NEXT_REVALIDATE_URL: ${{ secrets.NEXT_REVALIDATE_URL }}
          NEXT_REVALIDATE_SECRET: ${{ secrets.NEXT_REVALIDATE_SECRET }}
```

- [ ] **Step 2: 커밋**

```bash
git add .github/workflows/collect-market-series-live.yml
git commit -m "ci(collect): 지수·원자재 라이브 수집 워크플로 (매일 매시 :30)"
```

---

## Task 6: 데이터 액세스 — `getMarketSeriesLive` + 환율 반환 `value` 정리

**Files:**
- Modify: `lib/series.ts`

- [ ] **Step 1: `getLiveExchangeRate` 반환을 `{ value }`로 정리**

`lib/series.ts`의 `getLiveExchangeRate`(현재 line 73-92)에서:
- 반환 타입 `Promise<{ rate: number; updated_at: string } | null>` → `Promise<LivePoint | null>`
- 마지막 `return { rate: Number(data.rate), updated_at: ... }` → `return { value: Number(data.rate), updated_at: data.updated_at as string };`

(fx 페이지 호출부는 객체를 그대로 `appendLivePoint`에 넘기므로 동작 불변.)

- [ ] **Step 2: `getMarketSeriesLive` 추가** — `getLiveExchangeRate` 바로 아래에 삽입

```ts
/**
 * 지수·원자재·코인 라이브 현재가 조회 (market_series_live).
 * 매시 cron(yfinance fast_info)이 갱신. 차트 끝점 합성용 — cache는 minutes.
 */
export async function getMarketSeriesLive(seriesCode: string): Promise<LivePoint | null> {
  'use cache';
  cacheLife('minutes');
  cacheTag('market_series_live');
  const sb = createSupabaseAnonClient();
  const { data, error } = await sb
    .from('market_series_live')
    .select('price,updated_at')
    .eq('series_code', seriesCode)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, seriesCode }, 'market_series_live 조회 실패');
    return null;
  }
  if (!data) return null;
  return { value: Number(data.price), updated_at: data.updated_at as string };
}
```

- [ ] **Step 3: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add lib/series.ts
git commit -m "feat(series): getMarketSeriesLive + getLiveExchangeRate value 통일"
```

---

## Task 7: 페이지 차트 끝점 라이브 적용 (economy / commodities / fx)

**Files:**
- Modify: `app/etc/economy/page.tsx`
- Modify: `app/etc/commodities/page.tsx`
- Modify: `app/etc/fx/page.tsx`

- [ ] **Step 1: economy 페이지** — 8종 라이브 합성

import에 `appendLivePoint`, `getMarketSeriesLive` 추가:
```ts
import {
  getMarketSeries,
  getMarketSeriesLive,
  appendLivePoint,
  getSeriesMetaByCategory,
  getEconomyOutlook,
  type SeriesMeta,
} from '@/lib/series';
```

`Promise.all`에 8종 라이브 조회를 추가하고(국채 tnx/irx/tyx는 제외), 각 일봉을 `appendLivePoint`로 합성한다. 기존 `getMarketSeries('KOSPI')` 등 8개 뒤에 라이브 8개를 이어 받는다:

```ts
const [
  tnx, irx, tyx, kospi, kosdaq, spx, ixic, gold, silver, btc, eth, metas, outlook,
  kospiL, kosdaqL, spxL, ixicL, goldL, silverL, btcL, ethL,
] = await Promise.all([
  getMarketSeries('UST10Y'), getMarketSeries('UST2Y'), getMarketSeries('UST30Y'),
  getMarketSeries('KOSPI'), getMarketSeries('KOSDAQ'), getMarketSeries('SPX'),
  getMarketSeries('IXIC'), getMarketSeries('GOLD'), getMarketSeries('SILVER'),
  getMarketSeries('BTC'), getMarketSeries('ETH'),
  getSeriesMetaByCategory('economy'), getEconomyOutlook(),
  getMarketSeriesLive('KOSPI'), getMarketSeriesLive('KOSDAQ'), getMarketSeriesLive('SPX'),
  getMarketSeriesLive('IXIC'), getMarketSeriesLive('GOLD'), getMarketSeriesLive('SILVER'),
  getMarketSeriesLive('BTC'), getMarketSeriesLive('ETH'),
]);
```

`dataOf` switch가 반환하는 각 시리즈를 라이브 합성본으로 교체한다 — `dataOf` 내부를 합성된 상수로 변경:
```ts
const liveByCode: Record<string, ReturnType<typeof appendLivePoint>> = {
  KOSPI: appendLivePoint(kospi, kospiL),
  KOSDAQ: appendLivePoint(kosdaq, kosdaqL),
  SPX: appendLivePoint(spx, spxL),
  IXIC: appendLivePoint(ixic, ixicL),
  GOLD: appendLivePoint(gold, goldL),
  SILVER: appendLivePoint(silver, silverL),
  BTC: appendLivePoint(btc, btcL),
  ETH: appendLivePoint(eth, ethL),
};
```
그리고 `dataOf(code)`를 `liveByCode[code]` 참조로 단순화(기존 switch 제거). 국채 `MultiSeriesChart`의 `tnx/irx/tyx`는 그대로(라이브 미적용).

- [ ] **Step 2: commodities 페이지** — ALU/COPPER/HRC/LIT/WTI/BRENT 라이브

`commodities/page.tsx`는 `metas.filter(hasData)`로 동적 fetch한다. 라이브 대상 집합을 정의하고, `hasData`인 시리즈에 대해 라이브를 병렬 조회 후 합성한다:

```ts
import { getMarketSeries, getMarketSeriesLive, appendLivePoint, getSeriesMetaByCategory } from '@/lib/series';

const LIVE_CODES = new Set(['ALU', 'COPPER', 'HRC', 'LIT', 'WTI', 'BRENT']); // STEEL_KR/DUBAI 제외

// ...
const dataByCode = Object.fromEntries(
  await Promise.all(
    metas
      .filter((m) => m.hasData)
      .map(async (m) => {
        const daily = await getMarketSeries(m.series_code);
        if (!LIVE_CODES.has(m.series_code)) return [m.series_code, daily] as const;
        const live = await getMarketSeriesLive(m.series_code);
        return [m.series_code, appendLivePoint(daily, live)] as const;
      })
  )
);
```

- [ ] **Step 3: fx 페이지** — DXY/EURUSD 라이브 추가

`fx/page.tsx`의 `Promise.all`에 `getMarketSeriesLive('DXY')`, `getMarketSeriesLive('EURUSD')`를 추가하고, 기존 `dxy`/`eurusd`를 합성본으로 교체:

```ts
const [usd, eur, cny, dxy, eurusd, metas, usdLive, eurLive, cnyLive, dxyLive, eurusdLive] =
  await Promise.all([
    getExchangeRateSeries('USD'), getExchangeRateSeries('EUR'), getExchangeRateSeries('CNY'),
    getMarketSeries('DXY'), getMarketSeries('EURUSD'),
    getSeriesMetaByCategory('fx_extra'),
    getLiveExchangeRate('USD'), getLiveExchangeRate('EUR'), getLiveExchangeRate('CNY'),
    getMarketSeriesLive('DXY'), getMarketSeriesLive('EURUSD'),
  ]);
// ...
const dxyData = appendLivePoint(dxy, dxyLive);
const eurusdData = appendLivePoint(eurusd, eurusdLive);
```
import에 `getMarketSeriesLive` 추가. `<SeriesChart ... data={dxy} />` → `data={dxyData}`, `data={eurusd}` → `data={eurusdData}`.

- [ ] **Step 4: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add app/etc/economy/page.tsx app/etc/commodities/page.tsx app/etc/fx/page.tsx
git commit -m "feat(etc): 지수·원자재·DXY·EURUSD 차트 끝점 라이브 합성"
```

---

## Task 8: 개별 종목 `last_price` fallback

**Files:**
- Modify: `lib/stockPrices.ts`

- [ ] **Step 1: `appendLivePoint` import 추가**

`lib/stockPrices.ts` line 9 `import type { SeriesPoint } from '@/lib/series';`를 다음으로 교체:
```ts
import { appendLivePoint, type SeriesPoint } from '@/lib/series';
```
그리고 line 51-52 사이 캐시 태그에 `cacheTag('companies');` 추가(last_price 변경 시 무효화).

- [ ] **Step 2: 5분봉 없는 종목에 fallback 추가**

`getStockPriceSeries`의 stock_quotes_5min 합성 블록(현재 line 85-98)을 다음으로 교체 — 5분봉이 있으면 기존대로, 없으면 `companies.last_price`로 끝점 합성:

```ts
  const last = lastQuote?.[0];
  if (last) {
    // ts(UTC) → KST 일자
    const kstDate = new Date(new Date(last.ts).getTime() + 9 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const price = Number(last.price);
    const lastSeries = series[series.length - 1];
    if (lastSeries && lastSeries.time === kstDate) {
      lastSeries.value = price;
    } else if (!lastSeries || lastSeries.time < kstDate) {
      series.push({ time: kstDate, value: price });
    }
    return series;
  }

  // 5분봉이 없는 종목(한세 외) — companies.last_price를 fallback 끝점으로 합성.
  // collect_prices_live가 매시 갱신하는 KR·글로벌 종목이 대상.
  const { data: company } = await sb
    .from('companies')
    .select('last_price,last_updated_at')
    .eq('id', companyId)
    .maybeSingle();
  if (company?.last_price != null && company.last_updated_at) {
    return appendLivePoint(series, {
      value: Number(company.last_price),
      updated_at: company.last_updated_at as string,
    });
  }
  return series;
```

- [ ] **Step 3: 타입 체크**

Run: `npm run typecheck`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add lib/stockPrices.ts
git commit -m "feat(stock-prices): 5분봉 없는 종목에 last_price fallback 끝점"
```

---

## Task 9: 보조문구 재정정

직전 커밋(`038ab50`)에서 "일봉(종가)"으로 바꾼 문구를, 라이브 적용 후 상태에 맞게 정정한다.

**Files:**
- Modify: `app/etc/economy/page.tsx`
- Modify: `app/etc/commodities/page.tsx`
- Modify: `app/etc/stock-prices/page.tsx`
- Modify: `app/etc/fx/page.tsx`

- [ ] **Step 1: economy** — 현재 "지수·금리 5년 일봉(종가) · 전망 매일 KST 06:30 갱신"

```
미국 국채(30Y/10Y/2Y) · 한국·미국 주가지수 · 금/은 · 비트코인·이더리움 · 미국 경제 전망
노트 · 5년 일봉 + 지수 끝점 매시간 라이브(국채 제외) · 전망 매일 KST 06:30 갱신
```

- [ ] **Step 2: commodities** — 현재 "...(5년 일봉) · Dubai (월별) · 매일 KST 06:00 갱신"

```
알루미늄·구리·철강·리튬·WTI·Brent (5년 일봉 + 끝점 매시간 라이브) · Dubai (월별) · 매일 KST 06:00 갱신
```

- [ ] **Step 3: stock-prices** — 현재 "...(5년 일봉, 종가 기준) · 매일 KST 06:00 갱신" → 재정정

```
국내·해외 종목 2개를 선택해 듀얼 Y축으로 비교 (5년 일봉, 종가 기준) · 주요 종목 끝점 장중 라이브
```

- [ ] **Step 4: fx** — 현재 "...USD·EUR·CNY 차트 끝점은 평일 매시간 라이브 갱신"

```
USD·EUR·CNY → KRW · 달러 인덱스(DXY) · EUR/USD (5년 일봉) · 차트 끝점은 매시간 라이브 갱신
```

- [ ] **Step 5: format + 커밋**

Run: `npm run format`
```bash
git add app/etc/economy/page.tsx app/etc/commodities/page.tsx app/etc/stock-prices/page.tsx app/etc/fx/page.tsx
git commit -m "docs(etc): 라이브 적용 반영해 보조문구 재정정"
```

---

## Task 10: 문서 갱신 (AGENTS.md / Architecture.md)

**Files:**
- Modify: `AGENTS.md`
- Modify: `Architecture.md`

- [ ] **Step 1: Architecture.md**
- §7(데이터 모델): `market_series_live` 테이블(series_code PK→market_series, price, updated_at; anon read/service write RLS) 추가.
- §10(워크플로): `collect-market-series-live.yml`(매일 매시 :30, 지수·원자재 라이브) 한 줄 추가.

- [ ] **Step 2: AGENTS.md**
- 디렉터리 지도 `.github/workflows` 또는 데이터 흐름에서 라이브 수집 워크플로 언급(기존 fx-live 옆).
- `scripts/` `collect_*` 설명에 `collect_market_series_live.py` 포함되는지 확인(prefix 컨벤션이라 명시 불필요하면 생략).

- [ ] **Step 3: 커밋**

```bash
git add AGENTS.md Architecture.md
git commit -m "docs: market_series_live 테이블·라이브 워크플로 반영"
```

---

## Task 11: 통합 검증

- [ ] **Step 1: 수집 dry-run (실 적재)**

Run: `cd scripts; ./venv/Scripts/python collect_market_series_live.py`
Expected: 로그 "지수·원자재 라이브 갱신 완료 — 16개 시리즈"(휴장 심볼 일부 스킵 가능, ≥10이면 정상).

`execute_sql`: `SELECT count(*), max(updated_at) FROM market_series_live;` → 행수 ≥10, updated_at 최신 확인.

- [ ] **Step 2: 전체 정적 검사**

Run: `npm run check-all`
Expected: lint/typecheck/test 통과. (format:check가 기존 `Architecture.md` 미포맷으로 실패하면, `npm run format`으로 정리 후 재실행 — 단 Architecture.md 변경은 Task 10 커밋에 포함.)

- [ ] **Step 3: UI 골든 패스 확인**

Run: `npm run dev` 후 브라우저로:
- `/etc/economy`: KOSPI·SPX·BTC 등 차트 끝점이 최신값(오늘 일자) 표시. 국채 차트는 변동 없음. 콘솔/네트워크 에러 없음.
- `/etc/commodities`: WTI·구리 끝점 라이브, Dubai는 월별 그대로.
- `/etc/fx`: DXY·EUR/USD 끝점 라이브.
- `/etc/stock-prices`: ① 한세실업(5분봉 유지) ② 현대차(005380, last_price fallback 끝점) ③ last_price 없는 종목(일봉 유지) 확인.

- [ ] **Step 4: 최종 커밋(있으면) + 요약**

검증 중 수정이 있었다면 커밋. 없으면 완료.
```bash
git log --oneline feat/etc-live-chart-endpoints ^master
```

---

## Self-Review 메모 (작성자 확인)

- **Spec 커버리지**: 5.1 테이블(T2) / 5.2 스크립트+revalidate(T4) / 5.3 워크플로(T5) / 5.4 series(T1,T6) / 5.5 개별종목 fallback(T8) / 5.6 페이지(T7) / 5.7 문구(T9) / 5.8 타입·문서(T3,T10) / 6 검증(T11) — 전 항목 매핑됨.
- **타입 일관성**: `LivePoint = { value, updated_at }`를 T1에서 정의, T6 `getLiveExchangeRate`/`getMarketSeriesLive` 반환·T8 호출 모두 동일. `appendLivePoint` 시그니처 통일.
- **국채 제외**: 수집(EXCLUDED)·economy 페이지(라이브 8종에서 UST 제외) 양쪽 반영.
