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

우즈벡 탭과 별개로, UzAuto Motors는 재무도 PDF에서 수집한다. `collect_uzauto_financials.py`: `/investors` HTML 파싱(우즈벡어/영문 정규식) → PDF sha256 캐시(`uzauto_pdf_cache`, 마이그레이션 `20260526000001`) → 변경분만 Anthropic API(`claude-opus-4-7`) PDF document + `tool_use(submit_financials)` → financials upsert. **연도 오름차순 처리**로 재진술 정책 자연 보장. 플래그: `--reprocess-all`/`--dry-run`. cron `collect-uzauto-financials.yml` 매주 월요일 03:00 UTC.
