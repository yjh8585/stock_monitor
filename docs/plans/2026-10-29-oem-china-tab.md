# `/oem/china` — 중국 서브탭 신설 계획 (2026-10-29)

## 사용자 지시 원문 (2026-10-29)

> oem 페이지에 신규 서브페이지 추가.
>
> - 서브 페이지 이름 : 중국.
> - 소스 : https://www.marklines.com/en/vehicle_production/member
> - 위 페이지에 보면 엑셀 파일이 2개(displacement/nev, export volume), 링크가 1개(passenger cars, 들어가보면 엑셀 파일 다운로드 링크가 있음) 존재. 트럭 & 버스는 제외.
> - 3개 엑셀파일 읽어보고 분석해서 "전체" 서브페이지 처럼 구성해봐.

(첨부 화면: China 카드 — Monthly Statistics 의 Passenger Cars · Trucks & Buses · Displacement/NEV(엑셀) · Export Volume(엑셀), Annual Statistics 의 Passenger Cars · Trucks & Buses)

### 추가 지시 (2026-10-30)

> 무작정 새로 양식 만들지 말고 있는 차트양식 최대한 참고해

- 같은 날 사용자 선택: 「전체」 탭 `Top30YtdChart`·`Top40YearlyTable` 에 **선택 인자**(글자만 바꾸는 것, 안 넘기면 지금과 같음)를 더해 재사용한다 · 새로 만들었던 중국 전용 차트 파일 7개와 그 전용 집계 함수·시험은 지운다.

## 확정된 결정 (전부 2026-10-29 사용자 선택)

| #   | 결정        | 선택                                                                       |
| --- | ----------- | -------------------------------------------------------------------------- |
| 1   | 계획서      | 새로 만든다(이 파일)                                                       |
| 2   | 생산 출처   | 중국 전용 엑셀을 새 테이블 3개에 적재 — 기존 전 세계 생산 테이블 미사용    |
| 3   | 추가 분석   | 내수 추정 · 수출 EV 비중 · 차급 믹스 · 증감 상위·하위 (4종 전부)           |
| 4   | 자동 갱신   | GHA 주 1회(월 10:20 KST), 바뀐 파일만 적재, `xlrd` 추가                    |
| 5   | 이력 범위   | 2018~ (NEV 파워트레인 열이 2018 시트부터)                                  |
| 6   | 묶는 단위   | 중국 모회사 / 브랜드 토글                                                  |
| 7   | n.a. 모회사 | 브랜드 이름으로 대체(테슬라·기아·MINI 가 각각 한 줄)                       |
| 8   | 재적재      | 파일에 든 연도 범위 안에서 파일에 없는 키는 지운다(개명 시 이중 집계 방지) |
| 9   | 기존 화면   | 「전체」 탭·기존 테이블은 건드리지 않는다                                  |

## 실측 — 엑셀 3종 (2026-10-29 내려받아 열어 봄)

| 파일             | 형식                  | 이력      | 쓰는 열                                                    |
| ---------------- | --------------------- | --------- | ---------------------------------------------------------- |
| Passenger Cars   | xlsx, 한 해씩         | 2002~     | Type · Segment · 월 12                                     |
| Displacement/NEV | 구형 .xls(4.4MB)      | 2010~2026 | Maker/Brand · Group · Type · Model · HV/PHV/EV · 월 12     |
| Export Volume    | xlsx(병합 셀·소계 행) | 2016~2026 | Chinese Group · Chinese Maker · Brand · Model · EV · 월 12 |

#### 상세

- **받는 곳**
  - 승용차: `/en/vehicle_production/preset/excel/month?nationCode=CHN&fromYear=Y&toYear=Y&excelDownloadMethod=1`
  - NEV: `/en/statistics/product/china_monthly_prod` 페이지 안의 `/statics/pages/xls/daisu/china_monthly_prod_en_YYYYMMDD.xls`
  - 수출: `/en/statistics/product/china_export` 페이지 안의 `/statics/pages/xls/daisu/china_exp_en_YYYYMMDD.xlsx`
