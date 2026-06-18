# 보고서 작성 가이드 (report.md)

`/reports` 게시판에 글을 **작성·게시**할 때 지켜야 할 규칙. 본문은 마크다운이며 한국어 렌더링에 함정이 많아, 신규 글 작성·기존 글 수정 전 이 문서를 정독한다.

- **저장 구조(스키마)는 [`Architecture.md §7-G`](./Architecture.md) `posts` 테이블** 참고. 본 문서는 *작성 방법·렌더 규칙·게시 절차*만 다룬다.
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
7. **분량은 소스(영상·자막·원문)의 양에 비례** — §3-A 참조. 짧게 끝내지 말 것.

### 3-A. 분량 가이드 (영상·자막 양 기준) ⚠️

보고서를 너무 짧게 쓰지 않는다. **소스의 텍스트 양(유튜브는 자막 글자 수)을 기준으로 최소 분량을 잡고**, 긴 영상은 독자가 제대로 이해할 수 있게 충분히 길게 쓴다.

| 소스 분량(자막 글자 수) | 추정 영상 길이 | 본문 최소 분량 | 본문 섹션 수 |
| ----------------------- | -------------- | -------------- | ------------ |
| < 800자                 | 1~3분          | 1,200자+       | 4~6          |
| 800~3,000자             | 4~10분         | 2,500자+       | 6~8          |
| 3,000~8,000자           | 10~25분        | 5,000자+       | 8~12         |
| 8,000자 이상            | 25분 이상      | 8,000자+       | 10~15        |

- **재생목록·다중 영상 종합**: 묶인 영상들의 **자막 총량에 비례**해 늘린다. 영상 한 편당 **최소 한 단락(가능하면 한 섹션)** 을 배정해 핵심을 빠뜨리지 않는다. 편수가 많아 한 글이 과하게 길어지면 **주제별로 묶어 여러 보고서로 분할**한다.
- 짧은 영상을 억지로 늘리거나, 긴 영상을 과도하게 압축하지 말 것. **"이상으로", "이 정도면 충분" 같은 자기검열·축약 표현 금지.**
- 분량을 채우려는 의미 없는 반복은 금지 — 같은 주제의 다른 측면을 충분히 다룬다. 영상에 없는 배경지식은 "참고로 ~"로 구분해 적극 보강한다.
- 자동 요약 경로의 기준(`lib/reports/services/youtube.service.ts`의 `pickArticleTarget()`)과 동일하게 맞춘다. 직접 작성도 이 표를 따른다.

---

## 4. 마크다운 렌더 규칙 (한국어 — 깨짐 방지) ⚠️

렌더러는 `react-markdown` + `remark-gfm({ singleTilde: false })` + `remark-cjk-friendly` + **단독 줄 `<br>` 제거 전처리**로 설정돼 있다(`markdown-view.tsx`). 그래도 **작성 단계에서 아래를 지키면** raw 노출을 원천 차단한다(이 규칙들은 실제로 raw `**` 198건이 발생했던 원인이다).

