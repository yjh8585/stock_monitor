#!/usr/bin/env python3
"""Stellantis IR 홈페이지(stellantis.com) 분기 estimated 출하 → stellantis_shipments 직접 적재.

2026-01부터 분기마다 'Estimated Consolidated Shipments' 릴리스가 **지역별 절대값 표**를 싣는다
(첫 열 'units/000'). North America 당기 값을 직접 읽어 is_derived=False로 적재한다.

왜 IR 홈페이지를 primary로 쓰나 (사용자 지시 2026-07-16):
  - **EDGAR보다 먼저 나온다.** 분기 estimated 출하 릴리스는 재무결과(EDGAR 6-K)보다 ~2주 빠르다.
    실측: Q2 2026 estimated 출하는 7월 중순 공시, H1 2026 재무결과는 7/30 예정.
  - **분기 절대값을 직접 준다.** EDGAR는 Q1/H1/Q3/FY만 실어 Q2=H1−Q1로 차분 도출해야 했으나
    (±1천대 반올림 오차), IR 분기 릴리스는 Q2 445천대를 표에 그대로 싣는다 → is_derived=False.
  - EDGAR 수집(collect_stellantis_shipments.py)은 **pre-2026 백필 + 교차검증(보완)** 을 맡는다.

접근 방식:
  - stellantis.com은 **Akamai가 curl/requests를 403 차단** → Playwright 실브라우저로 가져온다.
  - 목록 페이지(/en/news/press-releases)에서 슬러그로 출하 PR을 자동 발견한다
    (`stellantis-reports-q{N}-{YYYY}-estimated-consolidated-shipments...`).
  - 각 PR의 'units/000' 표에서 헤더 첫 열이 슬러그의 (분기,연도)와 일치하는지 확인한 뒤
    'North America' 행의 첫 숫자(당기 천대)를 읽는다.

⚠️ 기준 주의: 2026-01-01부로 출하가 **'where sold' 기준**으로 바뀌고 마세라티가 지역에 합산됐다
   (별도 세그먼트 폐지). pre-2026 EDGAR 값(마세라티 제외)과 완전히 같은 기준은 아니다 —
   북미 마세라티는 분기 수천 대로 작아 방향성엔 영향이 미미하나 절대 수준 비교 시 유의.

단위: 표는 천대('units/000') → DB엔 대(units)로 ×1000 환산.

플래그:
  --year-from 2026   수집 시작 연도 (default 2026 — estimated 릴리스 시작 연도)
  --year-to <year>   마지막 연도 (default 현재 연도)
  --dry-run          DB 쓰기 없이 파싱 결과만 출력
  --revalidate-prod  로컬 실행 시 프로덕션 캐시도 무효화

사용:
  scripts/venv/Scripts/python.exe scripts/collect_stellantis_shipments_ir.py --dry-run
"""
import argparse
import re
import sys
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession  # noqa: E402
from lib.revalidate import revalidate_prod_for_tables  # noqa: E402

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------
BASE = 'https://www.stellantis.com'
LISTING_URL = f'{BASE}/en/news/press-releases'
# 실브라우저를 가장해 Akamai 봇 차단을 우회한다.
USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
)
NAV_TIMEOUT_MS = 60000
SETTLE_MS = 3500

DEFAULT_YEAR_FROM = 2026  # 분기 estimated 출하 릴리스가 지역별 표를 싣기 시작한 연도
UNITS_PER_THOUSAND = 1000

DB_TABLE = 'stellantis_shipments'
DB_CONFLICT_COLS = 'region,period_type,year_period'
REGION_NORTH_AMERICA = 'North America'
PERIOD_TYPE_QUARTER = 'quarter'

# 출하 PR 슬러그: '.../stellantis-reports-q2-2026-estimated-consolidated-shipments-...'
SHIPMENT_SLUG_RE = re.compile(
    r'/press-releases/\d{4}/[a-z]+/'
    r'stellantis-reports-q([1-4])-(20\d{2})-estimated-consolidated-shipments',
    re.I,
)
# 표 헤더의 기간 셀: 'Q2 2026'
PERIOD_CELL_RE = re.compile(r'^Q([1-4])\s+(20\d{2})$', re.I)
# 숫자 셀: '445' / '1,597' / '(4)'(음수)
NUMERIC_CELL_RE = re.compile(r'^\(?-?[\d,]+\)?$')
NORTH_AMERICA_LABEL = 'north america'


