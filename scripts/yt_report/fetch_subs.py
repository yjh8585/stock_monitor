"""videos.json → 한국어 자막 다운로드 + 정제 텍스트 생성.

입력: RUN_DIR/videos.json = [{"key","id", ...}, ...]  (key는 v1,v2… 같은 짧은 식별자)
출력: RUN_DIR/subs/<key>_<id>.ko-orig.vtt, RUN_DIR/text/<key>.txt
     + 각 영상의 글자수·대략 길이 출력(보고서 분량 산정용).

usage: python fetch_subs.py            # RUN_DIR/videos.json 사용
       python fetch_subs.py --langs ko-orig,ko,en
전제: venv에 yt-dlp 설치(`uv pip install yt-dlp` 또는 `pip install yt-dlp`).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys

from _common import RUN_DIR, clean_vtt, ensure_dir, run_path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--langs", default="ko-orig,ko,en", help="yt-dlp 자막 언어 우선순위")
    ap.add_argument("--videos", default=None, help="videos.json 경로(기본 RUN_DIR/videos.json)")
    args = ap.parse_args()

    videos_path = args.videos or run_path("videos.json")
    with open(videos_path, encoding="utf-8") as f:
        videos = json.load(f)

    subs_dir = ensure_dir(run_path("subs"))
    ensure_dir(run_path("text"))

    total = 0
    for v in videos:
        key, vid = v["key"], v["id"]
        subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--skip-download",
             "--write-subs", "--write-auto-subs", "--sub-langs", args.langs,
             "--sub-format", "vtt",
             "-o", str(subs_dir / f"{key}_{vid}.%(ext)s"),
             f"https://www.youtube.com/watch?v={vid}"],
            check=False,
        )
        vtt = subs_dir / f"{key}_{vid}.ko-orig.vtt"
        if not vtt.exists():
            # ko-orig 없으면 ko 폴백
            alt = subs_dir / f"{key}_{vid}.ko.vtt"
            vtt = alt if alt.exists() else None
        if not vtt:
            print(f"{key}\t{vid}\tNO_KO_SUB")
            continue
        body, chars, dur = clean_vtt(vtt)
        (run_path("text", f"{key}.txt")).write_text(body, encoding="utf-8")
        total += chars
        print(f"{key}\t{vid}\t{chars}chars\t~{dur // 60}min")
    print(f"TOTAL\t{total}chars\t(RUN_DIR={RUN_DIR})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
