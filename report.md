# 보고서 작성 가이드 (report.md)

`/reports` 게시판에 글을 **작성·게시**할 때 지켜야 할 규칙. 본문은 마크다운이며 한국어 렌더링에 함정이 많아, 신규 글 작성·기존 글 수정 전 이 문서를 정독한다.

- **저장 구조(스키마)는 [`Architecture.md §7-G`](./Architecture.md) `posts` 테이블** 참고. 본 문서는 _작성 방법·렌더 규칙·게시 절차_만 다룬다.
- 렌더러: `components/reports/markdown-view.tsx` (react-markdown + remark-gfm + remark-cjk-friendly), 다이어그램은 `components/reports/mermaid-block.tsx`.
- 관련 라우트/서비스: `app/reports/*`, `app/api/posts/route.ts`, `lib/reports/*`(`services/*`, `repositories/post.repository.ts`).

---

## 1. 글의 종류·필드

`posts` 한 행 = 글 한 개. 핵심 필드(상세는 Architecture.md):

- `source_type`: `'report'`(보고서·웹·PDF) | `'youtube'`(영상 요약)
- `status`: `'processing'` | `'completed'` | `'failed'` — **직접 작성 시 `completed`**
- `title`, `source_name`(발행기관/저자), `source_url`(원문), `content`(**마크다운 본문**)
- `source_published_at`(원문 작성일, 모르면 null), `category`, `thumbnail_url`
- PDF 첨부형: `file_path`/`file_name`(Storage `reports` 버킷). 상세 페이지가 다운로드 링크 자동 생성.
- 쓰기는 **service_role만**(RLS: SELECT 전체 허용, INSERT/UPDATE/DELETE 정책 없음).

**카테고리**(필터 드롭다운): `로봇 · 기술 · 부품사 · 전기차 · 자율주행 · 시장 · OEM`. 해당 없으면 짧은 새 키워드 1개.

**목록 정렬**: `source_published_at` desc(NULL은 항상 마지막) → `created_at` desc. 날짜 없는 글은 하단으로 가라앉으니 가능하면 원문 작성일을 채운다.

---

## 2. 게시 방법

### 2-A. 자동 (일반 경로) — `/reports/new` 폼

URL/PDF/유튜브를 입력하면 `POST /api/posts`가 메타만 즉시 INSERT(`processing`) 후 백그라운드에서 분석한다(`lib/reports/services/*`). **본문 생성에 Anthropic/Gemini API 사용**.

- `report-web`: 웹페이지 → Readability + turndown으로 본문 보존 → Claude 한국어 요약(`report-web.service.ts`)
- `report-file`: PDF → 추출 → Claude 요약(`report-pdf.service.ts`)
- `youtube`: 자막 → 요약 + `key_scenes`(`youtube.service.ts`)

캐시 무효화는 라우트가 `revalidateTag('posts')`/`post:<id>`로 자동 처리.

### 2-B. 직접 작성 (LLM API 미사용)

본문을 사람이/에이전트가 직접 써서 DB에 넣는 경로. **`/api/posts`(자동 요약)를 거치지 않는다.**

1. 아래 §3~§6 규칙대로 마크다운 본문 작성.
2. service_role 클라이언트로 INSERT: `source_type='report'`, `status='completed'`, `title/source_name/source_url/source_published_at/category/content` 채움. **같은 `source_url` 중복 INSERT 방지** 가드를 둔다.
3. **캐시 무효화 필수**(수동 변경은 `revalidateTag`를 코드에서 못 부름):
   - 프로덕션: `POST {NEXT_REVALIDATE_PROD_URL}` 헤더 `x-revalidate-secret: {NEXT_REVALIDATE_SECRET}`, body `{"tags":["posts","post:<id>"]}`
   - 로컬: dev 재시작 또는 `localhost:<port>/api/revalidate`
   - 무효화 안 해도 `cacheLife('hours')` TTL로 ~1시간 내 자동 반영.
   - 단, **컴포넌트 코드(렌더러) 변경은 배포(빌드)** 가 있어야 반영된다. 무효화는 데이터 변경용.

> 직접 작성·적재 스크립트는 `scripts/_*` 임시로 만들고 작업 후 정리(폴더 `.gitignore`가 새 산출물 무시). DB 접근 env는 `.env.local`(`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`).

---

## 3. 본문 형식 (권장 구성)

자동 요약(`report-web.service.ts`의 시스템 프롬프트)과 동일한 큐레이션 형식을 직접 작성에도 따른다.

1. 첫머리에 **한 줄 핵심 요약을 인용 블록(`>`)** 으로.
2. `## 들어가며` — 전체를 한 단락으로 압축.
3. 배경/목적 → 주요 분석·주장(여러 섹션) → 시사점·제언 순으로 **6~10개 섹션**.
4. 중요한 수치/주장은 **굵게**, 통계는 **단위·기준연도** 함께.
5. 마지막 `## 핵심 정리` — **5~8개 불릿**(각 1~2문장).
6. 원본 보고서를 옮길 때는 **원본의 표·이미지를 그대로 보존**(다시 그리거나 mermaid로 재구성 금지). 비교가 필요하면 새 GFM 표 작성 가능.
7. 분량: 한국어 최소 2,500자 이상.

