"""shots.json 기반 프레임 캡처 — 영상을 480p로 한 번씩 받아 두고 지점별 프레임 추출.

입력: RUN_DIR/shots.json = [{"slug","id","timecode":"MM:SS"}, ...]
출력: RUN_DIR/video/<id>.mp4  (영상당 1회 다운로드, 재실행 시 재사용)
     RUN_DIR/frames/<slug>_<offset>.jpg  (offset = 창 시작 기준 초, 몽타주가 좌→우로 배열)

usage: python capture.py                 # 기본(창 ±6초/40초, 오프셋 5개)
       python capture.py --wide          # 넓은 창(±12초/58초, 오프셋 6개) — 차트 재점검용
       python capture.py --only v6_manheim_correlation,v4_baden_factory_map

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
    args = ap.parse_args()
    cfg = WIDE if args.wide else NARROW

    ff, _ = find_ffmpeg()
    out = ensure_dir(run_path("frames"))
    vdir = ensure_dir(run_path("video"))

    with open(run_path("shots.json"), encoding="utf-8") as f:
        shots = json.load(f)
    if args.only:
        want = set(args.only.split(","))
        shots = [s for s in shots if s["slug"] in want]

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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
