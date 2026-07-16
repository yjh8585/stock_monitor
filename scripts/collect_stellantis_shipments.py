#!/usr/bin/env python3
"""Stellantis 북미 consolidated shipments(도매 출하) → stellantis_shipments 적재.

지표 주의: 'shipments'는 딜러·유통사·최종고객에게 **인도된 물량**(매출 인식 기준)이다.
stellantis_na_sales(미국 소매+플릿 최종고객 인도)와 **다른 지표**이며 혼동 금지.
region 'North America'는 미국+캐나다+멕시코이고 마세라티는 제외였다(2026-01-01부로 세그먼트 폐지).

소스: SEC EDGAR 6-K exhibit (무료 JSON API로 발견).
  - data.sec.gov/submissions/CIK0001605484.json → 6-K 목록
  - 커버페이지 `a6-kcoverpage{q1|h1|q3|fy}{YYYY}pressre*.htm` 로 기간 식별
  - 같은 filing 안의 실적 PR exhibit `stellantisnv{q1|h1|q3|fy}{YYYY}pressrel.htm` 이 본문
  - sec.gov는 **UA 헤더 필수**(없으면 403). stellantis.com은 Akamai가 차단하므로 쓰지 않는다.

보고 체계 (2021~2026 실측):
  Stellantis는 **Q1 / H1 / Q3 / FY** 4회만 실적 PR을 낸다(반기 보고 체제).
  → Q1·Q3는 표의 절대값을 그대로 쓰고, Q2·Q4는 차분 도출한다.
      Q2 = H1 − Q1
      Q4 = FY − H1 − Q3
  차분 도출 행은 is_derived=true (IR이 천대 반올림 → 최대 ±1천대 오차 누적).

  2026-02부터 분기마다 별도의 'Estimated Consolidated Shipments' 릴리스가 추가로 나오지만
  **본문이 산문이고 지역별 절대값이 없다**(YoY 증감만: "North America ... increased by
  approximately 122 thousand units, or 38%"). 따라서 Q2·Q4의 절대값 소스로 쓸 수 없고,
  차분 도출 체계는 2026년 이후에도 그대로 유지된다. 실제로 이 산문 증감은 차분 도출값과
  일치해 교차검증에 쓰인다(2026-07-15 실측):
      Q4 2025 = 295(Q4 2024 도출) + 127 = 422 = FY − H1 − Q3 ✓
      Q1 2026 = 325(Q1 2025) + 54 = 379 = 표 절대값 ✓

기준(basis) 주의: 2021년은 합병(2021-01-17) 때문에 Q1·H1·FY PR이 모두 **Pro Forma** 열을
  첫 값으로 싣는다(Q3 2021은 합병 후라 Pro Forma=실적). 세 기간이 같은 Pro Forma 기준이라
  차분이 기준 혼용 없이 성립한다.

단위: IR은 천대 표기 → DB에는 대(units)로 ×1000 환산해 저장.

플래그:
  --year-from 2021   백필 시작 연도 (default 2021 — Stellantis 출범 연도)
  --year-to <year>   마지막 연도 (default 현재 연도)
  --dry-run          DB 쓰기 없이 파싱·도출 결과만 출력

사용:
  scripts/venv/Scripts/python.exe scripts/collect_stellantis_shipments.py --dry-run
"""
import argparse
import re
import sys
import time
from datetime import datetime, timezone
from typing import Any

import requests
from bs4 import BeautifulSoup
from loguru import logger

from lib.bootstrap import init_script

init_script(__file__)

from lib.db import WriteSession  # noqa: E402

# ---------------------------------------------------------------------------
# 상수
# ---------------------------------------------------------------------------
SEC_CIK = 1605484                       # Stellantis N.V.
SUBMISSIONS_URL = f'https://data.sec.gov/submissions/CIK{SEC_CIK:010d}.json'
ARCHIVES_BASE = f'https://www.sec.gov/Archives/edgar/data/{SEC_CIK}'

# SEC는 UA 헤더가 없으면 403. 자동화 정책상 연락처 포함 문자열을 요구한다.
USER_AGENT = 'stock-monitor research contact@example.com'
COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept-Encoding': 'gzip, deflate',
}
REQUEST_TIMEOUT_S = 30
# SEC 공정이용 가이드 상한은 10 req/s. 여유를 둬 요청 간 0.15s 대기.
REQUEST_SLEEP_S = 0.15

