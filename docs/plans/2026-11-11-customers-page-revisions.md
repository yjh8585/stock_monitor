# 고객사 페이지 수정 회차 (2026-11-11)

지시 원문 = [`2026-11-11-customers-page-revisions_최초지시.md`](./2026-11-11-customers-page-revisions_최초지시.md) · 앞 계획 = [`2026-11-10-customers-ir-expansion.md`](./2026-11-10-customers-ir-expansion.md)(전부 끝) · 앞 결정 = [`2026-11-10-customers-ir-expansion_결정이행.md`](./2026-11-10-customers-ir-expansion_결정이행.md)

**목표**: 사용자 화면 지적 12건을 A(화면 수정) → B(문서·뉴스 요약) → C(지역별·차종별·점유율 수집) 순으로 고친다. 묶음마다 화면 확인·푸시 여부를 묻는다.

## 전역 제약 (앞 계획 그대로)

- 🔴 레포는 공개 — 손익 고객명·매출 비중·공급 품목·「○○는 우리 고객」 문장을 코드·주석·시험·커밋·GHA 로그에 쓰지 않는다(시험의 사외비 쪽은 `가나자동차`·`Acme Motors`). OEM 이름은 써도 된다.
- 사외비 표는 `confidentialDb` 로만 읽는다. `'use cache'` 함수엔 `cacheLife('days')` · 새 캐시 태그는 `cacheTag` · `ALL_TAGS` · `COLUMN_TO_TAGS` 세 곳(`verify_revalidate_tags.py`).
- 연도는 `currentYear()` / 데이터 앵커 — 박지 않는다. 날짜는 `todaySeoul()`.
- 공용 부품은 선택 인자로 넓히고 기존 호출부(OEM 탭)의 모양을 바꾸지 않는다.
- 문서를 읽는 일(요약·표 추출)은 API(수집기와 같은 `ANTHROPIC_API_KEY`)로 — 사용자 지시 2026-11-11.

## 확정된 결정

| #   | 결정                                                                                      | 근거                    |
| --- | ----------------------------------------------------------------------------------------- | ----------------------- |
| R1  | 순서 A → B → C · 묶음마다 확인                                                            | grill-me 2026-11-11     |
| R2  | 요약 = 공식 문서별 한국어 3~5줄 + 뉴스 회사별 주간 요약 1개 · API · DB 저장               | 사용자 선택 2026-11-11  |
| R3  | 가이던스 신호등 = 빨강·노랑·초록·회색 규칙(지시 원문 파일) · 기준 숫자 한 곳 · 이유 한 줄 | 사용자 선택 2026-11-11  |
| R4  | 지역별·차종별·점유율 = 이번에 수집까지(C)                                                 | 사용자 선택 2026-11-11  |
| R5  | 요약 표 원화 환산 = 그 분기 평균 환율 · VND 환율 수집 추가                                | 메인 가정 · A 확정 포함 |
| R6  | 요약 표 실적 = 상세와 같은 규칙(회사 공시 우선 · 조정 이익이면 「조정」 표시)             | A 확정 2026-11-11       |
| R7  | 필요한 문서 쪽은 캡처해 요약 옆에(비공개 버킷 + 인증 경유) · B 중 C 재료 목록화           | 사용자 지시 2026-11-11  |

## 기존 부품 짝짓기 (설계 전 확인 · 「같은 종류의 과거 작업부터 연다」)

