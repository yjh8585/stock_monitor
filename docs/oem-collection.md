# OEM 회사별 차종 판매 수집 상세

이 파일은 `/oem/*` 회사별 탭의 **수집 로직·데이터 모델·gotcha**를 다룬다. 라우트 목적 요약은 [`AGENTS.md`](../AGENTS.md) 라우트 표, DB 스키마는 [`Architecture.md §7`](../Architecture.md), 워크플로 전체 목록·주기는 [`Architecture.md §10`](../Architecture.md) 참고.

공통 패턴: `lib/oem-companies/<slug>/`(`source.ts` `'use cache'`+`cacheTag` / `aggregate.ts` pure 함수 + `aggregate.test.ts`), 컴포넌트는 `components/oem-companies/common/` + `<slug>/`. 판매 데이터는 모두 `vehicle_powertrain_map` LEFT JOIN으로 PT(파워트레인) mix 도출.

`/oem` "전체" 탭은 글로벌 MarkLines 대시보드(5개 `oem_sales_group_*` 테이블) + OEM 모델 outlook. 탭 네비는 `app/oem/layout.tsx`에서 통합 관리(6탭: 전체/Stellantis USA/KG모빌리티/현대차/기아/우즈베키스탄).

---

## `/oem/stellantis-na` — Stellantis NA (FCA US LLC)

- **범위**: brand·차종별 분기 판매 (2021Q1~)
- **출처**: prnewswire.com FCA US LLC publisher의 분기당 1개 보도자료 HTML `<table>`. `collect_stellantis_na_sales.py` — **requests + BeautifulSoup (Playwright 불필요)**
- **테이블** `stellantis_na_sales`: PK = period_type/year_period/brand/vehicle_model/region
  - brand 6종 = Jeep/Ram/Chrysler/Dodge/Fiat/Alfa Romeo (Maserati는 별도 PR이라 미수집)
  - `brand='Total'`/`vehicle_model='Total'`은 합계 row, region은 단일 `'US'`
- **gotcha**:
  - 분기 PR이 CYTD 컬럼 동봉 → Q4의 경우 `period_type='year'`(연 누계) 한 세트 **추가 적재**. Q1~Q3 연 누계는 분기 SUM으로 자연 도출.
  - cross-check: brand_total vs 모델 SUM (Q **±25**, YTD **±100**, source-side 미세 누락 허용) + 회사 합계 **±5** (실패 시 abort)
- **차트**: KPI 4종 + 분기 brand stacked(분기/연 토글, 합계 라벨) + 브랜드 mix(100% stacked) + PT mix(100% stacked) + 차종 TOP10(brand 1단계 드롭다운, region 단일 'US')
- **URL 매핑**: `scripts/lib/stellantis_pr_urls.json` (22분기 영구 캐시) + `--auto-discover`로 publisher index에서 신규 분기 발견. HTML sha256 캐시 `data/_stellantis_pr_cache/`
- **cron**: `collect-stellantis-na-sales.yml` — 분기 첫 달(1·4·7·10) 3일 03:00 UTC. `workflow_dispatch` 입력: `year_from`/`year_to`/`quarter`/`reprocess_all`/`auto_discover`

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

- **범위**: 차종별 판매 + 해외 공장 5종 + 지역별 수출 10종 (월별, 2021~)
- **출처**: worldwide.kia.com JSON API(`/api/investors/business-sales-results`) → 엑셀 3종(차종별·해외공장·지역별 수출) Playwright APIRequestContext 다운로드. `collect_kia_sales.py`
- **테이블**:
  - `kia_sales`: region IN ('', '내수', '수출', 'CKD') + factory 5종. **`Aggregate` 모델은 CKD section 합계 행이라 TOP10에서 제외**
  - `kia_export_regions`: 10 region × vehicle_type 8종을 6 카테고리로 normalize
- **차트**: KPI 4종 + 판매 추이(월/연 토글) + PT mix(EV 8종 매핑) + 해외 공장 5종 stacked + 지역별 수출 10종 stacked + 수출 차종 type mix(승용/RV/상용/특장/CKD 일반/CKD 특장) + 차종 TOP10(전체/국내/내수/수출)
- **cron**: `collect-kia-sales.yml` — 매월 16일 03:00 UTC(현대 15일과 1일 분산). 마이그레이션 `20260527000001`, `20260527000002`

## `/oem/uzbekistan` — 우즈베키스탄 자동차 시장

- **범위**: 회사별 sales + 연간 production by brand (2024~)
- **출처**:
  - uzavtosanoat.uz 회사별 sales 매월 보도자료 — RU 정규식 파싱 + **YTD 차분 → 월별 row**
  - uzavtosanoat.uz Statistical info — 연간 production by brand (Chevrolet/BYD/LCV/Engines, 2016~2025)
- **테이블** `uzbekistan_auto_stats` (단일 통합): kind=sales\|production, period_type=month\|quarter\|year
  - **company enum 6개** = UzAuto Motors / Khorezm Auto / ADM Jizzakh / BYD Uzbekistan Factory / SamAuto / Asaka Motors
  - source_type = uzavtosanoat \| stat-uz
  - **UzAuto Motors만 companies 테이블 등록**(UZMT, data_source=uzauto-pdf). 나머지 5개는 sales row의 company 컬럼만 사용
- **차트**: KPI 3장 + 회사별 sales 월/연 stacked + 연간 production by brand stacked
- **cron**: `collect-uzbekistan-sales.yml` — 매월 20일 03:00 UTC(보도자료 14~18일 발표 후 안전 일정). 마이그레이션 `20260527000004`
- **TODO**: stat.uz 분기 production은 추후 별도 수집 추가 예정

---

## UzAuto Motors IFRS PDF 재무 (참고: PDF-only 회사 패턴)

우즈벡 탭과 별개로, UzAuto Motors는 재무도 PDF에서 수집한다. `collect_uzauto_financials.py`: `/investors` HTML 파싱(우즈벡어/영문 정규식) → PDF sha256 캐시(`uzauto_pdf_cache`, 마이그레이션 `20260526000001`) → 변경분만 Anthropic API(`claude-opus-4-7`) PDF document + `tool_use(submit_financials)` → financials upsert. **연도 오름차순 처리**로 재진술 정책 자연 보장. 플래그: `--reprocess-all`/`--dry-run`. cron `collect-uzauto-financials.yml` 매주 월요일 03:00 UTC.
