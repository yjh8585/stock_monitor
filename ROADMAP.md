# 자동차 산업 주식 모니터링 대시보드 — 로드맵

## 개요

자동차 산업 관련 기업의 주가·환율·재무 데이터를 자동 수집하고
7개 페이지로 구성된 대시보드에서 시각화하는 프로젝트입니다.

**페이지 구성**: 관련주식 / 비교 / 국내자동차 / OEM / 부품사 TOP100 / 한세그룹 / 기타정보

---

## Phase 0 — 기반 설정 ✅ 완료

**목표**: 개발 환경 초기화 및 프로젝트 뼈대 구성

- [x] Next.js 15 + TypeScript + Tailwind CSS 4 + shadcn/ui 초기화
- [x] ESLint, Prettier, Pino 로거 설정
- [x] ~~mcp-shrimp-task-manager 빌드 + `.mcp.json` 등록~~ (2026-07-15 제거 — superpowers 스킬·TodoWrite·ROADMAP/MEMORY와 역할 중복)
- [x] 프로젝트 서브 에이전트 4종 (`.claude/agents/`)
- [x] `ROADMAP.md`, `USER_ACTIONS.md`, `.env.example` 작성
- [x] `lib/logger.ts` (Pino 기반 서버 전용 로거)
- [x] `package.json` check-all 스크립트 구성

---

## Phase 1 — DB 스키마 + Python 수집 인프라 ✅ 완료

**목표**: Supabase DB 구조 설계 및 Python 데이터 수집 기반 마련

- [x] Supabase 마이그레이션 — 7개 테이블 생성
  - `companies`, `stock_prices`, `financials`, `news`, `watchlist`
  - `exchange_rates`, `exchange_rates_live`, `companies_with_latest` 뷰
- [x] 21개사 시드 데이터 (`companies.json` → DB upsert)
- [x] Python 가상환경 설정 (`scripts/venv`) + `requirements.txt`
- [x] `scripts/lib/db.py` — PostgREST Python 클라이언트 공통 모듈
- [x] `scripts/lib/accounts_map.py` — 재무 계정과목 매핑 상수
- [x] `scripts/lib/fx.py` — 환율 변환 공통 유틸리티

---

## Phase 2 — 주가·환율 수집 (일봉 + 시간별) ✅ 완료

**목표**: 자동 시세 수집 파이프라인 구축

- [x] `scripts/collect_prices.py`
  - pykrx: 한국 8개사 5년 일봉
  - yfinance: 글로벌 13개사 5년 일봉
- [x] `scripts/collect_prices_live.py` — 1시간 간격 현재가 수집
- [x] `scripts/collect_fx.py` — 6개 환율 쌍 5년 일봉
- [x] `scripts/collect_fx_live.py` — 6개 환율 현재값 수집
- [x] GitHub Actions 워크플로우 4개
  - `collect-prices.yml` (매일 06:00 KST)
  - `collect-prices-live.yml` (매시간)
  - `collect-fx.yml` (매일 06:00 KST)
  - `collect-fx-live.yml` (매시간)

---

## Phase 3 — 분기·연간 실적 ✅ 완료

**목표**: 재무제표 자동 수집 파이프라인 구축

- [x] `scripts/collect_financials.py`
  - valley.town Playwright: 한국 8개사 연결 재무제표
  - yfinance: 글로벌 13개사 분기/연간 실적
  - 13개 계정과목 수집 (매출, 영업이익, 순이익, 자산, 부채, 자본 등)
  - ROE, ROA, 유동비율 계산 후 저장
- [x] `supabase/migrations/20260428000008_financials_nulls_not_distinct.sql`
- [x] GitHub Actions: `collect-financials.yml` (1/4/7/10월 15일 분기별 자동 실행)

---

## Phase 3.5 — fnguide 교체 🟡 진행 중

**목표**: valley.town → fnguide.com Playwright로 교체 (한국 8개사)

