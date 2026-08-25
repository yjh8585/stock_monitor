#!/usr/bin/env python
"""네이버 증권 리서치(산업분석·종목분석) 목록 수집 → research_reports 메타 적재.

플로우:
  1. 우리 휴머노이드 종목(company_pages.page='humanoid' + KRX 6자리) 을 읽어 ticker→company_id 표를 만든다
  2. 키워드 × 종류(industry|company) 로 목록 페이지를 넘기며 행을 모은다
  3. 이미 DB 에 있는 (kind, naver_nid) 는 **건너뛴다**
  4. 새 행만 상세 페이지로 보강(잘린 제목·PDF 주소·목표주가·투자의견)
  5. WriteSession 으로 upsert

🔴 함정 1 — 이미 아는 행을 다시 쓰면 데이터가 **뒤로 간다**.
   목록의 제목은 길면 잘려 오고(`...`), 상세에서 받은 온전한 제목을 이미 저장해 뒀는데
   다음 회차가 목록 제목으로 덮으면 조용히 퇴화한다. 그래서 알려진 nid 는 건너뛴다.

🔴 함정 2 — 목록 제목이 잘리면 핵심어 판정이 빗나간다.
   그래서 상세로 온전한 제목을 받은 **뒤에** 요약 대상 여부를 다시 매긴다.

🔴 함정 3 — `keyword` 는 EUC-KR 이어야 한다(lib/naver_research.encode_keyword).
   UTF-8 로 보내면 에러 없이 빈 목록이 온다.

만회(catch-up): 별도 원장 표를 두지 않는다(사용자 결정 2026-08-24).
   저장된 리포트의 **가장 최근 발행일 - CATCHUP_MARGIN_DAYS** 부터 다시 훑는다.
   PC 가 며칠 꺼져 있어도 그 사이 글을 가져오고, 늦게 등록된 글도 여유 기간이 흡수한다.

플래그:
  --mode full|incremental   기본 incremental. full 은 --months 만큼 거슬러 전량
  --months N                full 모드에서 거슬러 갈 개월 수 (기본 6)
  --keywords "로봇,휴머노이드"   기본 KEYWORDS
  --dry-run                 DB 에 쓰지 않고 건수만 보고

사용:
  scripts/venv/Scripts/python.exe scripts/collect_naver_research.py --mode full --months 6
  scripts/venv/Scripts/python.exe scripts/collect_naver_research.py

종료 코드:
  0 정상(신규 0건도 정상 — incremental 은 대개 0건이다)
  1 full 모드인데 한 건도 못 모았다
  2 upsert 실패
  3 목록 파싱이 전부 0건 = 네이버 구조가 바뀌었다(코드 수정 필요)
"""
import argparse
import sys
import time
from datetime import date, timedelta

import requests
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession, get_client  # noqa: E402
from lib.naver_research import (  # noqa: E402
    KINDS,
    is_relevant,
    list_url,
    parse_detail_page,
    parse_list_page,
    parse_total_pages,
    read_url,
)
from lib.retry import with_retry  # noqa: E402

# 검색어. 「로봇」이 주 키워드이고(계획서 실측 407건 기준) 「휴머노이드」는 이 갈래의 주제다.
# 🔴 「감속기」·「액추에이터」를 넣으면 자동차·산업기계 리포트가 대량으로 딸려 와 표를 오염시킨다.
#    부품 리포트는 대개 제목에 로봇/휴머노이드를 함께 달고 나오므로 지금 둘로 충분하다.
KEYWORDS = ("로봇", "휴머노이드")

# 만회 여유. 늦게 등록되는 글이 있어 최신 발행일부터가 아니라 며칠 앞에서 다시 훑는다.
CATCHUP_MARGIN_DAYS = 7

# 네이버 예의 — 요청 사이 최소 간격(초). 계획서 함정 7.
REQUEST_DELAY = 0.35

# 한 번에 넘길 최대 페이지(무한 루프 방지).
MAX_PAGES = 40

USER_AGENT = "Mozilla/5.0 (stock_monitor research collector)"

EXIT_OK = 0
EXIT_EMPTY_FULL = 1
EXIT_UPSERT_FAILED = 2
EXIT_STRUCTURE_CHANGED = 3


def _fetch(url: str, label: str) -> str:
    """EUC-KR 페이지를 받아 문자열로. 순간 장애만 재시도(4xx 는 즉시 raise)."""

    def _once() -> str:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
        r.raise_for_status()
        r.encoding = "euc-kr"
        return r.text

    time.sleep(REQUEST_DELAY)
    return with_retry(_once, _label=label)


