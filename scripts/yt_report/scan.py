"""영상 전체를 일정 간격으로 훑어 접촉 시트(격자 이미지)를 만든다 — 「정답지」 경로의 첫 단계.

2026-10-27 stock_monitor 에서 시작해 2026-11-18 agents 로 옮겼다(교차 반영 C15).
자막으로 추정한 캡처 시각은 화면과 5~15초 어긋난다(stock_monitor 2026-10-27 비교: 그림 자리 적중 29~40%).
그래서 그림 자리를 고르기 «전»에 영상 전체를 훑어 차트·도해가 실제로 뜬 시각을 먼저 적고(정답지),
본문의 그림 자리를 거기에 맞춘다 — 차트 누락 점검도 같은 표로 끝난다.

입력: RUN_DIR/videos.json · RUN_DIR/video/<id>.mp4 (없으면 capture.py 와 같은 1080p 로 받는다)
출력: RUN_DIR/scan/<key>/NNNN.jpg · RUN_DIR/sheets/<key>/sheet_NN.jpg (6×4 = 24칸)
     RUN_DIR/sheets/<key>/index.tsv (시트 · 칸 · 시각 — 환산식을 손으로 쓰지 않는다)

usage: python scripts/yt_report/scan.py v1,v3            # 기본 10초 간격
       python scripts/yt_report/scan.py v5 --every 5     # 촘촘하게

🔴 칸 → 시각은 index.tsv 를 본다. `fps=1/N` 필터는 구간 «가운데»를 뽑아 칸 k(0부터)의 시각이
   k×N + N/2 초다(`cell_seconds`). stock_monitor 2026-09-11 에 구간 시작으로 안내했다가 두 조사자가
   이른 화면을 짚었다. 2026-11-18 ffmpeg 8.1.1 합성 영상(밝기=시각)으로 다시 쟀다 — N=10 → 4.8·14.8·24.8초.

🔴 두 레포(agents·stock_monitor) 공통 파일 — 바이트 단위로 같게 유지(레포 고유 값은 `_repo.py` · `_common.py` 머리말).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from _common import NO_WINDOW, ensure_dir, find_ffmpeg, run_path
from capture import ensure_video

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

COLS, ROWS = 6, 4


def cell_seconds(k: int, every: int) -> int:
    """칸 k(0부터 · 영상 전체 통번호)가 담은 화면의 시각(초). fps=1/N 은 구간 가운데를 뽑는다."""
    return k * every + every // 2


def index_rows(n: int, every: int, sheet_ok: list[bool]) -> list[str]:
    """index.tsv 의 줄 — 🔴 실제로 만든 시트의 칸만 적는다.

    시트 생성이 실패해도 칸을 적으면 판독자가 없는 시트의 칸 시각을 믿는다(2026-11-18 Codex 검토 C5 ·
    합성 영상 + 시트 실패 주입으로 재현: 시트 0장인데 index.tsv 6칸 · exit 0).
    """
    per = COLS * ROWS
    rows = ["sheet\tcell\ttime\tfile"]
    for s, ok in enumerate(sheet_ok):
        if not ok:
            continue
        for c in range(min(per, n - s * per)):
            t = cell_seconds(s * per + c, every)
            # M:SS(분이 60 을 넘어도 그대로) — shots.json timecode 서식과 같다(agents 검사기 verify_yt_reports 가 H:MM:SS 를 막는다)
            rows.append(f"{s + 1}\t{c + 1}\t{t // 60}:{t % 60:02d}\t{s * per + c + 1:04d}.jpg")
    return rows


def video_seconds(src: str) -> float | None:
    """ffprobe 로 영상 길이(초). 못 재면 None(덮음 검사만 건너뛴다 · 0장 검사는 그대로)."""
    _, bindir = find_ffmpeg()
    probe = Path(bindir) / ("ffprobe.exe" if os.name == "nt" else "ffprobe")
    if not probe.exists():
        return None
    r = subprocess.run([str(probe), "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", src],
                       capture_output=True, text=True, check=False, creationflags=NO_WINDOW)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("keys", help="쉼표구분 key 목록(videos.json 의 key)")
    ap.add_argument("--every", type=int, default=10, help="간격(초)")
    args = ap.parse_args()
    if args.every <= 0:
        # 0·음수는 ffmpeg 가 0장을 내 「영상 파일을 지우고 다시」로 잘못 안내됐다(2026-11-18 Codex 검토 C5)
        ap.error("--every 는 1 이상이어야 한다")

    ff, _ = find_ffmpeg()
    vids = {v["key"]: v["id"] for v in json.loads(run_path("videos.json").read_text(encoding="utf-8"))}
    vdir = ensure_dir(run_path("video"))
    per = COLS * ROWS
    bad = 0
    for key in args.keys.split(","):
        if key not in vids:
            print(f"{key}: videos.json 에 없다")
            bad += 1
            continue
        src = ensure_video(vids[key], vdir)
        if not src:
            print(f"{key}: 영상을 못 받았다 ({vids[key]})")
            bad += 1
            continue
        sdir = ensure_dir(run_path("scan", key))
        hdir = ensure_dir(run_path("sheets", key))
        for p in [*sdir.glob("*.jpg"), *hdir.glob("*.jpg")]:
            p.unlink()  # 간격을 바꿔 다시 돌릴 때 옛 칸이 섞이지 않게
        subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-i", src,
                        "-vf", f"fps=1/{args.every},scale=480:-1", "-q:v", "4",
                        str(sdir / "%04d.jpg")], check=False, creationflags=NO_WINDOW)
        n = len(list(sdir.glob("*.jpg")))
        sheet_ok: list[bool] = []
        for s in range((n + per - 1) // per):
            sheet = hdir / f"sheet_{s + 1:02d}.jpg"
            r = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-y",
                                "-start_number", str(s * per + 1), "-i", str(sdir / "%04d.jpg"),
                                "-frames:v", "1", "-vf", f"scale=400:-1,tile={COLS}x{ROWS}",
                                str(sheet)], check=False, creationflags=NO_WINDOW)
            sheet_ok.append(r.returncode == 0 and sheet.exists())
        rows = index_rows(n, args.every, sheet_ok)
        (hdir / "index.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8", newline="\n")
        print(f"{key}: 프레임 {n}장 · 시트 {sum(sheet_ok)}장 · 칸 시각 = sheets/{key}/index.tsv")
        if not all(sheet_ok):
            print(f"🔴 {key}: 시트 생성 실패 {sheet_ok.count(False)}장 — 그 칸은 index.tsv 에서 뺐다")
            bad += 1
        # 🔴 0장·덜 덮음은 실패다 — 판독 지시문이 「A 가 한 칸도 없을 수 있다」고 하므로, 끊긴 영상(--no-part 라
        #    반쪽 mp4 가 남는다)이 「차트 없음」으로 읽힌다(2026-11-18 오퍼스 검토)
        dur = video_seconds(src)
        if n == 0 or (dur and n * args.every < dur - 2 * args.every):
            print(f"🔴 {key}: 덮은 구간 {n * args.every}초 / 영상 {dur or '?'}초 — 영상 파일을 지우고 다시 돌릴 것")
            bad += 1
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