- **세 파일의 관계**: 승용차와 NEV 의 월 합계가 **정확히 같다**(2026-01 전 차종 2,449,865 대 2,449,865). NEV 는 같은 생산을 트림(배기량)·파워트레인으로 쪼갠 것이다. 둘 다 이름과 달리 **트럭·버스 행이 섞여 있다** → Type 이 `Sedan/Hatchback`·`SUV`·`MPV`·`Mini Van` 인 행만 쓴다(2018~2026 전 시트에서 이 4개 표기가 그대로임을 확인).
- **NEV 의 Group 열은 중국 모회사 기준**이다(Audi 행의 Group = FAW). 승용차 파일의 Group 은 글로벌 그룹(Toyota Group)이라 쓰지 않는다.
- **n.a. 모회사**: 2026 1~9월 승용 107만 대(모회사 순위 7위) — 테슬라 상하이 74만 · 위에다기아 19만 · MINI 5만 · 이빈 카이이 4만 …
- **그룹명이 해마다 바뀐다**(맞추기 표 필요): Chery Automobile→Chery Group · Guangzhou Automobile Group→GAC Group · Haima (Zhengzhou) Automobile→Haima Automobile · Fujian Motor Industrial→Industry Group · SERES (2022-)/Chongqing Sokon→Seres Group · Jiangling Motors Co. Group→(2022-). 수출 파일도 같은 갈래.
- **파워트레인 열**은 2018 시트부터. 값: 빈칸(=ICE)·EV·PHV·PHEV·HV·MHV·MHV/PHV·HV/EV·FCV → 판매 쪽 `normalize_powertrain` 규칙을 그대로 쓴다.
- 승용 NEV(EV+PHV) 비중 실측: 2018 4.5% · 2020 6.0% · 2022 28.2% · 2024 44.8% · 2025 51.6% · 2026(1~9월) 58.0%.
- **수출 파일엔 차종 열이 없다.** 2026 수출 모델을 생산 모델명과 맞춰 보니 맞은 568만 대는 전부 승용, 상용으로 맞은 것은 0건 → **승용 전용**으로 판단(안 맞은 148만 대는 표기 차이 — 「MG ZS (2017-)」·「Song PLUS DM」 등).
- 수출 EV 열(2022~)은 **모델 단위 태그**(`EV`·`PHV`·`EV/PHV/ICE` 등)라 물량이 파워트레인별로 안 쪼개진다 → 태그 분류(EV 전용 · PHEV 전용 · HV · 혼합 · 태그 없음)로 보여 주고 각주로 한계를 밝힌다.
- 수출 2025·2026 은 「by Chinese Group」·「by Group」 두 벌(총계 같음), 그 이전은 Chinese Group 한 벌 → **Chinese Group 시트만** 쓴다. 시트마다 `Grand Total` 행이 있어 파서 자기검증에 쓴다(월별 합 = Grand Total). 2026 시트는 주석 2줄이 더 있어 헤더 행 위치가 시트마다 다르다(헤더는 「Chinese Group」 문자열로 찾는다).
- 「Adjusted value」 열(연 단위 보정)은 월에 배분할 수 없어 버린다.
- **DB 의 기존 중국 생산**(`oem_production_model_country_month` country='China')은 중국 전용 파일과 약 2% 다르다(2026-01 2,497,789) — 받은 시점 차이로 추정, **미확인**. 중국 탭은 쓰지 않는다(결정 2).
- 규모(2026 1~9월): 전 차종 생산 2,324만 · 승용 생산 1,996만 · 승용 수출 717만.

## 다운로드 함정 (실측)

- **승용차 엑셀은 303 리다이렉트를 거친다 — `requests` 의 자동 리다이렉트를 쓰면 로그인 화면(HTML 200)이 온다.** 자동 리다이렉트가 원문 `Cookie` 헤더를 떼고 빈 쿠키 jar 로 다시 요청하기 때문이다(2026-10-30 실측 — 처음엔 Referer 탓으로 잘못 짚었다. Referer 없이도 받아진다). `sync_oem_china_excel.py` 의 `download()` 가 리다이렉트를 손으로 따라간다.
- NEV·수출 URL 엔 **갱신 날짜가 박혀 있다** → 매번 페이지에서 링크를 다시 읽는다.
- NEV 는 BIFF `.xls` → `xlrd`(GHA 리눅스엔 Excel COM 이 없다).
- GHA 의 `MARKLINES_COOKIE` 는 살아 있다(생산·판매 sync 2026-10-12·19·26 연속 성공).

## 설계

### DB — 마이그레이션 `20261029000001_create_oem_china_tables.sql`

