"""selected.json + batch.json → (1) 게시용 png (2) 본문 [[FRAME:slug]] 토큰 치환 (3) frame_times.json.

입력:
  RUN_DIR/reports/<key>.md   — 에이전트가 쓴 본문(플레이스홀더 [[FRAME:slug]] 포함)
  RUN_DIR/batch.json         — {pub_base, reports:[{key, frames:[{slug,alt,caption,public_url}]}], ...}
  RUN_DIR/selected.json      — {slug: offset}  (드롭 slug은 없음)
  RUN_DIR/shots.json         — [{slug, id, timecode}] (frame_times.json 계산용)
  RUN_DIR/frames/<slug>_<offset>.jpg — capture.py
  RUN_DIR/png/<slug>_<offset>.png    — crop.py 크롭본(선택 · 있으면 우선)
  RUN_DIR/png/<slug>.png             — 11-24 전 옛 방식 크롭본(새 크롭본이 없고 원본보다 새것일 때만 쓴다)
  RUN_DIR/exact_times.json   — capture.py --exact 의 정각 기록 {slug: {video_id, seconds}}(선택)
출력:
  RUN_DIR/png_final/<slug>.png   — 게시용 그림(본문에 실린 것만). upload.ts 는 이 폴더만 올린다.
  RUN_DIR/reports_final/<key>.md — 토큰이 이미지 마크다운으로 치환된 최종 본문
  RUN_DIR/frame_times.json       — {slug: {video_id, seconds}} (settle.py --check 입력)

🔴 순서 = capture → (crop) → finalize → settle --check. 크롭은 finalize «앞»에 돌린다(2026-11-24 정본화 D5).
   예전엔 finalize 가 `png/<slug>.png` 를 쓰고 crop 이 그것을 덮었다 — 선택을 바꾸거나 finalize 를 다시 돌리면
   옛 크롭·원본이 조용히 섞였다. 이제 crop 은 `png/<slug>_<오프셋>.png` 에 쓰고 finalize 가 고른다(agents 와 같은 약속).
토큰이 selected에 없거나 png 변환 실패 시 해당 토큰 줄은 제거(누락 이미지 자동 정리).
종료 코드 1(2026-11-24 최종 검토) = 시각 누락 · 원본보다 오래된 크롭본(crop.py 를 다시 돌릴 것) · 게시 그림 0장 ·
  batch.json pub_base 가 `.../reports/<storage_folder>` 가 아님. 앞의 셋은 조립은 끝내고 실패로 알린다.
usage: python finalize.py
"""
from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path

from _common import FRAME_TOKEN, NO_WINDOW, ensure_dir, find_ffmpeg, mmss_to_sec, run_path
from capture import EXACT, NARROW, WIDE

SENTINEL = "\x01DROPFRAME\x01"
# 정각 캡처 파일은 <slug>_00.jpg 하나다(capture.py EXACT)
EXACT_OFFSET = EXACT["offsets"][0]


def window_before(offset: int) -> int:
    """창 시작 역산값 — 좁은 창(4,12,…)과 넓은 창(5,14,…)은 오프셋이 겹치지 않아 오프셋만으로 가른다.

    🔴 README 2차 패스가 `capture.py --wide` 를 쓴다 — 좁은 창 값(6)으로 역산하면 settle.py 가 6초 뒤를 검사한다
       (agents finalize_vault.py 도 같은 방식으로 맞췄다 · 2026-11-24).
    """
    return WIDE["before"] if offset in WIDE["offsets"] else NARROW["before"]


def frame_seconds(timecode: str, offset: int, exact: dict | None) -> int | None:
    """선택 프레임의 절대 초(frame_times.json). agents `finalize_vault.py` 와 같은 규칙 + 넓은 창 구분.

    정각 캡처분(오프셋 0)은 exact_times.json 기록 초를 그대로 쓴다 — 창 역산을 타면 settle.py 가 6초 앞을 검사한다.
    오프셋 0 인데 기록이 없으면 None(시각 누락). 0 이 아니면 좁은·넓은 창 파일이다.
    """
    if offset == EXACT_OFFSET:
        return int(exact["seconds"]) if exact else None
    # capture.py 가 `max(0, tc - before)` 로 자르므로 여기서도 같이 자른다
    return max(0, mmss_to_sec(timecode) - window_before(offset)) + offset


