#!/usr/bin/env python
"""선별된 증권사 리포트를 헤드리스 Claude 로 요약해 research_reports.summary 에 채운다.

플로우:
  1. summary 가 비어 있는 행을 읽어 **요약 대상만** 고른다(lib.naver_research.is_summary_target)
  2. 발행일 오름차순으로 처리 — 묶음의 오래된 것부터 해야 델타가 성립한다
  3. PDF 를 받아 pymupdf 로 텍스트를 뽑는다(없거나 비면 상세 페이지 텍스트로 폴백)
  4. 같은 (증권사, 대상) 의 직전 요약이 있으면 **델타 모드**로 재료를 만든다
  5. agents 레포의 CLI 를 불러 헤드리스 요약을 받는다(구독 인증 · 요금 0)
  6. 결과 파일을 읽어 summary·is_delta·prev_report_id 를 UPDATE

🔴 요약 규칙(프롬프트)은 여기 없다 — agents 의 summarizeReportCmd.ts 가 정본이다(결정 11).
   여기는 "무엇을 요약할지" 고르고 재료를 만들어 넘기는 일만 한다. 규칙이 두 레포로 갈리면
   반드시 어긋난다.

🔴 실패는 건너뛰고 계속한다(사용자 결정 2026-08-24). PDF 하나가 깨졌다고 전체가 멈추면
   밤새 도는 작업이 첫 건에서 죽는다. 실패는 모아서 끝에 보고한다.

🔴 헤드리스는 사용자 세션 한도를 **공유**한다. 한 번에 다 돌리지 말고 --limit 로 나눌 것.

플래그:
  --limit N     이번 회차에 요약할 최대 건수 (기본 20)
  --nid N       특정 리포트만 (kind 와 함께 · 디버깅용)
  --kind K      industry|company (--nid 와 함께)
  --dry-run     재료 파일까지만 만들고 헤드리스는 부르지 않는다

사용:
  scripts/venv/Scripts/python.exe scripts/summarize_naver_research.py --limit 20

종료 코드:
  0 정상(대상 0건 포함)
  1 한 건도 성공하지 못했다(대상은 있었는데)
  2 DB 갱신 실패
"""
import argparse
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import fitz  # pymupdf
import requests
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession, get_client  # noqa: E402
from lib.naver_research import (  # noqa: E402
    DELTA_MAX_GAP_DAYS,
    is_relevant,
    read_url,
)
from lib.retry import with_retry  # noqa: E402

# 재료·결과 파일을 두는 곳. gitignore 에 이미 있다.
TMP_DIR = Path(__file__).resolve().parent / "_tmp" / "naver_research"

# 한 회차 기본 처리량. 헤드리스가 세션 한도를 공유하므로 작게 잡는다.
DEFAULT_LIMIT = 20

# 재료에 실을 본문 최대 길이. 리포트 한 편은 보통 4~15쪽이라 이 정도면 전문이 들어간다.
MAX_BODY_CHARS = 40_000

# PDF 가 이 길이도 안 나오면 스캔 이미지로 보고 상세 페이지로 폴백한다.
MIN_PDF_TEXT = 300

USER_AGENT = "Mozilla/5.0 (stock_monitor research summarizer)"

EXIT_OK = 0
EXIT_ALL_FAILED = 1
EXIT_DB_FAILED = 2