| 새 항목               | 기존 부품                                                     | 처리                                                                  |
| --------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 상단 탭               | `components/management/management-tabs.tsx` · 경영관리 layout | 모양 그대로 재사용 — 탭 목록만 고객사(DB 명단)로 · 새 `CustomersTabs` |
| 실적 차트 이익률 숫자 | `HyundaiQuarterlyEarningsChart(Inner)`(OEM 현대 탭 공용)      | 선택 인자 `showMarginLabels` 추가 — 현대 탭은 안 넘겨 그대로          |
| 물량 분기 막대        | `CompanyTimeSeriesChart(Inner)`(OEM 탭 공용)                  | 선택 인자로 분기 데이터를 넘길 때만 「분기」 보기 · 나란한 막대       |
| 신호등 기준           | `lib/oem-competition/signals.ts` `SIGNAL_THRESHOLDS`          | 같은 꼴로 `lib/customers/signals.ts` 신규(판정·툴팁 문구 한 곳)       |
| 요약 표 실적 규칙     | `lib/customers/ir.ts` `pickCustomerEarnings`(상세)            | 그대로 재사용 — 요약 조회가 회사 공시 행도 읽는다                     |
| 표 QoQ·누적·YTD       | `CustomerEarningsTable`                                       | 칸 추가(신규 계산은 `lib/customers/earnings.ts` 순수 함수 + 시험)     |
| 불러오는 중 화면      | `app/management/*/loading.tsx`                                | 같은 꼴로 `app/customers/[slug]/loading.tsx`                          |

## A — 화면 수정 (AI 비용 0)

> **상태(2026-11-11)**: 구현·검토 반영 끝 · 커밋 끝 · 푸시는 사용자 확인 대기. 이행 상세·검토 반영·사용자 선택 = [`_결정이행.md`](./2026-11-11-customers-page-revisions_결정이행.md).

각 작업은 순수 함수에 vitest 를 먼저 붙이고(가능한 것만), 끝에 `npm run check-all` · 로컬 dev 헤드리스 촬영으로 확인한다.

