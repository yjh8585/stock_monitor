"""그림 자리 확정용 미리보기 — 지정 시각(과 뒤 몇 초)의 프레임을 떠서 가로로 붙인다.

2026-11-17 stock_monitor 회차 폴더에서 짠 것을 레포 도구로 올렸다(2026-11-18 agents 로 · 교차 반영 C15 · 정답지 경로).
정답지로 고른 시각이 화면과 맞는지, 차오르는 도중이 아닌지(규칙 문서 §2-A)를
몇 초 뒤까지 한 장으로 보고 고르는 데 쓴다(정답지 확정 지시서 — 레포마다 파일 이름이 다르다).
여기 결과는 판단용이다 — 캡처 확정본은 `capture.py --exact` 가 같은 시각에서 다시 뜬다.

usage: python scripts/yt_report/grab.py <key> <slug> <M:SS|H:MM:SS> [--after 0,3,6]   (회차 폴더는 YT_RUN_DIR)
결과:  RUN_DIR/preview/<key>/<slug>.jpg (오프셋 순서대로 좌→우) — Read 로 연다.
영상은 RUN_DIR/video/<영상 ID>.mp4 (scan.py·capture.py 가 받아 둔 것)를 쓴다.

🔴 두 레포(agents·stock_monitor) 공통 파일 — 바이트 단위로 같게 유지(레포 고유 값은 `_repo.py` · `_common.py` 머리말).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from _common import NO_WINDOW, ensure_dir, find_ffmpeg, mmss_to_sec, run_path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("key")
    ap.add_argument("slug")
    ap.add_argument("timecode")
    ap.add_argument("--after", default="0", help="쉼표구분 초 오프셋(예: 0,3,6)")
    a = ap.parse_args()

    vids = {v["key"]: v["id"] for v in json.loads(run_path("videos.json").read_text(encoding="utf-8"))}
    src = run_path("video", f"{vids[a.key]}.mp4")
    out = ensure_dir(run_path("preview", a.key)) / f"{a.slug}.jpg"
    # 실패했을 때 옛 미리보기를 새 것으로 오인하지 않게 — 🔴 영상 없음으로 끝나기 «전»에 지운다
    #   (예전엔 이 줄이 return 2 뒤에 있어 옛 미리보기가 남았다 · 2026-11-18 Codex 검토 C6)
    out.unlink(missing_ok=True)
    if not src.exists():
        print(f"영상 없음: {src} — scan.py 나 capture.py 로 먼저 받는다")
        return 2
    ff, _ = find_ffmpeg()
    base = mmss_to_sec(a.timecode)
    with tempfile.TemporaryDirectory() as tmp:
        parts: list[Path] = []
        missed: list[int] = []
        for o in (int(x) for x in a.after.split(",")):
            p = Path(tmp) / f"{o:02d}.jpg"
            r = subprocess.run([ff, "-hide_banner", "-loglevel", "error", "-ss", str(base + o), "-i", str(src),
                                "-vframes", "1", "-vf", "scale=960:-1", "-q:v", "3", "-y", str(p)],
                               check=False, creationflags=NO_WINDOW)
            if r.returncode == 0 and p.exists() and p.stat().st_size > 0:
                parts.append(p)
            else:
                missed.append(o)
        # 🔴 한 칸이라도 못 뜨면 붙이지 않는다 — 빠진 칸을 건너뛰고 붙이면 n번째 칸이 n번째 오프셋이 아니게 된다
        #    (0,3,6 에서 6 이 영상 끝을 넘으면 2칸짜리가 「0·3·6초」로 읽힌다 · 2026-11-18 Codex 검토 C6 · 합성 영상 재현)
        if missed:
            print(f"FAIL 못 뜬 오프셋 +{',+'.join(map(str, missed))}초(영상 끝을 넘었나) — 시각을 옮겨 다시 뜬다")
            return 1
        if len(parts) == 1:
            shutil.copyfile(parts[0], out)
        elif parts:
            args = [ff, "-hide_banner", "-loglevel", "error"]
            for p in parts:
                args += ["-i", str(p)]
            args += ["-filter_complex", f"hstack=inputs={len(parts)}", "-q:v", "3", "-y", str(out)]
            subprocess.run(args, check=False, creationflags=NO_WINDOW)
    print(out if out.exists() else "FAIL")
    return 0 if out.exists() else 1


if __name__ == "__main__":
    raise SystemExit(main())
