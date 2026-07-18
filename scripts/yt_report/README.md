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
2. 🔧 **자막**: `python scripts/yt_report/fetch_subs.py` → `text/<key>.txt` + 글자수·길이. 분량은 report.md §3-A 표로 산정.
3. ✍️ **본문 작성**(영상당 1 에이전트 병렬 권장): 자막 정독 → report.md §3/§3-A/§4대로 `reports/<key>.md` 작성. **차트·도해·주요 장면이 나오는 지점에 `[[FRAME:slug]]` 토큰** 삽입. slug는 `<key>_이름`.
4. ✍️ **shots.json / batch.json** 작성: 각 프레임의 slug·id·timecode + alt·caption(출처 포함)·public_url. 썸네일 slug 지정.
5. 🔧 **캡처**: `python scripts/yt_report/capture.py` (좁은 창). 실패 slug은 `--force --only <slug>`로 재시도.
6. 🔧 **몽타주**: `python scripts/yt_report/montage.py` → slug당 후보 프레임 1장(좌→우 오프셋).
7. ✍️ **프레임 선별**(vision): 몽타주를 보고 캡션이 말하는 장면/차트가 **선명한 프레임만** 골라 `selected.json`에 `slug:offset`. 토킹헤드·전환컷·손가림 드롭. → 채택된 것만 남는다.
8. 🔧 **조립**: `python scripts/yt_report/finalize.py` → `png/<slug>.png` + `reports_final/<key>.md`(토큰→이미지, 드롭 토큰 제거).
9. 🔧 **오버레이 크롭**(선택): 언더스탠딩 등 진행자 패널 레이아웃이면 `python scripts/yt_report/crop.py --prefix v4_,v6_` (좌측 72% 보존, `png/` 덮어씀).
10. 🔧 **업로드**: `npx tsx scripts/yt_report/upload.ts` → `reports/<storage_folder>/`.
11. 🔧 **게시**: `npx tsx scripts/yt_report/publish.ts` (source_url upsert — 신규 INSERT / 기존 UPDATE).
12. 🔧 **캐시 무효화**: `POST $NEXT_REVALIDATE_PROD_URL` 헤더 `x-revalidate-secret`, body `{"tags":["posts","post:<id>",…]}`.
13. 🔧 **검증**: `python scripts/yt_report/verify.py --ids <id들>` → raw`**`=0·이미지깨짐0·console0 `ALL_OK`.

### 차트 전수 재점검 (2차 패스 — 필수, report.md §7-A)

1차 선별에서 차트가 토킹헤드에 걸려 드롭되거나 애초에 안 잡힌 게 있을 수 있다.

1. ✍️ 영상별로 자막을 다시 훑어 **미포함 차트 지점**을 발굴 → `reports/<key>.md`에 `[[FRAME:새slug]]` 추가, `batch.json` frames에 메타 추가, `shots.json`에 재캡처 항목 추가.
2. 🔧 `python scripts/yt_report/capture.py --wide --only <새slug들>` (넓은 창, 오프셋 6개).
3. 🔧 `python scripts/yt_report/montage.py <새slug들>`.
4. ✍️ vision으로 **실제 차트인 것만** `selected.json`에 추가(엄격 — 애매하면 드롭).
5. 🔧 `finalize.py` → `crop.py` → `upload.ts` → `publish.ts`(UPDATE) → 무효화 → `verify.py`.

## 함정 (report.md §7-A와 동일)

- Windows ffmpeg `drawtext`는 fontconfig 부재로 크래시 → 몽타주 라벨 없이 순수 hstack.
- 언더스탠딩·일부 채널은 슬라이드+진행자 패널 레이아웃 → `crop.py`로 우측 크롭. 차플레이·KBS는 풀스크린이라 불필요.
- 자동 생성 자막은 오타 많음 → 내용 파악용, 본문 인용은 다듬는다.
- CI/클라우드 IP는 유튜브 자막·다운로드가 429로 막힐 수 있음(로컬 실행 권장).
- 개별 영상은 영상당 1편(source_url=watch URL), 재생목록만 주제별 묶음.
