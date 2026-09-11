"""애니메이션이 **다 차오른 뒤**의 프레임인지 기계로 판정한다 (토큰 0).

## 무엇을 막는가 (2026-09-11 사용자 지적 — "이런 문제가 되게 빈번함")

유튜브 해설 영상의 도해는 **한 번에 그려지지 않는다.** 막대가 하나씩 자라고 표의 칸이
차례로 채워진다. 그 «도중» 을 캡처하면 캡션은 세 회사를 비교한다고 하는데 그림에는
한 회사만 있는 글이 나간다. 실제 사고:

- 리포트 117 — 체리·BYD·지리 수출량 비교인데 **체리 막대만** 찬 프레임
- 리포트 122 — 폭스바겐·도요타 「직원 수 대비 판매량」인데 **직원 수 행만** 찬 프레임
- 이번 회차 v1 — 1분기 실적표의 **영업이익 행이 빈** 프레임, 부문별 총이익률의 **SI·ITO 칸이 빈** 프레임

사람 눈으로는 「표가 보인다」로 통과하기 쉽다. 표가 실제로 보이기 때문이다.
그래서 **잉크가 아직 늘고 있는가**를 기계가 본다.

## 원리

같은 장면 안에서 도해가 그려지는 동안은 **배경이 아닌 픽셀(= 잉크)이 단조 증가**한다.
선택한 시각 t 이후 몇 초를 훑어, **같은 장면인데 잉크가 유의미하게 더 많은 프레임**이
있으면 t 는 「차오르는 중」이다 → 그 더 늦은 시각을 추천한다.

장면이 바뀌면 잉크 비교가 무의미하므로, 프레임 간 평균 절대차로 **장면 전환을 먼저 가른다.**

usage:
    python settle.py --check            # RUN_DIR/frame_times.json 의 모든 선택 프레임 검사
    python settle.py --check --only v1_q1_2026,v2_chery_russia
    python settle.py --probe --video lb92luVHn-o --at 11:03   # 한 지점만 진단표로
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from _common import find_ffmpeg, mmss_to_sec, run_path

# ── 임계값 (실측으로 정한 값 — 고칠 때는 근거를 함께 남길 것) ──────────────
#
# SCENE_DIFF: 프레임 평균 절대차(0~255)가 이보다 크면 **다른 장면**으로 본다.
#   같은 도해가 채워지는 변화는 화면 일부라 10 을 넘기 어렵고,
#   컷이 바뀌면 20~60 이 나온다(2026-09-11 실측).
SCENE_DIFF = 14.0
# INK_GROWTH: 잉크가 이 비율 이상 더 많으면 「아직 차오르는 중이었다」로 본다.
#   표 한 행이 채워지면 3~15% 늘어난다. 3% 는 자막 한 줄이 바뀌어도 나올 수 있어
#   **5%** 를 하한으로 둔다.
INK_GROWTH = 1.05
# 뒤로 몇 초까지 훑는가. 도해는 대개 2~6초에 걸쳐 완성된다.
LOOKAHEAD = 8.0
STEP = 0.5


def grab(ff: str, video: Path, t: float, out: Path) -> bool:
    r = subprocess.run(
        [ff, "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{t:.2f}",
         "-i", str(video), "-vframes", "1", "-vf", "scale=480:-1", str(out)],
        check=False, capture_output=True,
    )
    return r.returncode == 0 and out.exists()


def load(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("L"), dtype=np.float32)


# 자막·고지 띠를 잘라 낸다.
#
# 🔴 2026-09-11 실측: 이걸 안 자르면 **오탐이 절반**이다. 도해는 그대로인데 화자의
#    자막 한 줄이 길어지기만 해도 잉크가 5~8% 늘어 「아직 차오르는 중」으로 잡힌다
#    (v1_mix_shift · v1_h1_2026 이 그렇게 걸렸다). 도해는 화면 가운데 위쪽에 있고
#    자막은 아래에, 채널 로고·투자고지는 위아래 끝에 있으므로 세로를 잘라 낸다.
TOP_CROP = 0.06
BOTTOM_CROP = 0.24


def _body(a: np.ndarray) -> np.ndarray:
    h = a.shape[0]
    return a[int(h * TOP_CROP): int(h * (1.0 - BOTTOM_CROP)), :]


def ink(a: np.ndarray) -> float:
    """배경이 아닌 픽셀의 비율 (자막 띠 제외).

    배경색을 고정값(흰/검)으로 가정하지 않는다 — 딥다이브는 파란 바탕, 언더스탠딩은
    흰 슬라이드, 대신TV 는 남색이다. **최빈 밝기에서 멀리 떨어진 픽셀**을 잉크로 센다.
    """
    a = _body(a)
    hist, _ = np.histogram(a, bins=32, range=(0, 256))
    mode = (int(np.argmax(hist)) + 0.5) * 8.0
    return float(np.mean(np.abs(a - mode) > 28.0))


def settle_at(ff: str, video: Path, t: float, tmp: Path) -> dict:
    """시각 t 가 「다 찬 뒤」인지 판정하고, 아니면 추천 시각을 돌려준다."""
    base_p = tmp / "base.jpg"
    if not grab(ff, video, t, base_p):
        return {"ok": False, "reason": "프레임 추출 실패"}
    base = load(base_p)
    base_ink = ink(base)

    best_t, best_ink = t, base_ink
    trail = []
    probe = tmp / "probe.jpg"
    dt = STEP
    while dt <= LOOKAHEAD + 1e-6:
        if not grab(ff, video, t + dt, probe):
            break
        a = load(probe)
        if a.shape != base.shape:
            break
        diff = float(np.mean(np.abs(_body(a) - _body(base))))
        if diff > SCENE_DIFF:
            trail.append({"dt": dt, "scene_change": True})
            break  # 장면이 바뀌었다 — 그 뒤는 다른 그림이라 비교 대상이 아니다
        cur = ink(a)
        trail.append({"dt": dt, "diff": round(diff, 2), "ink": round(cur, 5)})
        if cur > best_ink:
            best_ink, best_t = cur, t + dt
        dt += STEP

    grew = best_ink > base_ink * INK_GROWTH
    return {
        "ok": not grew,
        "base_ink": round(base_ink, 5),
        "best_ink": round(best_ink, 5),
        "growth": round(best_ink / base_ink, 3) if base_ink else None,
        "suggest_seconds": round(best_t, 1) if grew else None,
        "suggest_delta": round(best_t - t, 1) if grew else 0.0,
        "trail": trail,
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="frame_times.json 전량 검사")
    ap.add_argument("--only", default=None, help="쉼표구분 slug 만")
    ap.add_argument("--probe", action="store_true", help="단일 지점 진단")
    ap.add_argument("--video", default=None, help="--probe 용 영상 id")
    ap.add_argument("--at", default=None, help="--probe 용 MM:SS")
    args = ap.parse_args()

    ff, _ = find_ffmpeg()
    vdir = run_path("video")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        if args.probe:
            if not args.video or not args.at:
                print("--probe 에는 --video 와 --at 가 필요합니다")
                return 2
            res = settle_at(ff, vdir / f"{args.video}.mp4", mmss_to_sec(args.at), tmp)
            print(json.dumps(res, ensure_ascii=False, indent=1))
            return 0

        times = json.loads(run_path("frame_times.json").read_text(encoding="utf-8"))
        if args.only:
            want = set(args.only.split(","))
            times = {k: v for k, v in times.items() if k in want}

        out, bad = {}, []
        for slug, meta in sorted(times.items()):
            video = vdir / f"{meta['video_id']}.mp4"
            if not video.exists():
                print(f"  SKIP {slug}\t영상 없음")
                continue
            res = settle_at(ff, video, float(meta["seconds"]), tmp)
            res.pop("trail", None)
            out[slug] = res
            if not res["ok"]:
                bad.append(slug)
                print(f"  🔴 {slug}\t잉크 {res['growth']}배 더 참 "
                      f"→ +{res['suggest_delta']}초({res['suggest_seconds']}s) 권장")
            else:
                print(f"  OK  {slug}")

        # 🔴 `--only` 로 몇 건만 돌렸을 때 **기존 기록을 덮어쓰면 안 된다.**
        #    2026-09-11 에 그렇게 해서 51건짜리 기록이 8건으로 줄었고,
        #    `verify_yt_report.py` 가 「정착 검사 기록이 없다」로 13건을 잡아냈다.
        rp = run_path("settle_report.json")
        merged = {}
        if rp.exists():
            merged = json.loads(rp.read_text(encoding="utf-8"))
        merged.update(out)
        rp.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n검사 {len(out)}건 · 차오르는 중 {len(bad)}건")
        if bad:
            print("의심 slug: " + ",".join(bad))
        return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