- **A1 탭** — `app/customers/layout.tsx` 신규(경영관리 layout 꼴: 제목 + 탭) · `components/customers/CustomersTabs.tsx`(client · `usePathname`) — [요약 `/customers` · 고객사들 `/customers/<slug>`] 요약 표 순서. 명단은 서버 layout 에서 캐시 함수로 읽어 이름·slug 만 넘긴다(비중 등 다른 사외비 칸은 넘기지 않는다). 요약 활성 판정은 `pathname === '/customers'` 정확 일치. 상세 머리의 「← 고객사」 링크는 탭이 대신하니 지운다.
- **A2 파란 링크** — 요약 표 회사명 `text-blue-600 hover:underline`(다크 모드 `dark:text-blue-400`).
- **A3 속도** — (1) `app/customers/[slug]/loading.tsx` · (2) `getCustomerDetail` 이 전체 `buildRows` 대신 그 회사만 계산 — 단 매출 비중 분모·합산 동료 이름이 전체 명단에 걸려 있으니 비중 계산(`computeShareResult`)은 전체로 두고 실적·주가만 한 회사로 좁힌다 · (3) 고치기 전후를 **로컬 운영 빌드**(별도 `distDir` — 다른 세션 dev 의 `.next` 를 건드리지 않는다)에서 클릭→「실적」 제목까지 초로 잰다. 운영 사이트는 테스트 계정 로그인이 안 돼(2026-11-11 실측) 로컬로 갈음.
- **A4 이익률 통일** — `getCustomersOverview` 가 회사 공시 행도 읽어 `pickCustomerEarnings` 로 고른 실적에서 최근 분기를 뽑는다. 영업이익 출처가 `company_adjusted` 면 칸에 작은 「조정」 표시 + 툴팁(회사 발표 조정 영업이익 이름). 시험: 스텔란티스형(법정 OI 없음·AOI 있음) 가짜 행으로 요약·상세가 같은 값.
- **A5 원화 분기 매출** — 요약 표에 「분기 매출(원화)」 칸. 환율 = 그 분기 일별 `exchange_rates` 평균(통화→KRW). VND 는 표에 없으니 FX 수집기에 VND(USD 교차) 추가 + 백필(2024~). 매출 통화가 KRW 면 그대로. 환율이 없으면 「—」. 단위 = 조원(1조 미만은 억원).
- **A6 가이던스 변경 문구** — 요약 칸을 「<지표 한국어 이름> 전망 <상향/하향>: <이전 값> → <새 값> (<날짜> <문서 종류>)」. 지표 한국어 이름표는 `lib/customers/format.ts` 에 지표 키(metric) 기준으로 한 곳(원문 `metric_label` 은 툴팁). 이전 값 = 같은 FY·지표의 직전 발표.
- **A7 차트 이익률 숫자** — `showMarginLabels` 로 이익률 점 위 `LabelList`(소수 1자리 %).
- **A8 표 칸** — 분기 보기: 매출 YoY 오른쪽 「매출 QoQ」 · 「누적 매출」·「누적 영업이익」(그해 1분기~그 분기 합 · 빠진 분기가 있으면 「—」). 연간 보기: 맨 앞에 「<올해> YTD」 행(올해 분기 합 · 라벨에 「1~3분기」). 출처 각주 규칙은 기존 그대로.
- **A9 물량 분기 막대** — `CompanyTimeSeriesChart` 에 선택 인자 `quarterly`(주·보조 둘 다) → 토글에 「분기」 · 나란한 막대(파랑 MarkLines 분기 합 · 노랑 회사 발표). MarkLines 월→분기 합은 순수 함수 + 시험(3달이 다 있어야 그 분기). 고객사 화면은 회사 발표가 분기만 있으면 기본 보기를 「분기」로.
- **A10 신호등** — `lib/customers/signals.ts`(`GUIDANCE_SIGNAL_THRESHOLDS` · 판정 순수 함수 + 시험): 빨강 = 연초 첫 전망보다 낮음(현재 방향이 유지여도) · 철회 · 이익률 목표 < 전년 실적 · 매출 감소 전망 / 노랑 = 개선 폭 작음(매출 성장 0~3% · 이익률 +0.5%p 미만) / 초록 = 연초보다 상향 · 매출 +3% 초과 · 이익률 +0.5%p 이상 / 회색 = 비교 대상 없음. 범위 전망은 중간값으로 비교. 카드 테두리·점 색 + 이유 한 줄.
- **A11 용어 설명** — 지표에 붙는 한국어 설명표(`special_items` 「일회성 특별 요인(Sondereffekte) — 2026: 포르쉐 영업권 손상 약 60억 유로·조기퇴직 구조조정·중국 자회사 자산 손상 · 원문 2026-09-18 전망 수정 공시」 · `operating_margin_adjusted` 「일회성 특별 요인을 뺀 영업이익률」 등). 카드에 ⓘ 툴팁 + 펼침 한 줄.

**A 완료 정의**: 위 11개 화면 촬영 확인 · 순수 함수 시험 통과 · `npm run check-all` exit 0 · 속도 전후 수치 보고 · 사용자에게 화면 보여 주고 푸시 여부 질문.

## B — 문서·뉴스 요약 (API) — 시작 때 grill-me 로 세부 확정

- 대상 문서 종류: `earnings_release` · `presentation` · `shareholder_letter` · `investor_day` · `guidance` · `fact_sheet`(+ `prelim_results`·`periodic` 은 검토). 사외비 새 표(요약·중요도·캡처 경로) · 비공개 버킷 · 인증 프록시 라우트.
- 정기 실행 = GHA 문서 수집 뒤(새 문서만) · 뉴스 주간 요약 = 주 1회. 과거 1년 소급 1회.
- 🔴 C 재료 목록: 요약 중 지역별·차종별·점유율 표를 보면 「회사·문서·쪽·내용」 을 남긴다(R7).
- 비용: 토큰 실측으로 다시 추정해 보고.

## C — 지역별·차종별·점유율 수집 — 시작 때 grill-me 로 세부 확정

- 출발점 = B 의 C 재료 목록 + 이미 있는 지역 계열(`customer_volume_ir` region).
- 회사별로 어느 문서에 무엇이 있는지 → 코드 파서 우선 · 못 읽는 표만 API.
