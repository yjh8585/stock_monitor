"""shots.json 기반 프레임 캡처 — 영상을 480p로 한 번씩 받아 두고 지점별 프레임 추출.

입력: RUN_DIR/shots.json = [{"slug","id","timecode":"MM:SS"}, ...]
출력: RUN_DIR/video/<id>.mp4  (영상당 1회 다운로드, 재실행 시 재사용)
     RUN_DIR/frames/<slug>_<offset>.jpg  (offset = 창 시작 기준 초, 몽타주가 좌→우로 배열)

usage: python capture.py                 # 기본(창 ±6초/40초, 오프셋 5개)
       python capture.py --wide          # 넓은 창(±12초/58초, 오프셋 6개) — 차트 재점검용
       python capture.py --only v6_manheim_correlation,v4_baden_factory_map
       python capture.py --exact         # timecode 그 시각 한 장(<slug>_00.jpg) + frame_times.json 기록

--exact 는 timecode 를 접촉 시트 정답지(scan.py)에서 «눈으로 확인한» 시각으로 적었을 때 쓴다.
자막에서 추정한 시각은 적중 29~40%라(2026-10-27 실측) 창을 넓게 훑어야 하지만, 정답지 시각은
이미 화면을 본 값이라 창이 필요 없다. 절대 시각을 frame_times.json 에 바로 남겨
settle.py --check 가 사람 손 기록 없이 돈다(오프셋만 남기면 창 시작을 역산하다 틀린다).

🔴 2026-08-25: 구간 다운로드(`--download-sections`)를 버렸다. 유튜브가 통합 포맷 18을 내리면서
   android_vr 클라이언트 URL만 남았고 ffmpeg가 그 URL에서 403을 받아 **모든 캡처가 0장**이 됐다
   (그 전에는 조용히 멈춰 진행이 안 됐다). 영상 전체를 480p로 받으면 8~20분 영상이 30~60MB·수 초라
   지점이 여러 개일수록 오히려 빠르다. 영상 파일은 작업이 끝나면 RUN_DIR째로 지운다.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time

from _common import ensure_dir, find_ffmpeg, mmss_to_sec, run_path

NARROW = dict(before=6, offsets=(4, 12, 20, 28, 36))
WIDE = dict(before=12, offsets=(5, 14, 23, 32, 41, 50))
EXACT = dict(before=0, offsets=(0,))
FORMAT = "135/134/best[height<=480]"


def ensure_video(vid: str, vdir) -> str | None:
    """영상을 480p로 한 번만 받아 경로를 돌려준다(이미 있으면 재사용)."""
    dst = vdir / f"{vid}.mp4"
    if dst.exists():
        return str(dst)
    subprocess.run(
        [sys.executable, "-m", "yt_dlp", "--quiet", "--no-warnings", "--no-part",
         "-f", FORMAT, "-o", str(dst), f"https://www.youtube.com/watch?v={vid}"],
        check=False,
    )
    time.sleep(1.0)  # 429 회피
    return str(dst) if dst.exists() else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wide", action="store_true", help="넓은 창+촘촘한 오프셋(차트 재점검)")
    ap.add_argument("--only", default=None, help="쉼표구분 slug 목록만 캡처")
    ap.add_argument("--force", action="store_true", help="기존 프레임 삭제 후 재캡처")
    ap.add_argument("--exact", action="store_true", help="timecode 정각 한 장 + frame_times.json 기록")
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
                if dst.exists() and not args.force:
                    n += 1
                    continue
                subprocess.run(
                    [ff, "-hide_banner", "-loglevel", "error", "-ss", str(start + t),
                     "-i", src, "-vframes", "1", "-q:v", "2", "-y", str(dst)],
                    check=False,
                )
                if dst.exists():
                    n += 1
        print(f"[{i+1}/{len(shots)}] {slug}\t{vid}\t{'ok' if src else 'NO_VIDEO'}\tframes={n}")
        if args.exact and n:
            times[slug] = {"video_id": vid, "seconds": mmss_to_sec(sh["timecode"])}

    if args.exact:
        # --only 로 몇 건만 다시 떠도 다른 slug 기록은 남긴다(settle.py 와 같은 이유)
        tp = run_path("frame_times.json")
        merged = json.loads(tp.read_text(encoding="utf-8")) if tp.exists() else {}
        merged.update(times)
        tp.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"frame_times.json {len(times)}건 기록")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
