# 명령·검사 스크립트 목록

> **왜 이 문서가 있나** (2026-09-10 `AGENTS.md` 에서 이관)
> `AGENTS.md` 는 매 세션 자동 로드된다. 명령 목록·실행 절차는 **외울 것이 아니라 찾을 것**이라
> 자동 로드에 둘 이유가 없다. 같은 이유로 agents 레포도 2026-08-25 에 `docs/commands.md` 로 갈랐다.
> `AGENTS.md` 에는 **어기면 조용히 깨지는 약속만** 남겼다 — 「무슨 명령이었지」는 여기부터.

## TS/JS 검사 (npm)

```powershell
npm run check-all       # lint + format:check + typecheck + test 일괄
# 개별
npm run lint            # eslint .
npm run format:check    # prettier --check .
npm run typecheck       # tsc --noEmit
npm test                # vitest run (lib/**/*.test.ts)
npm run lint:fix        # 자동 수정
npm run format          # 자동 포맷
```

🔴 `npm run check-all` 은 **TS/JS 전용**(Python 미포함). Python 변경은
`scripts/venv/Scripts/python.exe -m py_compile <files>` + 순수 로직은 venv 로 직접 단위 실행해 검증한다.

테스트는 `lib/` 하위 순수 함수 대상(Vitest, node 환경). `vitest.config.ts` 의 `@/*` alias 는 tsconfig 와 동일.

## Python 상시 검사 (토큰 0 · 문서·수집 계약 회귀 감시)

```powershell
scripts/venv/Scripts/python.exe scripts/verify_docs.py            # 표 구조·상대 링크·자동 로드 분량
scripts/venv/Scripts/python.exe scripts/verify_no_secrets.py     # .env.local 값이 추적 파일에 평문으로 샜는가
scripts/venv/Scripts/python.exe scripts/verify_fnguide.py        # fnguide 수집 계약 (주 1회 GHA도 실행)
scripts/venv/Scripts/python.exe scripts/verify_revalidate_tags.py # cacheTag ↔ ALL_TAGS ↔ COLUMN_TO_TAGS 정합성
scripts/venv/Scripts/python.exe scripts/verify_report_sort_wiring.py # PostList 화면이 정렬 searchParams 를 배선했는가
scripts/venv/Scripts/python.exe -m pytest scripts/lib -q         # 순수 함수 회귀
python -X utf8 scripts/verify-hookify-rules.py                   # .claude/ 훅 규칙 (venv 아닌 시스템 python)
```

Python 스크립트는 `scripts/venv` 활성화 후 실행한다. 환경변수는 `scripts/.env`.

## E2E (dev 기동 후 · exit 0 정상 · `--self-test`)

- `e2e_smoke.py` = 역할 5종 × 라우트 13개 **65칸**(열려야 48 · 막혀야 17)
- `e2e_interact.py` = 화면 9개를 **눌러서** 64건

🔴 admin 만으론 「막히는가」를, smoke 만으론 「눌러서 되는가」를 못 잰다.
🔴 화면마다 조작이 달라 **사양 복사 금지** → [`gotchas-playwright-ui.md`](./gotchas-playwright-ui.md).

UI 변경은 `npm run dev` 띄워 브라우저에서 골든 패스 + 엣지 케이스를 확인한다(콘솔·네트워크 에러 모니터링).

## 워크플로·배포 확인

```powershell
gh workflow run <name>.yml --ref master
gh run watch <id> --exit-status
gh run view <id> --log
```

- 🔴 **실패가 인프라 탓인지 먼저 가른다**(동시다발 실패는 거의 항상 GitHub 장애).
  🔴 **수집 로그는 tail 로 읽지 말 것**(pykrx stdout 이 뒤섞여 무해한 메시지가 끝에 몰린다)
  → [`gotchas-ci-deploy.md`](./gotchas-ci-deploy.md) §1.
- 프로덕션 = `stock-monitor-orcin.vercel.app`. **scripts·워크플로 변경은 재배포 불필요**(GHA 가 master 체크아웃)지만
  **`app/`·`components/` UI 변경은 Vercel 재배포**(push → 빌드 READY) 후 E2E 검증.
  🔴 `list_deployments` 시간필터는 오도하고 빈 커밋 재트리거는 무의미 → 확인법은
  [`gotchas-ci-deploy.md`](./gotchas-ci-deploy.md) §2.
- **Supabase 접근은 플러그인 MCP**(`mcp__plugin_supabase_supabase__*`) — `.mcp.json` 등록은 제거(2026-08-24 ·
  🔴 「매번 죽는다」의 원인은 토큰이 아니라 **cwd** 였다). 플러그인도 죽으면 `scripts/.env` 의
  **`SUPABASE_Pesonal_Access_Token`**(오타가 실제 키 이름) + Management API 우회 →
  [`gotchas-ci-deploy.md`](./gotchas-ci-deploy.md) §3.
- 🔴 **`lib/database.types.ts` 재생성 전에** — 이 파일은 순수 생성물이 아니다. 끝에 손으로 붙인
  `TableRow`·`ViewRow` 가 있어 통째로 덮으면 3개 파일이 `TS2305` 로 죽고, 생성물은 Prettier 미적용이라
  `format:check` 도 깨진다 → [`gotchas-ci-deploy.md`](./gotchas-ci-deploy.md) §7.
