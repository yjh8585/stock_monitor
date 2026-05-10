# 코드 리뷰 체크리스트 (Claude / Codex 공통)

> 이 체크리스트는 **1차 Claude / 2차 Codex** 양쪽에 동일하게 전달되는 **표준 리뷰 기준**입니다.
> 두 결과를 동일한 카테고리·우선순위·출력 포맷으로 받아 비교·정리하기 위함.

---

## 0. 사용 방법

### 1차 Claude 리뷰
Claude Code에 다음과 같이 요청:
> `review/CHECKLIST.md` 와 `review/SCOPE.md` 기준으로 리뷰. 결과는 `review/claude-YYYY-MM-DD.md` 로 저장.

### 2차 Codex 리뷰
PowerShell에서:
```powershell
"" | codex exec `
  --skip-git-repo-check `
  --sandbox read-only `
  --output-last-message review/codex-YYYY-MM-DD.md `
  "$(Get-Content review/CHECKLIST.md -Raw)`n`n$(Get-Content review/SCOPE.md -Raw)`n`n위 체크리스트와 SCOPE 기준으로 코드 리뷰 결과를 출력해줘. 출력은 본 문서 §3 출력 포맷을 그대로 따를 것."
```

> ⚠ **중요**: PowerShell에서 codex 호출 시 반드시 `"" |` 프리픽스로 stdin을 닫아야 hang 없이 진행됨.

---

## 1. 프로젝트 컨텍스트 (리뷰어가 알아야 할 사실)

- **프레임워크**: Next.js 16 (App Router). `AGENTS.md`에 "This is NOT the Next.js you know" — 신 API 우선, 구 패턴 사용 시 지적
- **언어/스타일링**: TypeScript / Tailwind CSS v4 / shadcn/ui / lucide-react
- **상태**: Zustand
- **폼**: React Hook Form + Zod
- **DB·인증**: Supabase (PostgreSQL + Auth + Storage + Realtime), RLS 의존
- **로깅**: Pino (`console.log` 사용 금지)
- **차트**: Recharts, Lightweight Charts
- **배포**: Vercel
- **데이터 수집**: Python scripts/ (yfinance, pykrx, postgrest-py — supabase SDK 미사용)
- **재무 기준**: 연결(consolidated) 우선, 종속회사 없으면 별도

### 컨벤션 (CLAUDE.md / AGENTS.md 발췌)
- `any` 타입 **금지**
- 함수 **30줄 이하**, 길어지면 분리 제안
- **매직 넘버 금지** — 상수로 정의
- 변수/함수명 **camelCase**, 들여쓰기 **2칸**
- 한국어 주석/커밋 메시지
- JSDoc 추가
- 라이브러리 우선 (재구현 금지)
- 레이어드 아키텍처 (Controller → Service → Repository), DTO 패턴

---

## 2. 리뷰 카테고리 (10개)

각 카테고리에 대해 다음 형식으로 보고:
- 상태: ✅ 통과 / ⚠️ 개선 권고 / ❌ 즉시 수정
- 위치: `file_path:line` (다중일 경우 모두 나열)
- 우선순위: **P0** (배포 차단) / **P1** (다음 PR) / **P2** (기술 부채)

### A. 타입 안정성
- [ ] `any` 타입 사용 여부 (props, useState, 함수 시그니처, API 응답)
- [ ] Zod 스키마와 TypeScript 타입의 단일 소스 (`z.infer<typeof schema>`)
- [ ] Supabase 자동생성 타입 활용 (`Database['public']['Tables']...`)
- [ ] DTO / Domain / View 타입 분리
- [ ] 비-null 단언(`!`) 남용

### B. 컴포넌트 분리·재사용
- [ ] 30줄 이상 컴포넌트 → 분리 가능 여부
- [ ] shadcn/ui 컴포넌트 충분히 활용 (Button, Card, Table 등 재구현 금지)
- [ ] 중복 마크업/로직 → 공통 컴포넌트·hook으로 추출
- [ ] `app/` (라우팅) vs `components/` (UI) 책임 분리
- [ ] props drilling > 2뎁스 → context/store 검토

### C. Next.js 16 데이터 페칭·렌더링
- [ ] Server Component 기본, Client Component는 필요할 때만 (`'use client'` 최소화)
- [ ] Cache Components / `use cache` / `cacheLife` / `cacheTag` 활용 적절성
- [ ] `unstable_cache` 등 deprecated API 사용 여부
- [ ] Server Action 사용 위치·검증 (Zod 재검증 포함)
- [ ] Suspense 경계 + `loading.tsx` 배치
- [ ] `error.tsx` / `not-found.tsx` 누락
- [ ] 환경변수 — server-only 키가 클라이언트로 새지 않는지

### D. 상태 관리 (Zustand + 서버 상태)
- [ ] Zustand store: 도메인별 분리, persist 사용 적절성
- [ ] 서버 상태(Supabase 쿼리 결과)를 store에 중복 저장 안 함
- [ ] selector 사용으로 리렌더 최소화 (`useStore(s => s.x)`)
- [ ] 전역 상태 vs 컴포넌트 로컬 상태 결정 기준 일관

