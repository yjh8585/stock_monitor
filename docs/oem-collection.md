# OEM 회사별 차종 판매 수집 상세

이 파일은 `/oem/*` 회사별 탭의 **수집 로직·데이터 모델·gotcha**를 다룬다. 라우트 목적 요약은 [`AGENTS.md`](../AGENTS.md) 라우트 표, DB 스키마는 [`Architecture.md §7`](../Architecture.md), 워크플로 전체 목록·주기는 [`Architecture.md §10`](../Architecture.md) 참고.

공통 패턴: `lib/oem-companies/<slug>/`(`source.ts` `'use cache'`+`cacheTag` / `aggregate.ts` pure 함수 + `aggregate.test.ts`), 컴포넌트는 `components/oem-companies/common/` + `<slug>/`. 판매 데이터는 모두 `vehicle_powertrain_map` LEFT JOIN으로 PT(파워트레인) mix 도출.

`/oem` "전체" 탭은 글로벌 MarkLines 대시보드(5개 `oem_sales_group_*` 테이블) + OEM 모델 outlook. 탭 네비는 `app/oem/layout.tsx`에서 통합 관리(6탭: 전체/Stellantis USA/KG모빌리티/현대차/기아/우즈베키스탄).

> **MarkLines Excel 파이프라인은 판매·생산 2개다.** 이 문서의 MarkLines 언급은 모두 **판매**(`vehicle_sales` → `oem_sales_*`, `sync_oem_excel.py`)다. **생산**(`vehicle_production` → `oem_production_model_country_month`, `sync_oem_production_excel.py`)은 `/oem/*`이 아니라 `/management/stellantis`가 쓰며, 같은 쿠키를 쓰지만 **페이지·레이아웃·country의 의미가 모두 다르다**(생산의 `country`는 **공장 국가**, 판매는 **판매 시장**). 상세 → [`Architecture.md §7`](../Architecture.md).

---

## `/oem/stellantis-na` — Stellantis NA (FCA US LLC → Stellantis)

- **지표 (중요)**: **미국 총 판매 = 소매 + 플릿**(최종고객 인도 기준). **도매 출하(shipments)가 아니다.**
  FCA US 공식 집계방법론이 _"Reported vehicle unit sales **do not correspond to** FCA US's reported revenues"_ 라고 명시한다(매출 인식 = 도매 출하 시점). 도매 출하는 Stellantis IR의 consolidated shipments이며 **지역(북미) 단위로만** 공시 — 이 테이블에 없다.
  검증: DB 2023년 합계 `1,527,090` = FCA US 공시 FY2023 미국 판매 `1,527,090` 완전 일치.
  ⚠️ 2026-07-15 이전 UI가 이를 "도매 출하(shipments)"로 **정반대 라벨링**했다가 정정됨. 재발 금지.
- **범위**: brand·차종별 분기 판매 (2021Q1~)
- **출처**: prnewswire 분기당 1개 보도자료 HTML `<table>`. `collect_stellantis_na_sales.py` — **requests + BeautifulSoup (Playwright 불필요)**
- **테이블** `stellantis_na_sales`: PK = period_type/year_period/brand/vehicle_model/region
  - brand 6종 = Jeep/Ram/Chrysler/Dodge/Fiat/Alfa Romeo (Maserati는 별도 PR이라 미수집)
  - `brand='Total'`/`vehicle_model='Total'`은 합계 row, region은 단일 `'US'`
