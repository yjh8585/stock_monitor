# -*- coding: utf-8 -*-
"""두 레포(agents · stock_monitor) 유튜브 보고서 툴킷의 공통 파일이 글자까지 같은지 대조한다.

왜 (2026-11-24 사용자 지시 「2개가 있으니까 어느것은 수정되고 어느것은 수정안될까 걱정되네 앞으로. 정본화 할 수 없나?」)
  11-18 에 서로 옮긴 뒤 6일 만에 공통 앞단 8개가 전부 갈려 있었다(다른 줄 5~171).
  두 벌을 두되(사용자 선택), 공통 파일은 바이트 단위로 같게 두고 이 검사가 갈림을 잡는다.

이 파일 자신도 공통 파일이다(SHARED.txt 에 올라 있다) — 고치면 두 레포를 함께 고친다.

쓰기
  python scripts/yt_report/verify_shared.py                 # 목록 전체
  python scripts/yt_report/verify_shared.py --paths A B     # 이 레포 기준 경로 중 목록에 있는 것만(커밋 훅용)

종료 코드: 0 = 같음 · 1 = 갈림 · 2 = 실행 못 함(형제 레포·목록·파일 없음·목록 줄 깨짐·예외 — 「통과」가 아니다)
  --paths 를 주면 거르기가 먼저다: 공통 파일과 무관한 경로뿐이면 형제 레포·레포 이름과 상관없이 0
  (계획서 D4 「형제를 못 찾으면 실행 못 함」은 공통 파일을 커밋·검사할 때만 — 2026-11-24 최종 검토).
부르는 곳: 전역 ~/.claude/scripts/hook_commit_guard.py 검사 G · 게시 전 검사기
  (agents scripts/verify_yt_reports.py · stock_monitor scripts/verify_yt_report.py)
"""
import argparse
import difflib
import fnmatch
import os
import sys
from pathlib import Path

REPOS = ("agents", "stock_monitor")   # SHARED.txt 열 순서와 같다
TOOLKIT = Path(__file__).resolve().parent
ROOT = TOOLKIT.parent.parent
GLOB_CHARS = "*?["


