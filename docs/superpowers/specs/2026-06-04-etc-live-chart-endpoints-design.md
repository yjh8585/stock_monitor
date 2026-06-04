# 기타(/etc) 페이지 차트 끝점 라이브 갱신 확장 — 설계

- 작성일: 2026-06-04
- 상태: 승인됨 (구현 대기)
- 관련: 환율 라이브 패턴(`exchange_rates_live` + `collect_fx_live.py` + `appendLivePoint`)

## 1. 배경 / 목적

기타 페이지의 환율(USD/EUR/CNY)은 일봉 차트 끝점을 `exchange_rates_live`(평일 매시 yfinance fast_info)로 라이브 갱신한다. 반면 지수·원자재·코인·개별종목은 `market_series_daily`/`stock_prices` **일봉 종가만** 그려, 장중 현재가가 반영되지 않는다.

본 작업은 동일한 "일봉 + 라이브 끝점" 패턴을 **미국 국채를 제외한** 나머지 시리즈와 개별 종목으로 확장한다.

## 2. 범위

### 라이브 대상 (메타 기반 자동 선별)
`market_series`에서 **`yf_symbol IS NOT NULL AND series_code NOT IN ('UST10Y','UST30Y')`** 조건으로 선별 = 16종:

- 경제(8): `KOSPI` `KOSDAQ` `SPX` `IXIC` `GOLD` `SILVER` `BTC` `ETH`
- 원자재(6): `ALU` `COPPER` `HRC` `LIT` `WTI` `BRENT`
- 환율 보조(2): `DXY` `EURUSD`
- 개별 종목: `companies.last_price`(이미 `collect_prices_live`가 수집 중) → 차트 끝점만 반영

### 제외
- **미국 국채** `UST10Y`/`UST30Y`/`UST2Y` (사용자 요청). UST2Y는 `yf_symbol` 없음으로 자동 제외, UST10Y/UST30Y는 조건에서 명시 제외.
- `STEEL_KR`(KOMIS), `DUBAI`(FRED 월별), `KCCI`/`KUWI`(KOMSA 주간) — `yf_symbol` 없음, 저빈도 소스라 라이브 무의미.

## 3. 확정된 결정

| 항목 | 결정 |
| --- | --- |
| 실행 주기 | **매일 매시(주말 포함)** — 24/7 코인·선물 변동 반영, 휴장 시장은 마지막값(무해) |
| DXY·EUR/USD | **라이브 포함** (환율 본체와 일관성) |
| 수집 방식 | yfinance `fast_info.last_price` (메타의 `yf_symbol` 재사용) |

## 4. 아키텍처 — 환율 패턴 1:1 대칭

```
일봉(종가)            라이브 끝점                       차트
market_series_daily   market_series_live    →  appendLivePoint  →  SeriesChart
   (기존)             (신규, 매시 fast_info)    (공용, 재사용)
```

환율과의 대응:

| 환율(기존) | 본 작업(신규) |
| --- | --- |
| `exchange_rates_live` | `market_series_live` |
| `collect_fx_live.py` | `collect_market_series_live.py` |
| `collect-fx-live.yml` | `collect-market-series-live.yml` |
| `getLiveExchangeRate()` | `getMarketSeriesLive()` |
| `appendLivePoint()` | **동일 함수 재사용** |

## 5. 컴포넌트 상세

### 5.1 DB 마이그레이션 — `supabase/migrations/20260604000001_create_market_series_live.sql`
```sql
CREATE TABLE market_series_live (
  series_code text PRIMARY KEY REFERENCES market_series(series_code) ON DELETE CASCADE,
  price       numeric NOT NULL,
  updated_at  timestamptz NOT NULL
);
ALTER TABLE market_series_live ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_market_series_live    ON market_series_live FOR SELECT USING (true);
CREATE POLICY service_write_market_series_live ON market_series_live FOR ALL    USING (true);
```
(기존 `market_series_daily`/`exchange_rates_live`와 동일한 공개 SELECT + service_role write RLS.)

### 5.2 수집 스크립트 — `scripts/collect_market_series_live.py`
- `collect_fx_live.py` 패턴 + `scripts/lib/bootstrap.py` `init_script(__file__)`.
- `market_series`에서 라이브 대상(2절 조건) 조회 → 각 `yf_symbol`에 대해 yfinance `fast_info.last_price` → 행 `{series_code, price, updated_at(now UTC)}`.
- `with WriteSession() as w: w.table('market_series_live').upsert(rows, on_conflict='series_code').execute()` — 블록 종료 시 `market_series_live` 태그 자동 revalidate.
- 개별 심볼 실패는 warning 후 스킵(부분 성공 허용).
- `lib/revalidate.py` `COLUMN_TO_TAGS`에 `market_series_live` 매핑 추가.