# ---------------------------------------------------------------------------
# 순수 파싱 (scripts/lib/test_stellantis_shipments_ir.py 가 고정)
# ---------------------------------------------------------------------------
def parse_slug_period(url: str) -> tuple[int, int] | None:
    """출하 PR URL → (분기, 연도). 아니면 None."""
    m = SHIPMENT_SLUG_RE.search(url)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def parse_numeric_cell(cell: str) -> int | None:
    """'445' → 445, '1,597' → 1597, '(4)' → -4, '10%' → None."""
    cell = cell.strip()
    if not NUMERIC_CELL_RE.match(cell):
        return None
    negative = cell.startswith('(') and cell.endswith(')')
    digits = cell.strip('()').replace(',', '')
    if not digits or digits == '-':
        return None
    try:
        value = int(digits)
    except ValueError:
        return None
    return -value if negative else value


def find_current_period_column(rows: list[list[str]], quarter: int, year: int) -> int | None:
    """헤더 행에서 'Q{quarter} {year}' 셀의 열 인덱스를 찾는다.

    표 레이아웃(라벨 열 포함 여부)이 바뀌어도 당기 열을 정확히 집기 위해, 값이 아니라
    헤더 문자열로 위치를 정한다. 헤더의 첫 기간 셀이 슬러그의 (분기,연도)와 일치해야
    올바른 릴리스를 파싱하는 것이다.
    """
    for row in rows:
        for idx, cell in enumerate(row):
            m = PERIOD_CELL_RE.match(cell.strip())
            if m and int(m.group(1)) == quarter and int(m.group(2)) == year:
                return idx
    return None


def extract_north_america_thousands(
    rows: list[list[str]], quarter: int, year: int
) -> int | None:
    """정규화된 표 행 → North America 당기 출하(천대).

    1) 헤더에서 'Q{quarter} {year}' 열 인덱스를 찾는다(당기 열 확정 + 릴리스 정합 검증).
    2) 'North America' 행에서 그 열 값을 읽는다. 라벨 열 유무로 인덱스가 밀릴 수 있어,
       라벨을 제외한 숫자 셀만 모아 첫 숫자(=당기)를 쓰되, 헤더 정합이 실패하면 None.
    """
    period_col = find_current_period_column(rows, quarter, year)
    if period_col is None:
        return None
    for row in rows:
        if not row:
            continue
        if row[0].strip().lower() != NORTH_AMERICA_LABEL:
            continue
        # 라벨 셀(첫 셀)을 뺀 숫자 셀들. 헤더 첫 기간이 당기이므로 첫 숫자가 당기 값이다.
        numerics = [parse_numeric_cell(c) for c in row[1:]]
        numerics = [n for n in numerics if n is not None]
        if numerics:
            return numerics[0]
    return None


