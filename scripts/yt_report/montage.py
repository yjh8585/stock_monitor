"""slug별 후보 프레임을 가로 몽타주로 합쳐 vision 선별용 1장으로.

RUN_DIR/frames/<slug>_*.jpg 를 오프셋 오름차순으로 hstack → RUN_DIR/montages/<slug>.jpg.
좌→우 = 오프셋 오름차순(라벨 없음 — Windows ffmpeg drawtext는 fontconfig 부재로 크래시).

usage: python montage.py                    # RUN_DIR/shots.json 전체
       python montage.py v6_manheim_correlation v4_baden_factory_map
"""
from __future__ import annotations

import glob
import json
import re
import subprocess
import sys

from _common import ensure_dir, find_ffmpeg, run_path

_OFF = re.compile(r"_(\d+)\.jpg$")


def frames_for(slug: str) -> list[str]:
    paths = glob.glob(str(run_path("frames", f"{slug}_*.jpg")))
    return sorted(paths, key=lambda p: int(_OFF.search(p).group(1)) if _OFF.search(p) else 0)


def make(slug: str, ff: str) -> None:
    inputs = frames_for(slug)
    if not inputs:
        print(f"{slug}\tNO_FRAMES")
        return
    cmd = [ff, "-hide_banner", "-loglevel", "error"]
    for p in inputs:
        cmd += ["-i", p]
    filters = [f"[{i}:v]scale=420:-2[v{i}]" for i in range(len(inputs))]
    filters.append("".join(f"[v{i}]" for i in range(len(inputs))) + f"hstack=inputs={len(inputs)}[out]")
    cmd += ["-filter_complex", ";".join(filters), "-map", "[out]",
            str(run_path("montages", f"{slug}.jpg"))]
    r = subprocess.run(cmd, check=False, capture_output=True)
    print(f"{slug}\t{'OK' if r.returncode == 0 else 'ERR'}\t{len(inputs)}frames")


def main() -> int:
    ff_exe, ffbin = find_ffmpeg()
    ff = ff_exe
    ensure_dir(run_path("montages"))
    if len(sys.argv) > 1:
        slugs = sys.argv[1:]
    else:
        with open(run_path("shots.json"), encoding="utf-8") as f:
            slugs = [s["slug"] for s in json.load(f)]
    for slug in slugs:
        make(slug, ff)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
