#!/usr/bin/env python
"""목표주가가 단위 버그로 망가진 research_reports 행을 상세 페이지에서 다시 읽어 고친다.

배경(2026-08-25 실측):
  옛 정규식이 `목표(?:주)?가\\s*[:\\s]*([0-9,]+)` 라 「목표주가 35.6만원」에서 `35` 만
  집어냈다. 소수점 앞에서 끊기고 「만원」을 통째로 버린 것이다. 65건 중 26건이 이렇게
  1/10000 로 저장돼 있었다(리포트 정리 후 잔존 16건).

  🔴 DB 값만으로는 복원할 수 없다 — `35` 가 35원인지 35만원인지 행 안에 근거가 없다.
     그래서 상세 페이지를 다시 받아 고친 파서(`parse_target_price`)로 재판정한다.

대상: target_price 가 비정상적으로 작은 행(기본 1,000원 미만). 한국 상장사 주가에
      1,000원 미만 목표가는 사실상 없다.

사용:
  scripts/venv/Scripts/python.exe scripts/recheck_research_target_price.py --dry-run
  scripts/venv/Scripts/python.exe scripts/recheck_research_target_price.py

종료 코드: 0 정상(대상 0건 포함) · 1 한 건도 고치지 못했다(대상은 있었는데)
"""
import argparse
import sys

import requests
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession, get_client  # noqa: E402
from lib.naver_research import parse_detail_page, read_url  # noqa: E402
from lib.retry import with_retry  # noqa: E402

# 이 값 미만이면 단위 버그로 본다. 국내 상장사 목표주가가 세 자리일 수는 없다.
SUSPICIOUS_BELOW = 1_000

USER_AGENT = "Mozilla/5.0 (stock_monitor research target-price recheck)"


def fetch_detail(kind: str, nid: int, broker: str | None, target_name: str | None) -> dict:
    """상세 페이지를 받아 고친 파서로 다시 읽는다."""

    def _once() -> str:
        r = requests.get(read_url(kind, nid), headers={"User-Agent": USER_AGENT}, timeout=30)
        r.raise_for_status()
        r.encoding = "euc-kr"
        return r.text

    html = with_retry(_once, _label=f"detail {kind}/{nid}")
    return parse_detail_page(html, broker=broker, target_name=target_name)


def main() -> int:
    p = argparse.ArgumentParser(description="목표주가 단위 버그 재수집")
    p.add_argument("--dry-run", action="store_true", help="DB 에 쓰지 않고 비교만 출력")
    p.add_argument("--below", type=int, default=SUSPICIOUS_BELOW, help="이 값 미만을 대상으로")
    args = p.parse_args()

    rows = (
        get_client()
        .table("research_reports")
        .select("id, kind, naver_nid, target_name, broker, title, target_price")
        .lt("target_price", args.below)
        .execute()
        .data
        or []
    )
    logger.info(f"대상 {len(rows)}건 (target_price < {args.below:,})")
    if not rows:
        return 0

    fixed = 0
    for row in rows:
        label = f"{row['target_name']}/{row.get('broker') or '?'}"
        try:
            detail = fetch_detail(
                row["kind"], row["naver_nid"], row.get("broker"), row.get("target_name")
            )
        except Exception as e:
            logger.warning(f"{label}: 상세 실패 — {e}")
            continue

        new_price = detail.get("target_price")
        old_price = row.get("target_price")
        if new_price is None:
            # 상세에서 목표가를 못 찾았다. 옛 값이 틀린 것은 확실하므로 지운다.
            logger.info(f"{label}: 상세에 목표가 없음 — {old_price} → NULL")
        elif new_price == old_price:
            logger.info(f"{label}: 변화 없음 ({old_price})")
            continue
        else:
            logger.info(f"{label}: {old_price} → {new_price:,}")

        if args.dry_run:
            fixed += 1
            continue

        try:
            with WriteSession() as w:
                w.table("research_reports").update(
                    {"target_price": new_price, "opinion": detail.get("opinion") or None}
                ).eq("id", row["id"]).execute()
            fixed += 1
        except Exception as e:
            logger.error(f"{label}: UPDATE 실패 — {e}")

    logger.info(f"{'(dry-run) ' if args.dry_run else ''}처리 {fixed}/{len(rows)}건")
    return 0 if fixed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.warning("사용자 중단")
        sys.exit(130)