# ---------------------------------------------------------------------------
# Playwright 수집 (네트워크)
# ---------------------------------------------------------------------------
def _table_rows(page: Any) -> list[list[list[str]]]:
    """현재 페이지의 모든 <table> → 표별 정규화 행(빈 셀 제거)."""
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('table')).map(t =>
            Array.from(t.querySelectorAll('tr')).map(tr =>
                Array.from(tr.querySelectorAll('th,td'))
                    .map(c => (c.innerText || '').replace(/\\u00a0/g, ' ').trim())
                    .filter(x => x !== '')
            ).filter(r => r.length > 0)
        )"""
    )


def discover_shipment_prs(page: Any, year_from: int, year_to: int) -> list[tuple[int, int, str]]:
    """목록 페이지 → [(연도, 분기, url)] (연도 오름차순·분기 오름차순)."""
    page.goto(LISTING_URL, wait_until='domcontentloaded', timeout=NAV_TIMEOUT_MS)
    page.wait_for_timeout(SETTLE_MS)
    hrefs: list[str] = page.evaluate(
        "() => Array.from(document.querySelectorAll('a[href]')).map(a => a.href)"
    )
    found: dict[tuple[int, int], str] = {}
    for href in hrefs:
        parsed = parse_slug_period(href)
        if not parsed:
            continue
        quarter, year = parsed
        if year < year_from or year > year_to:
            continue
        found.setdefault((year, quarter), href.split('?')[0])
    return [(y, q, url) for (y, q), url in sorted(found.items())]


def fetch_na_thousands(page: Any, quarter: int, year: int, url: str) -> int | None:
    """출하 PR 페이지 → North America 당기 출하(천대). 실패 시 None."""
    page.goto(url, wait_until='domcontentloaded', timeout=NAV_TIMEOUT_MS)
    page.wait_for_timeout(SETTLE_MS)
    for rows in _table_rows(page):
        value = extract_north_america_thousands(rows, quarter, year)
        if value is not None:
            return value
    return None


def build_db_row(year: int, quarter: int, thousands: int, url: str) -> dict[str, Any]:
    return {
        'region': REGION_NORTH_AMERICA,
        'period_type': PERIOD_TYPE_QUARTER,
        'year_period': f'{year}-Q{quarter}',
        'shipments_units': thousands * UNITS_PER_THOUSAND,
        'is_derived': False,  # IR 분기 표의 절대값 — 차분 도출이 아니다
        'source_url': url,
        'filing_date': None,  # PR 게재일은 페이지에 일관된 마크업이 없어 생략(nullable)
        'collected_at': datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description='Stellantis IR 홈페이지 분기 출하 수집.')
    p.add_argument('--year-from', type=int, default=DEFAULT_YEAR_FROM)
    p.add_argument('--year-to', type=int, default=None)
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--revalidate-prod', action='store_true',
                   help='로컬 실행 시 프로덕션 캐시도 무효화')
    return p.parse_args()


def main() -> int:
    args = parse_args()
    year_to = args.year_to or datetime.now(timezone.utc).year
    logger.info(
        f'Stellantis IR 출하 수집: {args.year_from}~{year_to} dry_run={args.dry_run}'
    )

    from playwright.sync_api import sync_playwright

    rows: list[dict[str, Any]] = []
    failures: list[str] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=USER_AGENT, locale='en-US',
                                  viewport={'width': 1400, 'height': 1200})
        page = ctx.new_page()
        try:
            prs = discover_shipment_prs(page, args.year_from, year_to)
        except Exception as e:
            logger.exception(f'출하 PR 발견 실패: {e}')
            browser.close()
            return 2
        if not prs:
            logger.error('대상 출하 PR 없음 — 목록 페이지 구조 또는 연도 범위 확인.')
            browser.close()
            return 1
        logger.info(f'발견한 출하 PR {len(prs)}건:')
        for year, quarter, url in prs:
            logger.info(f'  {year}-Q{quarter}: {url.replace(BASE, "")}')

        for year, quarter, url in prs:
            try:
                thousands = fetch_na_thousands(page, quarter, year, url)
            except Exception as e:
                failures.append(f'{year}-Q{quarter}: fetch 실패 — {e}')
                logger.error(f'  {year}-Q{quarter}: {e}')
                continue
            if thousands is None:
                failures.append(f'{year}-Q{quarter}: North America 행/헤더 정합 실패')
                logger.error(f'  {year}-Q{quarter}: North America 표 파싱 실패 — {url}')
                continue
            rows.append(build_db_row(year, quarter, thousands, url))
            logger.info(f'  {year}-Q{quarter}: 북미 {thousands:,}천대')
        browser.close()

    logger.info(f'적재 대상 {len(rows)}행:')
    for row in rows:
        logger.info(f'  {row["year_period"]}  {row["shipments_units"]:>9,}대  [실측]')
    if failures:
        logger.warning(f'실패 {len(failures)}건:')
        for f in failures:
            logger.warning(f'  {f}')

    if args.dry_run:
        logger.success(f'dry-run 종료 (DB 쓰기 없음). rows={len(rows)}')
        return 1 if failures else 0
    if not rows:
        logger.warning('적재할 행 없음 — DB 호출 생략')
        return 1

    try:
        with WriteSession() as w:
            w.table(DB_TABLE).upsert(rows, on_conflict=DB_CONFLICT_COLS).execute()
        logger.success(f'{DB_TABLE} upsert 완료: {len(rows)}행')
    except Exception as e:
        logger.exception(f'upsert 실패: {e}')
        return 2

    if args.revalidate_prod:
        revalidate_prod_for_tables([DB_TABLE])
    return 1 if failures else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        logger.warning('사용자 중단')
        sys.exit(130)
    except Exception as e:
        logger.exception(f'예기치 못한 오류: {e}')
        sys.exit(1)