- [x] DB 마이그레이션 8개 추가 및 적용
  - `20260501000001` — companies에 market_cap, business_summary 추가
  - `20260501000002` — shareholders 테이블 신규 (대주주/주주구분)
  - `20260501000003` — credit_ratings 테이블 신규 (CP/Bond)
  - `20260501000004` — financials에 EPS/BPS/PER/PBR/EV_EBITDA 추가
  - `20260506000001` — companies에 company_type/region/products/customers 추가
  - `20260506000002` — 21개사 company_type·region·products·customers 시드
  - `20260506000003` — financials에 inventory(재고자산) 추가
  - `20260506000004` — related_stocks_view 생성 (관련주식 페이지용)
- [x] `scripts/collect_kr_snapshot.py` — fnguide Snapshot 스크레이핑 작성
  - 시가총액, 기업개요, 대주주/주주구분, 신용등급(CP/Bond) 수집
- [x] `scripts/collect_financials.py` — fnguide 재무제표·투자지표로 교체
  - GoMenu('103') 재무제표, GoMenu('105') 투자지표 수집
  - ⚠️ 2026-07: fnguide 레이아웃 변경(Snapshot fallback·통합표)으로 재작성 → `SVD_Finance.asp`/`SVD_Invest.asp` 직접 URL + 구조 변경 감지 가드. 상세 → `docs/gotchas-data-collection.md`(2026-08-10 AGENTS.md 에서 이관)
  - ⚠️ 2026-08: fnguide 도메인 이전(`comp` → `wcomp`)으로 재작성 → JSON 엔드포인트 + `AC_CODE` 매칭 + Playwright 제거, 주간 계약 점검(`verify-fnguide.yml`) 추가. 상세 → `docs/fnguide-wcomp-migration.md`
- [ ] 스크립트 실행 테스트 및 데이터 정합성 확인

---

## Phase 4 — 뉴스 수집 ✅ 완료

**목표**: 자동차 업계 주요 뉴스 자동 수집

- [x] `scripts/collect_news.py`
  - yfinance 뉴스 피드 (글로벌 상장사 `Ticker.news`)
  - Naver 종목 뉴스 API (한국 상장사) + Google News RSS (비상장사는 회사명 검색)
- [x] GitHub Actions: `collect-news.yml` — **6시간 주기**(`0 */6 * * *`, 설계 당시 '4시간'에서 변경됨)

> 2026-08-10 실측으로 완료 확인(체크박스가 낡아 미완으로 남아 있었다): 스크립트·워크플로 존재 + 정기 실행 성공.

---

## Phase 5 — 대시보드 UI (7개 페이지) 🟡 진행 중

**목표**: 7개 페이지 대시보드 UI 구현

### 공통 인프라 ✅ 완료

- [x] 좌측 사이드바 (`components/layout/Sidebar.tsx`) — 7개 탭
- [x] 팝업 레이아웃 분리 (`components/layout/AppLayout.tsx`) — 사이드바 제외
- [x] `lib/types.ts` — RelatedStockRow, FinancialYear 등 공통 타입
- [x] `lib/format.ts` — toB, toT, fmtPct, fmtChange, calcCagr 등 포매팅 함수
- [x] `lib/customerLogos.ts` — 고객사 브랜드 로고 설정 (SimpleIcons CDN)
- [x] `lib/supabase/client.ts`, `server.ts` — Supabase 클라이언트

### Page 1: 관련주식 ✅ 완료

- [x] 21개사 × 20컬럼 실적·주가 표 (정렬·필터·열 너비 조정)
  - 구분 / 회사명 / 제품 / 고객사 / 지역 / '22~'25 매출 / 3yr CAGR
  - '23~'25 OP% / '25 부채비율 / '25 재고회전율 / 주가 / 시가총액 / PER / PBR / EV/EBITDA
- [x] 좌측 3열(구분/회사명/제품) sticky 고정 + 열 너비 드래그 조정
- [x] OEM/부품사 토글 필터 + 제품 텍스트 검색
- [x] 회사명 클릭 → `/stock-popup/[id]` 팝업 (3/4 주식 페이지 + 1/4 뉴스)
- [x] 고객사 로고 (SimpleIcons CDN, 배지 폴백)
- [x] 매출 YoY 성장률 화살표 (파란색▲/빨간색▼), CAGR, OP% 음수 빨간색
- [x] 매출 십억원·시가총액 조원 단위, 외화 → KRW 환율 자동 환산
- [x] `related_stocks_view` — companies + 4년 annual 실적 + 환율 합성 뷰