- **gotcha**:
  - 분기 PR이 CYTD 컬럼 동봉 → Q4의 경우 `period_type='year'`(연 누계) 한 세트 **추가 적재**. Q1~Q3 연 누계는 분기 SUM으로 자연 도출.
  - cross-check: brand_total vs 모델 SUM (Q **±25**, YTD **±100**, source-side 미세 누락 허용) + 회사 합계 **±5** (실패 시 abort)
  - **발행 주체 이관 (2026Q2~)**: FCA US LLC → **Stellantis**. 회사 합계 행 라벨도 `'FCA US LLC'` → `'Stellantis'`로 바뀌어 `COMPANY_TOTAL_LABELS`에 둘 다 등록. 미인식 시 이 행이 model로 오분류돼 **직전 brand(Jeep)에 회사 합계가 통째로 얹히고** cross-check 실패 → exit 2. **`--no-abort`로 강행 금지**(오염 적재).
  - **publisher 인덱스 2개가 서로 겹치지 않는다**: 과거 분기는 `/news/fca-us-llc`에만, 신규는 `/news/stellantis`에만. auto-discover는 **둘 다 순회**해야 한다.
  - **분기 확정은 제목이 아니라 본문 표 캡션** `Sales Summary Q<n> <YYYY>`. 옛 제목 정규식은 2025Q3/Q4도 이미 놓치고 있었다(제목의 `%`가 매칭을 끊음).
  - **동일 차종 병합**(`MODEL_ALIASES`): `Voyager` → `Pacifica`(하위 트림, 보도자료도 2026Q2부터 통합 표기). 합산 후 **YoY는 재계산**(원본 % 평균은 틀림). `vehicle_model`이 PK라 규칙 추가 시 **재처리 + 옛 행 DELETE 필요**(upsert-only라 잔존).
  - 미해결: `Wagoneer`+`Grand Wagoneer` → `Wagoneer/G. Wagoneer`(2026Q2~) 병합 미적용 → 해당 모델 시계열은 Q1/Q2 경계에서 단절.
- **차트**: KPI 4종 + 분기 brand stacked(분기/연 토글, 합계 라벨) + 브랜드 mix(100% stacked) + PT mix(100% stacked) + 차종 TOP10(brand 1단계 드롭다운, region 단일 'US')
- **URL 매핑**: `scripts/lib/stellantis_pr_urls.json` (영구 캐시) + `--auto-discover`. HTML sha256 캐시 `data/_stellantis_pr_cache/`
- **cron**: `collect-stellantis-na-sales.yml` — 분기 첫 달(1·4·7·10) 3일 03:00 UTC. **스케줄 실행은 항상 `--auto-discover`**(과거엔 inputs가 비어 발견이 안 돌아 URL을 매 분기 손으로 채워야 했다 — 2026Q2 누락의 원인). `workflow_dispatch` 입력: `year_from`/`year_to`/`quarter`/`reprocess_all`/`auto_discover`

## `/oem/kg-mobility` — KG모빌리티

- **범위**: 차종별 판매 (월별, 2021~)
- **출처**: kg-mobility.com IR 엑셀. `collect_kg_mobility_sales.py` — Playwright `expect_download()`
- **테이블** `kg_mobility_sales`: region = 내수/수출
- **차트**: KPI 4종 + 월별 시계열(YoY) + PT mix(100% stacked) + 차종 TOP10 + 내수/수출 분리
- **cron**: `collect-kg-mobility-sales.yml` — 매월 15일 03:00 UTC

## `/oem/hyundai` — 현대차

- **범위**: 차종별 판매 + 해외 공장별 + 지역별 수출 (월별, 2021~) + 미국/유럽 현지(retail)
- **출처**: hyundai.com IR 엑셀 3종(`button.btn-download` Playwright) + IR 사이트 hover API(연도별 9개 region 도매 합계) + 미국/유럽 현지 엑셀 2종(`collect_hyundai_retail.py`)
  - 도매 수집: `--kind {model,factory,export,all}` 옵션. 같은 workflow step에서 `collect_hyundai_ir_summary.py`(API POST, Playwright 불필요)가 IR 9개 region 연 도매 합계도 갱신(source=ir-summary)
- **테이블**:
  - `hyundai_sales`: PK = region/factory/vehicle_model (`factory=""` = 국내)
  - `hyundai_export_regions`: 한국 출하 세부 region 월별 + IR 도매 region 연 합계 (`source` 컬럼으로 구분)
  - `hyundai_retail_sales`: US/EU retail. **US는 industry_total/market_share 동봉** (마이그레이션 `20260526000005`)
