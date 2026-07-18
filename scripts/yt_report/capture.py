"""shots.json 기반 프레임 캡처 — 각 지점 구간만 다운로드 후 여러 프레임 추출.

입력: RUN_DIR/shots.json = [{"slug","id","timecode":"MM:SS"}, ...]
출력: RUN_DIR/frames/<slug>_<offset>.jpg  (offset = 오프셋 초, 몽타주가 좌→우로 배열)
순차 다운로드(유튜브 429 회피). 이미 클립 있으면 스킵(--force로 재캡처).

usage: python capture.py                 # 기본(창 ±6초/40초, 오프셋 5개)
       python capture.py --wide          # 넓은 창(±12초/58초, 오프셋 6개) — 차트 재점검용
       python capture.py --only v6_manheim_correlation,v4_baden_factory_map
"""
from __future__ import annotations

import argparse
import glob
import json
import subprocess
import sys
import time

from _common import ensure_dir, find_ffmpeg, hhmmss, mmss_to_sec, run_path

NARROW = dict(before=6, length=40, offsets=(4, 12, 20, 28, 36))
WIDE = dict(before=12, length=58, offsets=(5, 14, 23, 32, 41, 50))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wide", action="store_true", help="넓은 창+촘촘한 오프셋(차트 재점검)")
    ap.add_argument("--only", default=None, help="쉼표구분 slug 목록만 캡처")
    ap.add_argument("--force", action="store_true", help="기존 클립/프레임 삭제 후 재캡처")
    args = ap.parse_args()
    cfg = WIDE if args.wide else NARROW

    _, ffbin = find_ffmpeg()
    ff = str(ffbin) + "/ffmpeg.exe" if sys.platform == "win32" else str(ffbin) + "/ffmpeg"
    out = ensure_dir(run_path("frames"))

    with open(run_path("shots.json"), encoding="utf-8") as f:
        shots = json.load(f)
    if args.only:
        want = set(args.only.split(","))
        shots = [s for s in shots if s["slug"] in want]

    for i, sh in enumerate(shots):
        slug, vid = sh["slug"], sh["id"]
        clip = out / f"{slug}.mp4"
        if args.force:
            for p in glob.glob(str(out / f"{slug}_*.jpg")):
                __import__("os").remove(p)
            if clip.exists():
                clip.unlink()
        if not clip.exists():
            start = max(0, mmss_to_sec(sh["timecode"]) - cfg["before"])
            sect = f"{hhmmss(start)}-{hhmmss(start + cfg['length'])}"
            subprocess.run(
                [sys.executable, "-m", "yt_dlp", "--quiet", "--no-warnings",
                 "--ffmpeg-location", str(ffbin),
                 "-f", "18/best[height<=480]/best",
                 "--download-sections", f"*{sect}", "--force-keyframes-at-cuts",
                 "-o", str(clip), f"https://www.youtube.com/watch?v={vid}"],
                check=False,
            )
            time.sleep(1.5)  # 429 회피
        ok = clip.exists()
        n = 0
        if ok:
            for t in cfg["offsets"]:
                dst = out / f"{slug}_{t:02d}.jpg"
                subprocess.run(
                    [ff, "-hide_banner", "-loglevel", "error", "-ss", str(t),
                     "-i", str(clip), "-vframes", "1", "-q:v", "2", str(dst)],
                    check=False,
                )
                if dst.exists():
                    n += 1
        print(f"[{i+1}/{len(shots)}] {slug}\t{vid}\t{'ok' if ok else 'NO_CLIP'}\tframes={n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
