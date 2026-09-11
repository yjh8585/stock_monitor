"""유튜브·PDF 보고서 산출물 상시 검사 — 게시 전에 돌린다 (토큰 0).

규칙 정본:
  - docs/report-from-youtube.md  (유튜브 경로)
  - docs/report-from-pdf.md      (PDF 경로)
  - report.md §3·§3-A·§4         (본문 형식·분량·렌더 규칙)

**exit 0 이 정상이다.** 위반이 나오면 그것이 회귀다.

무엇을 보는가 — 「사람 눈으로는 통과하는데 화면에서 깨지는 것」만 기계로 잡는다:
  1. 본문에 남은 `[[FRAME:...]]` 토큰 (조립이 덜 됐다)
  2. H1 제목 (제목은 DB 컬럼이다)
  3. 첫머리 인용 블록 누락 (report.md §3-1)
  4. 연도·숫자 앞 백틱 (인라인 코드로 오인돼 인접 마크다운을 삼킨다)
  5. 단독 줄 `<br>` (다음 문단을 HTML 블록으로 삼킨다)
  6. GFM 표의 구분선·빈 줄 누락
  7. 캡션에 나열된 **비교 대상 수**가 2 이상인데 정착 검사 기록이 없는 프레임
     → 🔴 이것이 리포트 117·122 를 낸 결함이다(docs/report-from-youtube.md §2-A)
  8. 이미지 URL 이 공개 Storage URL 인가 (로컬 경로가 새면 깨진다)

usage:
    python scripts/verify_yt_report.py --run scripts/_yt_report/2026-09-11
    python scripts/verify_yt_report.py --run <dir> --strict   # 경고도 실패로
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

TOKEN = re.compile(r"\[\[FRAME:[a-z0-9_]+\]\]")
H1 = re.compile(r"^# ", re.M)
BACKTICK_NUM = re.compile(r"`\d")
LONE_BR = re.compile(r"^[ \t]*<br\s*/?>[ \t]*$", re.M | re.I)
IMG = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
TABLE_ROW = re.compile(r"^\|.*\|\s*$", re.M)

# 캡션에서 「비교 대상」을 세는 표식. 가운뎃점·쉼표·vs 로 나열되면 비교다.
COMPARE_SPLIT = re.compile(r"[·,]|\bvs\.?\b|대비")


class Result:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warns: list[str] = []

    def err(self, msg: str) -> None:
        self.errors.append(msg)
        print(f"  [오류] {msg}")

    def warn(self, msg: str) -> None:
        self.warns.append(msg)
        print(f"  [경고] {msg}")


def check_body(path: Path, r: Result) -> None:
    t = path.read_text(encoding="utf-8")
    name = path.name

    for m in TOKEN.finditer(t):
        r.err(f"{name}: 조립 안 된 토큰 {m.group(0)}")
    if H1.search(t):
        r.err(f"{name}: H1 제목이 있다 — 제목은 posts.title 컬럼이다")
    if not t.lstrip().startswith(">"):
        r.err(f"{name}: 첫머리 한 줄 요약 인용 블록(`>`)이 없다 (report.md §3-1)")
    for m in BACKTICK_NUM.finditer(t):
        s = max(0, m.start() - 20)
        r.err(f"{name}: 숫자 앞 백틱 …{t[s:m.end() + 10]!r}")
    if LONE_BR.search(t):
        r.err(f"{name}: 단독 줄 <br> — 빈 줄로 문단을 나눌 것")

    # 표: 헤더 바로 아래에 구분선이 있는가
    lines = t.split("\n")
    for i, ln in enumerate(lines):
        if not TABLE_ROW.match(ln):
            continue
        prev_is_table = i > 0 and TABLE_ROW.match(lines[i - 1] or "")
        if prev_is_table:
            continue  # 헤더 줄만 본다
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if not re.match(r"^\|[\s:\-|]+\|\s*$", nxt):
            r.err(f"{name}:{i + 1}: 표 헤더 아래 구분선(| --- |)이 없다")
        if i > 0 and lines[i - 1].strip():
            r.warn(f"{name}:{i + 1}: 표 위에 빈 줄이 없다")

    for m in IMG.finditer(t):
        url = m.group(1)
        if not url.startswith("http"):
            r.err(f"{name}: 이미지가 공개 URL 이 아니다 — {url[:60]}")


def check_frames(run: Path, r: Result) -> None:
    batch = run / "batch.json"
    if not batch.exists():
        r.warn("batch.json 이 없어 캡션 검사를 건너뛴다")
        return
    b = json.loads(batch.read_text(encoding="utf-8"))
    settle = {}
    sp = run / "settle_report.json"
    if sp.exists():
        settle = json.loads(sp.read_text(encoding="utf-8"))
    else:
        r.err("settle_report.json 이 없다 — `settle.py --check` 를 돌리지 않았다"
              " (docs/report-from-youtube.md §2-A)")

    selected = {}
    sel = run / "selected.json"
    if sel.exists():
        selected = json.loads(sel.read_text(encoding="utf-8"))

    for rep in b.get("reports", []):
        for f in rep.get("frames", []):
            slug = f["slug"]
            if slug not in selected:
                continue  # 드롭된 프레임은 본문에 안 실린다
            cap = f.get("caption", "")
            if not cap:
                r.err(f"{slug}: 캡션이 비었다")
                continue
            if "출처" not in cap:
                r.warn(f"{slug}: 캡션에 출처 표기가 없다 (report.md §5)")
            # 🔴 비교 캡션은 애니메이션 도중 캡처에 특히 취약하다 — 정착 기록을 요구한다
            parts = [p for p in COMPARE_SPLIT.split(cap) if p.strip()]
            if len(parts) >= 3 and slug not in settle:
                r.err(f"{slug}: 비교 캡션인데 정착 검사 기록이 없다 — settle.py 로 확인할 것")
            if slug in settle and not settle[slug].get("ok"):
                r.warn(f"{slug}: 정착 검사에서 「차오르는 중」으로 잡혔다 "
                       f"(+{settle[slug].get('suggest_delta')}초 권장) — 눈으로 확정했는가")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, help="산출물 폴더(scripts/_yt_report/<날짜>)")
    ap.add_argument("--strict", action="store_true", help="경고도 실패로 본다")
    args = ap.parse_args()

    run = Path(args.run)
    if not run.is_dir():
        print(f"[오류] 산출물 폴더가 없다: {run}")
        return 2

    r = Result()
    finals = sorted((run / "reports_final").glob("*.md"))
    if not finals:
        print(f"[오류] {run}/reports_final 에 본문이 없다 — finalize.py 를 돌렸는가")
        return 2

    print(f"=== 본문 {len(finals)}편 ===")
    for p in finals:
        check_body(p, r)
    print("=== 프레임·캡션 ===")
    check_frames(run, r)

    print(f"\n오류 {len(r.errors)}건 · 경고 {len(r.warns)}건")
    if r.errors:
        return 1
    if args.strict and r.warns:
        return 1
    print("[통과]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