- **차트**: KPI + 판매 추이(월/연 토글) + PT mix + 해외 공장별 stacked + TOP10(region 토글) + 지역별 수출/도매 region 분포
- **cron**: 도매 `collect-hyundai-sales.yml` 매월 15일 / retail `collect-hyundai-retail.yml` 매월 16일 03:00 UTC. retail dispatch 입력: `year_from`/`year_to`/`region`

### 현대차 분기 IR 보고서 (매출/영업이익/판매량)

- **출처**: `/quarterly-earnings` 페이지의 "실적 발표 자료" PDF(분기당 1개, `q{1-4}-{YYYY}-...-ko.pdf`). `collect_hyundai_quarterly_earnings.py` — Playwright `expect_download` → PDF sha256 캐시(`hyundai_quarterly_earnings.pdf_sha256`) → 변경분만 Anthropic API(`claude-opus-4-7`) + `tool_use(submit_earnings)`
- **테이블** `hyundai_quarterly_earnings`: PK = (fiscal_year, fiscal_quarter) → 재진술 자연 우선. 매출/부문매출/영업이익/판매량/친환경 비중 일괄 추출
- **cron**: `collect-hyundai-quarterly.yml` — 매월 25일 03:00 UTC. dispatch 입력: `year_from`/`year_to`/`quarter`/`reprocess_all`. 마이그레이션 `20260526000006`

## `/oem/kia` — 기아

- **범위**: 차종별 판매 + 해외 공장 5종 + 지역별 수출 10종 + 현지판매(retail) (월별, 2021~)
- **출처**: worldwide.kia.com JSON API(`/api/investors/business-sales-results`) → 엑셀 4종(차종별·해외공장·지역별 수출·현지판매) Playwright APIRequestContext 다운로드. `collect_kia_sales.py`
- **테이블**:
  - `kia_sales`: region IN ('', '내수', '수출', 'CKD') + factory 5종. **`Aggregate` 모델은 CKD section 합계 행이라 TOP10에서 제외**
  - `kia_export_regions`: 10 region × vehicle_type 8종을 6 카테고리로 normalize
  - `kia_retail_sales`: plant × vehicle_model × region(12종 CHECK enum) 현지 retail 판매. period_type month/annual
- **retail 연도별 양식 차이 (gotcha)**: 2024+는 제목 `현지판매실적`·`Korea`(내수) 컬럼 포함. **2021~2023은 제목 `해외현지판매`**('실적' 글자 없음)·시트명 연도접미사(`Jan21`/`Ma21`=March)·`Korea` 컬럼 없음(해외 전용)·중국 합작법인 별도 컬럼(2021 `DYK(China)` / 2022 `KCN(China)`)을 `China`로 합산. 파서가 양식 자동 흡수(`_KIND_PATTERNS` retail 정규식 / `_RETAIL_MONTH_MAP` 숫자제거+`ma` / region alias / `model_col=total_col-2`). **plant SUM row는 total=0이어도 footer로 처리** — 신규 가동 plant(2025 `HMGICs Plant` 1~5월 등)가 가동 초기 0일 때 header로 오인하면 하위 `CKD` 섹션을 흡수하는 버그가 있었음(수정 완료). **2024 export·retail은 소스 엑셀이 10월까지만 채워진 발표본**(11~12월 빈칸 — 기아 미갱신, 파싱 정상).
- **차트**: KPI 4종 + 판매 추이(월/연 토글) + PT mix(EV 8종 매핑) + 해외 공장 5종 stacked + 지역별 수출 10종 stacked + 수출 차종 type mix(승용/RV/상용/특장/CKD 일반/CKD 특장) + 차종 TOP10(전체/국내/내수/수출). _retail은 적재만, 차트 미연결._
- **cron**: `collect-kia-sales.yml` — 매월 16일 03:00 UTC(현대 15일과 1일 분산). 마이그레이션 `20260527000001`, `20260527000002`, `20260527000005`(kia_retail_sales)

## `/oem/uzbekistan` — 우즈베키스탄 자동차 시장

