# 스텔란티스 북미 매출 전망 (/management/stellantis) — 설계

작성일: 2026-07-15 · 상태: **부분 폐기** — 후속 [`2026-07-16-stellantis-rework-design.md`](./2026-07-16-stellantis-rework-design.md)가 대체

> ⚠️ **2026-07-16 개편으로 §5-C의 차트 2·3·4(자사 매출 vs 소매 / 대당 원단위 / 시나리오 전망)는
> 폐기됐다.** 사용자 판정: "아주 엉터리 숫자야". 원인은 대당 원단위의 **분자·분모 스코프 불일치**
> (자사 매출은 특정 부품, 분모는 북미 전체 차량 출하 → 가리키는 물리량이 존재하지 않음)와
> 거기서 파생된 전망이었다. **왜 틀렸는지와 대체 설계는 후속 문서 §1을 볼 것.**
> 살아남은 것: 단계 A(prnewswire 수집 복구) · 단계 B(라벨 정정) · 차트 1(출하 vs 소매 갭 — 현 차트 2).

> **구현 중 설계가 틀린 것으로 밝혀진 항목은 해당 절에 직접 정정해 두었다.** 이 문서는 "무엇을 왜
> 이렇게 지었나"의 기록이며, 운영 규칙은 `AGENTS.md`·`Architecture.md §7-E`·`docs/oem-collection.md`가 SSOT다.
> 주요 정정: ① "2026년부터 분기 표에 절대값" → 거짓(§5-B) ② Cox 재고 2단계 → 1단계 편입(§1)
> ③ MarkLines 캐나다 1개월 지연 발견(§5-A) ④ Cox의 이상치 브랜드 은닉 발견(§5-B).

## 1. 목적 / 범위

주거래처인 **스텔란티스 북미(구 크라이슬러)** 의 출하·소매·재고 흐름과 자사 `Stellantis NA`향 매출을
한 화면에서 대비해, 향후 자사 매출 방향을 데이터로 진단·전망한다.

핵심 시나리오(사용자 정의): *출하와 자사 매출은 크게 늘었는데 소매가 안 늘고 딜러 재고가 쌓이면
→ 향후 스텔란티스 감산 → 자사 매출 악영향*. 이 상태를 자동 판정하고 매출 전망 숫자까지 제시한다.

작업은 **A → B → C 순서**로 진행한다(사용자 지시 2026-07-15). A·B는 C의 데이터 정합성 전제다.

| 단계 | 내용                                        | 독립성                     |
| ---- | ------------------------------------------- | -------------------------- |
| A    | prnewswire 수집 복구 (2026Q2 적재 불가 상태) | 독립 — 즉시 반영 가능      |
| B    | 지표 라벨 오류 수정                          | 독립                       |
| C    | `/management/stellantis` 신규 탭             | A·B의 데이터·용어에 의존   |

**범위 밖(out of scope)**

- **현대·기아·KGM의 "출하" 표현 수정** — 사용자 결정 2026-07-15: 건드리지 않는다.
  스텔란티스와 성격이 다르다 — 데이터가 실제로 도매이고 라벨도 `(도매 wholesale)`이라 이미
  밝히고 있어 **틀린 수치로 오해할 위험이 없다**. "출하"가 2018년 폐기된 출고 기준을
  연상시킨다는 용어 정밀도 문제일 뿐이라, 15개+ 파일을 뒤집을 값이 없다고 판단.