### Page 2: 비교 (예정)

### Page 3: 국내자동차 (예정)

### Page 4: OEM (예정)

- [x] `/oem/competition` — 핵심 차종 10종 경쟁 분석 (2026-08-13)
  - 경쟁군 정의 SSOT `oem_competitor_set` + 세그먼트 매핑 `oem_model_segment`
  - 근거: MarkLines 판매 실적 · 경쟁군 점유율 · Perplexity 웹검색 · NHTSA 리콜 · Cox 재고일수(북미)
  - Claude Sonnet 5 종합, 월 1회(매월 21일) 자동 갱신
- [x] `/oem/competition` 화면 재구성 — 카드 → **스코어보드 + 차종별 차트 7종** (2026-08-13, 사용자 지시)
  - 항목별 신호등 5종(판매·점유·재고·안전·소비자) 수치 규칙 판정 `lib/oem-competition/signals.ts`
  - 소비자 평가 5축 AI 점수 + 경쟁 차종 재고·리콜까지 수집 확장, 다중 시장은 시장 탭
  - 월별 시계열 구체화 뷰 `oem_competition_monthly_view`(일반 뷰는 4.9초로 anon timeout → 23ms)
  - 부수 수정: NHTSA 접두 매칭(Ram 주력 1500 누락 복구) · Cox 최신 non-null 재고
- [x] `/oem/competition` 사용자 피드백 14건 반영 (2026-08-14, 사용자 지시)
  - 차트 7종 전부 **범례 클릭 토글** 배선(재사용 자산은 썼는데 `onToggle`을 빠뜨려 죽어 있었다)
  - **기준 버튼(최근 12개월 · YTD)** — 월별 구체화 뷰에서 화면이 재집계(`buildPeriods`). 저장값과 14개 시장 전부 일치 확인
  - **미국 전용 지표의 자격 분리**(`usMetricsBasis`) — 글로벌 시장(포르쉐 911)은 표시하되 **등급 판정 제외**
  - 🔴 **Cox 이상치 제외(업계 평균 2배 초과) = RED 판정** — 위 8/13의 "최신 non-null" 만으로는 그 신호가 사라진다(값이 없는 쪽이 더 나쁘다). AI 프롬프트의 경고 분기도 조건 오류로 죽어 있어 함께 복구
  - NHTSA는 이중축 → **리콜/불만 지표 토글 + 접이식 내역**, 종합 등급은 스코어보드 **행 음영**
  - 소비자 레이더 경쟁 고유색·점유율 화살촉 덤벨·KPI 증감 병기·서술을 KPI 아래로
- [x] `/oem/competition` 판독성 2차 수정 (2026-08-14, 사용자 지시 — 위 두 차트를 **다시** 갈아엎었다)
  - **소비자 평가 5축** 겹친 오각형 → **차종별 패널 분리**(small multiples). 모든 패널에 같은 회색 점선(비교군 평균)을 깔아 비교 기준 유지. 축척 동일함을 DOM 실측으로 확인(5점 링 172px, 패널 간 차이 0px)
  - **경쟁군 내 점유율 변화** 화살촉 덤벨 → **가로 그룹 막대**(전년 옅은 톤 / 현재 진한 톤). 파일도 `ShareDumbbell.tsx` → `ShareChangeBars.tsx`
  - 🔴 배운 것: 색·모양만 바꾼 두 번의 시도가 모두 실패했다. **"겹쳐서 안 보인다"의 답은 색이 아니라 분리**이고, **"변화가 전달 안 된다"의 답은 방향 표식이 아니라 길이**다 → `docs/chart-guide.md §3·§7-A`
  - 화면으로만 잡힌 함정 3건(`DATA_LABEL_STYLE` 의 CSS `fill` 이 `fill=` 속성을 이겨 증감색 전멸 · `LegendRow` 의 `color` 가 글자색이라 옅은 색이면 라벨 실종 · `domain` 만 주면 눈금이 상한을 배수로 안 나눔) → §7-A
