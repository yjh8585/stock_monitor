"""플레이어 오버레이(진행자 캠·컨트롤 등) 우측 패널 크롭 → png_new 덮어쓰기.

언더스탠딩 등 '슬라이드 + PiP 진행자 패널' 레이아웃은 우측 ~28%를 잘라 도해만 남긴다.
RUN_DIR/selected.json에서 지정 prefix의 slug을 frames/<slug>_<offset>.jpg 에서 좌측 N% 크롭.

usage: python crop.py --prefix v4_,v6_            # 좌측 72% (기본)
       python crop.py --prefix v5_ --keep 72
       python crop.py --slugs v6_manheim_correlation,v4_baden_factory_map
"""
from __future__ import annotations

import argparse
import json
import subprocess

from _common import ensure_dir, find_ffmpeg, run_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="", help="쉼표구분 slug prefix (예: v4_,v6_)")
    ap.add_argument("--slugs", default="", help="쉼표구분 개별 slug")
    ap.add_argument("--keep", type=int, default=72, help="좌측 보존 비율(퍼센트)")
    args = ap.parse_args()

    ff, _ = find_ffmpeg()
    frames = run_path("frames")
    png = ensure_dir(run_path("png"))
    with open(run_path("selected.json"), encoding="utf-8") as f:
        selected = json.load(f)

    prefixes = tuple(p for p in args.prefix.split(",") if p)
    slugs = set(s for s in args.slugs.split(",") if s)
    crop = f"crop=in_w*{args.keep}/100:in_h:0:0"

    n = 0
    for slug, off in selected.items():
        if not ((prefixes and slug.startswith(prefixes)) or slug in slugs):
            continue
        src = frames / f"{slug}_{int(off):02d}.jpg"
        if not src.exists():
            print(f"  MISS {slug}")
            continue
        r = subprocess.run(
            [ff, "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
             "-vf", crop, str(png / f"{slug}.png")],
            check=False, capture_output=True,
        )
        ok = r.returncode == 0
        n += ok
        print(f"  {'OK ' if ok else 'ERR'} {slug} @ {off}s (keep {args.keep}%)")
    print(f"크롭 {n}장")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