# Windows 에서 콘솔 창을 띄우지 않는다(전역 규칙 · 사용자 지시 2026-08-18).
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def agents_repo_dir() -> Path:
    """agents 레포 경로. 기본은 형제 폴더."""
    env = os.environ.get("AGENTS_REPO_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / "agents"


def fetch_pdf_text(pdf_url: str) -> str:
    """PDF 를 받아 텍스트로. 실패하면 빈 문자열(호출자가 폴백한다)."""

    def _once() -> bytes:
        r = requests.get(pdf_url, headers={"User-Agent": USER_AGENT}, timeout=60)
        r.raise_for_status()
        return r.content

    try:
        blob = with_retry(_once, _label=f"pdf {pdf_url[-40:]}")
    except Exception as e:
        logger.warning(f"PDF 내려받기 실패: {e}")
        return ""

    try:
        with fitz.open(stream=blob, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc)
    except Exception as e:
        logger.warning(f"PDF 텍스트 추출 실패: {e}")
        return ""


def fetch_page_text(kind: str, nid: int) -> str:
    """상세 페이지 본문 텍스트(PDF 폴백)."""
    from bs4 import BeautifulSoup

    def _once() -> str:
        r = requests.get(read_url(kind, nid), headers={"User-Agent": USER_AGENT}, timeout=30)
        r.raise_for_status()
        r.encoding = "euc-kr"
        return r.text

    try:
        html = with_retry(_once, _label=f"detail {nid}")
    except Exception as e:
        logger.warning(f"상세 페이지 실패 nid={nid}: {e}")
        return ""

    soup = BeautifulSoup(html, "html.parser")
    node = soup.find("td", class_="view_cnt") or soup.find(class_="view_cnt")
    if node is not None:
        return node.get_text("\n", strip=True)
    return soup.get_text("\n", strip=True)


def find_delta_base(client, row: dict) -> dict | None:
    """같은 (증권사, 대상) 의 직전 **요약된** 리포트. 없으면 None."""
    if not row.get("broker") or not row.get("published_at"):
        return None
    published = date.fromisoformat(row["published_at"])
    # 60일 창은 파이썬에서 계산해 넘긴다(SQL 에 날짜 산술을 흩뿌리지 않는다).
    floor = published - timedelta(days=DELTA_MAX_GAP_DAYS)

    rows = (
        client.table("research_reports")
        .select("id, title, summary, published_at")
        .eq("broker", row["broker"])
        .eq("target_name", row["target_name"])
        .lt("published_at", row["published_at"])
        .gte("published_at", floor.isoformat())
        .not_.is_("summary", "null")
        .order("published_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def build_material(row: dict, body: str, base: dict | None) -> str:
    """헤드리스가 읽을 재료 파일 내용."""
    lines = [
        "# 증권사 리포트 요약 재료",
        "",
        "## 메타",
        f"- 종류: {'종목분석' if row['kind'] == 'company' else '산업분석'}",
        f"- 대상: {row['target_name']}" + (f" ({row['ticker']})" if row.get("ticker") else ""),
        f"- 증권사: {row.get('broker') or '(미상)'}",
        f"- 발행일: {row.get('published_at') or '(미상)'}",
        f"- 제목: {row['title']}",
        "",
    ]
    if base is not None:
        lines += [
            "## 직전 리포트 요약 (이것과 견줘 달라진 점만 쓰세요)",
            f"- 직전 제목: {base.get('title') or ''}",
            f"- 직전 발행일: {base.get('published_at') or ''}",
            "",
            (base.get("summary") or "").strip(),
            "",
        ]
    lines += ["## 이번 리포트 본문", "", body[:MAX_BODY_CHARS]]
    return "\n".join(lines)


def run_headless(material_path: Path, out_path: Path, mode: str) -> bool:
    """agents 레포의 CLI 를 불러 헤드리스 요약을 돌린다."""
    repo = agents_repo_dir()
    if not repo.is_dir():
        logger.error(f"agents 레포를 찾을 수 없다: {repo} (AGENTS_REPO_DIR 로 지정 가능)")
        return False

    cmd = [
        "pnpm", "--filter", "@agents/orchestrator", "run", "summarize-report",
        str(material_path), str(out_path), mode,
    ]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(repo),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=600,
            shell=(os.name == "nt"),  # Windows 에서 pnpm 은 .cmd 라 셸 경유가 필요하다
            creationflags=CREATE_NO_WINDOW,
        )
    except subprocess.TimeoutExpired:
        logger.warning("헤드리스 요약 시간 초과(10분)")
        return False

    # 🔴 종료 코드보다 **파일이 생겼는지**가 판정 기준이다(브리핑에서 겪은 함정).
    if not out_path.exists():
        tail = (proc.stderr or proc.stdout or "")[-300:]
        logger.warning(f"요약 파일 없음 (code={proc.returncode}) {tail}")
        return False
    return True


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="네이버 증권사 리포트 헤드리스 요약")
    p.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="이번 회차 최대 건수")
    p.add_argument("--nid", type=int, help="특정 리포트만 (디버깅)")
    p.add_argument("--kind", choices=["industry", "company"], help="--nid 와 함께 쓴다")
    p.add_argument("--dry-run", action="store_true", help="재료까지만 만들고 헤드리스는 안 부른다")
    return p.parse_args()


