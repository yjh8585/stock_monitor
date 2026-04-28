# 자동차 산업 주식 모니터링 대시보드 — 로드맵

## 개요

21개 글로벌 자동차 기업(한국 8개 + 해외 13개)의 주가·환율·재무 데이터를
자동 수집하고 실시간으로 시각화하는 대시보드 프로젝트입니다.

---

## Phase 0 — 기반 설정 ✅ 완료

**목표**: 개발 환경 초기화 및 프로젝트 뼈대 구성

- [x] Next.js 15 + TypeScript + Tailwind CSS 4 + shadcn/ui 초기화
- [x] ESLint, Prettier, Pino 로거 설정
- [x] mcp-shrimp-task-manager 빌드 + `.mcp.json` 등록
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
  - DART API: 한국 8개사 분기/연간 재무제표 (DART_API_KEY 필요, GitHub Actions Ubuntu에서 실행)
  - yfinance: 글로벌 13개사 분기/연간 실적 (95행 수집 확인)
  - 13개 계정과목 수집 (매출, 영업이익, 순이익, 자산, 부채, 자본 등)
  - ROE, ROA, 유동비율 계산 후 저장
- [x] `supabase/migrations/20260428000008_financials_nulls_not_distinct.sql`
  - UNIQUE NULLS NOT DISTINCT — 연간(fiscal_quarter=NULL) upsert 충돌 감지
- [x] GitHub Actions: `collect-financials.yml` (1/4/7/10월 15일 분기별 자동 실행)

---

## Phase 4 — 뉴스 수집

**목표**: 자동차 업계 주요 뉴스 자동 수집

- [ ] `scripts/collect_news.py`
  - yfinance 뉴스 피드
  - Naver Finance RSS (한국 기업)
  - 4시간 주기 수집
- [ ] GitHub Actions: `collect-news.yml` (4시간 주기)

---

## Phase 5 — 대시보드 UI + 통화 토글

**목표**: 핵심 UI 구현 및 반응형 대시보드 완성

- [ ] 메인 대시보드 — 21개사 카드 그리드
  - 현재가, 전일대비, 시가총액 요약 표시
- [ ] 통화 토글 (원본 통화 ↔ KRW 환산)
  - Zustand store로 전역 상태 관리
- [ ] 종목 상세 페이지 (`/stocks/[ticker]`)
  - Lightweight Charts: 인터랙티브 주가 차트
  - Recharts: 분기별 재무 실적 차트
- [ ] 비교 페이지 (`/compare`) — 최대 4개사 동시 비교
- [ ] 반응형 레이아웃 (모바일/태블릿/데스크탑)

---

## Phase 6 — 종목 검색·추가

**목표**: 사용자 커스터마이징 기능 구현

- [ ] `/search` 페이지 — 티커/기업명 검색
- [ ] 관심종목(watchlist) 기능 — Supabase RLS 적용
- [ ] `repository_dispatch` 트리거 — 신규 종목 백필 자동 실행

---

## Phase 7 — 테스트 + 코드 리뷰

**목표**: 프로덕션 배포 준비 및 품질 보증

- [ ] `npm run check-all` 전체 통과
  - ESLint, Prettier, TypeScript 타입 체크
- [ ] E2E 테스트 (Playwright)
  - 주가 카드 렌더링, 통화 토글, 차트 표시 검증
- [ ] 성능 최적화 (Lighthouse 90+ 목표)
- [ ] 버그 수정 및 최종 코드 리뷰
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
| 데이터 수집 | Python (pykrx + yfinance + DART API)     |
| CI/CD       | GitHub Actions                           |
| 배포        | Vercel                                   |