- **범위**: 회사별 **판매**(uzavtosanoat) + 차종(모델)별 **생산**(stat.uz) + 브랜드별 연간 생산(uzavtosanoat 통계 페이지).
- **테이블** `uzbekistan_auto_stats` (단일 통합): kind=sales\|production, period_type=month\|quarter\|year\|**ytd**, source_type=uzavtosanoat\|stat-uz.
  - **company enum 8개**(CHECK): UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors / **Jizzakh Auto** / **Alyans Auto** (`20260601000001`로 확장). UzAuto Motors만 companies 테이블 등록(UZMT, uzauto-pdf), 나머지는 company 컬럼만.

### 판매 — `collect_uzbekistan_sales.py` (uzavtosanoat.uz 보도자료, RU)

- 본문 **용어로 kind 분류**(생산/판매 절대 혼합 금지): `реализовано`·`продано`=sales / `выпущено`·`произведено`·`собрано`=production. 연말 보고가 생산 용어인 경우 있어 연도가 아닌 동사로 판정.
- 회사 라인 정규식: 구분자 `: – — -` + 각주 `*` + 러시아어 표기(`Завод BYD в Узбекистане`) 허용. 본문 하단 "관련뉴스" 푸터 잘라내 다른 기사 숫자 오염 방지.
- **YTD 차분**: (kind,year)별 회사 타임라인 → 인접 발표 delta를 구간 월수로 균등 분배(누락월 lumping 제거). 첫 발표 N월이면 1~N월 균등. period_type='month' + 연 누계 'year'.
- cron `collect-uzbekistan-sales.yml` 매월 20일.

### 생산(차종별) — `collect_uzbekistan_production_models.py` (stat.uz 통계위 뉴스 `news-of-committee`)

- 모델별 생산량을 영문 평문 `{Model} - {N} units;`로 발표(만년 + 월별 1~N월 누계). 텍스트 finditer 파싱(화이트리스트만 — 수입 국가별 섹션 China/Japan 등 제외). 기간: `in YYYY`=만년(last_month=12) / `in January-March YYYY`=YTD.
- **이미지(인포그래픽) 기사**: 2024 이하·2025 일부는 본문이 그림. 생산 slug(`PROD_SLUG_RE`, 수입/좌석/타이어/등록 제외)인데 텍스트 없으면 article-body 이미지를 **Anthropic 비전**(`submit_production` tool_use, sha256 캐시)으로 추출. `ANTHROPIC_API_KEY` 필요(CI). 키 없으면 이미지 skip(`--no-vision`).
- 적재: (year)별 YTD 차분 → period_type='month' + 만년(12월 스냅샷)이면 'year'. 모델 매핑: Cobalt/Tracker/Onix/Lacetti-Gentra→Chevrolet, Damas+Special(특수승용)+Labo→Chevrolet 'Damas/Labo', KIA/BYD/Chery/Haval→브랜드, Tank 500→Tank, LADA→LADA.
- cron `collect-uzbekistan-production.yml` 매월 28일(구 산업 PDF 파서 `collect_uzbekistan_production.py`는 모델 데이터에서 대체됨 — 미참조, `_archive` 이동 대상).
- **엔진(UzAuto Motors Powertrain) 제외**: 완성차 아니므로 집계·차트·DB에서 완전 제외(2026-06-01, 사용자 지시).

### 차트 (`source.ts`)

- 판매: KPI(만년 vs 만년 + 당해 YTD는 전년 동기 YoY) + 회사별 판매 월/연 stacked + 회사 점유율.
- 생산: 차종별 연도별 표(`UzbekistanModelYearTable` — 만년 + 최신 YTD + 동기 YoY) + 차종별 연간 grouped + 차종별 월별 추이 stacked + 브랜드별 연간(엔진 제외) + Chevrolet 시계열.

---

## UzAuto Motors IFRS PDF 재무 (참고: PDF-only 회사 패턴)

