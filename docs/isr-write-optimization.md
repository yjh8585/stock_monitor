# ISR Write 최적화 — 조사 결과와 남은 옵션 (재개용)

> 2026-07-14 정밀 조사(workflow `isr-write-analysis`, wf_73103c24) 산출물.
> 관련 메모리: `project_vercel_isr_write_2026_06_04`. Vercel Hobby ISR Writes가 200K 한도 초과(6/4 293K → 7/14 267K) 상태에서, 무엇이 실제로 효과 있는지 확정하고 남은 옵션을 재개 가능하게 기록.

## 1. 핵심: Write 과금 메커니즘 (전략의 전제)

- **ISR Write = 크기(8KB) 기준.** 1 write unit = durable 저장소에 기록된 자동압축 후 8KB. 페이지 재생성 1회 = `⌈압축 payload 바이트 / 8KB⌉` unit.
- **dedup: 재생성이 돌아도 내용이 이전과 같으면 write 0.** (time-based·on-demand 무효화 공통). 3개 주식 페이지 서버 렌더는 결정적(`new Date`/`random` 없음)이라 dedup이 정상 작동.
- 근거: [ISR Usage and Pricing](https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing)("write unit = 8KB", "unchanged revalidation = no write units"), [ISR per-deployment 캐시](https://vercel.com/docs/incremental-static-regeneration)("each new deployment uses its own ISR cache and does not reuse the cache from a previous deployment").
- **함의(중요):**
  - "무효화 빈도 축소 / cacheLife↑"는 실효 제한적 — unchanged 재생성은 이미 0 write.
  - 진짜 레버는 **(a) dedup을 무력화하는 no-prior-version full 재기록 제거** + **(b) payload 바이트 축소**.
  - granularity: 같은 라우트 안에서 `'use cache'` 함수만 쪼개도 ISR route write는 페이지 payload 통짜라 효과 없음 → 실제 payload/무효화 소스를 손봐야 함.

## 2. 완료: 옵션① 백업 커밋 배포 스킵 (최대 무해 레버)

- **무엇:** 매일 백업 봇 커밋(`data/backups`-only)이 프로덕션 재배포를 트리거 → 배포 단위 ISR 캐시 리셋(이전 배포 캐시 미재사용) → 전 라우트가 비교대상 없이 full-payload 재기록(dedup 무력화). 무효화 빈도와 무관한 매일 고정비.
- **조치:** `vercel.json`에 `ignoreCommand: "git diff --quiet HEAD^ HEAD -- . ':!data/backups'"` (백업 전용 커밋 exit 0 → 스킵 / 코드·설정 변경 exit 1 → 빌드). 커밋 `8957162`.
- **검증:** 로컬 diff(백업 exit 0 / 코드 exit 1), 코드 push→배포 정상 트리거(READY). 백업 스킵 실동작은 다음 백업 봇 커밋일에 확인.

## 3. 효과 측정 방법 (옵션2/3 재개 판단 기준)

- Vercel 대시보드 → **Usage → ISR Writes**. 옵션① 배포일(2026-07-14) **이후 백업 봇 커밋일에 write 스파이크가 사라지는지** 확인(배포 시점 대조).
- 267K/200K 대비 얼마나 내려오는지 보고, **여전히 초과면 옵션③(무해) → 옵션②(준무해)** 순으로 재개.

---

## 4. 남은 옵션 상세 (재개용)

세 주식 페이지(`/related-stocks`·`/domestic`·`/parts-top100`)의 공통 구조:
각 `lib/<page>/source.ts`의 단일 `'use cache'`가 `<page>_stocks_view` + `exchange_rates_live` 환율맵을 함께 fetch해 `{rows, rates}` 반환 → 페이지가 client 표에 props 전달. 세 뷰 모두 **주가(`companies.last_price` 등)·환율(`exchange_rates_live` JOIN)·재무(financials 상관 서브쿼리, 무거움)를 한 payload에 포함**.

### 옵션③ — 뷰 `select('*')` → 실제 렌더 컬럼만 (무해, 우선)

- **효과:** size-based라 모든 재기록 write에 곱연산. 매퍼가 안 읽는 뷰 컬럼(중간 계산 FX 컬럼 등) 제외로 payload 바이트↓. 신선도 영향 없음.
- **파일:** `lib/related-stocks/source.ts`(라인 35 `.select('*')`), `lib/domestic/source.ts`, `lib/parts-top100/source.ts`. 대조 대상 매퍼는 `lib/types.ts`.
- **변경:** 각 `.select('*')`를 매퍼가 실제 읽는 컬럼 목록으로 교체.
  - `mapRelatedStockRow`(`lib/types.ts`)가 읽는 컬럼 = `id, ticker, name, name_kr, market, country, currency, status, company_type, region, products, customers, last_price, last_change_pct, last_updated_at, market_cap, business_summary, summary_updated_at, homepage_url, fx_to_krw, fx_fin_to_krw, financials_by_year, latest_quarter` + **정렬 컬럼 `company_type, name_kr`**.
  - `mapDomesticStockRow`는 위에서 `region` 대신 `group_name` + 추가 `latest_revenue_krw, sales_rank`. **정렬 컬럼 `sales_rank`** 포함 필수(parts도 동일 매퍼 재사용).
- **함정:** 매퍼가 읽는 컬럼 **하나라도 빠지면 해당 필드 null**. 매퍼 본문과 1:1 대조 필수. `.order()`에 쓰는 컬럼도 select에 있어야 함.
- **검증:** `npm run typecheck` + `npm run build`(3개 페이지 프리렌더) + dev에서 표 컬럼·정렬 육안 확인.
- **효과폭:** 미사용 컬럼 비중에 비례(불확실) → 먼저 매퍼 대조로 실제 제외 컬럼이 얼마나 되는지 감사 후 판단.

### 옵션② — `exchange_rates_live` 태그를 3개 주식 뷰에서 분리 (준무해)

- **효과:** 주중 `collect_fx_live` ~5회/일이 3개 무거운 뷰(재무 서브쿼리 포함) full-payload를 재기록하던 것 제거 → heavy-view 재기록 이벤트 뷰당 ~30%↓(약 15-19 → 10-14/일). 주가(`companies` 태그) 재기록은 잔존.
- **신선도 trade-off:** FX 환산 컬럼(`fx_to_krw`, domestic/parts의 정렬키 `latest_revenue_krw`)이 다음 `companies`/`financials` 무효화 또는 cacheLife TTL(~1h)까지 **최대 ~1h 지연**. 사용자가 주시하는 `last_price`·등락률은 `companies` 태그로 즉시 갱신되어 무영향. FX 인트라데이 변동 <0.5%라 환산 시총/매출 지연 체감 미미. 단 domestic/parts는 `FX×revenue`가 `sales_rank` 정렬키라 FX 급변 직후 순위가 잠깐 stale.
- **파일:** `scripts/lib/revalidate.py`, `lib/related-stocks/source.ts`·`lib/domestic/source.ts`·`lib/parts-top100/source.ts`, `app/api/revalidate/route.ts`(ALL_TAGS 정합).
- **변경 스텝:**
  1. `scripts/lib/revalidate.py` `COLUMN_TO_TAGS`의 `'exchange_rates_live'` 매핑(현재 `['exchange_rates_live', 'related_stocks_view', 'domestic_stocks_view', 'parts_top100_stocks_view']`)에서 **뷰 태그 3개를 제거**하고 자기 태그(`'exchange_rates_live'`)만 남김.
  2. 3개 `source.ts`에서 `cacheTag('exchange_rates_live')` 제거. 환율맵 fetch(`exchange_rates_live select('base,rate')`)를 **별도 `'use cache'` 함수**(자기 태그 `cacheTag('exchange_rates_live')`만 소비)로 분리해 뷰 캐시와 무효화를 디커플. (`lib/series.ts`의 `getLiveExchangeRate`는 `LivePoint` 형태라 그대로는 부적합 → 표용 얇은 래퍼 추가.) 페이지에서 두 함수 각각 await 후 `{rows, rates}`로 합쳐 전달(client 표 컴포넌트 무수정).
  3. `app/api/revalidate/route.ts`의 `ALL_TAGS`와 정합 확인.
- **함정:** 뷰 SQL은 **여전히 `exchange_rates_live` JOIN 유지**(값 계산은 정확, 무효화 시점만 지연) → 정합성 OK. 완전 디커플(뷰에서 JOIN 제거)까지 가면 fx 계산을 앱/클라이언트로 옮기고 domestic/parts의 `latest_revenue_krw` 정렬을 뷰 밖으로 빼야 해 난이도 급상승(마이그레이션+정렬 재작성) — 태그 분리만으로 대부분의 이득 확보, JOIN 제거는 비권장.
- **검증:** `npm run typecheck` + `npm run build` + FX 갱신이 표에 반영되는지(무효화 경로) dev 확인. revalidate.py는 순수 로직이라 venv로 `_tags_for_tables(['exchange_rates_live'])` 결과에 뷰 태그가 빠졌는지 단위 확인.

### 폐기 / 보류

- **옵션④ cacheLife 'hours'→'days':** dedup 때문에 unchanged 시간기반 재생성은 이미 0 write → 실효 미미. **폐기.**
- **옵션⑤ 24/7 시장 크론 야간 저빈도화:** `/etc`가 최다 무효화(주중 24-28/일)라 대상은 되나, 야간 crypto/지수/FX 신선도 지연 + GHA throttle과 겹쳐 절감 정량화 어려움. 신선도 trade-off. **보류.**
- **옵션⑥ 뷰 수술(재무·FX를 뷰 payload에서 제거):** 이론상 최대 절감이나, 같은 라우트 내 `'use cache'` 분리로는 ISR route write를 못 쪼갬 → 재무를 Runtime Cache(`'use cache: remote'`)/client fetch로 실제 빼야 하고, Runtime Cache 과금 단가가 문서 미확정이라 payoff 불확실 + 마이그레이션/정렬/DTO 광범위 수정. **고위험, 최후.**

## 5. 재개 트리거

대시보드 ISR Writes가 옵션① 이후에도 여전히 200K 초과면:

1. **옵션③**(무해) 먼저 — 매퍼 컬럼 감사 → select 축소 → typecheck/build.
2. 그래도 부족하면 **옵션②**(FX 환산 ~1h 지연 감수) — revalidate.py 매핑 + source.ts 환율 분리.
