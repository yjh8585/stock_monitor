# -*- coding: utf-8 -*-
"""회차 끝 회고 검사 — 회고 표 없이 회차를 끝내지 못하게 한다(두 레포 공통 파일 · SHARED.txt).

사용자 지시(2026-11-24): 「교훈 원장 + 회고 강제」 — 회차마다 결함 유형을 원장에 쌓고, 서로 다른
2회차 이상 반복된 «채택(adopted)» 유형은 작성 지시서로 옮기라고 띄우며, 회고 표 없이 회차를 끝내면 막는다.
계획 = agents docs/superpowers/plans/2026-11-24-유튜브-교훈원장-회고강제.md · 같은 날 PDF 회차로 넓힘
(…-PDF-교훈원장-회고강제.md). 회차 갈래는 아래 `FLOWS`(yt · pdf).

부르는 곳: yt = agents finalize_vault.py · stock_monitor publish.ts 의 main 첫머리
          pdf = agents verify_pani_report.py(--only PDF 리포트 + --run-dir) · stock_monitor pdf_report/publish.py
    python -X utf8 scripts/yt_report/retro_check.py [--flow yt|pdf] [--run-dir <회차 폴더>]   # 기본 yt · RUN_DIR
종료: 0 통과(⚠ 옮길 교훈은 알림만) · 1 회고 없음·형식 위반·원장 누락·직전 회차 회고
      · 2 실행 못 함(회고 파일 읽기 실패 · agents 레포·node 없음 · 원장 CLI 출력 모양이 어긋남)

🔴 승격 문턱·교훈 id 는 여기서 계산하지 않는다 — agents 의 `scripts/curation-lessons.mjs retro` 가 정본에서 낸 JSON 을 받는다.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional

from _common import ROOT, RUN_DIR

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PLACES = ("지시서", "도구 코드", "검사기", "규칙 문서", "원장", "안 고침")
LEDGER_PLACE = "원장"
NO_MATERIAL = "재료 없음"
HEADER = ["재료", "반영 자리", "어디 · 이유"]
TABLE_COLS = 3
AGENTS_MARKER = ("scripts", "curation-lessons.mjs")
NO_LEDGER_RE = re.compile(r"^원장:\s*없음\s*—\s*\S")
SEP_CELL_RE = re.compile(r"^:?-{3,}:?$")
LEDGER_TIMEOUT_S = 120

# 회차 갈래(2026-11-24 · 유튜브 → PDF 로 넓힘 · 계획 = agents 2026-11-24-PDF-교훈원장-회고강제.md).
#   lane = 원장 갈래 · prefix = run 줄 접두 · inputs = 회차 입력(glob) — retro.md 가 이것보다 오래되면 직전 회차 회고다
#   (Codex 최종 검토 #1) · doc = 반복 교훈을 옮길 지시서(실행 레포 기준 상대경로) · format_doc = 절차 문서
FLOWS: dict[str, dict] = {
    "yt": {
        "lane": "yt-report",
        "prefix": "yt",
        "inputs": ("videos.json", "selected.json"),
        # 두 파일은 공통 목록(SHARED.txt)이라 같은 바이트다
        "doc": {"agents": "scripts/yt_report/PROMPT-공통.md", "stock_monitor": "scripts/yt_report/prompts/PROMPT-공통.md"},
        "move_to": "PROMPT-공통.md 로 옮길 것(두 레포",
        "format_doc": "agents docs/report-from-youtube.md §5-A 「회차 끝 회고」",
    },
    "pdf": {
        "lane": "pdf-report",
        "prefix": "pdf",
        # stock_monitor 회차 폴더 = _pdf_report/<날짜>/(text.txt·batch.json) · agents = 추출 출력 <OUT>/<report_id>/.
        # 🔴 report.md 는 넣지 않는다 — 회고를 쓴 «뒤» 정리본을 고치면 같은 회차가 막힌다
        "inputs": ("text.txt", "batch.json", "*/text.md", "*/manifest.tsv"),
        "doc": {"agents": "scripts/pdf_report/WRITER-BRIEF.md", "stock_monitor": "scripts/pdf_report/prompts/codex_check.md"},
        "move_to": "이 레포 작성 지시서로 옮길 것(사용자 선택 2026-11-24",
        "format_doc": "agents scripts/pdf_report/README.md 「회차 끝 회고」(표 형식 = agents docs/report-from-youtube.md §5-A)",
    },
}


def run_re(flow: str) -> re.Pattern:
    return re.compile(rf"^run:\s*(\d{{4}}-\d{{2}}-\d{{2}}/{FLOWS[flow]['prefix']}-(agents|stock_monitor):\S+)\s*$")


def cells(line: str) -> list[str]:
    """표 줄 → 칸. 바깥 파이프는 한쪽에 하나씩만 뗀다(`strip("|")` 은 끝의 빈 칸까지 먹는다)."""
    s = line[1:] if line.startswith("|") else line
    s = s[:-1] if s.endswith("|") else s
    return [c.strip() for c in s.split("|")]


def parse(text: str, flow: str = "yt") -> dict:
    """회고 표 → {run, repo, body(run 줄 뒤 빈 줄 아닌 줄), table(칸 목록 · 머리·구분 줄 포함), rows,
    contiguous(표 줄이 끊김 없이 이어지나), stray(`|` 가 들었는데 `|` 로 시작하지 않는 줄), no_material, no_ledger}."""
    lines = [ln.strip() for ln in text.splitlines()]
    start = next((i for i, ln in enumerate(lines) if ln), len(lines))
    m = run_re(flow).match(lines[start]) if start < len(lines) else None
    rest = lines[start + 1:]
    body = [ln for ln in rest if ln]
    at = [i for i, ln in enumerate(rest) if ln.startswith("|")]
    table = [cells(rest[i]) for i in at]
    return {
        "run": m.group(1) if m else None,
        "repo": m.group(2) if m else None,
        "body": body,
        "table": table,
        "rows": table[2:],
        "contiguous": not at or at == list(range(at[0], at[0] + len(at))),
        "stray": [ln for ln in body if "|" in ln and not ln.startswith("|")],
        "no_material": NO_MATERIAL in body,
        "no_ledger": any(NO_LEDGER_RE.match(ln) for ln in body),
    }


def has_ledger_row(rows: list) -> bool:
    return any(len(c) > 1 and c[1] == LEDGER_PLACE for c in rows)


def table_problems(table: list) -> list[str]:
    """머리 · 구분 줄 · 행(정확히 세 칸 · 빈 칸 없음 · 닫힌 어휘) — Codex 계획 대조 #3 · 최종 검토 #2·#3."""
    if table[0] != HEADER:
        return [f"표 머리가 `| {' | '.join(HEADER)} |` 가 아니다: | {' | '.join(table[0])} |"]
    if len(table) < 2 or len(table[1]) != TABLE_COLS or not all(SEP_CELL_RE.match(c) for c in table[1]):
        return ["표 머리 다음 줄이 세 칸 구분 줄(`|---|---|---|`)이 아니다"]
    if len(table) < 3:
        return ["표에 행이 없다"]
    bad = []
    for row in table[2:]:
        if len(row) != TABLE_COLS or any(not c for c in row):
            bad.append(f"행은 빈 칸 없이 정확히 세 칸: | {' | '.join(row)} |")
        elif row[1] not in PLACES:
            bad.append(f"반영 자리 「{row[1]}」 는 {'·'.join(PLACES)} 중 하나가 아니다")
    return bad