| 테이블                       | 원천   | PK                                                                   |
| ---------------------------- | ------ | -------------------------------------------------------------------- |
| `oem_china_production_month` | NEV    | `cn_group, maker_brand, vehicle_type, model, powertrain, year_month` |
| `oem_china_segment_month`    | 승용차 | `vehicle_type, segment, year_month`                                  |
| `oem_china_export_month`     | 수출   | `cn_group, maker, brand, model, year_month` (+ `ev_tag` 일반 열)     |

- `cn_group` 은 **맞추기 표·n.a. 대체를 거친 값**을 저장한다(화면이 다시 가공하지 않게).
- 순수 데이터 테이블 → `trg_skip_identical_update` 부착. RLS·권한은 기존 `oem_production_model_country_month` 정의를 그대로 따른다.
- `year_month` 는 기존 oem 테이블처럼 `integer YYYYMM`.
- 트림(배기량)은 저장하지 않는다 — 파서가 PK 단위로 합산한다(PK 가 「유일」하도록 만드는 자리가 파서다).

### 수집 — Python

- `scripts/lib/china_excel.py` — 순수 파서 3개 + 그룹 맞추기 표 + 수출 Grand Total 자기검증. 입력은 시트별 행 리스트, 출력은 PK 단위로 합산된 dict 리스트.
- `scripts/import_oem_china.py` — 파일 → 파서 → `upsert_rows`(캐시 무효화 자동) → 같은 연도 범위의 stale 키 삭제.
- `scripts/sync_oem_china_excel.py` — 쿠키 세션 → 3종 다운로드(승용차는 올해·작년, `--backfill` 이면 2018~) → 구조 검증 → md5 비교 → 바뀐 것만 import. 저장 위치 `참고/oem 중국/`.
- GHA `.github/workflows/sync-oem-china-excel.yml` cron `20 1 * * 1`.

### 화면 — `/oem/china`

기아 탭 패턴: `app/oem/china/page.tsx` · `lib/oem-companies/china/{source.ts,aggregate.ts,aggregate.test.ts}` · `components/oem-companies/china/ChinaDashboard.tsx`(조립만). `getChinaData()` 는 `'use cache'` + `cacheLife('days')` + 새 태그 3개, 반환값은 **기존 차트가 받는 모양으로 줄인 결과만**(원본 행을 캐시에 싣지 않는다 — ISR Write. 순위용 (묶음, 월) 행은 차트가 읽는 해부터만 — 생산 `p.fullYear − 1`~ · 수출 `p.year − 1`~ · 차종 구조는 `p.fullYear` 한 해).

**짝짓기 표**(2026-10-30 재작업 — 사용자 지시 「있는 차트양식 최대한 참고」, `docs/chart-guide.md` §7 0번). 첫 판은 이 표 없이 새 차트 7개를 만들었다가 같은 날 전부 지웠다.

| #   | 항목                         | 짝지은 기존 컴포넌트                        | 방식                                                   |
| --- | ---------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| 1   | KPI                          | `common/CompanyKpiCards`                    | 그대로                                                 |
| 2   | 내수(추정) · 수출            | `kg-mobility/KgDomesticExportSplit`(카드째) | 선택 인자 `title`·`footer` (축 단위 버그는 Inner 에서) |
| 3   | 생산 파워트레인 믹스         | `common/CompanyPowertrainMixChart`          | 그대로                                                 |
| 4   | 생산 YTD TOP30               | 전체 탭 `Top30YtdChart`                     | 선택 인자 `metricLabel`·`entityLabel`·`year`           |
| 5   | 순위 등락 TOP40(연도별 표)   | 전체 탭 `Top40YearlyTable`                  | 선택 인자 `entityLabel`·`year`                         |
| 6   | 증감 상위·하위               | 전체 탭 `YoyWinnersLosers`                  | 선택 인자 `year` (대수 → 성장률 %로 바뀜)              |
| 7   | 차급 믹스                    | 전체 탭 `TypeSegmentChart`                  | 선택 인자 `year` (추이 → 마지막 완결 연도 도넛 2개)    |
| 8   | 생산 모델 TOP30 · 수출 TOP20 | `common/CompanyTopModelsTable`              | 그대로                                                 |
| 9   | 수출 YTD TOP30               | 전체 탭 `Top30YtdChart`                     | 4와 같음                                               |
| 10  | 수출 EV 표기 비중            | `common/CompanyPowertrainMixChart`          | 그대로(표기 → EV·PHEV·HV·ICE·Multi·Unknown 로 옮김)    |
| —   | 모회사/브랜드 토글(결정 6)   | 우즈베키스탄 `UzbekistanDimensionToggle`    | 선택 인자 `options` (4·5·6·9 칸 머리)                  |