우즈벡 탭과 별개로, UzAuto Motors는 재무도 PDF에서 수집한다. `collect_uzauto_financials.py`: `/investors` HTML 파싱(우즈벡어/영문 정규식) → PDF sha256 캐시(`uzauto_pdf_cache`, 마이그레이션 `20260526000001`) → 변경분만 Anthropic API(`claude-sonnet-5` — 2026-08-06 Opus 4.7 에서 비용 전환, env `UZAUTO_FINANCIALS_MODEL` 로 환원 가능) PDF document + `tool_use(submit_financials)` → financials upsert. **연도 오름차순 처리**로 재진술 정책 자연 보장. 플래그: `--reprocess-all`/`--dry-run`. cron `collect-uzauto-financials.yml` 매주 월요일 03:00 UTC.

---

## MarkLines Excel sync — 판매량과 생산량은 다른 페이지·다른 레이아웃

`/oem` 대시보드의 원천 2종은 회사별 탭과 달리 **MarkLines 사이트에서 Excel 을 받아 적재**한다. 둘은 같은 세션 쿠키(`MARKLINES_COOKIE`)를 쓰지만 **페이지도 레이아웃도 다르므로 한쪽 코드를 그대로 복제하지 말 것.**

- **판매량** — `sync_oem_excel.py`(다운로드) + `import_oem_sales.py`(적재).
- **생산량** — `sync_oem_production_excel.py` + `import_oem_production.py`. 판매량과 **같은 쿠키·다른 페이지(`vehicle_production`)·다른 레이아웃**(메타 6열, PowerTrain 없음). ⚠️ **파일명이 `product_data`(≠`production_data`)** 라서 링크 탐지가 `EXPECTED_FILE_TOKEN` 으로 판매 링크를 배제한다 — 이름이 헷갈려 판매 파일을 생산으로 집는 사고를 막는 장치이니 지우지 말 것. 이력 파일은 `참고/oem 생산량/*_20NN_en.xlsx`, 최신은 롤링 `MarkLines_product_data_en.xlsx`(2024.01~)로 판매와 동일 구조다.
- **세그먼트 매핑** — `import_oem_model_segment.py` 가 같은 판매 엑셀들(`참고/oem 판매량/MarkLines_sales_data*.xlsx` 전부)의 메타 7열(Country·Group·Maker/Brand·Type·Segment·Model·PowerTrain)을 `oem_model_segment`(PK `model`+`country`, 파서는 순수 함수 `scripts/lib/model_segment.py`)에 적재한다. 92만 행짜리 `oem_sales_model_country_month` 를 UPDATE 하지 않으려고 **별도 테이블로 분리**했다(전 행 UPDATE 는 WAL 을 폭증시킨다 — 2026-08-03 Supabase 용량 사고 이력). 멱등이라 재실행 안전. ⚠️ 이 엑셀은 `read_only=True` 로 열면 **조용히 0행**이 나온다 → [`gotchas-data-collection.md`](./gotchas-data-collection.md).

적재 후 **구체화 뷰 갱신(`refresh_oem_agg_views()` RPC)이 필수**다(자동 갱신되지 않는다 — 빼먹으면 `/oem` 과 `/oem/competition` 판매 추이가 옛 값을 조용히 보여준다. 이 RPC 가 갱신하는 구체화 뷰는 3종). 쿠키 만료·단일 디바이스 정책은 AGENTS.md 「Python 스크립트 규칙」이 정본.

---

## 핵심 차종 경쟁 분석 — `collect_oem_model_outlook.py` (월 1회)

`/oem` 의 "AI 차종 평가"가 부실하다는 지적에서 출발해 2026-08-13 에 전면 재작성한 파이프라인이다. 옛 버전은 입력이 **모회사 주식 뉴스 헤드라인 8개**뿐이라 모델이 사전지식으로만 썼고, 그래서 매주 돌려도 내용이 안 바뀌었다. v2 는 판매 실적·경쟁군·웹검색·리콜을 근거로 넣는다. 적재처는 `oem_model_outlook`(v2 컬럼 = `competitive_view`·`sales_trend`·`market_breakdown`·`metrics`·`sources`, 마이그레이션 `20260813000003`), 화면은 `/oem/competition`.

