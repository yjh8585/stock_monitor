# 함정: CI · 배포 · 플랫폼 운영 (GitHub Actions · Vercel · Supabase MCP · PowerShell)

> AGENTS.md에서 분리(2026-08-12). 여기 있는 것은 전부 **실제로 겪은** 함정이다.
> AGENTS.md에는 명령과 약속만 남기고, "왜 이렇게 됐나"·재현 절차·실패한 대안은 이 문서가 정본이다.
>
> 대상: 수집기 로직이 아니라 **그것을 돌리고 배포하고 확인하는 경로**. 수집 로직 함정은
> [`gotchas-data-collection.md`](./gotchas-data-collection.md), UI 검증 함정은
> [`gotchas-playwright-ui.md`](./gotchas-playwright-ui.md).

## 1. GitHub Actions — 실환경 검증과 실패 원인 가르기

수집 스크립트·워크플로를 고쳤으면 실제로 돌려서 확인한다.

```powershell
gh workflow run <name>.yml --ref master
gh run watch <id> --exit-status
gh run view <id> --log
gh run list --workflow=<name>.yml   # 간헐 실패는 이력으로 판단
```

**🔴 실패가 인프라 탓인지 먼저 가른다.** 코드를 고치기 전에 이 순서를 밟는다.

1. `gh run view <id> --log-failed` 가 **비어 있으면** 스텝이 실행되기도 전에 죽은 것이다 — 코드 문제가 아니다.
2. `gh run view <id>` 의 ANNOTATIONS 에 다음이 보이면 GitHub 측 장애다:
   - `job was not acquired by Runner`
   - `Service Unavailable`
   - `Failed to resolve action download info`
3. `githubstatus.com/api/v2/incidents.json` 으로 확인하고 **복구를 기다린다.**

실측(2026-08-06): 서로 다른 워크플로 **6건이 각 15~16분 걸려 동시에** 실패했다. 코드에는 아무 문제가
없었고, 이때 스크립트를 "고치기" 시작했으면 멀쩡한 수집기를 망가뜨렸을 것이다. **동시다발 실패는
거의 항상 인프라**다 — 서로 다른 워크플로가 같은 시각에 실패했다는 사실 자체가 신호다.

**🔴 단발 실패도 대개는 코드가 아니라 "요청 1회 실패"다** (2026-08-17 실측, 실패 2건 모두).
동시다발이 아니어도 곧바로 코드를 의심하지 말고 **어느 요청이 어떻게 끊겼는지**부터 본다.

- `collect-market-series`: Supabase 앞단 **Cloudflare가 502를 1회** 반환 → `lib.db.upsert_rows` 가
  재시도 없이 raise → 수집 전체 exit 1. 매시 실행이라 **다음 회차가 스스로 메꿨다**(데이터 손실 0).
- `collect-uzauto-financials`: PDF 11개 중 마지막 1개가 **`IncompleteRead`** (2.08MB 받고 연결 끊김)
  → `failed=1` → exit 1. 그 PDF는 **이미 처리·캐시된 것**이었다(sha256 비교용 재다운로드일 뿐).

→ 처방은 **`scripts/lib/retry.py`** (`with_retry` · `is_transient_error`). 5xx·연결 끊김만 재시도하고
**4xx 는 즉시 raise** 한다 — UzAuto 의 `source_link_missing`(404 skip) 경로를 재시도가 삼키면 안 된다.
🔴 **재시도해도 끝내 실패하면 그대로 실패시킨다.** 알림을 없애는 게 목적이 아니라 순간 장애만 흡수한다.

**🔴 수집 워크플로 로그를 `tail` 로 읽지 말 것.** pykrx 의 stdout 이 loguru 의 stderr 와 뒤섞여
**무해한 `KRX 로그인 실패` 메시지가 로그 맨 끝에 몰린다.** 끝만 보면 그게 진짜 실패 원인처럼 읽힌다.
(관련: [`gotchas-data-collection.md`](./gotchas-data-collection.md) 의 `disable_pykrx_autologin` 항목)

## 2. Vercel — "지금 프로덕션에 뭐가 떠 있나"를 확인하는 법

프로덕션 = `stock-monitor-orcin.vercel.app`.

- **`scripts/`·워크플로 변경은 재배포 불필요**(GHA 가 master 를 체크아웃한다).
  **`app/`·`components/` UI 변경은 Vercel 재배포(push → 빌드 READY) 후에** E2E 검증한다.
- 배포 상태는 Vercel MCP `list_deployments`(projectId/teamId 는 `.vercel/project.json`).

**🔴 `list_deployments` 의 시간 필터(since/until)는 오도한다.** 배포가 push 후 수 분 지연될 수 있어서
필터를 걸면 **있는 배포를 없다고 오판한다**(2026-07-17 실측 — 정확히 이 오판을 했다).
→ **현재 프로덕션에 뭐가 떠 있나는 prod alias(`stock-monitor-orcin.vercel.app`)에 `get_deployment`**
로 확인한다(commit sha 와 `readyState` 를 돌려준다).

**🔴 재트리거에 빈 커밋은 무의미하다.** `vercel.json` 의 `ignoreCommand` 가 `data/backups` 외에 diff 가
없으면 빌드를 스킵하므로, **실제 변경 diff 가 있어야** 빌드가 돈다.
(이 `ignoreCommand` 가 왜 있는지 = [`isr-write-optimization.md`](./isr-write-optimization.md))

**Vercel MCP 에는 usage/과금 조회 도구가 없다.** ISR Writes·Bandwidth 등 사용량 수치는
**대시보드 Usage 탭에서만** 확인할 수 있다.

## 3. Supabase MCP 가 세션 중 `Unauthorized` 로 죽을 때

