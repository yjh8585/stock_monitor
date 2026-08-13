# /oem/competition 재구성 — 설계 spec

- 작성: 2026-08-13
- 상태: **구현 완료**(2026-08-13). `npm run check-all` 통과(테스트 380) · dev 서버 E2E 확인.

## 구현 중 설계에서 바뀐 것 (실측으로 뒤집힌 것)

| 설계 | 실제 | 근거 |
| --- | --- | --- |
| `oem_competition_monthly_view` 를 **일반 뷰**로 (구체화하면 REFRESH 누락 실패 모드가 생긴다고 판단) | **구체화 뷰**(마이그레이션 `20260813000009`) | 일반 뷰 전체 조회 **4,867ms** → PostgREST anon statement timeout(57014) → 판매 추이 차트가 **에러 없이 전 차종에서 통째로 빔**. 구체화 후 **23ms**. REFRESH 는 기존 `refresh_oem_agg_views()` 에 얹어 새 배관을 만들지 않았다(`import_oem_sales.py` 가 이미 호출) |
| NHTSA 경쟁 차종 매핑을 이름 정확 일치로 | **접두 매칭**(`_resolve` + products 끝점) | 정확 일치는 `civic sedan`·`niro hev`·`ram 1500 crew cab` 같은 파생형을 놓치고 **0건 = 안전한 차**로 오독시킨다. 검증 중 **기존 대상 차종 매핑의 실제 누락 3건**(ram_truck 주력 1500 통째 누락 등)이 드러났다 |
| 대상 차종의 미국 기준 지표만 시장 필터 | **경쟁 차종에도 동일 필터** | 셀토스 한국 경쟁군의 Kona·Trailblazer 가 `oem_model_brand` 에 있어 **한국 탭에 미국 재고일수가 붙었다**(실측). 수집기는 시장을 모르므로 `source.ts` 에서 거른다. 회귀 테스트 추가 |
| — | `_load_inventory` 버그 수정 | Cox 가 이상치 달을 비워 둬 최신 1행만 보면 NULL. **Ram 202606=NULL / 202605=144일** 인데 "데이터 없음"으로 저장되고 있었다 |

## 사용자 지시 원문 (2026-08-13)

> oem 페이지의 하부 페이지 경쟁분석을 만들었어.
>
> - 기존의 카드 형식을 그대로 가져왔던데 새로 구성을 했으면 좋겠어.
> - 데이터 잘 수집해서 결론냈던데 이것들을 그래프나 표로 구성해서 하나하나 이해하기 쉽게 잘 전달했으면 좋겠어.
> - 그래프나 표는 기존 양식을 가져와서 써.
> - 재고일수, 판매추이, 점유율, 판매증감 이런 것들은 경쟁사와 비교해서 한 눈에 볼수 있게 차트로 만들어.
> - 소비자 평가도 경쟁차종 대비 어떤지를 차트로 나타내 줘.
> - 레드/옐로우/그린 종합 판단도 있지만, 항목별로도 판단해서 시각적으로 표시해줘.
> - 순서는 스텔란티스, 아틀라스, 리비안, 현대기아 순이야. 스텔란티스에서는 그랜드체로키가 가장 먼저 나와야 해.
> - 위에 언급한 것 외에도 너가 생각하기에 필요한 내용이나 추가하면 좋을 내용도 작성해. 이해하기 쉽고 전달력 높이는 것이 포인트야.

### 확인 질문에 대한 사용자 결정 (2026-08-13)

| 질문 | 결정 |
| --- | --- |
| 소비자 평가 비교 방식 | **AI 5축 레이더 + 리콜 비교** (수집기 재실행 허용) |
| 페이지 뼈대 | **종합 스코어보드 + 차종별 상세** |
| 항목별 신호등 기준 | **수치 규칙 기반**(코드에 임계값 고정) |
| 포르쉐 911 위치 | **현대기아 앞** |