- [x] `/oem/competition` 추이 차트 2종 신설 + 판독성 3차 (2026-08-14, 사용자 지시)
  - **점유율 추이**(12개월 이동 누계, 24개월) — 이미 있던 `oem_competition_monthly_view` 48개월치를 화면이 재집계. 그랜드체로키 21.1%→17.1%, **2025.10경 Explorer 에 역전당한 시점**이 처음으로 눈에 보인다
  - **유통재고일수 추이**(7개월) — `cox_brand_inventory` 원본. Jeep 은 168→128 로 빠졌다가 **다시 160 으로 올라오는 중**인 반면 Ford 는 140→93 단조 감소. 최신 1점 막대로는 안 보이던 방향
  - 배치를 "수준 카드 ↔ 추이 카드" 짝으로 재정렬 · 업계 관행선 60일 상수를 `shared.tsx` 로 승격(두 재고 카드가 같은 선을 그어야 한다)
  - 레이더 패널 축소(여백 최소화) · 점유율 막대 차종명 잘림 해소(y축 104→140px)
  - 🔴 함정 2건 추가: **`'use cache'` 에 필드를 더하면 옛 페이로드가 `undefined` 로 들어와 화면 전체가 죽는다**(태그 revalidate 로 안 풀려 `.next/cache` 삭제 필요) · **결측월을 null 로 두면 이동 누계가 전부 비어** 선이 통째로 사라진다 → §7-A·§3. 회귀 테스트 8건 추가(405→413)
- [x] `/oem/competition` 신차 사이클 비교 신설 (2026-08-14, 사용자 지시)
  - 풀체인지·페이스리프트는 **이미 수집되고 있었지만** `outlook` 서술 안의 문장이라 접힌 채 묻혔고, 무엇보다 **대상 차종 얘기만** 해서 "경쟁 대비 노후한가"에 답할 수 없었다
  - `oem_model_outlook.model_cycle` JSONB 신설(`20260814000001`) + 수집 스키마·프롬프트 확장 → 시장별 [대상 + 경쟁 상위 3종]의 세대 연식·마지막 개선·다음 예정을 구조화
  - `ModelCycleChart` — 누적 가로막대. **전체 = 세대 나이, 진한 부분 = 마지막 개선 이후 경과**
  - 🔴 연식을 하나만 쓰면 **정반대 결론**이 나온다(그랜드체로키는 2021 세대 + 2026 페이스리프트라 "개선 후 0년"으로는 가장 신선해 보이고, Explorer 는 2020 세대인데 2024 에 손봤다) → 둘을 한 그림에
  - 🔴 함정 추가: **0 값 막대는 recharts 가 건너뛰고 `LabelList` index 를 당겨 써** 라벨이 엉뚱한 행에 붙는다 → 투명 앵커 막대(§4-D) 필수
  - 실측 결론: 그랜드체로키 세대 나이 5년 vs 경쟁 평균 3.3년 → **+1.7년 노후**

### Page 5: 부품사 TOP100 (예정)

### Page 6: 한세그룹 (예정)

### Page 7: 기타정보 (예정)

---

## Phase 6 — 테스트 + 코드 리뷰

**목표**: 프로덕션 배포 준비 및 품질 보증

- [ ] `npm run check-all` 전체 통과 (ESLint / Prettier / TypeScript)
- [ ] E2E 테스트 (Playwright) — 주가 표 렌더링, 필터, 정렬, 팝업 검증
- [ ] 성능 최적화 (Lighthouse 90+ 목표)
- [ ] Vercel 프로덕션 배포

---

## 기술 스택

| 영역        | 기술                                     |
| ----------- | ---------------------------------------- |
| 프론트엔드  | Next.js 15 + TypeScript + Tailwind CSS 4 |
| UI 컴포넌트 | shadcn/ui + Lucide React                 |
| 상태 관리   | Zustand                                  |
| 폼 관리     | React Hook Form + Zod                    |
| 차트        | Lightweight Charts + Recharts            |
| 백엔드/DB   | Supabase (PostgreSQL + Auth + Realtime)  |
| 로깅        | Pino + pino-pretty                       |
| 데이터 수집 | Python (pykrx + yfinance + fnguide)      |
| CI/CD       | GitHub Actions                           |
| 배포        | Vercel                                   |
