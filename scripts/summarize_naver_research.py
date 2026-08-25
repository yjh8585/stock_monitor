#!/usr/bin/env python
"""선별된 증권사 리포트를 헤드리스 Claude 로 요약해 research_reports.summary 에 채운다.

플로우:
  1. summary 가 비어 있는 행을 읽어 **요약 대상만** 고른다(lib.naver_research.is_summary_target)
     `--force` 면 이미 요약된 것도 포함한다(요약 규칙이 바뀌었을 때 전량 재작성).
  2. 발행일 오름차순으로 처리 — 묶음의 오래된 것부터 해야 델타가 성립한다
  3. PDF 를 **한 번** 받아 pymupdf 로 텍스트를 뽑고(없거나 비면 상세 페이지 텍스트로 폴백),
     같은 바이트에서 **차트·도표를 잘라내** Storage 에 올린다(`lib/pdf_figures.py`)
  4. 같은 (증권사, 대상) 의 직전 요약이 있으면 **델타 모드**로 재료를 만든다
  5. agents 레포의 CLI 를 불러 헤드리스 요약을 받는다(구독 인증 · 요금 0)
  6. 결과 파일을 읽어 summary·is_delta·prev_report_id·images 를 UPDATE

🔴 그림(2026-08-25 신설 · 사용자 지시 "이미지 중 필요한 것은 수록하고"):
   추출·업로드는 여기가 하고 **어느 것을 본문에 실을지는 헤드리스가 고른다**. 재료 파일의
   「사용 가능한 그림」 절이 후보 목록이다. 리포트 뒤쪽 **표준 재무제표 부록**은 아예
   후보에서 뺀다(`pdf_figures.is_skippable_page` · "재무실적 중 중요한 것은 기업 페이지에").

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
from lib.pdf_figures import extract_figures, is_image_body, render_pages  # noqa: E402
from lib.research_priority import score_report, select_ongoing, select_priority  # noqa: E402
from lib.naver_research import (  # noqa: E402
    DELTA_MAX_GAP_DAYS,
    MIN_BODY_TEXT,
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
# 🔴 수집기의 「요약 재료가 있나」 판정과 **같은 값을 써야 한다**. 두 값이 갈리면
#    수집이 저장한 것을 요약이 못 다뤄 화면에 "정리 안 된 카드"가 남는다.
#    정본은 `lib/naver_research.MIN_BODY_TEXT` 다.
MIN_PDF_TEXT = MIN_BODY_TEXT

USER_AGENT = "Mozilla/5.0 (stock_monitor research summarizer)"

# 그림을 올릴 곳. `/reports` 보고서 이미지와 같은 공개 버킷을 쓴다(report.md §5).
STORAGE_BUCKET = "reports"
FIGURE_FOLDER_PREFIX = "research"

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


def fetch_pdf_bytes(pdf_url: str) -> bytes:
    """PDF 원본 바이트. 실패하면 빈 바이트.

    🔴 텍스트와 그림을 **같은 바이트에서** 뽑는다. 예전처럼 텍스트만 뽑고 버리면
       그림 추출 때 같은 파일을 다시 받게 된다(리포트 144편이면 다운로드가 두 배).
    """

    def _once() -> bytes:
        r = requests.get(pdf_url, headers={"User-Agent": USER_AGENT}, timeout=60)
        r.raise_for_status()
        return r.content

    try:
        return with_retry(_once, _label=f"pdf {pdf_url[-40:]}")
    except Exception as e:
        logger.warning(f"PDF 내려받기 실패: {e}")
        return b""


def pdf_page_count(blob: bytes) -> int:
    """PDF 쪽수. 실패하면 0(호출자가 이미지 본문 판정을 건너뛴다)."""
    if not blob:
        return 0
    try:
        with fitz.open(stream=blob, filetype="pdf") as doc:
            return doc.page_count
    except Exception:
        return 0


def pdf_text(blob: bytes) -> str:
    """PDF 바이트에서 텍스트. 실패하면 빈 문자열(호출자가 폴백한다)."""
    if not blob:
        return ""
    try:
        with fitz.open(stream=blob, filetype="pdf") as doc:
            return "\n".join(page.get_text() for page in doc)
    except Exception as e:
        logger.warning(f"PDF 텍스트 추출 실패: {e}")
        return ""


def upload_figures(kind: str, nid: int, figures: list) -> list[dict]:
    """잘라낸 그림들을 Storage `reports` 버킷에 올리고 목록을 돌려준다.

    🔴 버킷이 허용하는 MIME 은 `image/png` 와 `application/pdf` 뿐이다(report.md §5).
       그래서 `pdf_figures` 는 처음부터 PNG 로 렌더한다 — jpg 로 올리면 거부된다.

    실패한 장은 **건너뛰고 계속한다.** 그림 한 장 때문에 리포트 전체 요약을 버릴 이유가 없다.
    """
    if not figures:
        return []

    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        logger.warning("SUPABASE_URL/SERVICE_ROLE_KEY 가 없어 그림 업로드를 건너뛴다")
        return []

    folder = f"{FIGURE_FOLDER_PREFIX}/{kind}_{nid}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "image/png",
        "x-upsert": "true",
    }

    uploaded: list[dict] = []
    for fig in figures:
        path = f"{folder}/{fig.name}"
        try:
            r = requests.post(
                f"{base}/storage/v1/object/{STORAGE_BUCKET}/{path}",
                data=fig.png,
                headers=headers,
                timeout=60,
            )
            r.raise_for_status()
        except Exception as e:
            logger.warning(f"그림 업로드 실패 {path}: {e}")
            continue
        uploaded.append(
            {
                "name": fig.name,
                "url": f"{base}/storage/v1/object/public/{STORAGE_BUCKET}/{path}",
                "page": fig.page_no,
                "caption": fig.caption,
            }
        )
    return uploaded


def collect_figures(row: dict, blob: bytes) -> list[dict]:
    """PDF 에서 그림을 뽑아 올린다. 어느 단계에서 실패하든 빈 목록으로 계속 간다."""
    if not blob:
        return []
    try:
        figures = extract_figures(blob)
    except Exception as e:
        logger.warning(f"그림 추출 실패 nid={row['naver_nid']}: {e}")
        return []
    return upload_figures(row["kind"], row["naver_nid"], figures)


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


def save_page_images(kind: str, nid: int, blob: bytes) -> list[Path]:
    """본문이 이미지인 PDF 를 페이지 통째로 렌더해 로컬에 저장하고 경로를 돌려준다.

    🔴 업로드하지 않는다 — 헤드리스가 **로컬 파일을 Read 로 열어 눈으로 읽을** 용도다.
       화면에 싣는 그림은 `collect_figures` 가 따로 잘라 올린 것이다.
    """
    pages = render_pages(blob)
    if not pages:
        return []
    folder = TMP_DIR / f"{kind}_{nid}_pages"
    folder.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for page_no, png in pages:
        p = folder / f"p{page_no:02d}.png"
        p.write_bytes(png)
        paths.append(p)
    return paths


def build_material(
    row: dict,
    body: str,
    base: dict | None,
    figures: list[dict] | None = None,
    page_images: list[Path] | None = None,
) -> str:
    """헤드리스가 읽을 재료 파일 내용.

    그림 목록은 **후보**다. 어느 것을 실을지는 헤드리스가 논지에 맞춰 고른다
    (규칙은 agents 레포 `summarizeReportPrompt.ts` 가 정본).
    """
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
    if figures:
        lines += [
            "## 사용 가능한 그림",
            "",
            "리포트 PDF 에서 잘라내 이미 업로드해 둔 차트·도표입니다.",
            "**논지에 필요한 것만 골라** 본문 흐름 안에 넣으세요(전부 넣지 마세요).",
            "",
        ]
        for f in figures:
            cap = f.get("caption") or "(설명 없음)"
            lines.append(f"- {f['page']}쪽 · {cap}")
            lines.append(f"  - URL: {f['url']}")
        lines.append("")

    if page_images:
        lines += [
            "## 🔴 본문이 이미지입니다 — 아래 페이지 그림을 직접 읽으세요",
            "",
            "이 리포트의 PDF 는 본문 글자를 그림으로 심어 두어 텍스트가 거의 추출되지",
            "않습니다. 아래 「이번 리포트 본문」만으로는 정리할 수 없으니, **아래 페이지",
            "그림을 Read 로 한 장씩 열어** 내용을 읽고 그것을 근거로 정리본을 쓰세요.",
            "",
        ]
        for p in page_images:
            lines.append(f"- {p}")
        lines.append("")

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
    p.add_argument(
        "--force",
        action="store_true",
        help="이미 요약된 것도 다시 만든다(요약 규칙이 바뀌었을 때). 오래된 것부터. "
        "이미 새 규격인 것은 건너뛰므로 여러 회차로 나눠 돌려도 앞으로 나아간다.",
    )
    p.add_argument(
        "--redo-all",
        action="store_true",
        help="--force 와 함께. 새 규격인 것까지 전부 다시 만든다(보통은 필요 없다).",
    )
    p.add_argument(
        "--priority",
        action="store_true",
        help="초기 채우기용 균형 선별(산업 조망 + 대상별 최소 1편 · lib/research_priority.py). "
        "새 대상이 무더기로 생겨 빈 페이지를 메워야 할 때만 쓴다. "
        "평소에는 인자 없이 돌리면 점수 문턱 선별이 기본으로 적용된다.",
    )
    p.add_argument(
        "--all",
        action="store_true",
        help="선별 없이 전부 요약한다(제외 표시된 것은 그래도 건드리지 않는다).",
    )
    p.add_argument(
        "--list-only",
        action="store_true",
        help="무엇이 대상인지 출력만 하고 끝낸다(요약도 그림 추출도 하지 않는다).",
    )
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


def is_current_format(summary: str | None) -> bool:
    """이미 **새 규격**(2026-08-25)으로 만들어진 요약인가.

    새 규격 정리본은 반드시 「> 한 줄 핵심 요약」 인용 블록으로 시작한다. 옛 규격은
    `## 투자포인트` 로 시작했다. 이 차이를 재개 표식으로 쓴다.

    🔴 왜 표식이 필요한가 — 전량 재작성은 144편 × 3~4분이라 여러 시간이 걸린다. 중간에
       끊겼을 때 `--force` 가 처음부터 다시 돌면 영영 끝나지 않는다. 이미 새 규격인 것은
       건너뛰어야 다시 돌릴 때마다 앞으로 나아간다(정말 전부 다시 만들려면 `--redo-all`).
    """
    if not summary:
        return False
    return summary.lstrip().startswith(">")


def load_targets(client, args: argparse.Namespace) -> list[dict]:
    """요약 대상 — 선별 규칙에 걸리는 것, 오래된 것부터.

    평소에는 summary 가 비어 있는 것만 고른다. `--force` 면 이미 요약된 것도 포함한다
    (요약 규칙이 바뀌면 전량을 새 규격으로 다시 만들어야 한다 — 2026-08-25).

    🔴 오래된 것부터 처리하는 순서는 `--force` 에서도 지켜야 한다. 델타의 「직전 요약」이
       이미 새 규격으로 갱신돼 있어야 비교가 성립한다.
    """
    q = (
        client.table("research_reports")
        .select("id, kind, naver_nid, target_name, ticker, company_id, title, broker, "
                "published_at, pdf_url, is_periodic, summary, view_count")
        .order("published_at", desc=False)
    )
    # 🔴 사람이 「빼라」고 한 것은 규칙과 별개로 데이터에 남아 있다. 선별 규칙이 나중에
    #    완화돼도 조용히 다시 딸려 들어오지 않게 여기서 먼저 잘라낸다.
    q = q.is_("excluded_at", "null")
    if not args.force:
        q = q.is_("summary", "null")
    if args.nid is not None:
        q = q.eq("naver_nid", args.nid)
        if args.kind:
            q = q.eq("kind", args.kind)

    rows = q.execute().data
    picked = [
        r for r in rows
        if is_relevant(r["kind"], r.get("company_id") is not None, r["title"], r["is_periodic"])
    ]
    # 🔴 중요도 선별은 **이미 끝난 것을 걸러내기 전에** 한다. 순서를 뒤집으면 「대상별 최소
    #    1편」의 그 1편이 이미 완료됐을 때 같은 대상의 다른 편이 새로 뽑혀 대상당 여러 편이
    #    쌓인다(선별의 목적이 무너진다).
    if args.priority:
        picked = select_priority(picked)
    elif not args.all:
        # 🔴 평소(정기 스케줄)의 기본값이다. 스케줄러는 인자 없이 부르므로 선별을 «기본»
        #    으로 두지 않으면 아무 리포트나 다 요약된다(2026-08-25 에 실제로 그 상태였다).
        picked = select_ongoing(picked)

    if args.force and not args.redo_all:
        picked = [r for r in picked if not is_current_format(r.get("summary"))]
    for r in picked:
        r.pop("summary", None)  # 이 뒤로는 안 쓴다 — 재료에는 새로 뽑은 본문이 들어간다
    return picked


def main() -> int:
    args = parse_args()
    client = get_client()
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    targets = load_targets(client, args)
    logger.info(f"요약 대상 {len(targets)}건 (이번 회차 최대 {args.limit}건)")
    if not targets:
        return EXIT_OK

    if args.list_only:
        # 무엇이 뽑혔는지 눈으로 확인하는 용도. 파일로 남겨 콘솔 인코딩에 안 휘둘리게 한다
        # (Windows 콘솔이 CP949 라 한글 로그가 깨져 보인다 — 파일은 멀쩡하다).
        out = TMP_DIR / "priority_targets.md"
        lines = [f"# 요약 대상 {len(targets)}건", ""]
        for r in targets:
            lines.append(
                f"- [{score_report(r):2d}점] {r.get('published_at')} · "
                f"{'산업' if r['kind'] == 'industry' else '종목'} · "
                f"{r['target_name']} · {r.get('broker') or '(미상)'} — {r['title']}"
            )
        out.write_text("\n".join(lines), encoding="utf-8")
        logger.info(f"목록만 작성: {out}")
        return EXIT_OK

    done = 0
    failed: list[str] = []

    for row in targets[: args.limit]:
        label = f"{row['target_name']}/{row.get('broker') or '?'}/{row.get('published_at')}"

        blob = fetch_pdf_bytes(row["pdf_url"]) if row.get("pdf_url") else b""
        body = pdf_text(blob)
        # 🔴 본문 글자를 글리프 이미지로 심는 증권사가 있다(미래에셋 실측). 텍스트 경로로는
        #    영영 못 읽으므로 페이지를 통째로 렌더해 헤드리스가 눈으로 읽게 한다.
        page_images: list[Path] = []
        if blob and is_image_body(len(body.strip()), pdf_page_count(blob)):
            page_images = save_page_images(row["kind"], row["naver_nid"], blob)
            if page_images:
                logger.info(f"본문이 이미지라 페이지 {len(page_images)}장을 렌더했다: {label}")
        if len(body.strip()) < MIN_PDF_TEXT:
            body = fetch_page_text(row["kind"], row["naver_nid"])
        if not page_images and len(body.strip()) < MIN_PDF_TEXT:
            failed.append(f"{label} — 본문을 얻지 못함")
            logger.warning(f"본문 없음: {label}")
            continue

        # 그림은 있으면 좋은 것이지 없으면 못 가는 것이 아니다 — 실패해도 요약은 계속한다.
        figures = collect_figures(row, blob)

        base = find_delta_base(client, row)
        mode = "delta" if base else "full"

        material_path = TMP_DIR / f"{row['kind']}_{row['naver_nid']}_material.md"
        out_path = TMP_DIR / f"{row['kind']}_{row['naver_nid']}_summary.md"
        material_path.write_text(
            build_material(row, body, base, figures, page_images), encoding="utf-8"
        )
        if out_path.exists():
            out_path.unlink()  # 지난 회차 산출물을 성공으로 오인하지 않게

        if args.dry_run:
            logger.info(f"[dry-run] {mode} 재료 작성(그림 {len(figures)}장): {material_path}")
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
                    # 🔴 의미가 바뀌었다(2026-08-25): 예전엔 「변화만 실린 요약」이라는 뜻이었고
                    #    지금은 「전체 정리본에 변화 절이 하나 더 있다」는 뜻이다.
                    "is_delta": base is not None,
                    "prev_report_id": base["id"] if base else None,
                    "images": figures,
                }).eq("id", row["id"]).execute()
        except Exception as e:
            logger.exception(f"DB 갱신 실패 {label}: {e}")
            return EXIT_DB_FAILED

        done += 1
        logger.info(f"[{done}] {mode} 완료 · 그림 {len(figures)}장 · {len(summary):,}자 — {label}")

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
