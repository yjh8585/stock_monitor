#!/usr/bin/env python
"""네이버 증권 리서치(산업분석·종목분석) 목록 수집 → research_reports 메타 적재.

플로우:
  1. 우리 휴머노이드 종목(company_pages.page='humanoid' + KRX 6자리) 을 읽어 ticker→company_id 표를 만든다
  2. 종류(industry|company) 별로 목록 API 를 넘기며 행을 모은다
  3. 이미 DB 에 있는 (kind, naver_nid) 는 **건너뛴다**
  4. 새 행만 상세 페이지로 보강(잘린 제목·PDF 주소·목표주가·투자의견)
  5. WriteSession 으로 upsert

🔴 2026-09-12 — 네이버 금융이 Next.js 로 개편돼 **HTML 목록이 통째로 사라졌다.**
   모바일 JSON API 로 갈아탔다(응답 모양·경위 = `lib/naver_research.py` 머리말).
   그때 **키워드 검색도 함께 사라져** 전체를 받아 `is_relevant()` 로 거른다.
   ⚠️ 회수율 손해는 없다(정리본 76건 기준 100% 재현 — 제목 핵심어 94% + itemCode 6%).

🔴 함정 1 — 이미 아는 행을 다시 쓰면 데이터가 **뒤로 간다**. 그래서 알려진 nid 는 건너뛴다.

🔴 함정 2 — 상세로 온전한 제목을 받은 **뒤에** 요약 대상 여부를 매긴다.
   새 API 는 목록 제목도 안 자르지만, 판정 순서는 그대로 둔다(상세가 더 정확하다).

만회(catch-up): 별도 원장 표를 두지 않는다(사용자 결정 2026-08-24).
   저장된 리포트의 **가장 최근 발행일 - CATCHUP_MARGIN_DAYS** 부터 다시 훑는다.
   PC 가 며칠 꺼져 있어도 그 사이 글을 가져오고, 늦게 등록된 글도 여유 기간이 흡수한다.

플래그:
  --mode full|incremental   기본 incremental. full 은 --months 만큼 거슬러 전량
  --months N                full 모드에서 거슬러 갈 개월 수 (기본 6)
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
    API_HEADERS,
    KINDS,
    MIN_BODY_TEXT,
    is_relevant,
    list_url,
    parse_detail_payload,
    parse_list_payload,
    read_url,
)
from lib.retry import with_retry  # noqa: E402

# 만회 여유. 늦게 등록되는 글이 있어 최신 발행일부터가 아니라 며칠 앞에서 다시 훑는다.
CATCHUP_MARGIN_DAYS = 7

# 네이버 예의 — 요청 사이 최소 간격(초). 계획서 함정 7.
REQUEST_DELAY = 0.35

# 한 번에 넘길 최대 페이지(무한 루프 방지). 한 페이지가 100건이고 날짜 하한에 닿으면
# 먼저 멈추므로, 이 값은 「하한을 못 만났을 때의 안전판」이다.
MAX_PAGES = 40

EXIT_OK = 0
EXIT_EMPTY_FULL = 1
EXIT_UPSERT_FAILED = 2
EXIT_STRUCTURE_CHANGED = 3


def _fetch(url: str, label: str):
    """JSON API 를 받아 파이썬 객체로. 순간 장애만 재시도(4xx 는 즉시 raise).

    🔴 `r.encoding = "euc-kr"` 를 되살리지 말 것 — 옛 HTML 페이지 때의 잔재다.
       새 API 는 UTF-8 JSON 이라 EUC-KR 로 읽으면 한글이 통째로 깨진다.
    """

    def _once():
        r = requests.get(url, headers=API_HEADERS, timeout=20)
        r.raise_for_status()
        return r.json()

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
    since: date,
    known: set[tuple[str, int]],
    seen: set[tuple[str, int]],
) -> tuple[list[dict], int]:
    """한 종류(산업분석|종목분석)의 목록을 `since` 까지 거슬러 훑으며 새 행을 모은다.

    돌려주는 두 번째 값은 **파싱된 행 수**다(새 행이 아니라). 0 이면 구조 변경 신호.

    🔴 옛 시그니처에 있던 `keyword` 가 없다 — 새 API 는 검색을 받지 않는다.
       전체를 받아 뒤에서 `is_relevant()` 로 거른다(경위 = `lib/naver_research.py` 머리말).
       총 페이지 수를 알려 주는 필드도 없어서 **빈 응답이 끝**이다.
    """
    collected: list[dict] = []
    parsed_total = 0

    for page in range(1, MAX_PAGES + 1):
        payload = _fetch(list_url(kind, page), f"{kind} p{page}")
        rows = parse_list_payload(payload, kind)
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
        payload = _fetch(read_url(row["kind"], row["naver_nid"]), f"detail {row['naver_nid']}")
        detail = parse_detail_payload(
            payload, broker=row.get("broker"), target_name=row.get("target_name")
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
    # 🔴 요약할 재료가 있나. PDF 가 있으면 그것으로 충분하고, 없으면 상세 본문 길이로 본다.
    #    2026-08-25: 이 판정이 없어서 신한투자증권 12건이 "정리 안 된 카드"로 남았다
    #    (네이버에 PDF 를 안 올리고 자사 팝업으로 보내 원문을 받을 수 없다).
    row["_has_material"] = bool(row.get("pdf_url")) or int(detail.get("body_len") or 0) >= MIN_BODY_TEXT

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
    p.add_argument("--dry-run", action="store_true", help="DB 에 쓰지 않고 건수만 보고")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    client = get_client()

    tracked = load_tracked_companies(client)
    known = load_known_nids(client)
    since = resolve_since(client, args.mode, args.months)
    logger.info(
        f"수집 시작 mode={args.mode} since={since} "
        f"추적종목={len(tracked)}사 기존={len(known)}건"
    )

    seen: set[tuple[str, int]] = set()
    new_rows: list[dict] = []
    parsed_any = 0

    for kind in KINDS:
        rows, parsed = collect_kind(kind, since, known, seen)
        parsed_any += parsed
        logger.info(f"  {kind}: 파싱 {parsed}건 → 신규 {len(rows)}건")
        new_rows.extend(rows)

    # 🔴 목록을 한 건도 못 읽었다면 네이버 구조가 바뀐 것이다. "새 글이 없다"와 구분한다.
    if parsed_any == 0:
        logger.error("목록 파싱이 전부 0건 — 네이버 페이지 구조가 바뀌었을 수 있다")
        return EXIT_STRUCTURE_CHANGED

    if not new_rows:
        logger.info("신규 0건")
        return EXIT_EMPTY_FULL if args.mode == "full" else EXIT_OK

    # 🔴 목록 단계에서 먼저 거른다 — 상세 요청을 아끼려는 것이다.
    #    키워드 검색이 사라져 이제 «전체»가 들어오므로(2026-09-12 개편), 거르지 않으면
    #    관련 없는 리포트 300건의 상세를 받느라 회차마다 6분씩 쓴다(실측).
    #    ⚠️ 이 1차 거름이 안전한 이유는 **새 API 의 목록 제목이 안 잘리기 때문**이다
    #       (옛 HTML 목록은 길면 `...` 로 잘려서 목록 제목으로 판정하면 안 됐다).
    #       그래도 상세를 받은 뒤 `enrich()` 가 온전한 제목으로 **다시** 판정한다.
    candidates = [
        r
        for r in new_rows
        if is_relevant(
            r["kind"],
            bool(tracked.get(r.get("ticker") or "")),
            r["title"],
            r["is_periodic"],
        )
    ]
    dropped = len(new_rows) - len(candidates)
    if dropped:
        logger.info(f"목록 단계에서 {dropped}건 배제(정기물·비관련) — 상세 생략")

    logger.info(f"상세 보강 {len(candidates)}건")
    enriched = [enrich(r, tracked) for r in candidates]

    # 🔴 비관련 행은 **저장하지 않는다**(사용자 지시·승인 2026-08-25). 화면에서만 걸러
    #    두면 지운 251건이 다음 수집 때 그대로 되살아난다.
    relevant = [r for r in enriched if r["_is_relevant"] and r["_has_material"]]
    no_material = sum(1 for r in enriched if r["_is_relevant"] and not r["_has_material"])
    if no_material:
        logger.info(f"요약 재료 없음 {no_material}건 — 저장 안 함(원문을 받을 수 없다)")
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