토큰 env 가 주입되지 않아 발생한다. **재시작으로 세션을 버리지 말고** Management API 직접 호출로 우회한다.

- 키는 `scripts/.env` 의 **`SUPABASE_Pesonal_Access_Token`** — 🔴 **오타(`Pesonal`)가 실제 키 이름이다.**
  고치지 말 것. 고치면 기존 참조가 전부 깨진다.
- 끝점: `POST https://api.supabase.com/v1/projects/{ref}/database/query`
  (`ref` 는 `SUPABASE_URL` 의 `https://<ref>.supabase.co` 에서 파싱)
- 🔴 **브라우저 User-Agent 헤더 필수** — 안 붙이면 Cloudflare 가 `403 error code 1010` 으로 차단한다
  (2026-07-15 실측).
- DDL·SELECT 모두 가능하다. MCP 가 내부적으로 쓰는 **같은 끝점**이다.
- ⚠️ 단 이 경로는 `supabase_migrations.schema_migrations` 이력을 **남기지 않는다.**
  MCP `apply_migration` 과 동등하게 맞추려면
  `insert into supabase_migrations.schema_migrations (version, name)` 을 직접 넣어야 한다.

## 4. PowerShell 5.1 운영

기본 규칙(`&&` 미지원 · UTF-16 LE BOM)은 AGENTS.md 본문에 있다. 아래는 겪고 나서야 아는 것들.

- **`master` 에 백업 봇이 매일 커밋한다**(`chore(backup): daily JSONB snapshot`).
  push 가 거부되면 `git -c rebase.autoStash=true pull --rebase origin master` 후 재push.
  🔴 **파이프(`... | tail`)는 앞 명령의 exit code 를 가린다** → `git push` 실패 후 `|| (rebase)` 분기가
  안 탄다. push 는 **파이프 없이** 실행하거나 종료 코드를 별도로 확인할 것.
- **Bash `grep` 이 한글/ANSI 섞인 stdout 을 binary 로 처리해 결과를 숨긴다** → `grep -a` 강제.
  (파일 내용 검색은 Grep 도구를 쓰는 것이 맞다)
- **venv Python stdout 한글이 깨지면** Bash 도구로 실행할 때 `PYTHONIOENCODING=utf-8` 프리픽스:
  `PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe ...`
- Codex CLI 는 stdin hang 회피로 `"" | codex ... --output-last-message <file>` 패턴
  (메모리 `reference_codex_cli_powershell.md`).

## 5. 커밋 전 secret 점검 — 왜 매번 보는가

일부 일회성 스크립트와 `scripts/_archive/*` 에 **자격증명(Supabase PAT 등) 하드코딩 잔재가 남아 있다.**
untracked 를 정리하거나 새로 추적하기 전에 `sbp_`/토큰 패턴을 grep 한다.

이 레포는 **master 직접 push** 라서, secret 이 포함되면 GitHub Push Protection(GH013)이 푸시를 통째로
막는다. 그때는 해당 파일을 제외하고 재커밋한다.

## 6. dev 서버가 옛 `'use cache'` 값을 들고 있을 때

`source.ts` 등을 고쳤는데 dev 화면이 안 바뀌면 `rm -rf .next` + 재시작까지 갈 필요가 없다.

`scripts/lib/revalidate.py` 의 `revalidate_tags([태그])` 를 **로컬로** 호출하면
(`NEXT_REVALIDATE_URL`=localhost) 해당 태그만 무효화돼 훨씬 빠르다.

## 7. `lib/database.types.ts` 재생성이 손으로 덧붙인 헬퍼 타입을 지운다 (2026-08-21 실측)

`AGENTS.md` 는 컬럼을 추가하면 "`generate_typescript_types` 로 `lib/database.types.ts` 갱신" 하라고
적어 두었는데, **이 파일은 순수 생성물이 아니다.** 파일 **맨 끝에 손으로 붙인 export 두 개**가 있다.

```ts
export type ViewRow<T extends keyof Database['public']['Views']> = ...
export type TableRow<T extends keyof Database['public']['Tables']> = ...
```

Management API(`GET /v1/projects/{ref}/types/typescript`)의 출력으로 통째로 덮으면 이 둘이 사라지고,
`lib/companies/source.ts` · `lib/oem/source.ts` · `lib/types.ts` 가 `TS2305: has no exported member 'TableRow'`
로 죽는다. **재생성 뒤 두 export 를 다시 붙이고 `npx prettier --write` 를 돌린다.**

같이 걸리는 것 둘:

- **생성물은 Prettier 를 안 거친 상태로 온다**(세미콜론·큰따옴표). 그대로 두면 `format:check` 가 깨진다.
  먼저 `prettier --write` 를 돌린 뒤에 `git diff` 를 봐야 **진짜 내용 변경**이 보인다
  (안 그러면 포맷 차이 때문에 4,800줄 diff 가 나와 무엇이 바뀌었는지 알 수 없다).
- **재생성은 그동안 드리프트한 것까지 함께 들여온다.** 2026-08-21 에는 컬럼 하나를 더하려다
  `macro_outlook_notes` · `oem_model_brand` · `oem_sales_country_group_year` · `refresh_oem_agg_views`
  가 함께 들어왔다(전부 순수 추가라 무해했지만, **삭제가 섞이지 않았는지 필드명 단위로 대조**할 것).

🔴 **typecheck 초록이 "타입이 스키마와 맞다"는 뜻은 아니다.** `PostRepository` 는 클라이언트를
untyped `SupabaseClient` 로 캐스트하고 `posts` 는 `confidentialDb` 대상이 아니라, `database.types.ts` 를
갱신하지 않아도 컴파일은 통과한다. 갱신 여부는 컴파일러가 아니라 사람이 확인해야 한다.
