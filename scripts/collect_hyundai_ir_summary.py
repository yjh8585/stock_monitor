#!/usr/bin/env python3
"""현대차 IR 사이트 지역별 판매실적 (도매 기준) → hyundai_export_regions 적재.

플로우:
  1. API POST /wsvc/ww/salesPerformanceSummary.item.do?year=YYYY&lang=ko 호출.
  2. resp.data.item.data[] → {name: region_name, intCount: sales_units}
  3. hyundai_export_regions upsert:
       - period_type='annual', year_period='YYYY'
       - source='ir-summary'
       - region_name (한국어): '북미'/'국내'/'유럽'/'인도'/'중남미'/'아중동'/'아태'/'중국'/'기타'
         (2023+ 9개, 2021/2022는 '러시아' 포함 8개)
       - sales_units=intCount, source_url=API URL

특징:
  - 도매 기준(현대 사이트 공식 hover 데이터) — sales-by-model의 '수출' Total과 단위/시점 다를 수 있음.
  - 5연도(2021~2025) 합계가 사이트 표기 총량과 일치하는지 검증.
  - Playwright 불필요 — 순수 HTTP POST.

플래그:
  --year-from 2021     수집 시작 연도 (default 2021)
  --year-to <year>     수집 마지막 연도 (default 현재 연도)
  --dry-run            DB 쓰기 없이 print

사용:
  scripts/venv/Scripts/python.exe scripts/collect_hyundai_ir_summary.py \\
    --year-from 2021 --year-to 2025 --dry-run
"""
import argparse
import sys
from datetime import datetime, timezone

import requests
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession  # noqa: E402

API_URL = 'https://www.hyundai.com/wsvc/ww/salesPerformanceSummary.item.do'
DEFAULT_YEAR_FROM = 2021
HTTP_TIMEOUT_S = 20
REQUEST_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  ),
  'Referer': 'https://www.hyundai.com/worldwide/ko/company/ir/ir-resources/sales-results',
  'Origin': 'https://www.hyundai.com',
}


def fetch_year_summary(year: int) -> dict | None:
  """단일 연도의 hover summary JSON 반환. 실패 시 None."""
  try:
    resp = requests.post(
      f'{API_URL}?year={year}&lang=ko',
      headers=REQUEST_HEADERS,
      data='',
      timeout=HTTP_TIMEOUT_S,
    )
  except Exception as e:
    logger.error(f'{year}년 API 호출 실패: {e}')
    return None
  if resp.status_code != 200:
    logger.warning(f'{year}년 status {resp.status_code}: {resp.text[:200]}')
    return None
  try:
    js = resp.json()
  except Exception as e:
    logger.error(f'{year}년 JSON 파싱 실패: {e}')
    return None
  if (js.get('resultCode') or '') != '0000':
    logger.warning(f'{year}년 resultCode != 0000: {js.get("resultCode")}')
    return None
  item = (js.get('data') or {}).get('item') or {}
  if not item.get('data'):
    logger.warning(f'{year}년 data[] 비어있음')
    return None
  return item


def build_rows(year: int, item: dict) -> list[dict]:
  """item.data[] → hyundai_export_regions rows."""
  rows: list[dict] = []
  src_url = f'{API_URL}?year={year}&lang=ko'
  for entry in item.get('data') or []:
    name = (entry.get('name') or '').strip()
    units = int(entry.get('intCount') or 0)
    if not name or units <= 0:
      continue
    rows.append({
      'period_type': 'annual',
      'year_period': str(year),
      'source': 'ir-summary',
      'region_name': name,
      'sales_units': units,
      'source_url': src_url,
    })
  return rows


def print_summary(year_to_rows: dict[int, list[dict]], year_to_total: dict[int, int]) -> None:
  if not year_to_rows:
    logger.info('수집된 연도 없음')
    return
  for year in sorted(year_to_rows.keys()):
    rows = year_to_rows[year]
    computed = sum(r['sales_units'] for r in rows)
    reported = year_to_total.get(year, 0)
    delta = computed - reported
    flag = 'OK' if abs(delta) <= 5 else f'DIFF={delta:+d}'
    region_brief = ', '.join(f"{r['region_name']}={r['sales_units']:,}" for r in rows)
    logger.info(
      f'{year}: rows={len(rows)} sum={computed:,} reported={reported:,} [{flag}]'
    )
    logger.debug(f'  → {region_brief}')


def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description='현대차 IR 사이트 지역별 판매실적 수집.')
  p.add_argument('--year-from', type=int, default=DEFAULT_YEAR_FROM,
                 help=f'백필 시작 연도 (default {DEFAULT_YEAR_FROM})')
  p.add_argument('--year-to', type=int, default=None,
                 help='마지막 연도 (default 현재 연도)')
  p.add_argument('--dry-run', action='store_true',
                 help='DB 쓰기 없이 print만')
  return p.parse_args()


def main() -> int:
  args = parse_args()
  current_year = datetime.now(timezone.utc).year
  year_to = args.year_to or current_year
  year_range = list(range(args.year_from, year_to + 1))
  logger.info(
    f'현대 IR summary 수집: 연도 {year_range[0]}~{year_range[-1]} (dry_run={args.dry_run})'
  )

  all_rows: list[dict] = []
  year_to_rows: dict[int, list[dict]] = {}
  year_to_total: dict[int, int] = {}
  failed: list[int] = []

  for year in year_range:
    item = fetch_year_summary(year)
    if item is None:
      failed.append(year)
      continue
    rows = build_rows(year, item)
    if not rows:
      logger.warning(f'{year}년 정상 응답이나 rows=0')
      failed.append(year)
      continue
    all_rows.extend(rows)
    year_to_rows[year] = rows
    year_to_total[year] = int(item.get('totalCount') or 0)

  print_summary(year_to_rows, year_to_total)
  if failed:
    logger.warning(f'실패 연도: {failed}')

  if args.dry_run:
    logger.success('dry-run 종료 (DB 쓰기 없음)')
    return 0 if not failed else 1

  if not all_rows:
    logger.warning('적재할 행 없음 — DB 호출 생략')
    return 1 if failed else 0

  try:
    with WriteSession() as w:
      w.table('hyundai_export_regions').upsert(
        all_rows,
        on_conflict='period_type,year_period,source,region_name',
      ).execute()
    logger.success(f'hyundai_export_regions upsert 완료: {len(all_rows)}행')
  except Exception as e:
    logger.error(f'upsert 실패: {e}')
    return 2

  return 0 if not failed else 1


if __name__ == '__main__':
  try:
    sys.exit(main())
  except KeyboardInterrupt:
    logger.warning('사용자 중단')
    sys.exit(130)
  except Exception as e:
    logger.exception(f'예기치 못한 오류: {e}')
    sys.exit(1)