## 현황 조사 결과 (2026-08-13 실측)

| 항목 | 실측 |
| --- | --- |
| 적재 차종 | 10종 (`oem_model_outlook`, note_date=2026-08-13) |
| 화면이 쓰는 컬럼 | `market_breakdown`(시장별 집계) + 서술 5종 + `sources` |
| **화면이 안 쓰는 컬럼** | **`metrics`** — 경쟁차종별 판매·YoY 표, NHTSA 리콜·불만, Cox 재고일수 원본이 전부 들어 있다 |
| 월별 시계열 | `oem_sales_model_country_month`(96.9만 행). 경쟁군 정의로 필터하면 24개월 ≈ **2,120행** |
| Cox 재고일수 | `cox_brand_inventory` 30개 브랜드 × 7개월(최신 202606). **브랜드 단위**(차종 아님) |
| 경쟁군 SSOT | `oem_competitor_set` (13행 = 10차종 × 시장) |
| Cox 미보유 브랜드 | Tesla · Rivian · Lucid → 리비안 경쟁군은 재고일수 비교 불가 |

### 조사 중 발견한 버그

`_load_inventory()`가 `order(year_month desc).limit(1)` 로 최신 1행만 집어 `days_supply` 가 NULL 이면
그대로 NULL 을 담는다. 실측: **Ram 202606=NULL 이지만 202605=144** 가 있다 → 램 픽업이 "재고 데이터
없음"으로 잘못 저장된다. `days_supply IS NOT NULL` 필터를 추가해 고친다.

---

## 1. 아키텍처 — 계산은 어디서 하나

`scripts/lib/competition_metrics.py` docstring 이 **"계산을 Python 한 곳에서만 하고 TypeScript 는
표시만"** 을 못 박아 두었다. 이 원칙을 유지하되, **24개월 시계열만 예외**로 SQL 뷰에서 가져온다.

| 후보 | 채택 여부 | 근거 |
| --- | --- | --- |
| 전부 수집기가 `metrics` JSONB 에 담기 | ❌ | 24개월 × 4모델 × 13시장 시계열이 RSC 페이로드·캐시에 실린다. 이 레포는 이미 Vercel ISR Write 한도를 겪어 `docs/isr-write-optimization.md` 로 관리 중 |
| 전부 TypeScript 에서 계산 | ❌ | 계산 로직이 두 언어로 갈린다(위 docstring 이 금지) |
| **시계열만 SQL 뷰 + 나머지는 `metrics`** | ✅ | 집계는 Python 단일 SSOT 유지, 시계열은 DB 가 필터해 서버에서만 무겁고 화면에는 잘라 보낸다 |

---

## 2. 데이터 계층 변경

### 2-A. 마이그레이션 ① `20260813000007_oem_competition_monthly_view.sql`

```
oem_competition_monthly_view
  model_key · market · market_label · display_order
  model · is_target(bool) · year_month · sales
```

- `oem_competitor_set` 와 `oem_sales_model_country_month` 를 조인해 **경쟁군에 속한 모델의 월별 판매**만 남긴다.
- `countries IS NULL` 이면 전 국가 합산(GLOBAL), 아니면 `country = ANY(countries)`.
- 같은 논리 시장이 여러 국가면 국가를 합산하므로 `SUM(sales)::bigint` — 🔴 **캐스팅 필수**(안 하면 문자열로 와서 JS 산술이 깨진다, AGENTS.md 규칙).
- 최근 36개월로 제한(24개월 표시 + YoY 계산분 12개월).

### 2-B. 마이그레이션 ② `20260813000008_oem_model_brand.sql`

```
oem_model_brand (model text PRIMARY KEY, cox_brand text NOT NULL)
```

MarkLines 모델명 → Cox 브랜드. **배열 컬럼이 아니라 별도 표**로 두는 이유: 같은 모델이 여러
경쟁군에 등장한다(Explorer 는 `grand_cherokee`·`atlas` 양쪽). 배열이면 중복 입력이 생긴다.