- **Stellantis IR Fact Sheet 글로벌 재고 수집** — 조사 결과 `Total inventory - excl. JVs` /
  `of which STLA property`(회사) / `of which independent dealers`(딜러) 3행이 실재하고
  Sep'21~Mar'26 확보 가능하나, **글로벌 총계라 북미 분해가 없다**(8개 fact sheet 전수 확인).
  유럽·남미 재고가 섞여 우리 관심사와 지리가 안 맞아 미채택(사용자 결정 2026-07-15).
  북미 재고는 FY2025 프레젠테이션 p.17에 **반기 4점**(Jun'24 522 / Dec'24 382 / Jun'25 338 /
  Dec'25 395)만 있고 정기 공시가 아니라 시계열 불가.
- MarkLines `production_data` export 신규 도입 — 현재 계약·파이프라인 범위 밖.
- 기존 `/oem/stellantis-na` 탭의 데이터 소스 교체(MarkLines 통일) — 사용자가 "라벨만 수정" 선택.
- 챗봇(`lib/chat/tools.ts`) 노출 — 사외비 화이트리스트 추가 금지 원칙 유지.

> **범위 변경 이력**: Cox 딜러 재고는 당초 2단계였으나 **사용자 결정으로 1단계에 편입**
> (2026-07-15). IR에 북미 재고 정기 공시가 없다는 사실이 확인돼, 재고 실측을 얻는 길이
> Cox뿐이기 때문이다. `출하 − 소매` 갭은 그대로 유지하고 Cox는 **독립 교차검증**으로 쓴다.

---

## 2. 배경 — 조사로 확정된 사실

이 설계의 전제는 전부 1차 출처 또는 실제 쿼리로 검증했다. 추정은 없다.

### 2-A. `stellantis_na_sales`는 출하가 아니라 **소매**다

FCA US 공식 집계방법론 문서([media.stellantisnorthamerica.com/newsrelease.do?id=21274]):

> "FCA US's reported vehicle sales **represent unit sales of vehicles to retail customers, deliveries
> of vehicles to fleet customers**… Reported vehicle units sales **do not correspond to FCA US's
> reported revenues**, which are… typically recognized upon shipment to the dealer or end customer."

반면 Stellantis IR의 shipments 정의는 정반대다:

> "The term 'shipments' describes the volume of vehicles **delivered to dealers, distributors**…
> **which drive revenue recognition**."

**수치 확정**: DB `stellantis_na_sales` 2023년 합계 `1,527,090` = FCA US 공시 FY2023 미국 판매
`1,527,090` **완전 일치**. 산술 반증도 성립 — 2024Q3 북미 **전체** 출하 299,000 < 미국 **단독**
판매 305,294(부분집합이 전체보다 클 수 없음). 이는 재고 소진 국면의 서명이며 Stellantis도
"딜러 재고 축소로 출하 감소폭(-36%)이 판매 감소폭(-20%)보다 컸다"고 직접 서술한다.

### 2-B. MarkLines 계열 7종은 **전부 판매(sales)** — 라벨 정상

`import_oem_sales.py`의 단일 `aggregate()`가 하나의 `MarkLines_sales_data*.xlsx`(URL:
`marklines.com/en/vehicle_sales/search`)에서 5개 테이블을 파생하고, 뷰 2개는 그 SUM이다
(항등 검증 통과). **DB 어디에도 출하·생산 데이터는 없다.**

### 2-C. prnewswire vs MarkLines — 21분기 전량 대조

| 구간                        | 관계                                                | 잔차              |
| --------------------------- | --------------------------------------------------- | ----------------- |
| 2021Q1~2023Q4 (12분기)      | prnewswire = ML − 마세라티 − `N/A` − `N/A (Class 5)` | **전 분기 정확히 0** |
| 2024Q1~2025Q3, 2026Q1       | prnewswire = ML − 마세라티 − `N/A` (Class 5 **포함**) | 0 ~ ±수십 대      |
| 2024Q4 · 2025Q4             | 어느 규칙도 불성립                                   | −1,266 · +3,300   |

**결론**: MarkLines는 스코프가 넓고(마세라티·미분류·Class 5 포함) **분류 규칙이 시기마다 흔들린다**.
`SF90 Stradale`(페라리) 7대가 2020년 FCA에 붙어 있는 것도 같은 잡음. → **prnewswire가 정본(SSOT)**.

단 prnewswire는 **미국·분기**뿐이고, MarkLines는 **월별 + 캐나다·멕시코**를 준다. 출하(SEC)가
**북미 3국 단위**라 지리를 맞추려면 MarkLines가 필수다. 따라서 둘을 역할 분담한다(§5-A).

### 2-D. 데이터 지도 (C가 쓰는 것)

| 지표                          | 소스                       | 주기 | 범위             | 분해        | 상태     |
| ----------------------------- | -------------------------- | ---- | ---------------- | ----------- | -------- |
| 미국 소매 (정본)              | prnewswire → `stellantis_na_sales` | 분기 | 2021Q1~          | brand·차종  | 기존(A로 복구) |
| 북미 소매 (US+CA+MX)          | MarkLines → `oem_sales_model_country_month` | 월 | 2020.01~2026.06 | 모델        | 기존     |
| **북미 출하**                 | SEC EDGAR 6-K → `stellantis_shipments` | 분기 | 2021Q1~ | 지역 단위만 | **신규** |
| **딜러 재고일수**             | Cox Automotive → `cox_brand_inventory` | 월 | (수집 범위 내) | 브랜드별 | **신규** |
| 자사 `Stellantis NA` 매출     | `pnl_entries`(사외비)      | 월   | 2022.01~2026.05 (53개월) | 단일 | 기존     |

`pnl_entries.customer`에 정확히 `'Stellantis NA'` 문자열로 존재(`'Stellantis EU'`도 별도).
별도(standalone) 기준이 2022.01부터 월별 연속이라 시차 탐지의 기준 계열로 쓴다.

---

## 3. 단계 A — prnewswire 수집 복구

### 3-A. 문제

발행 주체가 **FCA US LLC → Stellantis**로 이관됐고, 두 publisher 인덱스는 **서로 겹치지 않는다**
(과거는 옛 인덱스에만, 신규는 새 인덱스에만 — 실측 확인).

| 항목                | 2026-Q1                    | 2026-Q2                   |
| ------------------- | -------------------------- | ------------------------- |
| 표 제목 행          | `FCA US LLC Sales Summary Q1 2026` | `Stellantis Sales Summary Q2 2026` |
| **회사 합계 행 라벨** | `FCA US LLC`               | **`Stellantis`**          |
| publisher 인덱스    | `/news/fca-us-llc`         | **`/news/stellantis`**    |

**현재 증상(실측 재현)**: `_row_kind('Stellantis')` → `'model'`로 오분류 → `_assign_brands_to_models`가
Jeep으로 fallback → Jeep 모델 SUM이 brand_total보다 328,284 초과 → cross-check 2건 실패 →
`exit 2`, **적재 0행**. 조용한 오적재가 아니라 요란한 실패라는 점은 다행이나,
**`--no-abort`로 강행하면 Jeep에 오염 적재되므로 절대 금지**.

표 구조(7열)·brand 합계 라벨·`<meta name="date">`·`RELEASE_ID_RE`·`_is_quarterly_table`·
`BRAND_TOTAL_RE`·`_to_yoy`(`#DIV/0!` 처리)는 **정상 — 손대지 않는다**.

### 3-B. 수정

1. **`COMPANY_TOTAL_LABELS = {'FCA US LLC', 'Stellantis'}`** — `_row_kind`의 중복 하드코딩
   (`or upper == 'FCA US LLC'`) 제거하고 집합만 보게 정리. 이 한 줄로 오염·cross-check 실패가
   연쇄 해소되고 COMPANY 검증도 부활한다.
2. **`PUBLISHER_INDEX_URL` → `PUBLISHER_INDEX_URLS`** 리스트(`fca-us-llc` + `stellantis`) 순회.
   두 인덱스가 disjoint하므로 과거·미래 모두 커버. `Referer`도 순회 중 인덱스로.
3. **`HREF_RE`의 `fca` 접두사 제약 제거** → `/news-releases/([-\w]+-\d{9})\.html`.
4. **제목 정규식 의존 폐기** → 후보 릴리스 본문의 캡션 `Sales Summary\s+(Q[1-4])\s+(20\d{2})`로
   `year_period` **확정**. 제목은 후보 필터링에만 사용.
   근거: `TITLE_QUARTER_RE`는 **2025Q3/Q4도 이미 MISS**(제목의 `%`가 매칭을 끊음) — auto-discover는
   이미 반쯤 죽어 있었고 URL 캐시가 사실상 수동 관리되고 있었다. 캡션은 발행 명의와 무관하게 존재.
5. `HEADER_PREFIX`에 `'Stellantis Sales Summary'` 추가(무해하나 의도 명확화).
6. `stellantis_pr_urls.json`에 `2026-Q2` URL 추가 + `_comment` 갱신.

### 3-C. Voyager → Pacifica 병합 (사용자 지시 2026-07-15)

Chrysler Voyager는 Pacifica의 하위 트림으로 **동일 차종**이며, prnewswire도 **2026Q2부터 스스로
Voyager 행을 없앴다**(Chrysler는 Pacifica만). 과거를 병합하면 모델 시계열이 Q1/Q2 경계에서
끊기는 문제까지 해소된다.

- 정규화 규칙을 `MODEL_ALIASES = {'Voyager': 'Pacifica'}`로 두고 `build_db_rows` **직전**에 적용.
- 같은 분기에 Pacifica·Voyager가 **둘 다 있으면 합산 병합**(`sales_units`, `sales_units_prev`).
  합산 후 `yoy_pct`는 원본 % 두 개를 평균하면 틀리므로 **`prev>0`이면 재계산, 아니면 `null`**.
- **`vehicle_model`이 PK 구성요소**이므로 재수집만으로는 옛 `Voyager` 행이 잔존한다
  (AGENTS.md의 알려진 함정 — sync는 upsert-only, delete 안 함).
  → **`--reprocess-all`로 2021Q1~2026Q2 전량 재처리 + `Voyager` 행 DELETE**를 1회 수행.
- brand 합계·회사 합계는 불변이므로 cross-check 허용 오차에 영향 없다.

`Wagoneer`/`Grand Wagoneer` → `Wagoneer/G. Wagoneer` 병합도 같은 성격이나 **사용자 지시 범위 밖**
이므로 이번엔 건드리지 않는다(알려진 제약으로 기록).

### 3-D. 회귀 테스트

`npm run check-all`은 TS 전용이라 Python은 별도 경로다. `scripts/lib/`에 fixture 기반 단위 검증 추가:

- 회사 합계 라벨 `'Stellantis'` 인식
- `'DODGE  BRAND'` 더블 스페이스 유지
- `'#DIV/0!'` → `None`
- `Voyager` → `Pacifica` 병합 + `yoy_pct` 재계산

실환경 검증은 `gh workflow run collect-stellantis-na-sales.yml`.

---

## 4. 단계 B — 지표 라벨 오류 수정

### 4-A. 스텔란티스 (심각 — 정반대) · 커밋 1

| 파일:줄                                                          | 현재                                  | 수정                                    |
| ---------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| `app/oem/stellantis-na/page.tsx:46`                              | `분기별 brand·차종 도매 출하 (shipments)` | `분기별 brand·차종 소매 판매 (retail+fleet)` |
| `app/oem/stellantis-na/page.tsx:71`                              | `차종 TOP10 (도매 출하 shipments · brand 필터)` | `차종 TOP10 (소매 판매 retail · brand 필터)` |
| `components/oem-companies/stellantis-na/StellantisNaQuarterlySeriesChart.tsx:26` | `분기별 도매 출하 (shipments · brand stacked)` | `분기별 소매 판매 (retail · brand stacked)` |

같은 페이지 22번째 줄은 이미 "분기별 차종 판매"로 옳다(페이지 자기모순 해소).
`docs/oem-collection.md`의 스텔란티스 섹션·마이그레이션 주석도 같이 정정한다.

**"소매"가 아니라 "소매 판매(retail+fleet)"로 쓰는 이유**: 이 표는 *total sales*(소매+플릿+임직원)이고,
보도자료는 더 좁은 *retail sales*를 별도로 언급한다(2025Q1: 총 판매 −12%인데 retail은 flat).
둘은 다른 숫자이므로 "소매"라고만 쓰면 새 오라벨이 된다.

### 4-B. 현대·기아·KGM (용어 정밀도) · 커밋 2 — 별도 분리

현대·기아는 **2018년 판매 기준을 출고(ex-factory) → 도매로 변경**했다. 즉 출하 ≠ 도매이며
`출하량 추이 (도매 wholesale)`는 상호배타적 두 기준의 병기다. **"도매"는 정확하다**
(기아 보도자료 "(도매 판매 기준)" 명기, 현대 "Wholesales in Korea…"로 내수까지 도매 포함,
`hyundai_export_regions` 2025년 4,138,389 = 공식 도매 발표와 정확히 일치) — 고칠 것은 "출하" 표현뿐.

`출하량 추이 (도매 wholesale)` → **`판매 추이 (도매 wholesale 기준)`**.

대상 15개+ 파일(`app/oem/{hyundai,kia,kg-mobility}/page.tsx`,
`components/oem-companies/common/{CompanyTimeSeriesChart,CompanyTimeSeriesChartInner,ShipmentStackedHBarChart}.tsx`,
`kia/*`, `hyundai/HyundaiFactoryChart.tsx`)는 A·C와 무관하므로 **별도 커밋**으로 격리한다.

> KGM `평택공장 ex-factory` 근거는 1차 IR 미확인 → 문구를 **단정하지 말고** 현대·기아와 동일 처리만 한다.

---

## 5. 단계 C — `/management/stellantis` 신규 탭

### 5-A. 소스 역할 분담

| 축                     | 소스                          | 이유                                              |
| ---------------------- | ----------------------------- | ------------------------------------------------- |
| 미국 소매 **절대값**   | prnewswire (`stellantis_na_sales`) | 브랜드 직접 발표 = 정본                     |
| **북미** 소매 (US+CA+MX) | MarkLines                   | 출하와 **지리 단위 일치**. prnewswire엔 미국뿐    |
| 월별 형상              | MarkLines                     | prnewswire는 분기뿐                               |
| 북미 출하              | SEC EDGAR (신규)              | 유일한 공개 출하 소스                             |

**스코프 정합**: Stellantis IR의 North America 세그먼트는 **마세라티를 제외**한다(마세라티는 별도
세그먼트). 따라서 MarkLines 북미 소매도 **마세라티 모델을 제외**해 출하와 맞춘다.
`N/A`·`N/A (Class 5)` 미분류 버킷은 §2-C대로 규칙이 흔들리므로 **포함하되**, 화면에
"MarkLines 스코프 편차 ±0~2%" 각주를 단다. 절대값 정합보다 **추세 비교**가 목적이다.

**⚠️ 국가별 수집 지연 — 부분 분기 함정 (2026-07-15 실측 발견)**

MarkLines는 **캐나다가 미국·멕시코보다 한 달 늦게** 들어온다(2026-07-15 기준 USA·Mexico는
`202606`까지, **Canada는 `202605`까지**). 이건 스텔란티스 한정이 아니라 **소스 차원의 지연**이다
(Canada를 보유한 27개 그룹 전부 동일).

그대로 합산하면 **최신 분기 북미 소매가 조용히 과소집계**된다 — 2026Q2가 372,622로 계산되지만
캐나다 6월(약 1만 대)이 빠진 값이고 실제는 약 382,600이다. 소매를 낮게 잡으면 `출하 − 소매` 갭이
부풀어 **재고 축적을 과대평가**하는 방향으로 틀린다. 정확히 이 화면이 판정하려는 것이라 치명적이다.

**대응(필수)**: 3개국 각각의 최신 월을 구해 `min()`을 취하고, **3개월이 모두 채워진 분기까지만
"완전 분기"로 취급**한다. 부분 분기는 갭·진단·전망 계산에서 **제외**하고, 화면에는 "2026Q2는
캐나다 6월 미도착으로 잠정" 같은 문구로 **명시**한다. 조용히 빼거나 조용히 섞지 않는다.
`aggregate.ts`에 `lastCompleteQuarter(rows)` 순수 함수로 두고 vitest로 고정한다.

### 5-B. 데이터 모델

마이그레이션 `supabase/migrations/20260716000001_create_stellantis_shipments_and_inventory.sql`
— 테이블 2개 신설. 둘 다 **공개 데이터**라 사외비 격리 대상이 아니며 anon read를 연다
(기존 `stellantis_na_sales`와 동일 패턴). 자사 매출만 사외비이고 `pnl_entries`(default deny) 그대로다.

| 테이블                 | PK                                  | 핵심 컬럼                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------- |
| `stellantis_shipments` | (region, period_type, year_period)  | `shipments_units`(대), `is_derived`         |
| `cox_brand_inventory`  | (brand, year_month)                 | `days_supply`, `image_url`                  |

**출하 정밀도 제약(반드시 화면 각주)**: IR이 `Shipments (000s)` 천대 반올림이라 원자료 오차 ±500대.
2021~2025는 분기 PR이 **Q1/Q3만** 존재(반기 보고 체제)해 **Q2 = H1 − Q1**, **Q4 = FY − H1 − Q3**로
차분 도출하며 오차가 ±1,000대로 누적된다 → `is_derived = true`로 표시하고 UI에서 구분한다.
**2026 이후에도 이 체계는 그대로다** — 설계 초안은 "2026년부터 분기 표에 절대값이 직접 나온다"고
적었으나 **구현 중 SEC 원문으로 반증됐다**(2026-07-15): 지역별 절대값 표가 실린 실적 PR은 여전히
**Q1 / H1 / Q3 / FY 4회만** 나오고, 2026-02부터 추가된 분기 `Estimated Consolidated Shipments`
릴리스는 **산문 증감뿐**(북미는 "Shipments Up 38%")이라 절대값 표가 없다. 2026Q1(379)에 절대값이
있는 건 원래부터 있던 Q1 실적 PR 때문이지 분기 표 신설 때문이 아니다.
→ **최신 분기 출하가 비어 있는 게 정상**이며, 해당 H1/FY PR 공시 후 차분으로 채워진다.

**Cox 제약**: 브랜드별 재고일수는 **차트 JPEG 안에만** 있어 vision 판독이 유일한 경로다.
이미지 파일명이 매월 불규칙해 URL 조립이 불가하고(기사 페이지 스크래핑 필수), **과거치가 소급
수정**되므로 최근 2~3개월을 매번 재적재한다. sha256 캐시가 소급 수정을 가리지 않도록 주의.
Fiat·Alfa Romeo는 물량 미달로 차트에 없다 → 스텔란티스는 Jeep/Ram/Dodge/Chrysler 4개.
업계 평균 행 `NATION`도 함께 적재해 "업계 대비 위치"를 볼 수 있게 한다(실측 2026-05:
Jeep 145 / Ram 144 / Dodge 148 / Chrysler 129 vs NATION 76 — **업계 평균의 약 2배**).

### 5-C. 집계 로직 — `lib/stellantis-forecast/aggregate.ts` (pure + vitest)

기존 `lib/inventory`·`lib/finance` 패턴을 따른다(순수 빌더 + 단위 테스트).

1. **재고 증감** — `재고변화_Q = 출하_Q − 소매_Q`(둘 다 북미, 마세라티 제외).
   누적치는 시작점이 임의이므로 **절대 수준이 아니라 지수/flow로 표시**한다.
   **Cox 재고일수(월별, 브랜드별)를 독립 교차검증축으로 병기** — 계산값과 실측이 같은 방향을
   가리키면 진단 신뢰도가 올라가고, 어긋나면 그 사실 자체가 경고다.
   Cox의 `days_supply`는 딜러 재고 기준이며 `NATION` 대비 배율로 과잉 정도를 읽는다.
2. **시차 탐지** — 자사 매출(월)과 북미 소매(월)의 **YoY 증감률** 계열로 교차상관.
   원계열이 아니라 YoY를 쓰는 이유: 추세·계절성이 남으면 허위 상관이 뜬다.
   lag −6~+6개월 탐색 → `|r|` 최대 lag 채택. `r`·`n`·채택 lag를 화면에 노출(블랙박스 금지).
   자사 매출 53개월 ⇒ lag별 n ≈ 35~41로 충분.
3. **원단위** — `자사 매출(분기, 억원) ÷ 북미 출하(분기, 대)`(시차 적용 후).
   **소매가 아니라 출하 기준**인 이유: 부품 매출은 딜러 재고를 거치지 않고 OEM 생산·출하에 연동된다.
   지리 단위도 북미로 일치한다. 안정성은 **변동계수(CV)** 로 표시하고, CV가 크면 전망 신뢰도 경고.
4. **진단 신호** — 3색 판정:
   - 🔴 `출하 YoY > 소매 YoY` **그리고** 재고 누적 증가 → 재고 축적 · 향후 감산 위험
   - 🟢 `출하 YoY < 소매 YoY` **그리고** 재고 감소 → 재고 소진 · 보충 출하 기대
   - 🟡 그 외
   임계값은 상수로 추출하고 근거를 주석에 남긴다(매직 넘버 금지).
5. **전망 시나리오 3종** — `자사 매출 전망 = 출하 전망 × 원단위`:
   - ① **재고 유지**: 출하 = 소매 추세(최근 4분기 이동평균 기반)
   - ② **재고 정상화**: 누적 과잉분을 향후 2분기에 해소 → 출하 하향
   - ③ **현 추세 지속**: 최근 4분기 출하 추세 유지
   각 시나리오의 가정을 화면에 문장으로 표기한다.

### 5-D. 화면 구성

`app/management/stellantis/page.tsx` (server) + `components/management/stellantis/*`

- **진단 신호 카드 4장** — 재고 상태(3색) · 출하 vs 소매 갭 · 탐지 시차(`r` 동반) · 다음 분기 매출 전망
- **차트 1 (콤보)** — 북미 출하·북미 소매 막대 + 갭(재고 증감) 선. 이중축 영역 분리(`chart-guide` §4-F:
  막대 `[0, max×2.5]` 하단 · 선 `[−max×1.5, max×1.1]` 상단), 범례 `LegendRow`(막대 왼→오 → 꺾은선)
- **차트 2 (콤보)** — 자사 매출(억원) 막대 + 스텔란티스 북미 소매(대) 선, **시차만큼 밀어서** 정렬
- **차트 3 (라인)** — 대당 매출 원단위 추이 + CV
- **차트 4 (막대)** — 매출 전망(실적 + 시나리오 3종)

**스타일 규칙(필수 준수)** — `docs/chart-guide.md`:

- 막대는 **`MGMT_BAR_COLORS`(파란 계열)만**. 비율·달성율 꺾은선은 `#dc2626`. 중립·잔여는 회색 `#9ca3af`.
- 경영관리 데이터 라벨 **16px**(`MGMT_DATA_LABEL_STYLE`), 툴팁 16px(`TOOLTIP_CONTENT_STYLE`).
- `fontSize`·축 domain·범례 순서 임의 변경 금지.
- recharts는 `dynamic(() => import('./XxxInner'), { ssr: false })` 래퍼 패턴.

### 5-E. 데이터 접근 — `lib/stellantis-forecast/source.ts`

```ts
'use cache';
cacheLife('days');
cacheTag('oem-stellantis-na-sales');   // prnewswire
cacheTag('oem-sales');                  // MarkLines
cacheTag('stellantis-shipments');       // 신규
cacheTag('pnl');                        // 자사 매출
```

- 공개 3종(prnewswire·MarkLines·출하) → `createSupabaseAnonClient()` (기존 OEM `source.ts` 패턴)
- 자사 매출 → **반드시 `confidentialDb.from('pnl_entries')`** (service_role 자동 + TS union 차단)
- `.range()` 페이지네이션을 쓰면 **결정적 정렬 필수**(AGENTS.md — 정렬 없는 다중 페이지 fetch는
  페이지 경계에서 행 누락. `lib/oem/source.ts` 전례)
- 신규 태그 `stellantis-shipments`를 `scripts/lib/revalidate.py`의 `COLUMN_TO_TAGS`에 등록
  (누락 시 무효화 no-op → 화면 stale)

### 5-F. 권한

**`permissions.ts` 수정 불필요.** `canAccess`의 `/management` 분기가 자동 처리한다:

| 역할      | 결과   | 경로                                             |
| --------- | ------ | ------------------------------------------------ |
| admin     | 허용   | 첫 줄 `if (role === 'admin') return true`        |
| holdings  | 허용   | `/management` 분기 마지막 `return true`          |
| mobility  | 허용   | 동일                                             |
| hmobility | **차단** | `HMOBILITY_MANAGEMENT_PATHS`에 없음            |
| guest     | **차단** | `if (role === 'guest') return false`           |

탭 노출은 `components/management/management-tabs.tsx`의 `ALL_TABS`에 한 줄 추가하면
`canAccess` 필터가 자동 적용된다.

### 5-G. 수집 스크립트 — `scripts/collect_stellantis_shipments.py`

- 발견: `https://data.sec.gov/submissions/CIK0001605484.json` (무료 JSON API)
  → 6-K exhibit `stellantisnvq{N}{YYYY}pressrel.htm` / `stellantisnvfy{YYYY}pressrel.htm`
- 파싱: `requests` + BeautifulSoup — `NORTH AMERICA` 섹션의 `Shipments (000s)` HTML 표.
  FY 표는 `NORTH AMERICA | ENLARGED EUROPE` **2열 병렬 레이아웃**이라 파싱 주의.
- **SEC는 UA 헤더 필수**(WebFetch는 403, 연락처 포함 UA면 정상). `stellantis.com`은 Akamai가
  curl/requests를 403 차단하므로 **쓰지 않는다** — SEC 경로가 우월한 이유.
- 교차 검증: stellantis.com Q1'26 표의 전년 열(325) = SEC Q1'25 실적(325) — 통과 확인됨.
- `bootstrap.py`의 `init_script(__file__)` + **`WriteSession`**(신규 mutating 스크립트 필수) 사용.
- 워크플로 `.github/workflows/collect-stellantis-shipments.yml` — 분기 실적 발표 후(2·5·8·11월).

---

## 6. 검증

| 대상            | 방법                                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| TS 전반         | `npm run check-all` (lint + format:check + typecheck + test)                       |
| 집계 로직       | vitest — 시차 탐지·원단위·진단 판정·전망 시나리오 pure 함수                       |
| Python          | `scripts/venv/Scripts/python.exe -m py_compile` + fixture 단위 실행               |
| A 실환경        | `gh workflow run collect-stellantis-na-sales.yml` → `gh run watch --exit-status`   |
| C 수집 실환경   | `gh workflow run collect-stellantis-shipments.yml`                                 |
| 출하 정합       | SEC Q1'21=451k · Q1'25=325k · Q3'24=299k · Q1'26=379k · FY'25=1,472k 대조. **독립 검증**: FY PR의 H2 표(스크립트 미사용)와 `Q3 + 도출Q4` 대조 → 2021~2025 오차 0 |
| UI              | `npm run dev`(3001+) + Playwright — 로그인 후 `/management/stellantis` 골든 패스   |

**사외비 검증 제약**: 자사 매출 금액 셀 미접근. 라벨·범례·요소 개수·색(`fill`)·불리언만 추출.
recharts 축 틱 `<text>`는 headless에서 안 그려지므로 축 라벨 정확성은 **vitest로** 검증한다
(브라우저에서 "틱에 X 없음"은 헛통과). 검증 산출물은 **scratchpad**에 쓴다(프로젝트 폴더에 쓰면
Turbopack 재컴파일 → Server Action ID 어긋나 로그인 404).

---

## 7. 문서 갱신 (완료 조건)

- `AGENTS.md` — `/management` 탭 목록에 `stellantis` 추가, `lib/stellantis-forecast/` 도메인 폴더 등록,
  `scripts/` prefix 목록에 `collect_stellantis_shipments.py`, sync 정책
- `Architecture.md` — §5-A 경영관리 탭 구조, §7 `stellantis_shipments` 스키마, §10 워크플로
- `docs/oem-collection.md` — 스텔란티스 섹션 지표 정정(소매) + publisher 이관 + Voyager 병합
- `docs/chart-guide.md` — §3 페이지별 카탈로그에 신규 차트 4종

## 8. 인계 (핸드오프)

### 8-A. 다음 세션이 먼저 확인할 것 (시한 있음)

1. **2026Q2 출하가 DB에 없다 — 정상이다.** H1 2026 보도자료(**7월 말 예상**, 과거 공시일 7/25~8/3)가
   나와야 `Q2 = H1 − 379`로 채워진다. 워크플로 `collect-stellantis-shipments.yml`의 **8/27 실행이 커버**.
   그때 차트 1의 x축이 26Q2까지 늘면 정상. 안 늘면 SEC 문서명 패턴 변화를 의심할 것.
2. **탐지 시차가 음수다** — 자사 매출이 스텔란티스 소매보다 *후행*으로 나온다. 부품사는 통상 선행할
   텐데 반대라 **사용자 확인 대기 중**. 사업 구조상 틀렸다면 `source.ts`의 `REVENUE_BASIS`
   (현재 `standalone`)나 `detectLag`의 매칭 방향(`매출[t] ↔ 소매[t+lag]`)을 재검토.
   화면은 양수·0·음수를 모두 정확한 문구로 처리하므로 코드는 안전하다.

### 8-B. 정기 운영

| 주기            | 무엇                                                                 |
| --------------- | -------------------------------------------------------------------- |
| 분기(1·4·7·10월) | `collect-stellantis-na-sales.yml` — 미국 소매. **스케줄은 항상 auto-discover** |
| 분기(2·5·8·11월) | `collect-stellantis-shipments.yml` — 북미 출하(H1/FY PR 후 차분 채움) |
| 매월 20일       | `collect-cox-inventory.yml` — 딜러 재고일수. **exit 3 = 수집 정지 경보** |

사람이 손댈 일은 원칙적으로 없다. prnewswire URL을 손으로 채우던 관행은 auto-discover 복구로 끝났다.

### 8-C. 실패 시 진단 순서

- **prnewswire cross-check 실패** → 표 구조·회사 합계 라벨 변경 의심. **`--no-abort` 절대 금지**
  (Jeep에 회사 합계가 오염 적재된다). `scripts/lib/test_stellantis_na_parsing.py`부터 돌릴 것.
- **출하 차분이 음수** → FY PR에서 H2 표를 FY 표로 오인한 것. 음수 가드가 로그와 함께 제외하므로
  조용히 틀리진 않는다.
- **Cox exit 3** → 슬러그·발행 경로 변화로 최신 월을 못 찾은 것(조용한 정지 방지 게이트).
- **차트가 특정 구간만 near-zero** → 집계가 아니라 **fetch 의심**. `.range()` 다중 페이지에
  결정적 정렬이 빠졌는지 볼 것(`lib/oem/source.ts` 전례).

### 8-D. 이 작업이 DB에 이미 남긴 것 (코드 롤백해도 남는다)

마이그레이션 2개 적용(+ `schema_migrations` 이력) · `stellantis_shipments` 21행 ·
`cox_brand_inventory` 178행 · `stellantis_na_sales` 995행 **재적재**(Voyager 병합 반영, 옛 `Voyager`
8행 DELETE) · 프로덕션 캐시 `oem-stellantis-na-sales` 무효화.

## 9. 알려진 제약

- 출하는 **북미(미국+캐나다+멕시코) 지역 단위**뿐 — 브랜드·차종별 출하는 **어떤 공개 소스에도 없다**.
- 2021~2025 Q2/Q4 출하는 차분 도출이라 ±1,000대 오차(`is_derived`로 표시).
- MarkLines 스코프 편차 ±0~2%(시기별 변동) — 절대값이 아니라 추세 비교용.
- 딜러 재고는 계산값(`출하 − 소매`)이며 Cox 실측이 아니다 → 2단계에서 교차검증.
- `Wagoneer`/`Grand Wagoneer` 병합은 이번 범위 밖 → 2026Q2 경계에서 모델 시계열 단절 잔존.
- 자사 매출은 2022.01부터라 2021년 스텔란티스 데이터와는 겹치지 않는다(시차 분석 구간 = 53개월).