> **2026-08-13 화면 재구성**: 카드 나열에서 **스코어보드 + 차종별 차트 7종**으로 바꿨다. 이때 `metrics` 가 화면의 1차 데이터원이 됐다(그전에는 감사용으로만 저장하고 화면이 쓰지 않았다). 차트가 필요로 하는 월별 시계열은 **구체화 뷰** `oem_competition_monthly_view`(`20260813000007` 생성 → `20260813000009` 구체화)가 공급한다 — 경쟁군 정의를 따라 96.9만 행을 3,010행으로 미리 걸러 둔 것으로, **갱신은 아래 `refresh_oem_agg_views()` 에 얹혀 있다**(일반 뷰로 뒀더니 4.9초가 걸려 anon statement timeout 에 걸렸고 차트가 조용히 비었다 → [`Architecture.md §7`](../Architecture.md)).

### 경쟁군 정의의 SSOT 는 `oem_competitor_set` 테이블

- 수집기에 하드코딩돼 있던 경쟁군 목록은 **삭제됐다.** 수집기는 DB 에서 읽는다 — `collect_oem_model_outlook.py` 의 `MODEL_META` 에는 표시명·OEM 그룹·Cox 브랜드·`region` 만 남았다.
- **경쟁차종·시장을 바꾸려면 새 마이그레이션을 쓴다**(기존 시드 파일 수정 금지). 시드 = `supabase/migrations/20260813000002_oem_competitor_set.sql`, 컬럼 = `model_key`·`market`·`market_label`·`display_order`·`countries text[]`·`target_models text[]`·`competitor_models text[]`·`segment_note`.
- MarkLines `Segment` 를 자동 분류로 쓰지 않고 이 표를 **수동 정본**으로 두는 이유는 시드 주석에 있다(Grand Cherokee 는 SUV-E, Explorer·Atlas 는 SUV-D 로 갈리지만 실제로는 같은 시장에서 경쟁한다).
- 🔴 **모델명은 `oem_sales_model_country_month.model` 의 실제 표기와 정확히 일치해야 한다** — 한 글자만 달라도 에러 없이 0행이 되어 경쟁군에서 조용히 빠진다. 대조 검증은 `scripts/lib/test_competitor_set.py`(DB 실측).
- ⚠️ **교정 마이그레이션에서 배열을 통째로 갈아끼우지 말 것.** `..._04_fix_models.sql` 이 `competitor_models`/`target_models` 를 배열째 UPDATE 하면서 멀쩡한 `Captur`·`Elantra Yuedong` 을 함께 지웠고, 복원 마이그레이션 2개(`...05`·`...06`)를 더 써야 했다. **검증 쿼리의 기간도 넓게 잡을 것** — `year_month >= 202501` 만 본 탓에 2023 년까지만 존재하는 표기를 "없음"으로 오판한 것이 원인이었다.

### 10개 차종 × 시장별 처리

한 차종이 여러 시장을 가지면 **시장마다 지표를 따로 계산**한다(경쟁군도 시장별로 다르다). 시장 선정 근거(2025.01~2026.07 실측 판매 비중)는 시드 주석 참조.

| model_key                                                 | 시장 (`market`)              |
| --------------------------------------------------------- | ---------------------------- |
| grand_cherokee · ram_truck · pacifica · rivian_r1 · atlas | USA (북미 5종, 미국 89~93%)  |
| porsche_911                                               | GLOBAL (지배 시장 없음)      |
| seltos                                                    | India · USA · Korea          |
| avante_ex_china                                           | USA · Korea                  |
| avante_china                                              | China                        |
| niro                                                      | USA · Europe (서유럽 14개국) |