### 5.3 워크플로 — `.github/workflows/collect-market-series-live.yml`
- cron `30 * * * *` (매일 매시 :30, 기존 fx-live `:0`/fx `:5`/market-series `:15`와 분 분산).
- `workflow_dispatch` 포함. Python 3.13 + requirements + `python collect_market_series_live.py`.

### 5.4 데이터 액세스 — `lib/series.ts`
- `getMarketSeriesLive(seriesCode: string): Promise<LivePoint | null>` 신규 — `'use cache'` + `cacheLife('minutes')` + `cacheTag('market_series_live')`, anon 클라이언트로 `market_series_live`에서 `price,updated_at` `maybeSingle()`.
- `appendLivePoint`의 live 파라미터 타입을 공용 `LivePoint = { value: number; updated_at: string }`로 일반화. `getLiveExchangeRate` 반환을 `{ rate }` → `{ value }`로 정리(환율 호출부 fx 페이지는 객체를 그대로 전달하므로 **동작 불변**, 필드명만 통일).

### 5.5 개별 종목 라이브 끝점 — `lib/stockPrices.ts` / `app/api/stock-prices`
- 개별 종목 시계열은 `getStockPriceSeries(id)`(서버) → `/api/stock-prices` → 클라이언트(`DualStockCard`)에서 fetch.
- **서버(`getStockPriceSeries`)에서** 해당 회사의 `companies.last_price`/`last_updated_at`를 조회해 `appendLivePoint`로 끝점 append 후 반환. 클라이언트 변경 없음.
- `last_price`가 NULL인 회사(라이브 미수집 종목)는 일봉 그대로.

### 5.6 페이지 수정
- `app/etc/economy/page.tsx`: `SINGLE_CODES` 8종 각 차트 data에 `appendLivePoint(daily, live)` 적용. 국채 `MultiSeriesChart`는 미적용(제외).
- `app/etc/commodities/page.tsx`: `ALU/COPPER/HRC/LIT/WTI/BRENT` 라이브 적용. `STEEL_KR`/`DUBAI` 미적용.
- `app/etc/fx/page.tsx`: `DXY`/`EURUSD`에 `getMarketSeriesLive` + `appendLivePoint` 추가.
- 라이브 조회는 페이지의 `Promise.all`에 합류(환율 페이지 기존 방식과 동일).

### 5.7 보조문구 재정정
직전 커밋에서 "일봉(종가)"으로 정정한 문구를, 라이브 적용 항목에 한해 정확히 갱신:
- economy: "지수·금리 5년 일봉 · **지수 끝점 매시간 라이브**(국채 제외) · 전망 매일 KST 06:30"
- commodities: "5년 일봉 · **끝점 매시간 라이브**(Dubai 제외) · Dubai 월별"
- stock-prices: "5년 일봉 종가 · **끝점 매시간 라이브**"
- fx: DXY·EUR/USD도 라이브 대상이 되었음을 반영
(최종 문구는 구현 시 간결화.)

### 5.8 타입 / 문서
- `mcp generate_typescript_types`로 `lib/database.types.ts`에 `market_series_live` 반영.
- `AGENTS.md`: 워크플로 목록(§디렉터리 지도 `.github/workflows`)·수집 스크립트, `lib/revalidate.py` 매핑 언급 갱신.
- `Architecture.md`: §7(테이블 `market_series_live`)·§10(워크플로) 추가.

## 6. 검증

1. **단위 테스트** — `lib/series.test.ts` 신규: `appendLivePoint` 순수 로직(끝점 추가/동일일자 덮어쓰기/과거 무시/빈 시리즈/null). 일반화된 `{ value }` 시그니처 기준.
2. **수집 스크립트** — 로컬 1회 실행(또는 `workflow_dispatch`) 후 `market_series_live` 16행 적재 + `updated_at` 최신 확인. (stdout은 행수만, 가격 값 비노출 불필요 — 사외비 아님이지만 간결 로깅.)
3. **UI** — `npm run dev`로 economy/commodities/fx/stock-prices 차트 끝점이 라이브 값으로 갱신되는지 + 국채는 미변경 확인. 콘솔/네트워크 에러 모니터링.
4. `npm run check-all` 통과 (lint/format/typecheck/test).

## 7. 비범위 (Out of scope)

- 미국 국채 라이브화.
- `STEEL_KR`/`DUBAI`/`KCCI`/`KUWI` 라이브화(소스 저빈도).
- 라이브 값의 전일대비(change_pct) 표시 — 끝점 가격만 반영(YAGNI).
- 라이브 테이블 히스토리 보존(현재값 1행/series_code upsert).