Cox 에 없는 브랜드(Tesla·Rivian·Lucid)는 **행을 만들지 않는다** — 화면이 "데이터 없음"으로 처리한다.

### 2-C. 수집기 확장 `scripts/collect_oem_model_outlook.py`

| 변경 | 내용 |
| --- | --- |
| AI 응답 스키마 | `consumer_scores` 추가 — 대상 + 주요 경쟁 3종 × 5축(1~5점) |
| NHTSA | `NHTSA_COMPETITOR_MAP` 신설 — 경쟁차종 매핑. 상위 3종만 조회(호출 수 억제) |
| Cox | `oem_model_brand` 조인해 경쟁 브랜드 재고일수까지 수집 |
| 버그 수정 | `_load_inventory` 에 `days_supply IS NOT NULL` 필터 |
| `metrics` 페이로드 | `consumer_scores` · `competitor_safety` · `competitor_inventory` 추가 |

**소비자 평가 5축**: `상품성·디자인` / `가격 경쟁력` / `품질·신뢰도` / `연비·전동화` / `브랜드·잔존가치`

⚠️ `max_tokens=16000` 은 사고+응답 합산 상한이다. 응답 스키마가 커지므로 잘림(`stop_reason='max_tokens'`)
경고를 반드시 확인한다 — 과거에 이 때문에 차종 1종이 **조용히 누락**됐다(커밋 `0f42d89`).

### 2-D. 판정 계층 `lib/oem-competition/signals.ts` (신규, 순수 함수 + vitest)

| 항목 | 🟢 | 🟡 | 🔴 |
| --- | --- | --- | --- |
| 판매 증감(YoY) | +5% 이상 | -5% ~ +5% | -5% 미만 |
| 경쟁군 내 점유율(전년 대비 %p) | +0.5%p 이상 | -1.0 ~ +0.5%p | -1.0%p 미만 |
| 재고일수(브랜드) | 75일 이하 | 75~110일 | 110일 초과 |
| 안전성(NHTSA 리콜 건수) | 0~1건 | 2~4건 | 5건 이상 |
| 소비자 평가(5축 평균, 경쟁 평균 대비) | +0.5 이상 | ±0.5 | -0.5 미만 |

- 데이터가 없으면 `null`(회색 `—`) — 🟡 로 뭉개지 않는다.
- 임계값은 `SIGNAL_THRESHOLDS` 상수로 export 해 화면 툴팁이 같은 값을 보여준다(정본 1곳).
- 종합 판단은 **AI 의 `label` 을 그대로 쓴다** — 항목별 신호등으로 덮어쓰지 않는다(근거가 다르므로).

### 2-E. 조회 계층 `lib/oem-competition/source.ts` 확장

- `getCompetitionMonthly()` 신설 — 뷰 조회. `'use cache'` + `cacheLife('days')` + `cacheTag('oem_model_outlook')`.
  🔴 `cacheLife('days')` 누락 시 15분마다 재생성돼 ISR Write 를 낭비한다(AGENTS.md 규칙).
- `.range()` 페이징에는 `.order()` 필수(페이지 경계 행 누락 방지).
- 시계열은 **대상 + 판매 상위 3 경쟁**만 남겨 페이로드를 줄인다.
- 표시 순서 `MODEL_DISPLAY_ORDER` 상수로 교체(기존 `compareForDisplay` 는 region 기준이라 폐기).

---

## 3. 화면 구성

### 3-A. 표시 순서 (사용자 지정)

| # | model_key | 그룹 |
| --- | --- | --- |
| 1 | `grand_cherokee` | Stellantis |
| 2 | `ram_truck` | Stellantis |
| 3 | `pacifica` | Stellantis |
| 4 | `atlas` | Volkswagen |
| 5 | `rivian_r1` | Rivian |
| 6 | `porsche_911` | VW Group (Porsche) |
| 7 | `avante_ex_china` | Hyundai Kia |
| 8 | `avante_china` | Hyundai Kia |
| 9 | `seltos` | Hyundai Kia |
| 10 | `niro` | Hyundai Kia |