---

## 4. 마크다운 렌더 규칙 (한국어 — 깨짐 방지) ⚠️

렌더러는 `react-markdown` + `remark-gfm({ singleTilde: false })` + `remark-cjk-friendly` + **단독 줄 `<br>` 제거 전처리**로 설정돼 있다(`markdown-view.tsx`). 그래도 **작성 단계에서 아래를 지키면** raw 노출을 원천 차단한다(이 규칙들은 실제로 raw `**` 198건이 발생했던 원인이다).

- **CJK 인접 강조**: `**'피지컬 AI'**가`처럼 닫는 `**` 앞이 부호(`'`·`%`·`)`)이고 뒤가 한글 조사면 CommonMark 규칙상 강조가 안 닫힌다. `remark-cjk-friendly`가 보정하지만, **가능하면 부호를 강조 밖으로**: `'**피지컬 AI**'` (권장) > `**'피지컬 AI'**`.
- **물결표 `~`**: 숫자 범위(`50~60`, `33~40%`)는 안전(`singleTilde:false`로 단일 `~`는 리터럴). 취소선은 **반드시 `~~취소선~~`**(쌍)으로만.
- **백틱 금지**: 연도/숫자 앞에 백틱 쓰지 말 것(`` `24년 ``·`` `26~`30 `` → 인라인 코드로 오인돼 인접 마크다운을 삼킴). **작은따옴표**(`'24년`)나 그냥 `2024년`.
- **단독 줄 `<br>` 지양**: 빈 줄로 문단을 나눈다. 단독 `<br>` 뒤에 빈 줄이 없으면 다음 문단이 HTML 블록으로 흡수돼 마크다운 전체가 무력화된다(전처리가 제거하지만 애초에 쓰지 않는 게 깔끔). **표 셀 안 줄바꿈**용 `<br>`는 보존되므로 사용 가능.
- **GFM 표**: 파이프 표(`| a | b |`) 위·아래에 빈 줄. 헤더 구분선 `| --- |` 필수.
- 헤딩 `##`/`###`, 리스트 `-`/`1.`, 링크 `[txt](url)` 표준 GFM 사용.

> 직접 작성 후 검증: 본문을 렌더해 **출력에 raw `**`가 0**인지 확인하고, 로컬 dev(3000은 다른 앱이 점유할 수 있으니 **다른 포트**)에서 눈으로 확인한다.

---

## 5. 이미지

- Supabase Storage **`reports` 버킷(public)** 에 업로드. 경로 예: `valley-humanoid/<name>.png`.
- 공개 URL: `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/reports/<path>`.
- 본문 삽입: `![alt](공개URL)` + **바로 다음 줄에 이탤릭 캡션**(`*출처/설명*`).
- 업로드: admin 클라이언트 `storage.from('reports').upload(path, buf, { contentType, cacheControl: '31536000', upsert: true })`.
- **로컬 저장본(`*_files/...`) 경로를 그대로 본문에 넣지 말 것** — 공개 URL이 아니라 깨진다. 반드시 Storage에 올린 뒤 그 URL을 쓴다.
- PDF 첨부는 이미지가 아니라 `file_path`/`file_name`(같은 버킷)로 — 상세 페이지가 다운로드 링크를 만든다.

---

## 6. Mermaid 다이어그램

- ` ```mermaid ` 코드펜스로 작성하면 `MermaidBlock`이 SVG로 렌더.
- **한글 노드 박스 잘림은 컴포넌트에서 해결됨**(`htmlLabels:true` + 한글 글꼴 스택 + `useMaxWidth`). 노드 라벨에 한글·`<br>` 줄바꿈을 자유롭게 써도 박스가 내용에 맞춰 확장된다.
- 자동 웹 요약(`report-web`)은 **원본 표/이미지 보존이 원칙이라 mermaid 재구성 금지**. 유튜브 요약·직접 작성 글에서는 흐름도/타임라인/파이 등 자유롭게 사용.

---

## 7. 체크리스트 (게시 전)

- [ ] §3 형식(요약 인용 → 들어가며 → 섹션 → 핵심 정리) 준수
- [ ] §4 렌더 규칙 준수 — 렌더 후 raw `**`=0, 백틱/단독`<br>`/단일`~` 점검
- [ ] 이미지는 Storage 업로드 후 공개 URL 사용(§5)
- [ ] `status='completed'`, `category`·`source_published_at` 채움, `source_url` 중복 없음
- [ ] 직접 작성/수동 변경이면 캐시 무효화(§2-B)
- [ ] 로컬 dev(별도 포트)에서 시각 확인(이미지·표·Mermaid·강조)