### E. 폼·유효성
- [ ] React Hook Form + Zod resolver 일관 사용
- [ ] 클라이언트 검증과 동일한 스키마로 서버측(Server Action / API Route) 재검증
- [ ] 에러 메시지 한국어, 사용자 친화적
- [ ] 비제어 컴포넌트 사용 (`register`)

### F. 접근성 (a11y)
- [ ] 시맨틱 HTML (`<button>`, `<nav>`, `<main>`)
- [ ] 키보드 네비게이션 (focus ring, tabIndex, Esc 처리)
- [ ] ARIA 속성 (label, role, aria-live for 비동기 업데이트)
- [ ] 차트·테이블 대체 텍스트
- [ ] 색상만으로 정보 전달 금지

### G. 성능
- [ ] `dynamic(() => import(...))` for 무거운 차트(Recharts/Lightweight Charts)
- [ ] `next/image` 사용 (외부 도메인 `next.config` 등록)
- [ ] 불필요한 클라이언트 번들 (lucide-react, date-fns tree-shaking)
- [ ] `memo` / `useMemo` / `useCallback` — 측정 없이 남용 금지
- [ ] N+1 쿼리, 큰 select, 인덱스 미스 (DB 카테고리와 교차)

### H. 에러 핸들링·로깅
- [ ] try-catch 일관성, 비동기 에러 누락
- [ ] Pino 로거 사용 (`console.log` 금지 — 컨벤션)
- [ ] 사용자 표시 에러 vs 로그 에러 분리
- [ ] error boundary / `error.tsx` 활용
- [ ] toast/sonner 사용자 알림 일관성

### I. 보안
- [ ] Supabase RLS 정책 의존성 명시 — 클라이언트 코드가 RLS를 가정
- [ ] `service_role` 키 클라이언트 노출 절대 금지
- [ ] `NEXT_PUBLIC_` 접두사 적절성 (잘못 붙으면 노출)
- [ ] 외부 입력(URL params, form, fetch body) Zod 검증
- [ ] XSS — `dangerouslySetInnerHTML` 사용 여부
- [ ] CSP / 시크릿 커밋 여부 (`.env*`, `*.pem`, MCP 토큰)

### J. DB·migration·트랜잭션
- [ ] migration 일관성 (이전 migration과 충돌 없음)
- [ ] foreign key, 인덱스, unique 제약 누락
- [ ] 다단계 변경은 트랜잭션 (RPC / `pg.transaction`)
- [ ] upsert vs insert 적절성, `on_conflict` 명시
- [ ] generated columns / view 활용 (계산 컬럼 코드 중복 제거)
- [ ] RLS 정책 누락 / 너무 관대 / 너무 엄격
- [ ] 재무 데이터: 연결 우선, 별도 fallback 규칙 일관 적용

### K. 반응형 & UI 일관성
- [ ] Tailwind breakpoint (`sm`/`md`/`lg`) 일관성
- [ ] 모바일 우선 (default → 큰 화면 추가)
- [ ] 차트·테이블 모바일 대응 (가로 스크롤 / 카드 변환)
- [ ] 다크 모드 (`next-themes`) 색상 일관

### L. 프로젝트 컨벤션 준수
- [ ] `any` 사용 여부
- [ ] 함수 30줄 초과
- [ ] 매직 넘버
- [ ] 변수명 camelCase
- [ ] JSDoc 누락
- [ ] 한국어 주석/커밋
- [ ] `console.log` 잔존
- [ ] 들여쓰기 2칸

---

## 3. 출력 포맷 (Claude / Codex 동일)

```markdown
# 리뷰 결과 — {대상 페이지/디렉토리} ({모델명})
- 작성일: YYYY-MM-DD
- 리뷰어: Claude Opus 4.7 / Codex gpt-5.5
- 리뷰 범위: review/SCOPE.md 참조

## 1. 요약
- 총 발견: **P0 N개 / P1 N개 / P2 N개**
- 핵심 risk Top 3:
  1. ...
  2. ...
  3. ...

## 2. 카테고리별 상세

### A. 타입 안정성  ⚠️
| 우선순위 | 위치 | 지적 | 권고 |
|---|---|---|---|
| P0 | `app/related-stocks/page.tsx:42` | `any` 사용 | `RelatedStockDto` 타입 도입 |
| P1 | `lib/supabase/types.ts:18` | 비-null 단언 남용 | optional chaining + zod parse |

(빈 카테고리는 `### A. 타입 안정성  ✅` 만 표기, 표 생략)

### B. 컴포넌트 분리·재사용  ❌
...

## 3. 우선 조치 권고 (Top 5)
1. **P0** — `app/foo.tsx:42` `any` 제거 (A)
2. ...

## 4. 카테고리 외 발견 사항 (선택)
- (체크리스트로 분류 안 되는 추가 의견)
```

---

## 4. 비교 정리 (`review/diff-YYYY-MM-DD.md`) — 후속 단계에서 사람이 작성

- **공통 지적**: Claude / Codex 양쪽이 동시에 P0/P1로 지적 → 우선 수정
- **한쪽만 지적**: 나머지 한쪽이 놓친 부분 또는 의견 차이 → 사람이 판단
- **충돌**: 의견이 반대 → 가장 깊이 검토 필요

---

_작성: 2026-05-08 / 다음 갱신: 카테고리 추가·삭제·우선순위 재조정 시_
