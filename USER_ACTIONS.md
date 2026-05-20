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

---

## 5. Vercel 배포

1. [https://vercel.com](https://vercel.com) 접속 → **Import Project** → GitHub 저장소 선택
2. **Environment Variables** 섹션에 아래 변수 입력:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. **Deploy** 클릭

---

## 6. (선택) Supabase MCP 설치

Claude Code에서 Supabase 스키마를 직접 조작하려면 설치 권장:

```bash
npx @anthropic-ai/claude-code mcp add @supabase/mcp-server-supabase --scope project
```

Personal Access Token 발급: [https://supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)

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