- 아반떼는 **중국/중국 외로 카드 자체가 갈린다**(`avante_china` · `avante_ex_china`) — 중국은 전기·PHEV 전환이 최대 변수라 같은 잣대로 볼 수 없다.
- `MODEL_META` 의 `region` 은 `'North America' | 'Global'` 두 값만 쓴다(기존 행과 체계를 맞춘 것). **여기에 시장 코드(USA/India/…)를 넣지 말 것** — 같은 컬럼에 두 체계가 섞인다. 시장별 세부는 `market_breakdown` 이 담당한다.
- 지표 계산은 `scripts/lib/competition_metrics.py`(순수 함수, DB 접근 없음) 한 곳에서만 하고 결과를 `metrics` JSONB 에 저장한다 → TypeScript 는 표시만 하므로 계산이 두 언어로 갈리지 않는다. 🔴 **대상 차종과 경쟁군의 기준월 동기화**가 이 모듈의 핵심 함정이다 → [`gotchas-data-collection.md`](./gotchas-data-collection.md).

### 근거 데이터 4종 (+ 북미 한정 1종)

| 근거               | 출처 / 모듈                                  |
| ------------------ | -------------------------------------------- |
| 판매 실적 · 점유율 | `oem_sales_model_country_month` (MarkLines)  |
| 웹 검색            | Perplexity Search API `perplexity_client.py` |
| 리콜 · 소비자 불만 | NHTSA 공개 API `nhtsa_client.py`             |
| 딜러 재고일수      | `cox_brand_inventory` (미국 딜러 · 브랜드별) |

- **경쟁 차종까지 확장(2026-08-13)** — 재고일수·리콜·불만을 **대상 차종만이 아니라 시장별 판매 상위 3 경쟁 차종**(`TOP_RIVALS`)에 대해서도 모은다. 화면이 "경쟁 대비 어떤가"를 차트로 보이기 위한 것이고, 결과는 `metrics.competitor_inventory` · `metrics.competitor_safety` 에 시장별로 담긴다. 경쟁 차종 → Cox 브랜드 매핑은 **`oem_model_brand` 테이블**(마이그레이션 `20260813000008`)이 정본이다.
- **판매 실적** — 시장별 최근 12개월 판매·YoY·경쟁군 내 점유율(현재/전년) + 경쟁 차종별 판매·YoY 표.
- **웹 검색** — 차종당 고정 검색어 3종(신형/소비자 반응/경쟁 비교, `build_model_queries`)을 각 4건. Claude 내장 웹검색 대신 쓰는 이유는 **검색어를 우리가 고정할 수 있어 매달 같은 관점의 결과가 보장**되기 때문이다(모델 자율 검색은 실행마다 검색어가 달라져 편차가 크다). 가격도 절반($5/1,000 vs $10/1,000).
- **NHTSA** — 미국 등록 차량 한정이라 미국 미판매(`avante_china`)는 제외. 모델연도 폴백 `[2026, 2025, 2024]`. 🔴 **모델명은 접두 매칭으로 푼다** — 정확 일치는 파생형(`niro hev`·`ram 1500 crew cab`)을 놓치고 **0건을 "안전한 차"로 보이게** 만든다. 매핑 오류를 0건과 구분하려면 `_resolve` 의 경고 로그를 확인할 것 → [`gotchas-data-collection.md`](./gotchas-data-collection.md).
- **Cox 딜러 재고일수** — `MODEL_META` 에 Cox 브랜드가 매핑된 차종만 조회한다(10종 중 8종. `rivian_r1` 은 Cox 로스터에 Rivian 이 없고 `avante_china` 는 미국 미판매라 둘 다 `None`). **차종이 아니라 브랜드 단위**이고 **미국 딜러 기준**이라, 북미 4종(Jeep·Ram·Chrysler·Volkswagen) 밖에서는 미국 시장 신호로만 읽어야 한다. 🔴 **최신 1행이 아니라 최신 non-null 을 쓴다** — Cox 가 이상치 달을 비워 두기 때문(실측: Ram 202606=NULL, 202605=144일). Cox 자체 함정은 [`gotchas-data-collection.md`](./gotchas-data-collection.md).
- **소비자 평가 5축 점수(2026-08-13 추가)** — AI 가 시장마다 대상 + 상위 3 경쟁을 `상품성·디자인`/`가격 경쟁력`/`품질·신뢰도`/`연비·전동화`/`브랜드·잔존가치` 5축 1~5점으로 채점해 `metrics.consumer_scores` 에 담는다(화면 레이더 차트 입력). **3점이 그 시장 동급 평균**이라는 상대 평가 규칙을 시스템 프롬프트에 명시했다. 축 키는 수집기 `CONSUMER_AXIS_KEYS` 와 화면 `lib/oem-competition/types.ts` 의 `CONSUMER_AXES` 가 **일치해야** 한다. 값 범위는 스키마가 아니라 `_normalize_consumer_scores()` 가 1~5로 자른다.
- **생산-판매 갭은 1차 범위에서 뺐다** — 생산과 판매의 `country` 의미가 정반대라 국가별 차감이 무의미하기 때문 → [`gotchas-data-collection.md`](./gotchas-data-collection.md).

