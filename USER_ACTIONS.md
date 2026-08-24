# 사용자 필수 작업 목록

자동화할 수 없는 외부 서비스 설정 및 시크릿 등록 작업입니다.
아래 순서대로 진행하세요.

---

## 1. Supabase 프로젝트 생성

1. [https://supabase.com](https://supabase.com) 접속 → 새 프로젝트 생성
2. 프로젝트 설정 > API 메뉴에서 다음 값을 `.env.local`에 입력:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> **주의**: `SUPABASE_SERVICE_ROLE_KEY`는 서버 전용이며 클라이언트에 노출하면 안 됩니다.

> **⚠️ Pro 플랜이 필요합니다 (2026-08-03 실측)**: 이 프로젝트는 Free 플랜으로 운영할 수 없습니다. 2026-08-03 Free 한도(디스크 1.1GB)를 초과해 **Data API가 402로 차단**되면서 수집 스크립트와 앱이 전면 중단됐습니다(`exceed_db_size_quota`).
>
> 청구되는 건 데이터가 아니라 **디스크 전체**이고, 그중 **WAL이 880MB(55%)** 를 차지합니다. 이 WAL은 `min_wal_size = 1024MB` 설정 때문에 항상 1GB 가까이 유지되는데, 이 파라미터는 **Supabase가 사용자 변경을 막아둔 항목**입니다. 즉 데이터를 0으로 만들어도 한도를 맞출 수 없습니다.
>
> 또한 Fair Use 정책상 **용량을 줄여도 차단은 즉시 풀리지 않습니다** — 해제는 다음 결제 주기이거나 Pro 업그레이드뿐입니다. Pro는 디스크 8GB라 WAL 문제가 사라집니다. 배경·조치 상세는 [`Architecture.md` §7-J](./Architecture.md)의 `trg_skip_identical_update` 항목을 참고하세요.

---

## 2. valley.town 계정 설정

1. [https://www.valley.town](https://www.valley.town) 접속 → 회원가입
2. `.env.local`에 추가:

```env
VALLEY_EMAIL=your@email.com
VALLEY_PASSWORD=yourpassword
```

---

## 3. GitHub 저장소 생성 및 연결

```bash
git remote add origin https://github.com/<your-username>/stock_monitor.git
git push -u origin master
```

---

## 4. GitHub Actions Secrets 등록

저장소 > Settings > Secrets and variables > Actions에 다음 시크릿 추가:

| 시크릿 이름                 | 값                          |
| --------------------------- | --------------------------- |
| `SUPABASE_URL`              | Supabase 프로젝트 URL       |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key   |
| `VALLEY_EMAIL`              | valley.town 로그인 이메일   |
| `VALLEY_PASSWORD`           | valley.town 로그인 비밀번호 |

> **🔴 `PERPLEXITY_API_KEY`** — `/oem/competition` 차종 경쟁 분석의 웹 검색(신형 출시·소비자 반응)에 필요.
> 값은 로컬 `scripts/.env`에 이미 들어 있는 것과 같은 키를 그대로 등록한다.
> **없어도 워크플로는 성공한다** — 검색만 조용히 건너뛰고 분석이 판매 실적·리콜만으로 작성돼
> 품질이 떨어진다. 즉 실패가 아니라 **품질 저하로만** 나타나므로 등록 여부를 놓치기 쉽다.
> 수집은 월 1회(매월 21일 06:30 KST)라 등록이 늦으면 그달치 분석이 통째로 얕아진다.

> **(선택) `YOUTUBE_COOKIES`** — `/reports` 유튜브 자동 보고서에 **이미지(주요 장면·차트)**를 붙이려면 필요.
> GHA 러너 IP는 유튜브가 봇 차단해서, 이 쿠키가 없으면 이미지가 대개 안 붙고 **텍스트로만** 완성된다(글이 실패하진 않음).
> 값: 로그인한 브라우저에서 "Get cookies.txt LOCALLY" 확장으로 유튜브 `cookies.txt`를 export한 **파일 내용 전체**를 붙여넣는다.
> 쿠키는 만료되므로(예: `MARKLINES_COOKIE`처럼) 이미지가 안 붙기 시작하면 재채취. 없어도 텍스트 요약은 정상.

---

## 5. Vercel 배포

1. [https://vercel.com](https://vercel.com) 접속 → **Import Project** → GitHub 저장소 선택
2. **Environment Variables** 섹션에 아래 변수 입력:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GITHUB_PAT` — GitHub 자동 트리거용(회사 onboarding·유튜브 이미지 보강). repo `workflow` 권한 PAT
   - `(선택) YT_AUTO_REPORT` — 유튜브 이미지 자동 보강 스위치. **미설정=켜짐(기본)**, `0`으로 두면 이미지 보강을 끄고 텍스트 요약만.
3. **Deploy** 클릭

---

## 6. Supabase MCP — 플러그인 방식을 쓴다

Claude Code에서 Supabase 스키마를 직접 조작하는 통로다. **프로젝트 `.mcp.json` 등록은 2026-08-24에 제거했고**
Claude Code **플러그인 MCP**(OAuth 로그인)로 통일했다.

- 플러그인은 작업 폴더와 무관하게 붙는다. `.mcp.json` 방식은 **cwd가 이 폴더일 때만** 로드돼,
  다른 레포(agents 등)에서 이 DB를 만질 때 "MCP가 안 붙는다"로 나타났다(2026-08-24 원인 규명).
- 도구 이름은 `mcp__plugin_supabase_supabase__*`. 인증이 풀리면 Claude Code에서 다시 로그인하면 된다.
- 플러그인이 없거나 죽었을 때의 우회는 `scripts/.env`의 Personal Access Token + Management API
  → [`docs/gotchas-ci-deploy.md`](./docs/gotchas-ci-deploy.md) §3.

Personal Access Token 발급(우회용): [https://supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)

---

## 7. Python 환경 설정 (Phase 1 이후)

데이터 수집 스크립트 실행 전 필요:

```bash
cd scripts
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

`.env.local`의 내용을 `scripts/.env`에도 복사하세요:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
VALLEY_EMAIL=your@email.com
VALLEY_PASSWORD=yourpassword
```

---

## 8. Git pre-commit hook 활성화

저장소 구조(라우트·마이그레이션·워크플로 등)가 바뀌었는데 `AGENTS.md`를 깜빡한 채로 커밋하는 것을 막는 hook입니다. **clone 직후 한 번 실행하면 됩니다.**

```bash
git config core.hooksPath .githooks
```

확인:

```bash
git config core.hooksPath
# .githooks  ← 이렇게 출력되면 OK
```

- 트리거 패턴과 갱신 규칙은 `AGENTS.md`의 "이 파일(AGENTS.md) 갱신 트리거" 섹션에 정리되어 있습니다.
- hook이 오탐일 때 이번 커밋만 우회:
  - bash: `SKIP_AGENTS_CHECK=1 git commit -m "..."`
  - PowerShell: `$env:SKIP_AGENTS_CHECK=1; git commit -m "..."; Remove-Item Env:SKIP_AGENTS_CHECK`