def valid_seconds(sec) -> bool:
    """정각 기록 초로 믿을 값인가 — 유한한 0 이상 수만(NaN·음수·문자열·bool 은 버린다 · 2026-11-24 최종 검토).

    파이썬 json 은 `NaN` 을 실수로 읽는다 — 거르지 않으면 게시 PNG·본문을 다 쓴 뒤 int() 에서 죽는다.
    """
    return (not isinstance(sec, bool) and isinstance(sec, (int, float))
            and math.isfinite(sec) and sec >= 0)


def load_exact_times(path: Path) -> dict | None:
    """exact_times.json 을 읽는다. 없으면 {} · 깨졌으면 None(정각 그림만 시각 누락으로 돌린다)."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text("utf-8"))
    except (ValueError, OSError):
        return None
    return data if isinstance(data, dict) else None


def exact_record(exact_times: dict, slug: str, video_id: str) -> dict | None:
    """그 slug 의 정각 기록 — 형식이 맞고 같은 영상의 것일 때만(아니면 None → 시각 누락)."""
    rec = exact_times.get(slug)
    if not isinstance(rec, dict) or rec.get("video_id") != video_id:
        return None
    return rec if valid_seconds(rec.get("seconds")) else None


def pick_source(slug: str, off: int) -> tuple[Path | None, str]:
    """게시용 그림의 원본과 알림 표시 — 크롭본이 «지금 선택한 그 프레임»에서 만들어졌을 때만 크롭본.

    표시: "" 정상 · "stale" 새 크롭본이 원본보다 오래됐다(원본으로 · 실패로 끝낸다) ·
          "legacy" 옛 방식 크롭본 png/<slug>.png 를 쓴다(알림만) · "legacy-stale" 옛 이름이 원본보다 오래됐다(원본으로 · 알림만).
    🔴 크롭본이 원본 프레임보다 오래됐으면 버린다 — 정각을 다시 뜨면 _00.jpg 만 새로 생기고 크롭은 옛 그림 그대로다.
       버리기만 하고 조용히 넘기면 크롭하려던 그림이 크롭 안 된 채 게시된다 → "stale" 로 실패를 낸다(2026-11-24 최종 검토).
    🔴 11-24 전 회차는 crop.py 가 png/<slug>.png 를 덮어썼다(이미 크롭된 그림) — 새 크롭본이 없을 때만 그것을 쓴다.
       SHORTCUT: 옛 이름에는 오프셋이 없어 옛 조립 뒤 선택만 바꾼 slug 는 가르지 못한다(원본보다 새것인지만 본다)
                 → 옛 회차를 다시 조립할 일이 늘면 crop.py 를 다시 돌려 새 이름으로 옮긴다.
    원본 프레임이 없으면 (None, "").
    """
    frame = run_path("frames", f"{slug}_{off:02d}.jpg")
    if not frame.exists():
        return None, ""
    fresh = frame.stat().st_mtime
    cropped = run_path("png", f"{slug}_{off:02d}.png")
    if cropped.exists():
        return (cropped, "") if cropped.stat().st_mtime >= fresh else (frame, "stale")
    legacy = run_path("png", f"{slug}.png")
    if legacy.exists():
        return (legacy, "legacy") if legacy.stat().st_mtime >= fresh else (frame, "legacy-stale")
    return frame, ""


def to_png(ff: str, src: Path, dst: Path) -> bool:
    r = subprocess.run(
        [ff, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), str(dst)],
        check=False, creationflags=NO_WINDOW, capture_output=True,
    )
    return r.returncode == 0 and dst.exists()


CROP_NOTE = {
    "stale": "크롭본 png/{slug}_{off:02d}.png 이 원본 프레임보다 오래됐다 — 원본으로 만들었다 · crop.py 를 다시 돌릴 것",
    "legacy": "옛 방식 크롭본 png/{slug}.png 를 쓴다(11-24 전 회차 · 원본보다 새것)",
    "legacy-stale": "옛 이름 png/{slug}.png 가 원본보다 오래돼 안 쓴다 — 크롭했던 slug 이면 crop.py 를 다시 돌릴 것",
}


def build_pngs(ff: str, slugs: list[str], selected: dict) -> tuple[set[str], list[str]]:
    """본문에 실릴 slug 만 png_final/<slug>.png 로 만든다 → (성공 slug, 옛 크롭본 slug).

    🔴 옛 파일을 먼저 지운다 — 개정으로 그림이 줄면 고아가 올라간다.
    🔴 크롭본 변환이 실패하면 원본 프레임으로 다시 한다 — 깨진 크롭 하나가 멀쩡한 그림을 본문에서 빼지 않게(2026-11-24).
    """
    out_dir = ensure_dir(run_path("png_final"))
    for old in out_dir.glob("*.png"):
        old.unlink()
    ok: set[str] = set()
    stale: list[str] = []
    for slug in slugs:
        off = int(selected[slug])
        src, note = pick_source(slug, off)
        if src is None:
            print(f"  MISS {slug}")
            continue
        if note:
            print(f"  ⚠️ CROP {slug}\t" + CROP_NOTE[note].format(slug=slug, off=off))
        if note == "stale":
            stale.append(slug)
        dst = out_dir / f"{slug}.png"
        good = to_png(ff, src, dst)
        frame = run_path("frames", f"{slug}_{off:02d}.jpg")
        if not good and src != frame:
            print(f"  ⚠️ ERR {slug}\t크롭본 {src.parent.name}/{src.name} 변환 실패 — 원본 프레임으로 다시 한다")
            src = frame
            good = to_png(ff, src, dst)
        if good:
            ok.add(slug)
        print(f"  {'OK ' if good else 'ERR'} {slug} @ {off}s\t{src.parent.name}/{src.name}")
    return ok, stale


def legacy_time(old_times: dict, slug: str, video_id: str) -> dict | None:
    """옛 회차(2026-11-24 전 · exact_times.json 이 없다)의 frame_times.json 정각 기록 — 같은 영상 · 믿을 초일 때만."""
    rec = old_times.get(slug)
    if not isinstance(rec, dict) or rec.get("video_id") != video_id or not valid_seconds(rec.get("seconds")):
        return None
    return {"video_id": video_id, "seconds": rec["seconds"]}


def update_times(slugs: set[str], selected: dict, shots: dict, old_times: dict) -> tuple[dict, list[str]]:
    """이번에 게시하는 slug 로만 frame_times 를 «새로» 만든다 → (frame_times, 시각 누락 slug).

    🔴 옛 기록을 제자리에서 고치면 본문에서 뺀 slug 의 기록이 남아 settle.py --check 가 계속 읽는다(2026-11-24 최종 검토).
    🔴 옛 frame_times 값을 살리는 것은 exact_times.json «파일 자체가 없는» 옛 회차뿐이다 — 파일이 있는데 그 slug 기록이
       없으면 정각을 다시 뜬 뒤 기록이 빠진 것이라 옛 초는 다른 그림의 시각일 수 있다 → 누락.
    """
    exact_path = run_path("exact_times.json")
    has_exact = exact_path.exists()
    exact_times = load_exact_times(exact_path)
    if exact_times is None:
        print("  🔴 exact_times.json 형식 오류 — 정각(오프셋 0) 그림만 시각 누락으로 처리한다")
    times: dict[str, dict] = {}
    missing: list[str] = []
    for slug in sorted(slugs):
        sh = shots.get(slug)
        if not sh:
            missing.append(slug)
            print(f"  🔴 TIME {slug}\t게시 그림인데 shots.json 에 없다 — 시각을 구할 수 없다")
            continue
        vid, off = sh["id"], int(selected[slug])
        sec = frame_seconds(sh["timecode"], off, exact_record(exact_times or {}, slug, vid))
        if sec is None and not has_exact:
            old = legacy_time(old_times, slug, vid)
            if old is not None:
                # 옛 회차(2026-11-24 전): capture.py --exact 가 frame_times.json 에 직접 적었다 — 그 기록을 살린다
                times[slug] = old
                continue
        if sec is None:
            missing.append(slug)
            print(f"  🔴 TIME {slug}\t오프셋 0 인데 믿을 정각 기록이 없다(exact_times.json) — "
                  f"capture.py --exact --only {slug} 로 다시 뜰 것(안 그러면 settle.py 가 못 본다)")
        else:
            times[slug] = {"video_id": vid, "seconds": sec}
    return times, missing


def body_slugs(batch: dict, selected: dict) -> list[str]:
    """본문 등장 순으로 «실릴» slug — 채택됐고(selected) 캡션 메타가 있는 토큰만."""
    seen: list[str] = []
    for rep in batch["reports"]:
        meta = {fr["slug"] for fr in rep["frames"]}
        text = run_path("reports", f"{rep['key']}.md").read_text(encoding="utf-8")
        for m in FRAME_TOKEN.finditer(text):
            slug = m.group(1)
            if slug in selected and slug in meta and slug not in seen:
                seen.append(slug)
    return seen


def assemble(rep: dict, pub_base: str, png_ok: set[str]) -> tuple[str, list[str], list[str]]:
    meta = {fr["slug"]: fr for fr in rep["frames"]}
    text = run_path("reports", f"{rep['key']}.md").read_text(encoding="utf-8")
    used, dropped = [], []

    def repl(m: re.Match) -> str:
        slug = m.group(1)
        if slug in png_ok and slug in meta:
            fr = meta[slug]
            used.append(slug)
            # 🔴 주소는 업로드되는 파일(png_final/<slug>.png)에서 만든다 — batch 의 손 기입값이 어긋나면 깨진 그림이 나간다
            url = f"{pub_base}/{slug}.png"
            if fr.get("public_url") != url:
                print(f"  ⚠️ URL {slug}\tbatch.json public_url 이 게시 파일과 다르다 — {url} 로 쓴다")
            # 🔴 캡션 속 별표는 이스케이프 — 안 하면 감싼 이탤릭이 깨진다(2026-11-18 agents 볼트 실측에서 옮김)
            cap = fr["caption"].replace("*", r"\*")
            return f"![{fr['alt']}]({url})\n*{cap}*"
        dropped.append(slug)
        return SENTINEL

    text = FRAME_TOKEN.sub(repl, text)
    text = re.sub(rf"[ \t]*{re.escape(SENTINEL)}[ \t]*", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
    return text, used, dropped


def pub_base_of(batch: dict) -> str | None:
    """본문 주소의 앞부분 — `.../reports/<storage_folder>` 꼴일 때만(아니면 None).

    🔴 upload.ts 는 storage_folder 로 올리고 본문은 pub_base 로 주소를 만든다 — 둘이 어긋나면 그림이 전부 깨진다
       (2026-11-24 최종 검토 · 형식 = README 「pub_base = <SUPABASE_URL>/storage/v1/object/public/reports/<storage_folder>」).
    """
    folder = str(batch.get("storage_folder") or "").strip("/")
    pub_base = str(batch.get("pub_base") or "").rstrip("/")
    return pub_base if folder and pub_base.endswith(f"/reports/{folder}") else None


def main() -> int:
    ff, _ = find_ffmpeg()
    batch = json.loads(run_path("batch.json").read_text(encoding="utf-8"))
    pub_base = pub_base_of(batch)
    if pub_base is None:
        print(f"🔴 batch.json pub_base({batch.get('pub_base')!r}) 가 .../reports/<storage_folder>"
              f"({batch.get('storage_folder')!r}) 가 아니다 — upload.ts 가 올리는 폴더와 본문 주소가 갈린다")
        return 1
    ensure_dir(run_path("reports_final"))
    selected = json.loads(run_path("selected.json").read_text(encoding="utf-8"))
    shots = {s["slug"]: s for s in json.loads(run_path("shots.json").read_text(encoding="utf-8"))}

    print("=== 게시용 PNG(png_final/) ===")
    png_ok, crop_stale = build_pngs(ff, body_slugs(batch, selected), selected)

    print("=== 본문 조립 ===")
    for rep in batch["reports"]:
        text, used, dropped = assemble(rep, pub_base, png_ok)
        run_path("reports_final", f"{rep['key']}.md").write_text(text, encoding="utf-8")
        print(f"  {rep['key']}: 이미지 {len(used)}개, 드롭 {len(dropped)}개  {dropped if dropped else ''}")

    print("=== frame_times.json ===")
    tpath = run_path("frame_times.json")
    old_times = json.loads(tpath.read_text(encoding="utf-8")) if tpath.exists() else {}
    times, missing = update_times(png_ok, selected, shots, old_times if isinstance(old_times, dict) else {})
    tpath.write_text(json.dumps(times, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(f"  {len(times)}건")
    # 🔴 시각이 빠진 그림은 settle.py --check 가 조용히 건너뛴다 → 「통과」로 읽히지 않게 실패로 끝낸다(agents 와 같다)
    if missing:
        print(f"🔴 시각 누락 {len(missing)}장 — 정착 검사가 못 본다: {','.join(missing)}")
    if crop_stale:
        print(f"🔴 옛 크롭 {len(crop_stale)}장 — 원본으로 만들었다 · crop.py 를 다시 돌린 뒤 조립할 것: {','.join(crop_stale)}")
    if not png_ok:
        print("🔴 게시 그림 0장 — 프레임·선택·본문 토큰을 확인할 것")
    return 1 if missing or crop_stale or not png_ok else 0


if __name__ == "__main__":
    raise SystemExit(main())