DEFAULT_YEAR_FROM = 2021                # Stellantis 출범(FCA+PSA 합병) 연도
UNITS_PER_THOUSAND = 1000               # IR 'Shipments (000s)' 천대 → 대 환산

DB_TABLE = 'stellantis_shipments'
DB_CONFLICT_COLS = 'region,period_type,year_period'
REGION_NORTH_AMERICA = 'North America'  # IR 세그먼트명 원문
PERIOD_TYPE_QUARTER = 'quarter'         # 스키마 CHECK가 'quarter'만 허용

# 6-K 커버페이지 → 기간 식별. 'supplem'(보충자료)은 매칭되지 않아야 하므로 'pressre'로 한정.
COVER_DOC_RE = re.compile(r'a6-?kcoverpage(q[1-4]|h1|fy)(20\d{2})pressre', re.I)
# filing 디렉터리 안의 실적 PR 본문 exhibit.
PRESSREL_DOC_RE = re.compile(r'stellantisnv(q[1-4]|h1|fy)(20\d{2})pressrel', re.I)

# 지역 헤더 행 판정용 — IR 세그먼트명 원문(대문자). 이 집합의 원소만으로 이뤄진 행이 헤더다.
# 2021년엔 'NORTH AMERICA | SOUTH AMERICA' 조합, 2022년 이후는 'NORTH AMERICA | ENLARGED
# EUROPE' 조합이라 지역쌍은 연도별로 다르다 → 순서 매핑으로 흡수한다.
REGION_HEADER_TOKENS = {
  'NORTH AMERICA', 'ENLARGED EUROPE', 'SOUTH AMERICA', 'MIDDLE EAST & AFRICA',
  'ASIA PACIFIC', 'MASERATI', 'CHINA, INDIA & ASIA PACIFIC',
}
NORTH_AMERICA_HEADER = 'NORTH AMERICA'

# 출하 행 라벨 — 'Shipments (000s)' / 'Combined shipments (1) (000s)' /
# 'Consolidated shipments (1) (000s)' 변형 흡수. 같은 행에서도 지역마다 라벨이 다르다(실측:
# MEA는 'Combined', 남미는 'Shipments') → 블록 분할 기준으로 쓰려면 변형을 모두 잡아야 한다.
SHIPMENT_LABEL_RE = re.compile(r'shipments\b.*\(000s\)', re.I)
# 표 숫자 셀 — '1,472' / '(191)'(음수) / '379'.
NUMERIC_CELL_RE = re.compile(r'^\(?-?[\d,]+\)?$')

# 도출 공식에 필요한 기간 키
PERIOD_Q1, PERIOD_Q3, PERIOD_H1, PERIOD_FY = 'Q1', 'Q3', 'H1', 'FY'


# ---------------------------------------------------------------------------
# 순수 파싱 함수 (scripts/lib/test_stellantis_shipments.py 가 고정)
# ---------------------------------------------------------------------------
def normalize_cell(text: str | None) -> str:
  """표 셀 텍스트 정규화 — nbsp 제거 + 트림."""
  if text is None:
    return ''
  return text.replace('\xa0', ' ').strip()


def parse_period_key(doc_name: str) -> tuple[str, int] | None:
  """exhibit 파일명 → (기간, 연도). 'stellantisnvq12026pressrel.htm' → ('Q1', 2026)."""
  m = PRESSREL_DOC_RE.search(doc_name)
  if not m:
    return None
  return m.group(1).upper(), int(m.group(2))


def parse_numeric_cell(cell: str) -> int | None:
  """'1,472' → 1472, '(191)' → -191, 'n.m.' → None."""
  if not NUMERIC_CELL_RE.match(cell):
    return None
  is_negative = cell.startswith('(') and cell.endswith(')')
  digits = cell.strip('()').replace(',', '')
  if not digits or digits == '-':
    return None
  try:
    value = int(digits)
  except ValueError:
    return None
  return -value if is_negative else value


def find_region_header(rows: list[list[str]]) -> list[str] | None:
  """지역 헤더 행(예: ['NORTH AMERICA', 'ENLARGED EUROPE'])을 찾아 대문자 리스트로 반환.

  셀이 전부 IR 세그먼트명인 행만 헤더로 인정한다 — 본문 문단·수치 행 오인식 방지.
  """
  for row in rows:
    if not row:
      continue
    upper = [c.upper() for c in row]
    if all(c in REGION_HEADER_TOKENS for c in upper):
      return upper
  return None


