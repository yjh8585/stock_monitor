# yt_report — 유튜브 영상 → `/reports` 보고서 파이프라인 (재사용 툴킷)

유튜브 영상 N편을 **주요 장면·차트 스크린샷을 포함한** 고품질 보고서로 만들어 `/reports`에 게시하는 **커밋된 재사용 도구**. 내용 규칙(본문 형식·분량·마크다운 렌더 함정·차트 필수)은 **[`report.md`](../../report.md) §7·§7-A·§8**이 단일 진실 공급원이며, 이 툴킷은 그 절차의 **기계적 단계(자막·캡처·몽타주·조립·업로드·게시·검증)**를 담당한다.

- **커밋(코드)**: `scripts/yt_report/*` (이 폴더)
- **일회성 산출물**: `scripts/_yt_report/`(= 기본 `RUN_DIR`, `.gitignore` 처리). 자막·프레임·png·중간 json은 전부 여기. 다른 곳에 두려면 `YT_RUN_DIR` 환경변수로 지정.
- **에이전트 단계**(본문 작성·프레임 선별·차트 발굴)는 사람/서브에이전트가 수행 — 아래 절차의 ✍️ 표시. 나머지 🔧는 스크립트.

## 전제

- venv에 yt-dlp: `scripts/venv/Scripts/python.exe -m pip install yt-dlp` (또는 `uv pip install yt-dlp`).
- ffmpeg: PATH에 있거나 `FFMPEG_PATH` 환경변수, 또는 winget(`winget install Gyan.FFmpeg`) 설치. `_common.find_ffmpeg()`가 자동 탐지.
- `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(게시), `MOBILITY_ID`/`MOBILITY_PW`(검증), `NEXT_REVALIDATE_PROD_URL`/`NEXT_REVALIDATE_SECRET`(무효화).
- Storage `reports` 버킷 허용 MIME = image/png·application/pdf → 프레임은 png로 업로드(툴킷이 변환).

## 데이터 계약 (RUN_DIR 안의 JSON)

| 파일               | 생성 주체     | 형태                                                                                                                                                                                   |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `videos.json`      | ✍️            | `[{key, id, channel, title, category, published_at, source_name}]` (key=v1,v2…)                                                                                                        |
| `text/<key>.txt`   | 🔧 fetch_subs | 정제 자막(15초 타임코드 마커)                                                                                                                                                          |
| `reports/<key>.md` | ✍️            | 본문(플레이스홀더 `[[FRAME:slug]]` 포함, H1 제목 없음)                                                                                                                                 |
| `shots.json`       | ✍️            | `[{slug, id, timecode:"MM:SS"}]` — 캡처할 프레임 지점                                                                                                                                  |
| `batch.json`       | ✍️            | `{storage_folder, pub_base, reports:[{key, video_id, title, source_name, source_url, category, published_at, thumb_slug, thumb_fallback, frames:[{slug, alt, caption, public_url}]}]}` |
| `selected.json`    | ✍️            | `{slug: offset}` — 채택된 프레임과 오프셋(초). 드롭은 미포함                                                                                                                           |

`pub_base` = `<SUPABASE_URL>/storage/v1/object/public/reports/<storage_folder>`. `public_url` = `pub_base/<slug>.png`.

## 절차

1. ✍️ **영상 목록**: `videos.json` 작성(제목·채널은 oEmbed `youtube.com/oembed?url=<watch>&format=json`, 업로드일은 `yt-dlp --print upload_date`).
2. 🔧 **자막**: `python scripts/yt_report/fetch_subs.py` → `text/<key>.txt` + 글자수·길이. 분량은 report.md §3-A 표로 산정. 🔴 **이미 게시된 영상이 있으면 자막을 받기 전에 멈춘다**(2026-10-27 사용자 지시) — 목록에서 빼거나, 다시 만드는 게 맞으면 `YT_ALLOW_UPDATE=<key,…>`.
3. ✍️ **본문 작성 — 오퍼스 초안 → Codex 대조 → 메인 검산**(2026-10-27 사용자 선택 · 근거 = `~/.claude/docs/codex-vs-opus.md` · 경위 §9). 모두 Opus 고정 — 자동 경로(`collect_yt_report.py`)의 모델 상수와는 별개다.
   1. **초안(오퍼스)**: 영상당 서브에이전트 1명(`model` 칸 비움 · 5명씩 순차)에 [`prompts/write.md`](./prompts/write.md)를 넘긴다. `{분량표}`(report.md §3-A)·`{환율 한 줄}`(DB `exchange_rates_live`)은 메인이 채운다. 출력의 BODY → `reports/<key>.md`, SHOTS → shots·캡션 후보.
   2. **사실 대조(Codex · 읽기 전용)**: BODY 를 `check/<key>_draft.md`로 두고, 과제문 `check/prompt_<key>.md`(대상 key · [`prompts/check.md`](./prompts/check.md)를 따르라 · 다른 파일 열지 말 것)로 `python -X utf8 ~/.claude/scripts/codex_run.py run check/prompt_<key>.md check/codex_<key>.md --cwd <RUN_DIR> --tag yt-report-check`. 30초 간격으로 띄우고 결과 크기를 본다. Codex 한도면 서브에이전트 1명이 같은 지시로 `check/opus_<key>.md`.
   3. **메인 검산**: 지적마다 자막(과 화면)으로 확인된 것만 반영한다 — 2026-10-27 은 v7 지적 0건 · 나머지도 전부 맞지는 않았다. 고유명사는 그림 속 글자가 정답지(`docs/report-from-youtube.md` §2-G).
   - 🔴 `verify_yt_report.py` 가 편마다 `check/(codex|opus)_<key>.md`(300B 이상)가 없으면 오류를 내고, 게시 게이트가 그 통과를 요구한다.
   - 본문에는 **차트·도해·주요 장면이 나오는 지점에 `[[FRAME:slug]]` 토큰**. slug는 `<key>_이름`.
4. ✍️ **shots.json / batch.json** 작성: 각 프레임의 slug·id·timecode + alt·caption(출처 포함)·public_url. 썸네일 slug 지정.
5. 🔧 **캡처**: `python scripts/yt_report/capture.py` (좁은 창). 실패 slug은 `--force --only <slug>`로 재시도.
   - **권장(2026-10-27~) — 정답지 방식**: 먼저 `python scripts/yt_report/scan.py v1,v2,…`로 10초 간격 접촉 시트를 만들고, 차트·도해가 실제로 뜬 시각(정답지 · 칸→시각은 `sheets/<key>/index.tsv`)에 `shots.json` 타임코드를 맞춘 뒤 `capture.py --exact`(정각 1장 · `frame_times.json` 자동 기록). 자막 추정 시각의 적중률은 29~40%였다. 이때 `selected.json` 은 `{slug: 0}`이고 6·7단계(몽타주·선별)는 2×2 격자로 직접 읽는 것으로 대신한다.
   - `settle.py --check` 의 «권장 시각»을 되풀이 채택하지 말 것 — 전환 효과(줌·페이드)로 끌려가 흐린 프레임·클로즈업이 된다(2026-10-27 두 건). 경고가 남아도 눈으로 확정한다.
6. 🔧 **몽타주**: `python scripts/yt_report/montage.py` → slug당 후보 프레임 1장(좌→우 오프셋).
7. ✍️ **프레임 선별**(vision): 몽타주를 보고 캡션이 말하는 장면/차트가 **선명한 프레임만** 골라 `selected.json`에 `slug:offset`. 토킹헤드·전환컷·손가림 드롭. → 채택된 것만 남는다.
8. 🔧 **조립**: `python scripts/yt_report/finalize.py` → `png/<slug>.png` + `reports_final/<key>.md`(토큰→이미지, 드롭 토큰 제거).
9. 🔧 **오버레이 크롭**(선택): 언더스탠딩 등 진행자 패널 레이아웃이면 `python scripts/yt_report/crop.py --prefix v4_,v6_` (좌측 72% 보존, `png/` 덮어씀).
10. 🔧 **업로드**: `npx tsx scripts/yt_report/upload.ts` → `reports/<storage_folder>/`.
11. 🔧 **게시**: `npx tsx scripts/yt_report/publish.ts` (source_url 기준 — 신규 INSERT). 🔴 **이미 게시된 영상이 하나라도 있으면 아무것도 쓰지 않고 멈춘다**(2026-10-27 리포트 132 를 경고 없이 덮어쓴 사고). 덮어쓰는 게 맞으면 `YT_ALLOW_UPDATE=v5,…`(또는 `all`)로 명시한다.
12. 🔧 **캐시 무효화**: `POST $NEXT_REVALIDATE_PROD_URL` 헤더 `x-revalidate-secret`, body `{"tags":["posts","post:<id>",…]}`.
13. 🔧 **검증**: `python scripts/yt_report/verify.py --ids <id들>` → raw`**`=0·이미지깨짐0·console0 `ALL_OK`.

### 차트 전수 재점검 (2차 패스 — 필수, report.md §7-A)

1차 선별에서 차트가 토킹헤드에 걸려 드롭되거나 애초에 안 잡힌 게 있을 수 있다.

1. ✍️ 영상별로 자막을 다시 훑어 **미포함 차트 지점**을 발굴 → `reports/<key>.md`에 `[[FRAME:새slug]]` 추가, `batch.json` frames에 메타 추가, `shots.json`에 재캡처 항목 추가.
2. 🔧 `python scripts/yt_report/capture.py --wide --only <새slug들>` (넓은 창, 오프셋 6개).
3. 🔧 `python scripts/yt_report/montage.py <새slug들>`.
4. ✍️ vision으로 **실제 차트인 것만** `selected.json`에 추가(엄격 — 애매하면 드롭).
5. 🔧 `finalize.py` → `crop.py` → `upload.ts` → `YT_ALLOW_UPDATE=all publish.ts`(UPDATE) → 무효화 → `verify.py`.

## 함정 (report.md §7-A와 동일)

- Windows ffmpeg `drawtext`는 fontconfig 부재로 크래시 → 몽타주 라벨 없이 순수 hstack.
- 언더스탠딩·일부 채널은 슬라이드+진행자 패널 레이아웃 → `crop.py`로 우측 크롭. 차플레이·KBS는 풀스크린이라 불필요.
- 자동 생성 자막은 오타 많음 → 내용 파악용, 본문 인용은 다듬는다.
- CI/클라우드 IP는 유튜브 자막·다운로드가 429로 막힐 수 있음(로컬 실행 권장).
- 개별 영상은 영상당 1편(source_url=watch URL), 재생목록만 주제별 묶음.
