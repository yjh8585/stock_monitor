"""그림 자리 확정용 미리보기 — 지정 시각(과 뒤 몇 초)의 프레임을 떠서 가로로 붙인다.

사용: YT_RUN_DIR=<회차 폴더> python -X utf8 scripts/yt_report/grab.py <key> <slug> <MM:SS|H:MM:SS> [--after 0,3,6]
결과: <회차>/preview/<key>/<slug>.jpg (오프셋 순서대로 좌→우) — Read 로 연다.
캡처 확정본은 capture.py --exact 로 같은 시각에서 다시 뜬다(여기 결과는 판단용).

2026-11-17 회차 폴더에서 짠 것을 레포 도구로 올렸다 — 정답지(prompts/answer.md)로 고른 시각이
화면과 맞는지, 차오르는 도중이 아닌지(§2-A) 몇 초 뒤까지 한 장으로 보고 고르는 데 쓴다(prompts/final.md).
영상은 capture.py 가 받아 둔 <회차>/video/<영상 ID>.mp4 를 쓴다.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

from _common import find_ffmpeg, mmss_to_sec, run_path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("slug")
    ap.add_argument("timecode")
    ap.add_argument("--after", default="0", help="쉼표구분 초 오프셋(예: 0,3,6)")
    a = ap.parse_args()

    vids = {v["key"]: v["id"] for v in json.load(open(run_path("videos.json"), encoding="utf-8"))}
    src = run_path("video", f"{vids[a.key]}.mp4")
    if not os.path.exists(src):
        print(f"영상 없음: {src} — capture.py 로 먼저 받는다")
        return 2
    ff, _ = find_ffmpeg()
    base = mmss_to_sec(a.timecode)
    offs = [int(x) for x in a.after.split(",")]
    tmp = tempfile.mkdtemp()
    parts = []
    for o in offs:
        p = os.path.join(tmp, f"{o:02d}.jpg")
        subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-ss", str(base + o), "-i", str(src),
                        "-vframes", "1", "-vf", "scale=960:-1", "-q:v", "3", "-y", p], check=False)
        if os.path.exists(p):
            parts.append(p)
    outdir = run_path("preview", a.key)
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, f"{a.slug}.jpg")
    if len(parts) == 1:
        os.replace(parts[0], out)
    elif parts:
        args = [ff, "-hide_banner", "-loglevel", "error"]
        for p in parts:
            args += ["-i", p]
        args += ["-filter_complex", f"hstack=inputs={len(parts)}", "-q:v", "3", "-y", out]
        subprocess.run(args, check=False)
    print(out if os.path.exists(out) else "FAIL")
    return 0 if os.path.exists(out) else 1


if __name__ == "__main__":
    sys.exit(main())