스텔란티스 2·3번과 현대기아 내부 순서는 지시에 없어 **판매 규모 순**으로 정했다.

### 3-B. 컴포넌트 (`components/oem/competition/`)

| 파일 | 역할 |
| --- | --- |
| `CompetitionScoreboard.tsx` | 10종 × 5항목 신호등 표. 행 클릭 시 해당 섹션으로 스크롤 |
| `ModelSection.tsx` | 차종 1개 = KPI + 차트 7종 + 서술/출처. 다중 시장은 시장 탭 |
| `KpiStrip.tsx` | 판매·점유율·재고일수·리콜 4개 타일 + 전년 대비 화살표 |
| `SalesTrendChart.tsx` | ① 판매 추이 멀티라인(대상 + 상위 3 경쟁, 24개월) |
| `CompetitorRankChart.tsx` | ② 경쟁차종 순위 가로막대(대상 강조 + YoY 라벨) |
| `ShareDumbbell.tsx` | ③ 점유율 전년→현재 덤벨 |
| `InventoryChart.tsx` | ④ 재고일수 가로막대 + 60일 기준선 |
| `ConsumerRadar.tsx` | ⑤ 소비자 평가 5축 레이더(대상 vs 경쟁 상위 2) |
| `SafetyChart.tsx` | ⑥ 리콜·불만 그룹막대 |
| `PositionBubble.tsx` | ⑦ 경쟁 지형도(x=YoY, y=점유율, 크기=판매량) |
| `SignalDot.tsx` | 신호등 점 + 임계값 툴팁 (공용) |

### 3-C. 차트 규칙 (`docs/chart-guide.md` 준수)

- 높이는 `useChartHeight(sm, md, lg)` — 직접 px 금지
- 색은 `OEM_COLORS`, 툴팁은 `TOOLTIP_CONTENT_STYLE`, 그리드는 `GRID_STROKE_OPACITY`
- 범례 상단 중앙, 축 `tick={{ fontSize: 14 }}`
- 버블은 `MarginScatter.tsx` 의 `ScatterChart` + `ZAxis` 패턴 재사용
- 다크모드: 고정 hex 외에는 `var(--card/--border/--foreground/--muted)`
- 무거운 차트는 `dynamic ssr:false` 래퍼

### 3-D. 기존 파일 처리

`components/oem/CompetitionCards.tsx` 는 **서술 5종 + 출처**만 담는 `ModelNarrative.tsx` 로 축소해
`ModelSection` 하단에 접이식으로 붙인다. 카드 그리드 레이아웃은 제거한다.

---

## 4. 검증 계획

| 단계 | 검증 |
| --- | --- |
| 마이그레이션 | SQL 직접 조회로 행 수·is_target·SUM 캐스팅 확인 |
| 수집기 | `--only grand_cherokee` 로 1종 선행 → `metrics` 육안 확인 → 전체 10종. `stop_reason` 경고 확인 |
| 신호등 | `npm test`(vitest) — 경계값·null 케이스 |
| 전체 | `npm run check-all` |
| UI | `npm run dev` → 로그인 → `/oem/competition` sm/md/lg 폭 + 콘솔·네트워크 에러 |

## 5. 범위 밖 (명시적 제외)

- `oem_competitor_set` 의 경쟁군 정의 변경 — SSOT 이므로 건드리지 않는다
- `/oem` 전체 탭·회사별 탭 — 이번 작업 대상 아님
- Cox 재고일수를 차종 단위로 만드는 것 — 원천 데이터가 브랜드 단위라 불가. **화면 문구에 "브랜드 기준"을 명시**한다(AGENTS.md 약속)