def load_tracked_companies(client) -> dict[str, str]:
    """우리가 추적하는 휴머노이드 종목 ticker → company_id."""
    rows = (
        client.table("company_pages")
        .select("company_id, companies(id, ticker)")
        .eq("page", "humanoid")
        .execute()
        .data
    )
    out: dict[str, str] = {}
    for r in rows:
        c = r.get("companies") or {}
        ticker = c.get("ticker")
        if ticker and ticker.isdigit() and len(ticker) == 6:
            out[ticker] = c["id"]
    return out


def load_known_nids(client) -> set[tuple[str, int]]:
    """이미 저장된 (kind, naver_nid). 이 조합은 건너뛴다(함정 1)."""
    known: set[tuple[str, int]] = set()
    page_size = 1000
    offset = 0
    while True:
        rows = (
            client.table("research_reports")
            .select("kind, naver_nid")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
        )
        if not rows:
            break
        for r in rows:
            known.add((r["kind"], r["naver_nid"]))
        if len(rows) < page_size:
            break
        offset += page_size
    return known


def resolve_since(client, mode: str, months: int) -> date:
    """이 회차가 거슬러 갈 하한 날짜."""
    if mode == "full":
        return date.today() - timedelta(days=30 * months)

    rows = (
        client.table("research_reports")
        .select("published_at")
        .order("published_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows or not rows[0].get("published_at"):
        # 표가 비어 있으면 증분이 성립하지 않는다 → full 과 같게 본다.
        return date.today() - timedelta(days=30 * months)
    latest = date.fromisoformat(rows[0]["published_at"])
    return latest - timedelta(days=CATCHUP_MARGIN_DAYS)


def collect_kind(
    kind: str,
    keyword: str,
    since: date,
    known: set[tuple[str, int]],
    seen: set[tuple[str, int]],
) -> tuple[list[dict], int]:
    """한 (종류, 키워드) 조합의 목록을 넘기며 새 행을 모은다.

    돌려주는 두 번째 값은 **파싱된 행 수**다(새 행이 아니라). 0 이면 구조 변경 신호.
    """
    collected: list[dict] = []
    parsed_total = 0
    total_pages = MAX_PAGES

    for page in range(1, MAX_PAGES + 1):
        if page > total_pages:
            break
        html = _fetch(list_url(kind, keyword, page), f"{kind}/{keyword} p{page}")
        if page == 1:
            total_pages = min(parse_total_pages(html), MAX_PAGES)

        rows = parse_list_page(html, kind)
        parsed_total += len(rows)
        if not rows:
            break

        reached_old = False
        for row in rows:
            published = row.get("published_at")
            if published is not None and published < since:
                reached_old = True
                continue
            key = (row["kind"], row["naver_nid"])
            if key in known or key in seen:
                continue
            seen.add(key)
            collected.append(row)

        # 목록은 최신순이라, 하한보다 오래된 글이 나오기 시작하면 그 뒤는 볼 필요가 없다.
        if reached_old:
            break

    return collected, parsed_total


def enrich(row: dict, tracked: dict[str, str]) -> dict:
    """상세 페이지로 제목·PDF·목표주가를 보강하고 요약 대상 여부를 확정한다."""
    try:
        html = _fetch(read_url(row["kind"], row["naver_nid"]), f"detail {row['naver_nid']}")
        # 🔴 목록에서 받은 증권사·분류명을 함께 넘겨야 제목에서 그 장식을 정확히 떼어낸다.
        #    안 넘기면 제목이 분류명("기타"·"조선")으로 덮인다.
        detail = parse_detail_page(
            html, broker=row.get("broker"), target_name=row.get("target_name")
        )
    except Exception as e:  # 상세 실패는 치명적이지 않다 — 목록 정보로 남긴다
        logger.warning(f"상세 실패 nid={row['naver_nid']}: {e}")
        detail = {}

    # 안전망 — 상세 제목이 분류명과 같아지면 파싱이 틀린 것이다. 그럴 땐 목록 제목을 지킨다.
    detail_title = detail.get("title")
    if detail_title and detail_title != row.get("target_name"):
        row["title"] = detail_title
    if detail.get("pdf_url"):
        row["pdf_url"] = detail["pdf_url"]
    if detail.get("target_price") is not None:
        row["target_price"] = detail["target_price"]
    if detail.get("opinion"):
        row["opinion"] = detail["opinion"]

    company_id = tracked.get(row.get("ticker") or "")
    row["company_id"] = company_id

    # 🔴 함정 2 — 온전한 제목을 받은 뒤에 다시 판정한다. 잘린 제목으로 매기면
    #    핵심어가 뒤쪽에 있던 산업 리포트를 통째로 놓친다.
    row["_is_relevant"] = is_relevant(
        row["kind"],
        bool(company_id),
        row["title"],
        row["is_periodic"],
    )
    return row


def to_db_row(row: dict) -> dict:
    published = row.get("published_at")
    return {
        "source": "naver",
        "kind": row["kind"],
        "naver_nid": row["naver_nid"],
        "target_name": row["target_name"],
        "company_id": row.get("company_id"),
        "ticker": row.get("ticker"),
        "title": row["title"],
        "broker": row.get("broker"),
        "published_at": published.isoformat() if published else None,
        "pdf_url": row.get("pdf_url"),
        "view_count": row.get("view_count"),
        "target_price": row.get("target_price"),
        "opinion": row.get("opinion"),
        "is_periodic": row["is_periodic"],
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="네이버 증권 리서치 목록 수집")
    p.add_argument("--mode", choices=["full", "incremental"], default="incremental",
                   help="full=지정 개월 전량 · incremental=저장된 최신분 이후만")
    p.add_argument("--months", type=int, default=6, help="full 모드에서 거슬러 갈 개월 수")
    p.add_argument("--keywords", default=",".join(KEYWORDS), help="쉼표로 구분한 검색어")
    p.add_argument("--dry-run", action="store_true", help="DB 에 쓰지 않고 건수만 보고")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]
    client = get_client()

    tracked = load_tracked_companies(client)
    known = load_known_nids(client)
    since = resolve_since(client, args.mode, args.months)
    logger.info(
        f"수집 시작 mode={args.mode} since={since} keywords={keywords} "
        f"추적종목={len(tracked)}사 기존={len(known)}건"
    )

    seen: set[tuple[str, int]] = set()
    new_rows: list[dict] = []
    parsed_any = 0

    for kind in KINDS:
        for keyword in keywords:
            rows, parsed = collect_kind(kind, keyword, since, known, seen)
            parsed_any += parsed
            logger.info(f"  {kind}/{keyword}: 파싱 {parsed}건 → 신규 {len(rows)}건")
            new_rows.extend(rows)

    # 🔴 목록을 한 건도 못 읽었다면 네이버 구조가 바뀐 것이다. "새 글이 없다"와 구분한다.
    if parsed_any == 0:
        logger.error("목록 파싱이 전부 0건 — 네이버 페이지 구조가 바뀌었을 수 있다")
        return EXIT_STRUCTURE_CHANGED

    if not new_rows:
        logger.info("신규 0건")
        return EXIT_EMPTY_FULL if args.mode == "full" else EXIT_OK

    # 🔴 정기물은 상세를 받아 볼 것도 없다. 목록 제목만으로 확정 배제되므로 여기서 잘라
    #    상세 요청을 통째로 아낀다(실측 2026-08-25: 407건 중 121건이 정기물).
    #    목록 제목이 잘려 키워드를 놓친 경우는 is_periodic=False 로 통과해 아래에서
    #    온전한 제목으로 다시 판정되므로, 놓치는 쪽으로만 틀린다.
    periodic = [r for r in new_rows if r["is_periodic"]]
    candidates = [r for r in new_rows if not r["is_periodic"]]
    if periodic:
        logger.info(f"정기물 {len(periodic)}건 — 상세 생략·저장 안 함")

    logger.info(f"상세 보강 {len(candidates)}건")
    enriched = [enrich(r, tracked) for r in candidates]

    # 🔴 비관련 행은 **저장하지 않는다**(사용자 지시·승인 2026-08-25). 화면에서만 걸러
    #    두면 지운 251건이 다음 수집 때 그대로 되살아난다.
    relevant = [r for r in enriched if r["_is_relevant"]]
    dropped = len(new_rows) - len(relevant)
    logger.info(f"신규 {len(new_rows)}건 → 관련 {len(relevant)}건 (비관련 {dropped}건 버림)")

    if args.dry_run:
        logger.info("dry-run — DB 에 쓰지 않았다")
        return EXIT_OK

    if not relevant:
        logger.info("관련 리포트 0건 — 저장할 것이 없다")
        return EXIT_OK

    db_rows = [to_db_row(r) for r in relevant]
    try:
        with WriteSession() as w:
            w.table("research_reports").upsert(
                db_rows, on_conflict="kind,naver_nid"
            ).execute()
    except Exception as e:
        logger.exception(f"upsert 실패: {e}")
        return EXIT_UPSERT_FAILED

    logger.success(f"적재 완료 {len(db_rows)}건")
    return EXIT_OK


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.warning("사용자 중단")
        sys.exit(130)
    except Exception as e:
        logger.exception(f"예기치 못한 오류: {e}")
        sys.exit(1)