### 실행 · 비용

- **월 1회**: `.github/workflows/collect-oem-model-outlook.yml` cron `'30 21 20 * *'` = **KST 매월 21일 06:30**. 주 1회가 아닌 이유는 판매(MarkLines)·재고(Cox)가 월 1회 갱신이라 주간 실행이 *같은 숫자에 문장만 바뀌는 노이즈*가 되기 때문이고, 21일인 이유는 전월 판매 데이터와 Cox 수집(20일)이 끝난 뒤이기 때문이다.
- 모델 **Claude Sonnet 5**(env `OEM_MODEL_OUTLOOK_MODEL` 로 환원 가능), `output_config` 의 `json_schema` 로 응답 형식을 강제. **회당 약 $0.73**(Sonnet 5 $0.58 + Perplexity $0.15) → 연 $8.8.
- ⚠️ 이 수집기는 다른 LLM 수집기와 달리 `thinking` 을 **adaptive 로 켠다**(추출이 아니라 분석이라 사고가 품질에 기여한다). 비용 절감 목적으로 `disabled` 로 바꾸지 말 것 — Sonnet 5 의 thinking 기본값 함정과는 별개의 의도된 설정이다.
- 🔴 **`PERPLEXITY_API_KEY` 가 없으면 웹 검색만 조용히 건너뛰고 실행은 성공한다.** 실패가 아니라 **분석 품질 저하로만** 나타나므로 Secret 등록 누락을 놓치기 쉽다. 적재 행의 `sources_used`(`perplexity×N nhtsa=… cox=…`)와 `sources` 배열이 비었는지로 확인한다.
- **일부 차종만 재수집**: `--only ram_truck`(공백으로 여러 개 지정 가능). 한 종이 실패해도 전체를 다시 돌릴 필요가 없다. 🔴 **성공 판정은 워크플로의 exit code 가 아니라 `note_date` 가 당일인 행이 10종인지**로 한다 — 한 종만 잘려 빠져도 실행은 `success` 로 끝난다(경위·처방 → [`gotchas-data-collection.md`](./gotchas-data-collection.md)).

---

## `marklines-adhoc-fetch.yml` — 쿠키를 꺼낼 수 없을 때의 우회 통로

(AGENTS.md에서 이관, 2026-08-12 · `workflow_dispatch` 전용 · DB 미접근)

유효한 MarkLines 쿠키는 GitHub Secrets `MARKLINES_COOKIE` 에만 있고 **Secrets 는 write-only 라 값을
조회할 수 없다.** 로컬에서 다시 뽑는 것도 전멸했다:

- Edge — 쿠키 없음
- **Chrome 127+ ABE**(App-Bound Encryption) — 복호화 불가
- **Chrome 150** — 기본 프로필에 대한 CDP 접속 거부

그래서 **쿠키를 빼오는 대신 Actions 안에서 페이지를 받아 artifact 로 회수**한다.

```
gh workflow run marklines-adhoc-fetch.yml
gh run download <id> -n marklines-raw
```

- 스케줄이 없어 저절로 돌지 않으므로 **남겨 둬도 부작용이 없다.**
- ⚠ **로그인 판정을 HTTP 200 으로 하지 말 것** — 로그인 안 된 상태도 **200 에 144KB 짜리 껍데기**를
  돌려준다. `<table>` 존재·천단위 수치 유무로 판정해야 한다.