# 헤드리스 CLI 가 훅 게이트를 통과하려고 앞머리에 뱉는 탈출 문구. 요약 본문이 아니다.
_GATE_PREFIX_RE = re.compile(r"^[ \t]*(?:RULES-OK|PLAN-OK)[ \t]*:.*$", re.MULTILINE)


def clean_summary(text: str) -> str:
    """요약 본문에서 훅 탈출 문구를 걷어낸다.

    🔴 실측(2026-08-25): 저장된 요약 77건 중 5건이 `RULES-OK: ...` 로 시작했다.
       agents 레포의 헤드리스 CLI 가 훅 게이트를 통과하려고 출력한 줄이 결과 파일
       첫머리에 섞여 그대로 DB 에 들어갔다. 화면에서는 요약이 엉뚱한 문장으로 시작한다.
       규칙의 정본은 agents 쪽이지만, 오염을 여기서 한 번 더 막는다.
    """
    return _GATE_PREFIX_RE.sub("", text or "").strip()


def load_targets(client, args: argparse.Namespace) -> list[dict]:
    """요약 대상 — summary 가 비어 있고 선별 규칙에 걸리는 것, 오래된 것부터."""
    q = (
        client.table("research_reports")
        .select("id, kind, naver_nid, target_name, ticker, company_id, title, broker, "
                "published_at, pdf_url, is_periodic")
        .is_("summary", "null")
        .order("published_at", desc=False)
    )
    if args.nid is not None:
        q = q.eq("naver_nid", args.nid)
        if args.kind:
            q = q.eq("kind", args.kind)

    rows = q.execute().data
    return [
        r for r in rows
        if is_relevant(r["kind"], r.get("company_id") is not None, r["title"], r["is_periodic"])
    ]


def main() -> int:
    args = parse_args()
    client = get_client()
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    targets = load_targets(client, args)
    logger.info(f"요약 대상 {len(targets)}건 (이번 회차 최대 {args.limit}건)")
    if not targets:
        return EXIT_OK

    done = 0
    failed: list[str] = []

    for row in targets[: args.limit]:
        label = f"{row['target_name']}/{row.get('broker') or '?'}/{row.get('published_at')}"

        body = fetch_pdf_text(row["pdf_url"]) if row.get("pdf_url") else ""
        if len(body.strip()) < MIN_PDF_TEXT:
            body = fetch_page_text(row["kind"], row["naver_nid"])
        if len(body.strip()) < MIN_PDF_TEXT:
            failed.append(f"{label} — 본문을 얻지 못함")
            logger.warning(f"본문 없음: {label}")
            continue

        base = find_delta_base(client, row)
        mode = "delta" if base else "full"

        material_path = TMP_DIR / f"{row['kind']}_{row['naver_nid']}_material.md"
        out_path = TMP_DIR / f"{row['kind']}_{row['naver_nid']}_summary.md"
        material_path.write_text(build_material(row, body, base), encoding="utf-8")
        if out_path.exists():
            out_path.unlink()  # 지난 회차 산출물을 성공으로 오인하지 않게

        if args.dry_run:
            logger.info(f"[dry-run] {mode} 재료 작성: {material_path}")
            done += 1
            continue

        if not run_headless(material_path, out_path, mode):
            failed.append(f"{label} — 헤드리스 실패")
            continue

        summary = clean_summary(out_path.read_text(encoding="utf-8"))
        if not summary:
            failed.append(f"{label} — 요약이 비었음")
            continue

        try:
            with WriteSession() as w:
                w.table("research_reports").update({
                    "summary": summary,
                    "is_delta": base is not None,
                    "prev_report_id": base["id"] if base else None,
                }).eq("id", row["id"]).execute()
        except Exception as e:
            logger.exception(f"DB 갱신 실패 {label}: {e}")
            return EXIT_DB_FAILED

        done += 1
        logger.info(f"[{done}] {mode} 완료 — {label}")

    if failed:
        logger.warning(f"실패 {len(failed)}건:")
        for f in failed:
            logger.warning(f"  - {f}")

    logger.success(f"요약 {done}건 완료 · 실패 {len(failed)}건 · 남은 대상 {max(0, len(targets) - args.limit)}건")
    return EXIT_OK if done else EXIT_ALL_FAILED


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.warning("사용자 중단")
        sys.exit(130)
    except Exception as e:
        logger.exception(f"예기치 못한 오류: {e}")
        sys.exit(1)
