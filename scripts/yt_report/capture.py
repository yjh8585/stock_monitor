"""shots.json 기반 프레임 캡처 — 영상을 1080p로 한 번씩 받아 두고 지점별 프레임 추출.

입력: RUN_DIR/shots.json = [{"slug","id","timecode":"MM:SS"}, ...]
출력: RUN_DIR/video/<id>.mp4  (영상당 1회 다운로드, 재실행 시 재사용)
     RUN_DIR/frames/<slug>_<offset>.jpg  (offset = 창 시작 기준 초, 몽타주가 좌→우로 배열)

usage: python capture.py                 # 기본(창 ±6초/40초, 오프셋 5개)
       python capture.py --wide          # 넓은 창(±12초/58초, 오프셋 6개) — 차트 재점검용
       python capture.py --only v6_manheim_correlation,v4_baden_factory_map
       python capture.py --exact         # 정답지 경로 — timecode 그 시각 한 장(<slug>_00.jpg)

--exact(2026-10-27 stock_monitor 에서 시작 · 2026-11-18 agents 로 옮김)는 timecode 를 접촉 시트 정답지(scan.py)와
미리보기(grab.py)로 «눈으로 확인한» 시각으로 적었을 때 쓴다. 자막 추정 시각은 적중 29~40%라 창을 훑어야 하지만
정답지 시각은 이미 화면을 본 값이라 창이 필요 없다.
🔴 정각 캡처분은 절대 초를 `exact_times.json`({slug: {video_id, seconds}})에 남긴다 — 조립 단계(finalize)가
   이 기록이 있는 slug 의 오프셋 0 은 「창 시작 − 6초」 역산을 건너뛰고 이 초를 frame_times.json 에 그대로 쓴다.
   역산을 타면 settle.py 가 6초 «앞»을 검사한다(Codex 실물 대조 2026-11-18 지적).
   두 레포 모두 이 약속을 따른다(2026-11-24 정본화 D5 — 정각 기록은 exact_times.json · settle 입력은 frame_times.json).

🔴 2026-08-25: 구간 다운로드(`--download-sections`)를 버렸다. 유튜브가 통합 포맷 18을 내리면서
   android_vr 클라이언트 URL만 남았고 ffmpeg가 그 URL에서 403을 받아 **모든 캡처가 0장**이 됐다
   (그 전에는 조용히 멈춰 진행이 안 됐다). 영상 전체를 480p로 받으면 8~20분 영상이 30~60MB·수 초라
   지점이 여러 개일수록 오히려 빠르다. 영상 파일은 작업이 끝나면 RUN_DIR째로 지운다.

🔴 2026-11-23: 480p → **1080p**(사용자 결정 · agents 계획 `2026-11-23-보고서정렬-월가아재갱신_최초지시.md` D4).
   480p 프레임을 크롭하면 그림이 658×480 이라 웹 본문 폭(1120px)에서 1.7배로 늘어나 슬라이드 글자가
   뭉갰다(사용자 지적 「이미지가 깨져있네」). 같은 영상 형식(mp4 DASH 영상 전용 · avc1)의 상위 화질이라
   받기 경로는 그대로다. 크기 실측 = 48분 영상 137번 88MB(480p 22MB) — 정지 화면이 많아 작다.
   몽타주·정착검사·접촉시트는 전부 비율로 줄여 쓰므로(`scale=…:-1`) 따로 고칠 곳이 없다.

🔴 두 레포(agents·stock_monitor) 공통 파일 — 바이트 단위로 같게 유지(레포 고유 값은 `_repo.py` · `_common.py` 머리말).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import time

from _common import NO_WINDOW, ensure_dir, find_ffmpeg, mmss_to_sec, ytdlp_cmd, run_path

NARROW = dict(before=6, offsets=(4, 12, 20, 28, 36))
WIDE = dict(before=12, offsets=(5, 14, 23, 32, 41, 50))
# 🔴 오프셋 0 은 정각 전용이다 — NARROW·WIDE 에 0 을 넣으면 조립 단계(finalize)가 정각으로 오인할 수 있다
EXACT = dict(before=0, offsets=(0,))
FORMAT = "137/136/135/best[height<=1080]"


def ensure_video(vid: str, vdir) -> str | None:
    """영상을 1080p로 한 번만 받아 경로를 돌려준다(이미 있으면 재사용 · 없으면 720p·480p 순으로 내린다)."""
    dst = vdir / f"{vid}.mp4"
    if dst.exists():
        return str(dst)
    subprocess.run(
        [*ytdlp_cmd(), "--quiet", "--no-warnings", "--no-part",
         "-f", FORMAT, "-o", str(dst), f"https://www.youtube.com/watch?v={vid}"],
        check=False, creationflags=NO_WINDOW,
    )
    time.sleep(1.0)  # 429 회피
    return str(dst) if dst.exists() else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wide", action="store_true", help="넓은 창+촘촘한 오프셋(차트 재점검)")
    ap.add_argument("--only", default=None, help="쉼표구분 slug 목록만 캡처")
    ap.add_argument("--force", action="store_true", help="기존 프레임 삭제 후 재캡처")
    ap.add_argument("--exact", action="store_true", help="timecode 정각 한 장 + exact_times.json 기록(정답지 경로)")
    args = ap.parse_args()
    cfg = EXACT if args.exact else WIDE if args.wide else NARROW

    ff, _ = find_ffmpeg()
    out = ensure_dir(run_path("frames"))
    vdir = ensure_dir(run_path("video"))

    with open(run_path("shots.json"), encoding="utf-8") as f:
        shots = json.load(f)
    if args.only:
        want = set(args.only.split(","))
        shots = [s for s in shots if s["slug"] in want]

    times: dict[str, dict] = {}
    for i, sh in enumerate(shots):
        slug, vid = sh["slug"], sh["id"]
        if args.force:
            for p in glob.glob(str(out / f"{slug}_*.jpg")):
                os.remove(p)
        src = ensure_video(vid, vdir)
        n = 0
        if src:
            start = max(0, mmss_to_sec(sh["timecode"]) - cfg["before"])
            for t in cfg["offsets"]:
                dst = out / f"{slug}_{t:02d}.jpg"
                # 🔴 정각은 늘 다시 뜬다 — timecode 를 고친 뒤 옛 _00 을 재사용하면 그림과 기록 초가 갈린다
                if dst.exists() and not args.force and not args.exact:
                    n += 1
                    continue
                if args.exact:
                    # 🔴 먼저 지운다 — ffmpeg 가 실패하면(시각이 영상 길이 밖 등) "-y" 여도 옛 파일이 그대로 남아
                    #    「옛 그림 + 새 기록 초」가 된다(2026-11-18 오퍼스 검토 · ffmpeg 8.1.1 실측)
                    dst.unlink(missing_ok=True)
                subprocess.run(
                    [ff, "-hide_banner", "-loglevel", "error", "-ss", str(start + t),
                     "-i", src, "-vframes", "1", "-q:v", "2", "-y", str(dst)],
                    check=False, creationflags=NO_WINDOW,
                )
                if dst.exists():
                    n += 1
        print(f"[{i+1}/{len(shots)}] {slug}\t{vid}\t{'ok' if src else 'NO_VIDEO'}\tframes={n}")
        if args.exact:
            # 실패한 slug 은 None 으로 표시해 아래 병합에서 옛 기록까지 지운다(그림이 없는데 초만 남지 않게)
            times[slug] = {"video_id": vid, "seconds": mmss_to_sec(sh["timecode"])} if n else None

    if args.exact:
        # --only 로 몇 건만 다시 떠도 다른 slug 기록은 남긴다(settle_report.json 과 같은 이유)
        tp = run_path("exact_times.json")
        try:
            merged = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else {}
        except ValueError:
            merged = None
        if not isinstance(merged, dict):
            # 깨진 기록을 고치려고 다시 뜨는 것이 처방인데 여기서 죽으면 고칠 길이 없다 — 새로 쓴다.
            # 빠진 slug 은 조립 단계(finalize)가 🔴 TIME 으로 잡는다(2026-11-18 Codex 검토 C4)
            print("🔴 exact_times.json 형식 오류 — 이번에 뜬 것만으로 새로 쓴다(다른 slug 은 다시 떠야 한다)")
            merged = {}
        failed = [s for s, rec in times.items() if rec is None]
        for s in failed:
            merged.pop(s, None)
        times = {s: rec for s, rec in times.items() if rec is not None}
        merged.update(times)
        if failed:
            print(f"🔴 정각 캡처 실패 {len(failed)}건(기록 지움): {','.join(failed)}")
        # 🔴 임시 파일에 다 쓴 뒤 바꿔 끼운다 — 쓰다 끊기면 반쪽 JSON 이 남아 다음 조립이 깨진다(2026-11-18 Codex 검토 C4)
        tmp = tp.with_name(tp.name + ".tmp")
        tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
        os.replace(tmp, tp)
        print(f"exact_times.json {len(times)}건 기록(누적 {len(merged)}건)")
        if failed:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