def split_row_into_region_blocks(
  row: list[str], region_count: int, na_index: int,
) -> list[str] | None:
  """출하 행을 지역별 값 블록으로 쪼개 북미 블록만 반환.

  2열 병렬 레이아웃(['Shipments (000s)', 379, 325, +54, 'Shipments (000s)', 637, ...])은
  라벨 셀이 블록 경계다. 라벨 수가 지역 수와 같으면 순서대로 매핑한다.
  라벨 수가 안 맞는 경우(지역마다 표기 지표가 다른 행)는 북미가 맨 왼쪽일 때만
  첫 블록으로 안전하게 처리한다 — 실측상 북미는 항상 첫 지역이다.
  """
  label_idx = [i for i, c in enumerate(row) if SHIPMENT_LABEL_RE.search(c)]
  if not label_idx:
    return None

  if len(label_idx) == region_count:
    start = label_idx[na_index]
    end = label_idx[na_index + 1] if na_index + 1 < len(label_idx) else len(row)
    return row[start + 1:end]

  if na_index == 0:
    end = label_idx[1] if len(label_idx) > 1 else len(row)
    return row[label_idx[0] + 1:end]
  return None


def extract_north_america_shipments(rows_by_table: list[list[list[str]]]) -> int | None:
  """정규화된 표 목록 → 북미 출하 절대값(천대).

  표 선택: 지역 헤더에 'NORTH AMERICA'가 있는 표만. (FY PR엔 'MIDDLE EAST & AFRICA |
  SOUTH AMERICA' 표에도 출하 행이 있어 표를 안 가리면 다른 지역 값을 집는다.)
  값 선택: 북미 블록의 **첫 숫자** = 당기 실적. 뒤 열(전년·증감·YTD)은 레이아웃마다
  달라 위치 고정이 불가능하지만, 첫 숫자가 당기인 규칙은 전 연도 공통이다.
  """
  for rows in rows_by_table:
    regions = find_region_header(rows)
    if not regions or NORTH_AMERICA_HEADER not in regions:
      continue
    na_index = regions.index(NORTH_AMERICA_HEADER)
    for row in rows:
      if not row or not SHIPMENT_LABEL_RE.search(row[0]):
        continue
      block = split_row_into_region_blocks(row, len(regions), na_index)
      if not block:
        continue
      for cell in block:
        value = parse_numeric_cell(cell)
        if value is not None:
          return value
  return None


def html_to_table_rows(html: str) -> list[list[list[str]]]:
  """HTML → 표별 정규화 행 매트릭스 (빈 셀 제거)."""
  soup = BeautifulSoup(html, 'html.parser')
  tables: list[list[list[str]]] = []
  for table in soup.find_all('table'):
    rows: list[list[str]] = []
    for tr in table.find_all('tr'):
      cells = [normalize_cell(c.get_text(' ')) for c in tr.find_all(['td', 'th'])]
      cells = [c for c in cells if c != '']
      if cells:
        rows.append(cells)
    if rows:
      tables.append(rows)
  return tables


def derive_year_quarters(
  values: dict[str, int], year: int,
) -> list[dict[str, Any]]:
  """한 연도의 기간별 절대값(천대) → 분기 4개 산출.

  values 키: 'Q1' / 'H1' / 'Q3' / 'FY' (없는 기간은 생략 가능).
  반환 dict: {'quarter', 'thousands', 'is_derived', 'source_period'}.
    - Q1·Q3: 표 절대값 (is_derived=False)
    - Q2 = H1 − Q1, Q4 = FY − H1 − Q3 (is_derived=True)
  입력이 부족한 분기는 생략한다(예: H1 미발표 연도의 Q2).
  """
  out: list[dict[str, Any]] = []
  q1, q3 = values.get(PERIOD_Q1), values.get(PERIOD_Q3)
  h1, fy = values.get(PERIOD_H1), values.get(PERIOD_FY)

  if q1 is not None:
    out.append({'quarter': 1, 'thousands': q1, 'is_derived': False,
                'source_period': PERIOD_Q1})
  if h1 is not None and q1 is not None:
    out.append({'quarter': 2, 'thousands': h1 - q1, 'is_derived': True,
                'source_period': PERIOD_H1})
  if q3 is not None:
    out.append({'quarter': 3, 'thousands': q3, 'is_derived': False,
                'source_period': PERIOD_Q3})
  if fy is not None and h1 is not None and q3 is not None:
    out.append({'quarter': 4, 'thousands': fy - h1 - q3, 'is_derived': True,
                'source_period': PERIOD_FY})

  valid: list[dict[str, Any]] = []
  for row in out:
    # 음수는 파싱 오류(열 오인식 등) 신호 — 스키마 CHECK(>=0)에 걸리기 전에 잡는다.
    if row['thousands'] < 0:
      logger.error(
        f'  {year}-Q{row["quarter"]}: 도출값 음수({row["thousands"]}천대) — 파싱 오류 의심, 제외'
      )
      continue
    row['year'] = year
    valid.append(row)
  return valid