def load_pairs(manifest: Path) -> list[tuple[str, str]]:
    pairs = []
    for no, line in enumerate(manifest.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        cols = line.split("\t")
        if len(cols) != 2 or not all(c.strip() for c in cols):
            raise ValueError(f"목록 {manifest.name} {no}줄이 「경로<TAB>경로」가 아니다: {line!r}")
        pairs.append((cols[0].strip(), cols[1].strip()))
    return pairs


def norm(p: str) -> str | None:
    """이 레포 루트 기준 posix 경로(소문자)로. 레포 밖이면 None · 레포 루트 자체면 "".

    소문자로 접는 것은 Windows 경로가 대소문자를 안 가리기 때문이다(`SCRIPTS/YT_REPORT/CAPTURE.PY` 도 잡는다).
    """
    if Path(p).is_absolute():
        try:
            full = Path(p).resolve()
        except OSError:  # glob 글자(`*`)가 든 경로 등
            full = Path(os.path.abspath(p))
        try:
            rel = os.path.relpath(full, ROOT)
        except ValueError:  # 다른 드라이브
            return None
    else:
        rel = os.path.normpath(p)
    rel = rel.replace("\\", "/")
    if rel == ".." or rel.startswith("../"):
        return None
    return "" if rel == "." else rel.casefold()


def wanted(path: str, want: list[str]) -> bool:
    """목록 경로 path 가 --paths 중 하나에 걸리는가 — 같은 파일 · 그 위 폴더(폴더째 add) · glob pathspec."""
    p = path.casefold()
    for w in want:
        if w == "" or p == w or p.startswith(w + "/"):
            return True
        if any(c in w for c in GLOB_CHARS) and fnmatch.fnmatchcase(p, w):
            return True
    return False


def diff_summary(a: Path, b: Path, label_a: str, label_b: str) -> str:
    try:
        la = a.read_text(encoding="utf-8").splitlines()
        lb = b.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return "    (글자로 읽을 수 없음 — 바이트가 다름)"
    lines = list(difflib.unified_diff(la, lb, label_a, label_b, n=0, lineterm=""))
    shown = lines[:12]
    more = f"\n    … 외 {len(lines) - 12}줄" if len(lines) > 12 else ""
    return "\n".join("    " + x for x in shown) + more


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="두 레포 공통 파일 대조")
    ap.add_argument("--paths", nargs="*", help="이 레포 기준 경로 — 목록에 있는 것만 대조")
    args = ap.parse_args()

    manifest = TOOLKIT / "SHARED.txt"
    if not manifest.exists():
        print(f"실행 못 함: 목록 없음 {manifest}")
        return 2
    pairs = load_pairs(manifest)
    # 목록 자신은 늘 올라 있어야 한다 — 비우거나 자기 줄을 지우면 그 뒤 모든 대조가 「0개 같음」으로 통과한다(Codex 재검토 2026-11-24).
    #   전체 대조 · 목록 파일 자신을 커밋할 때만 본다(무관한 커밋까지 막지 않는다 — F1).
    touches_manifest = args.paths is None or any(
        w == "" or (w or "").endswith("shared.txt") for w in (norm(p) for p in args.paths))   # "" = 레포 루트째
    if touches_manifest and not any(a.endswith("/SHARED.txt") for a, _ in pairs):
        print(f"실행 못 함: 목록 {manifest} 에 SHARED.txt 자기 줄이 없다(비었거나 깨짐)")
        return 2
    me = REPOS.index(ROOT.name) if ROOT.name in REPOS else None
    name_err = f"실행 못 함: 레포 이름 {ROOT.name!r} 이 {REPOS} 가 아니라 어느 열인지 모른다"

    # 거르기가 형제·이름 검사보다 먼저다 — 공통 파일과 무관한 커밋을 체크아웃 배치 때문에 막지 않는다
    if args.paths is not None:
        want = [w for w in (norm(p) for p in args.paths) if w is not None]
        cols = (0, 1) if me is None else (me,)   # 이름을 모르면 어느 열에라도 맞으면 대상
        pairs = [pr for pr in pairs if any(wanted(pr[c], want) for c in cols)]
        if not pairs:
            return 0
    if me is None:
        print(name_err)
        return 2
    sib = ROOT.parent / REPOS[1 - me]
    if not (sib / "scripts" / "yt_report").is_dir():
        print(f"실행 못 함: 형제 레포 툴킷 없음 {sib}")
        return 2

    bad, missing = [], []
    for pr in pairs:
        mine, theirs = ROOT / pr[me], sib / pr[1 - me]
        if not mine.exists() or not theirs.exists():
            absent = [n for n, p in ((ROOT.name, mine), (sib.name, theirs)) if not p.exists()]
            missing.append(f"  - {pr[me]} ↔ {sib.name}/{pr[1 - me]} (없는 쪽: {' · '.join(absent)})")
            continue
        if mine.read_bytes() != theirs.read_bytes():
            bad.append(f"  - {pr[me]} ≠ {sib.name}/{pr[1 - me]}\n"
                       + diff_summary(mine, theirs, f"{ROOT.name}/{pr[me]}", f"{sib.name}/{pr[1 - me]}"))
    if missing:
        print("실행 못 함: 공통 파일이 한쪽에 없다\n" + "\n".join(missing))
        return 2
    if bad:
        print(f"갈림 {len(bad)}건 — 공통 파일은 두 레포를 글자까지 같게 고친다(레포별 값은 _repo.py):\n"
              + "\n".join(bad))
        return 1
    print(f"같음: 공통 파일 {len(pairs)}개 ({ROOT.name} ↔ {sib.name})")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # 목록 줄 깨짐 등 — 1(갈림)과 갈라 2 로 낸다(훅이 「통과」로 읽지 않게)
        print(f"실행 못 함: {type(e).__name__}: {e}")
        sys.exit(2)