def body_problems(p: dict) -> list[str]:
    """run 줄 아래 본문 — 「재료 없음」 단독 · 새는 표 행 · 끊긴 표(최종 검토 #2·#3)."""
    if p["no_material"]:
        if p["table"]:
            return [f"「{NO_MATERIAL}」 과 표를 함께 쓰지 않는다"]
        if p["body"] != [NO_MATERIAL]:
            return [f"「{NO_MATERIAL}」 을 쓰면 run 줄 아래 빈 줄 아닌 줄은 그 한 줄뿐이어야 한다(코드 블록 속 예시 불가)"]
        return []
    if any(ln.startswith("```") for ln in p["body"]):
        return ["코드 블록(```)을 쓰지 않는다 — 예시를 감싼 표·문장도 검사 대상으로 읽힌다(재검토 Minor 2026-11-24)"]
    if p["stray"]:
        return [f"`|` 로 시작하지 않는 표 행(표에서 샌다): {ln}" for ln in p["stray"]]
    if p["table"] and not p["contiguous"]:
        return ["표 머리·구분 줄·행 사이에 다른 줄(빈 줄 포함)이 끼었다 — 표는 끊김 없이 한 덩어리"]
    return []


def problems(p: dict, repo: str, flow: str = "yt") -> list[str]:
    if not p["run"]:
        return [f"첫 줄이 `run: YYYY-MM-DD/{FLOWS[flow]['prefix']}-<agents|stock_monitor>:<회차 이름>` 이 아니다"]
    if p["repo"] != repo:
        return [f"run 의 레포 「{p['repo']}」 가 이 레포 「{repo}」 와 다르다 — 다른 레포 회차를 적었다(Codex 계획 대조 #4)"]
    bad = body_problems(p)
    if bad or p["no_material"]:
        return bad
    if not p["table"]:
        return [f"회고 표가 없다 — 표를 쓰거나 「{NO_MATERIAL}」 한 줄"]
    bad = table_problems(p["table"])
    if not bad and not has_ledger_row(p["rows"]) and not p["no_ledger"]:
        bad.append("「원장」 행이 없다 — 결함 유형을 원장에 넣었으면 그 행을, 아니면 `원장: 없음 — <이유>` 한 줄")
    return bad