def existing_direct_quarters() -> set[str]:
  """DB에 이미 **실측(is_derived=false)**으로 채워진 북미 분기 집합.

  IR 홈페이지 수집(`collect_stellantis_shipments_ir.py`)이 2026+ 분기를 IR 표의 **절대값**으로
  채우면(더 정확·더 이르다), 이 EDGAR 차분 수집이 같은 분기를 나중에 is_derived=true로 **덮지
  않도록** 하기 위한 가드다(사용자 지시 2026-07-16: stellantis.com IR이 primary, EDGAR는 보완).

  조회 실패 시 빈 집합을 돌려주어 가드 없이 진행한다(수집 자체를 막지 않는다).
  """
  from lib.db import get_client
  try:
    resp = (
      get_client()
      .table(DB_TABLE)
      .select('year_period')
      .eq('region', REGION_NORTH_AMERICA)
      .eq('period_type', PERIOD_TYPE_QUARTER)
      .eq('is_derived', False)
      .execute()
    )
    return {row['year_period'] for row in (resp.data or [])}
  except Exception as e:
    logger.warning(f'  기존 실측 분기 조회 실패 — IR 우선 가드 없이 진행: {e}')
    return set()


def build_db_rows(
  quarters: list[dict[str, Any]], sources: dict[str, tuple[str, str]],
) -> list[dict[str, Any]]:
  """도출된 분기 → DB upsert dict.

  source_url/filing_date는 그 분기 값을 **확정한 PR**을 가리킨다
  (Q2는 H1 PR, Q4는 FY PR — 도출 입력 중 가장 마지막 공시).
  """
  collected_at = datetime.now(timezone.utc).isoformat()
  rows: list[dict[str, Any]] = []
  for q in quarters:
    url, filing_date = sources[q['source_period']]
    rows.append({
      'region': REGION_NORTH_AMERICA,
      'period_type': PERIOD_TYPE_QUARTER,
      'year_period': f'{q["year"]}-Q{q["quarter"]}',
      'shipments_units': q['thousands'] * UNITS_PER_THOUSAND,
      'is_derived': q['is_derived'],
      'source_url': url,
      'filing_date': filing_date,
      'collected_at': collected_at,
    })
  return rows


# ---------------------------------------------------------------------------
# SEC 수집 (네트워크)
# ---------------------------------------------------------------------------
def _get(session: requests.Session, url: str) -> requests.Response:
  """SEC GET — UA 헤더 + rate limit 대기. 실패 시 예외."""
  time.sleep(REQUEST_SLEEP_S)
  resp = session.get(url, headers=COMMON_HEADERS, timeout=REQUEST_TIMEOUT_S)
  if resp.status_code != 200:
    raise RuntimeError(f'SEC status={resp.status_code}: {url}')
  return resp


def discover_press_releases(
  session: requests.Session, year_from: int, year_to: int,
) -> dict[tuple[str, int], tuple[str, str]]:
  """submissions JSON → {(기간, 연도): (본문 URL, filing_date)}.

  커버페이지 파일명으로 기간을 먼저 좁힌 뒤, 해당 filing의 index.json만 조회해
  본문 exhibit을 찾는다(전 filing index 조회를 피해 요청 수를 실적 PR 수로 제한).
  """
  data = _get(session, SUBMISSIONS_URL).json()
  recent = data['filings']['recent']
  found: dict[tuple[str, int], tuple[str, str]] = {}

  for i in range(len(recent['accessionNumber'])):
    if recent['form'][i] != '6-K':
      continue
    cover = COVER_DOC_RE.search(recent['primaryDocument'][i])
    if not cover:
      continue
    year = int(cover.group(2))
    if year < year_from or year > year_to:
      continue

    accession = recent['accessionNumber'][i].replace('-', '')
    filing_date = recent['filingDate'][i]
    try:
      index = _get(session, f'{ARCHIVES_BASE}/{accession}/index.json').json()
    except Exception as e:
      logger.warning(f'  index.json 조회 실패 {accession}: {e}')
      continue

    for item in index['directory']['item']:
      key = parse_period_key(item['name'])
      if not key:
        continue
      found[key] = (f'{ARCHIVES_BASE}/{accession}/{item["name"]}', filing_date)
      logger.info(f'  발견 {key[1]}-{key[0]}: {item["name"]} (filed {filing_date})')
  return found