- **CJK 인접 강조**: `**'피지컬 AI'**가`처럼 닫는 `**` 앞이 부호(`'`·`%`·`)`)이고 뒤가 한글 조사면 CommonMark 규칙상 강조가 안 닫힌다. `remark-cjk-friendly`가 보정하지만, **가능하면 부호를 강조 밖으로**: `'**피지컬 AI**'` (권장) > `**'피지컬 AI'**`.
- **물결표 `~`**: 숫자 범위(`50~60`, `33~40%`)는 안전(`singleTilde:false`로 단일 `~`는 리터럴). 취소선은 **반드시 `~~취소선~~`**(쌍)으로만.
- **백틱 금지**: 연도/숫자 앞에 백틱 쓰지 말 것(`` `24년 ``·`` `26~`30 `` → 인라인 코드로 오인돼 인접 마크다운을 삼킴). **작은따옴표**(`'24년`)나 그냥 `2024년`.
- **단독 줄 `<br>` 지양**: 빈 줄로 문단을 나눈다. 단독 `<br>` 뒤에 빈 줄이 없으면 다음 문단이 HTML 블록으로 흡수돼 마크다운 전체가 무력화된다(전처리가 제거하지만 애초에 쓰지 않는 게 깔끔). **표 셀 안 줄바꿈**용 `<br>`는 보존되므로 사용 가능.
- **GFM 표**: 파이프 표(`| a | b |`) 위·아래에 빈 줄. 헤더 구분선 `| --- |` 필수.
- 헤딩 `##`/`###`, 리스트 `-`/`1.`, 링크 `[txt](url)` 표준 GFM 사용.

> 직접 작성 후 검증: 본문을 렌더해 **출력에 raw `**`가 0**인지 확인하고, 로컬 dev(3000은 다른 앱이 점유할 수 있으니 **다른 포트\*\*)에서 눈으로 확인한다.

---

## 5. 이미지

- Supabase Storage **`reports` 버킷(public)** 에 업로드. 경로 예: `valley-humanoid/<name>.png`.
- 공개 URL: `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/reports/<path>`.
- 본문 삽입: `![alt](공개URL)` + **바로 다음 줄에 이탤릭 캡션**(`*출처/설명*`).
- 업로드: admin 클라이언트 `storage.from('reports').upload(path, buf, { contentType, cacheControl: '31536000', upsert: true })`.
- **버킷 허용 MIME = `image/png`·`application/pdf`뿐** — jpg/webp는 `mime type ... is not supported`로 거부된다. 영상 프레임 등 **jpg는 png로 변환 후 업로드**(`ffmpeg -i x.jpg x.png`). 확인: `select allowed_mime_types from storage.buckets where name='reports'`.
- **영상에서 직접 프레임을 캡처**해 본문 이미지로 쓰는 방법(yt-dlp 구간 다운 + ffmpeg)은 **§7 워크플로** 참조.
- **로컬 저장본(`*_files/...`) 경로를 그대로 본문에 넣지 말 것** — 공개 URL이 아니라 깨진다. 반드시 Storage에 올린 뒤 그 URL을 쓴다.
- PDF 첨부는 이미지가 아니라 `file_path`/`file_name`(같은 버킷)로 — 상세 페이지가 다운로드 링크를 만든다.

---

## 6. Mermaid 다이어그램

- ` ```mermaid ` 코드펜스로 작성하면 `MermaidBlock`이 SVG로 렌더.
- **한글 노드 박스 잘림은 컴포넌트에서 해결됨**(`htmlLabels:true` + 한글 글꼴 스택 + `useMaxWidth`). 노드 라벨에 한글·`<br>` 줄바꿈을 자유롭게 써도 박스가 내용에 맞춰 확장된다.
- 자동 웹 요약(`report-web`)은 **원본 표/이미지 보존이 원칙이라 mermaid 재구성 금지**. 유튜브 요약·직접 작성 글에서는 흐름도/타임라인/파이 등 자유롭게 사용.

---

## 7. 유튜브(영상·재생목록) → 보고서 직접 작성 워크플로

유튜브 영상/재생목록을 §2-B(직접 작성)로 보고서화할 때의 검증된 절차. 자동 경로(§2-A)는 단일 영상 1편→1글만 다루므로, **재생목록 종합·고품질·이미지 다수**가 필요하면 이 워크플로(직접 작성)를 쓴다.

1. **영상 목록 수집**: 재생목록 페이지(`youtube.com/playlist?list=<ID>`) HTML에서 `"videoId":"<11자>"`를 추출(중복 제거)하고, 영상 수는 `stats`의 "동영상 N개"로 검증(grep으로 추천영상 1건이 섞일 수 있음). 제목·채널은 oEmbed(`youtube.com/oembed?url=<watch>&format=json`).
2. **자막 추출**: `youtube-transcript`(node, 프로젝트 설치됨). `ko → en → auto` 폴백. 타임코드(offset)를 함께 저장하면 프레임 캡처 시점 산정에 쓸 수 있다. **자동 생성 자막은 오타가 많으니** 내용 파악용으로만 쓰고, 본문 인용은 다듬는다. 로컬 IP는 봇 차단이 거의 없으나 CI/클라우드 IP는 막힐 수 있다(그때만 yt-dlp 자막/Gemini 폴백).
3. **본문 작성**: 자막을 정독해 **에이전트가 직접** §3 형식 + **§3-A 분량**으로 작성(자동 요약 API보다 품질·일관성↑). 영상에 없는 배경지식은 `WebSearch`로 보충하되 **"영상에서는 ~", "참고로 ~"로 영상 내용과 구분**.
4. **이미지 — 영상 프레임 캡처(권장)**: §5 규칙 + 아래.
   - 도구: `yt-dlp`(venv `pip install yt-dlp`) + `ffmpeg`(시스템; winget `Gyan.FFmpeg`). 둘 다 일회성 설치.
   - **영상 전체를 받지 않는다**: `yt-dlp --ffmpeg-location <ffmpeg/bin> -f "best[height<=720]/18/best" --download-sections "*MM:SS-MM:SS" --force-keyframes-at-cuts -o clip.%(ext)s <url>` 로 **필요 구간(2~3초)만** 받고, `ffmpeg -ss 1 -i clip.mp4 -vframes 1 -q:v 2 out.jpg` 로 프레임 추출.
   - **화질**: JS 런타임이 없으면 360p(format 18)만 받지만 교육용 칠판·도해·자막 판독엔 충분. 더 선명해야 하면 deno/node 런타임 지정.
   - **시점 선정**: 자막 타임코드로 설명 구간을 추정해 한 영상에서 **여러 컷**을 뽑고, **`Read`(vision)로 선별**(손이 화면을 가린 컷·그리는 도중 컷 배제).
   - **라이브 방송 채팅 오버레이는 `ffmpeg -vf "crop=W:H:0:0"`로 우측을 잘라** 도해만 남긴다.
   - 다이어그램이 없는 영상(잡담·Q&A)은 캡처 대신 **썸네일**(`img.youtube.com/vi/<id>/maxresdefault.jpg`, 없으면 `hqdefault`).
   - 업로드 전 **jpg→png 변환**(버킷 MIME 제약, §5). Storage 경로 예: `auto-engineer/<topic>/<name>.png`.
   - **직접 그린 AI 이미지는 쓰지 않는다.** 구조 설명은 영상 프레임·썸네일·웹검색 이미지 또는 **Mermaid 도식**(텍스트 기반이라 허용, §6)으로.
5. **게시**: §2-B(service_role INSERT + 캐시 무효화). 재생목록 종합 보고서는 단일 원문일이 없으므로 `source_published_at`은 **발행일**, `source_url`은 재생목록 URL, `source_name`은 채널명. **같은 재생목록을 여러 보고서로 분할**하면 중복 가드를 `source_url`+`title`로 본다(§2-B의 중복 방지). `thumbnail_url`은 대표 프레임/썸네일.
6. **검증**: `/reports`는 보호 라우트(로그인 필수, `proxy.ts`의 `PUBLIC_PATH_PREFIXES`에 없음) → Playwright로 로그인(`input[name="id"]`/`password`, 자격증명은 `.env.local` env 로드로 비노출) 후 상세 페이지에서 **raw `**`=0 · 이미지 깨짐 0 · console 에러 0 · Mermaid SVG 렌더\*\*를 점검하고 전체 스크린샷을 눈으로 확인.

> 위 절차의 일회성 스크립트(자막 추출·프레임 캡처·업로드·게시·검증)는 `scripts/_yt_report/`(`.gitignore`로 무시)에 두고 작업 후 정리한다. secret 하드코딩 금지(env는 `.env.local`).

---

## 8. 체크리스트 (게시 전)

- [ ] §3 형식(요약 인용 → 들어가며 → 섹션 → 핵심 정리) 준수
- [ ] §3-A 분량 — 소스(자막) 양에 비례, 짧게 끝내지 않음
- [ ] §4 렌더 규칙 준수 — 렌더 후 raw `**`=0, 백틱/단독`<br>`/단일`~` 점검
- [ ] 이미지는 Storage 업로드 후 공개 URL 사용(§5), jpg는 png 변환, 출처 캡션
- [ ] (유튜브) 프레임 캡처는 필요 구간만 다운로드, 라이브 채팅은 크롭(§7)
- [ ] `status='completed'`, `category`·`source_published_at` 채움, `source_url` 중복 없음
- [ ] 직접 작성/수동 변경이면 캐시 무효화(§2-B)
- [ ] 로컬 dev(별도 포트)에서 시각 확인(이미지·표·Mermaid·강조)