def stale_problem(run_dir: Path, retro: Path, flow: str = "yt") -> Optional[str]:
    """retro.md 가 이번 회차 입력 파일보다 오래됐으면 문구. 입력 파일이 하나도 없으면 검사하지 않는다."""
    inputs = sorted({f for pat in FLOWS[flow]["inputs"] for f in run_dir.glob(pat) if f.is_file()})
    if not inputs:
        return None
    newest = max(f.stat().st_mtime for f in inputs)
    if retro.stat().st_mtime >= newest:
        return None
    names = sorted({f.name for f in inputs})
    return "retro.md 가 이번 회차 입력(" + "·".join(names) + ")보다 오래됐다 — 직전 회차 것일 수 있다"


def is_agents(root: Path) -> bool:
    return root.joinpath(*AGENTS_MARKER).exists()


def repo_name(root: Path = ROOT) -> str:
    """폴더 이름이 아니라 실물로 가른다 — 워크트리 폴더 이름은 레포 이름과 다르다(오퍼스 최종 검토 I3)."""
    return "agents" if is_agents(root) else "stock_monitor"


def agents_root(root: Path = ROOT) -> Optional[Path]:
    cand = root if is_agents(root) else root.parent / "agents"
    return cand if is_agents(cand) else None


def valid_status(st: object) -> bool:
    """CLI `retro` JSON 모양 — {this_run: 0 이상 정수, to_move: [{id, fix, runs}]}. 어긋나면 «실행 못 함»(2)."""
    def is_int(v: object) -> bool:
        return isinstance(v, int) and not isinstance(v, bool)

    if not isinstance(st, dict) or not is_int(st.get("this_run")) or st["this_run"] < 0:
        return False
    moves = st.get("to_move")
    return isinstance(moves, list) and all(
        isinstance(m, dict) and isinstance(m.get("id"), str) and isinstance(m.get("fix"), str) and is_int(m.get("runs"))
        for m in moves
    )


def ledger_status(run: str, flow: str = "yt") -> Optional[dict]:
    """agents CLI `retro` 의 JSON. 못 부르거나 모양이 어긋나면 None."""
    root = agents_root()
    if root is None:
        return None
    # 옮길 지시서는 «실행 레포» 것 — PDF 는 레포마다 지시서가 다르다(사용자 선택 2026-11-24 「각 레포 작성 지시서」)
    doc = ROOT / FLOWS[flow]["doc"][repo_name()]
    cmd = ["node", "--import", "tsx", "scripts/curation-lessons.mjs", "retro",
           "--lane", FLOWS[flow]["lane"], "--run", run, "--doc", str(doc)]
    try:
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, encoding="utf-8",
                           timeout=LEDGER_TIMEOUT_S, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        st = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, ValueError, IndexError):
        return None
    return st if valid_status(st) else None


def check(run_dir: Path, ledger: Optional[Callable[..., Optional[dict]]] = None, repo: Optional[str] = None,
          flow: str = "yt") -> int:
    run_dir = Path(run_dir)
    fl = FLOWS[flow]
    f = run_dir / "retro.md"
    if not f.exists():
        print(f"🛑 회고 표 없음: {f} — 형식 = {fl['format_doc']}")
        return 1
    try:
        text = f.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError) as e:
        print(f"🛑 실행 못 함: 회고 파일을 못 읽었다({f}): {e}")
        return 2
    p = parse(text, flow)
    bad = problems(p, repo or repo_name(), flow)
    if bad:
        print("🛑 회고 표 형식 위반:\n  - " + "\n  - ".join(bad))
        return 1
    try:
        stale = stale_problem(run_dir, f, flow)
    except OSError as e:
        print(f"🛑 실행 못 함: 회차 파일 수정 시각을 못 읽었다({run_dir}): {e}")
        return 2
    if stale:
        print(f"🛑 {stale} — 이번 회차 회고를 새로 쓴다({fl['format_doc']})")
        return 1
    st = ledger(p["run"]) if ledger else ledger_status(p["run"], flow)
    if st is None or not valid_status(st):
        print("🛑 실행 못 함: agents 레포의 교훈 원장 CLI 를 못 불렀다(agents 폴더·node·tsx 확인)")
        return 2
    if has_ledger_row(p["rows"]) and st["this_run"] == 0:
        print(f"🛑 「원장」 행이 있는데 원장에 {p['run']} 이 찍힌 {fl['lane']} 교훈이 0건 — `curation-lessons.mjs add` 를 먼저")
        return 1
    for m in st["to_move"]:
        print(f"⚠ 반복 {m['runs']}회차 — {fl['move_to']} · 표식 `<!-- lesson:{m['id']} -->`): {m['fix']}")
    print(f"회고 통과: {p['run']} · 이번 회차 원장 {st['this_run']}건")
    return 0


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--flow", choices=sorted(FLOWS), default="yt")
    ap.add_argument("--run-dir", default=None, help="회차 폴더(기본 = 유튜브 RUN_DIR)")
    a = ap.parse_args()
    sys.exit(check(Path(a.run_dir) if a.run_dir else RUN_DIR, flow=a.flow))
