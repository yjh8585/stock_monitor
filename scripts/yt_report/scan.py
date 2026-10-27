"""영상 전체를 일정 간격으로 훑어 접촉 시트(격자 이미지)를 만든다 — 「시각자료 정답지」용.

자막으로 추정한 캡처 시각은 화면과 5~15초 어긋난다(2026-10-27 비교: 그림 자리 약속 적중 29~40%).
그래서 그림 자리를 고르기 «전»에 영상 전체를 훑어 차트·도해가 실제로 뜬 시각을 먼저 적고
(정답지), 본문의 그림 자리를 거기에 맞춘다 — 차트 누락 점검도 같은 표로 끝난다.

입력: RUN_DIR/videos.json · RUN_DIR/video/<id>.mp4 (capture.py 와 같은 480p 파일)
출력: RUN_DIR/scan/<key>/NNNN.jpg · RUN_DIR/sheets/<key>/sheet_NN.jpg (6×4 = 24칸)
     RUN_DIR/sheets/<key>/index.tsv (시트 · 칸 · 시각 — 환산식을 손으로 쓰지 않는다)

usage: python scan.py v1,v3            # 기본 10초 간격
       python scan.py v5 --every 5     # 촘촘하게

🔴 칸 → 시각은 index.tsv 를 본다. `fps=1/N` 필터는 구간 «중앙»을 뽑아 칸 k(0부터)의 시각이
   k×N + N/2 초다 — 2026-09-11 에 (N-1)×20 으로 안내했다가 두 조사자가 10초 이른 화면을 짚었다.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess

from _common import ensure_dir, find_ffmpeg, run_path

COLS, ROWS = 6, 4


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", help="쉼표구분 key 목록(videos.json 의 key)")
    ap.add_argument("--every", type=int, default=10, help="간격(초)")
    args = ap.parse_args()

    ff, _ = find_ffmpeg()
    vids = {v["key"]: v["id"] for v in json.loads(run_path("videos.json").read_text(encoding="utf-8"))}
    per = COLS * ROWS
    for key in args.keys.split(","):
        src = run_path("video", f"{vids[key]}.mp4")
        if not src.exists():
            print(f"{key}: 영상 없음 — capture.py 로 먼저 받을 것 ({src.name})")
            continue
        sdir = ensure_dir(run_path("scan", key))
        hdir = ensure_dir(run_path("sheets", key))
        for p in glob.glob(str(sdir / "*.jpg")) + glob.glob(str(hdir / "*.jpg")):
            os.remove(p)  # 간격을 바꿔 다시 돌릴 때 옛 칸이 섞이지 않게
        subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-i", str(src),
                        "-vf", f"fps=1/{args.every},scale=480:-1", "-q:v", "4",
                        str(sdir / "%04d.jpg")], check=False)
        n = len(glob.glob(str(sdir / "*.jpg")))
        rows = ["sheet\tcell\ttime"]
        for s in range((n + per - 1) // per):
            subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y",
                            "-start_number", str(s * per + 1), "-i", str(sdir / "%04d.jpg"),
                            "-frames:v", "1", "-vf", f"scale=400:-1,tile={COLS}x{ROWS}",
                            str(hdir / f"sheet_{s + 1:02d}.jpg")], check=False)
            for c in range(min(per, n - s * per)):
                t = (s * per + c) * args.every + args.every // 2
                rows.append(f"{s + 1}\t{c + 1}\t{t // 60}:{t % 60:02d}")
        (hdir / "index.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8")
        print(f"{key}: 프레임 {n}장 · 시트 {(n + per - 1) // per}장 · 칸 시각 = sheets/{key}/index.tsv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