def fetch_shipments(
  session: requests.Session, sources: dict[tuple[str, int], tuple[str, str]],
) -> tuple[dict[int, dict[str, int]], dict[int, dict[str, tuple[str, str]]], list[str]]:
  """각 PR 본문 → 연도별 {기간: 천대} + 연도별 {기간: (url, filing_date)}."""
  values: dict[int, dict[str, int]] = {}
  per_year_sources: dict[int, dict[str, tuple[str, str]]] = {}
  failures: list[str] = []

  for (period, year), (url, filing_date) in sorted(sources.items(), key=lambda kv: kv[0][1]):
    try:
      html = _get(session, url).text
      thousands = extract_north_america_shipments(html_to_table_rows(html))
    except Exception as e:
      failures.append(f'{year}-{period}: fetch/parse 실패 — {e}')
      logger.error(f'  {year}-{period}: {e}')
      continue
    if thousands is None:
      failures.append(f'{year}-{period}: 북미 Shipments 행 미발견')
      logger.error(f'  {year}-{period}: 북미 Shipments 행 미발견 — {url}')
      continue
    values.setdefault(year, {})[period] = thousands
    per_year_sources.setdefault(year, {})[period] = (url, filing_date)
    logger.info(f'  {year}-{period}: 북미 {thousands:,}천대')
  return values, per_year_sources, failures


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description='Stellantis 북미 출하(shipments) 수집.')
  p.add_argument('--year-from', type=int, default=DEFAULT_YEAR_FROM,
                 help=f'백필 시작 연도 (default {DEFAULT_YEAR_FROM})')
  p.add_argument('--year-to', type=int, default=None,
                 help='마지막 연도 (default 현재 연도)')
  p.add_argument('--dry-run', action='store_true',
                 help='DB 쓰기 없이 파싱·도출 결과만 출력')
  return p.parse_args()


def main() -> int:
  args = parse_args()
  year_to = args.year_to or datetime.now(timezone.utc).year
  logger.info(
    f'Stellantis 북미 출하 수집: {args.year_from}~{year_to} dry_run={args.dry_run}'
  )

  session = requests.Session()
  try:
    sources = discover_press_releases(session, args.year_from, year_to)
  except Exception as e:
    logger.exception(f'실적 PR 발견 실패: {e}')
    return 2
  if not sources:
    logger.error('대상 실적 PR 없음 — 연도 범위 또는 SEC 응답 확인.')
    return 1

  values, per_year_sources, failures = fetch_shipments(session, sources)

  all_rows: list[dict[str, Any]] = []
  for year in sorted(values):
    quarters = derive_year_quarters(values[year], year)
    all_rows.extend(build_db_rows(quarters, per_year_sources[year]))

  # IR 홈페이지가 이미 실측으로 채운 분기를 차분 도출값으로 덮지 않는다(IR primary).
  direct = existing_direct_quarters()
  skipped = [r for r in all_rows if r['is_derived'] and r['year_period'] in direct]
  if skipped:
    all_rows = [r for r in all_rows if not (r['is_derived'] and r['year_period'] in direct)]
    logger.info(
      f'IR 실측값 보존 — 차분 도출 {len(skipped)}행 스킵: '
      f'{[r["year_period"] for r in skipped]}'
    )

  # 요약 — 분기별 천대 + 도출 여부
  logger.info(f'적재 대상 {len(all_rows)}행:')
  for row in all_rows:
    mark = '도출' if row['is_derived'] else '실측'
    logger.info(
      f'  {row["year_period"]}  {row["shipments_units"]:>9,}대  [{mark}]'
    )

  if failures:
    logger.warning(f'실패 {len(failures)}건:')
    for f in failures:
      logger.warning(f'  {f}')

  if args.dry_run:
    logger.success(f'dry-run 종료 (DB 쓰기 없음). rows={len(all_rows)}')
    return 1 if failures else 0

  if not all_rows:
    logger.warning('적재할 행 없음 — DB 호출 생략')
    return 1

  try:
    with WriteSession() as w:
      w.table(DB_TABLE).upsert(all_rows, on_conflict=DB_CONFLICT_COLS).execute()
    logger.success(f'{DB_TABLE} upsert 완료: {len(all_rows)}행')
  except Exception as e:
    logger.exception(f'upsert 실패: {e}')
    return 2

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