#### 상세

- 선택 인자는 **기본값이 지금과 같다**(`'판매량'`·`'OEM'`·`currentYear()`/`targetYear()`·`'내수/수출 분리'`·브랜드/회사) — 전체·KG·우즈베키스탄 탭 화면은 그대로다(헤드리스로 확인).
- 첫 재작업 판은 토글(`DimTabs`)과 내수·수출 카드 껍데기를 새로 짰다 — 버튼 모양만 본뜨고 「짝 없음」이라 적었는데, 같은 일을 하는 `UzbekistanDimensionToggle`·`KgDomesticExportSplit` 이 이미 있었다(2026-10-30 검토 지적 → 재사용으로 교체). **짝을 찾을 때 「같은 모양」이 아니라 「같은 일」로 찾는다.**
- `KgDomesticExportSplitInner` 의 축 단위 함수가 「1,000만으로 나누고 M」을 붙여 10배 작게 찍었다(3,200만 → 3.20M). 회사 하나는 1,000만에 안 닿아 안 보이던 버그라 **이 파일만** 고쳤다. 같은 식이 회사 탭 차트 16곳에 더 복사돼 있다(값이 작아 지금은 안 보인다 — 손대지 않음 · 목록 = `docs/chart-guide.md` §3).
- 연간 라벨은 KG·현대 관례대로 **연도만** 쓴다 — `'2026 YTD'` 처럼 길면 x축이 바로 앞 해(2025) 라벨을 숨겼다(헤드리스 실측). 누계 기간은 각주가 밝힌다.
- 차종 구조 도넛은 반쪽 폭이면 조각 이름이 잘려 전체 탭처럼 한 줄을 다 쓴다.
- 🔴 **연도는 시계가 아니라 데이터 앵커로 정해 차트에 `year` 로 넘긴다**(2026-10-30 검토 지적). 첫 판은 전체 탭처럼 `currentYear()`·`targetYear()` 를 썼는데, 중국 엑셀은 한 달 넘게 늦어 1~2월엔 시계 연도의 데이터가 아직 없다 — 그러면 YTD TOP30 은 「데이터 없음」, 순위 표는 KPI(앵커 기준)와 다른 해를 말한다. 제목·각주도 같은 `p.year`·`p.fullYear` 로 만든다.
- 머리글의 시작월과 수출 EV 표기 비중의 시작 연도도 데이터에서 읽는다(「2018.01~」「(2022~)」를 박지 않는다).
- 12월까지 찬 해는 모델 표의 YTD 칸이 연간과 겹쳐 비운다(KPI 「대기」와 같은 규칙).

탭: `app/oem/layout.tsx` 의 `OEM_TABS` 에 「중국」 한 줄. 새 API 라우트 없음.

### 함께 고칠 곳

- 캐시 태그 3곳: `cacheTag` · `app/api/revalidate/route.ts` `ALL_TAGS` · `scripts/lib/revalidate.py` `COLUMN_TO_TAGS`
- 문서: `Architecture.md` §5·§7·§10·부록 C · `docs/oem-collection.md`(중국 절 + 탭 목록)

## 검증

1. 파서: 수출 Grand Total 자기검증 · NEV 전 차종 월합 = 승용차 파일 전 차종 월합(교차 검증) · 파이썬 단위 시험
2. 적재 후 SQL: 2026-01 승용 생산 = 2,061,724 · 2026 1~9월 수출 = 7,166,762 − Adjusted 제외분 · 연도별 행 수
3. `aggregate.test.ts` · `npm run check-all` · `verify_revalidate_tags.py`
4. dev 서버 `/oem/china` 헤드리스 캡처로 10개 절 렌더 확인 — 2026-10-30 카드 14장(KPI 4 + 10) 렌더 · 콘솔 오류 0 · 토글은 칸마다 따로 · 전체 탭 표 머리 「OEM」 그대로
