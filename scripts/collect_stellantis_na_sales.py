#!/usr/bin/env python3
"""Stellantis NA (FCA US LLC) 분기 판매 → stellantis_na_sales 적재 (PR5).

플로우:
  1. scripts/lib/stellantis_pr_urls.json (audit 검증한 22분기 매핑) 로드.
  2. (선택) --auto-discover 시 prnewswire publisher index에서 신규 분기 발견.
  3. 각 분기 URL에서 HTML fetch (requests + UA 헤더, sha256 캐시).
  4. BeautifulSoup으로 <table> 1개 추출 → 정규화.
  5. 행 분류 (model / subtotal / brand_total / company_total / spacer).
  6. cross-check (실패 시 abort):
       - subtotal 제외 sum(models[brand]) == brand_total[brand]
       - sum(brand_totals) == company_total
     허용 오차 CROSS_CHECK_TOLERANCE 대 이내.
  7. WriteSession upsert (자동 revalidate 'oem-stellantis-na-sales').
     - period_type='quarter' 단일 분기 + brand='Total'/vehicle_model='Total' 합계 row 적재
     - Q4의 경우 CYTD를 period_type='year'로 추가 적재
     - Q1/Q2/Q3 의 CYTD는 quarter Q1=CYTD, 그 외는 적재 안 함 (분기 SUM으로 자연 도출 가능)

플래그:
  --year-from 2021         백필 시작 연도 (default 2021).
  --year-to <year>         마지막 연도 (default 현재 연도).
  --quarter <1-4>          특정 분기만 (default 전체).
  --reprocess-all          HTML sha256 캐시 무시하고 재 fetch + 재 parse.
  --dry-run                DB 쓰기 없이 파싱 + cross-check 결과만.
  --auto-discover          publisher index 페이지에서 신규 분기 PR 자동 발견.
  --no-abort               cross-check 실패 시에도 적재 강행 (긴급용).

사용:
  scripts/venv/Scripts/python.exe scripts/collect_stellantis_na_sales.py \\
    --year-from 2021
"""
import argparse
import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
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
SCRIPT_DIR = Path(__file__).resolve().parent
URL_CACHE_PATH = SCRIPT_DIR / 'lib' / 'stellantis_pr_urls.json'
HTML_CACHE_DIR = SCRIPT_DIR.parent / 'data' / '_stellantis_pr_cache'
RUN_LOG_DIR = SCRIPT_DIR

DEFAULT_YEAR_FROM = 2021

REQUEST_TIMEOUT_S = 30
REQUEST_SLEEP_S = 0.8                # PR 사이 요청 간격 (예의)
USER_AGENT = (
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
)
COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.prnewswire.com/news/fca-us-llc',
}

PUBLISHER_INDEX_URL = 'https://www.prnewswire.com/news/fca-us-llc'

# release_id: prnewswire 9자리 cision ID (영구). URL 끝의 -NNNNNNNNN.html.
RELEASE_ID_RE = re.compile(r'-(\d{9})\.html$', re.I)

# brand 정규식 — 'BRAND' suffix 누락 변형 (ALFA ROMEO) 흡수.
# 'DODGE  BRAND' (double space 발견) 등 모든 공백 변형 흡수.
BRAND_TOTAL_RE = re.compile(
  r'^(?P<brand>JEEP|RAM|CHRYSLER|DODGE|FIAT|ALFA\s+ROMEO|MASERATI)\s*(?:BRAND)?\s*$',
  re.I,
)

# brand 표준화 (정규식 그룹 → 표 표기 / DB 표기)
BRAND_DISPLAY = {
  'JEEP': 'Jeep',
  'RAM': 'Ram',
  'CHRYSLER': 'Chrysler',
  'DODGE': 'Dodge',
  'FIAT': 'Fiat',
  'ALFA ROMEO': 'Alfa Romeo',
  'MASERATI': 'Maserati',  # 안전망 — FCA US LLC에는 없음
}

# subtotal row: 'TOTAL Ram PU' 등. 모델 SUM 시 double-count 방지 — skip.
SUBTOTAL_PREFIX_RE = re.compile(r'^TOTAL\s+', re.I)

# 회사 합계 row 라벨
COMPANY_TOTAL_LABELS = {'FCA US LLC'}

# 행 헤더/잔재 토큰 — skip
HEADER_TOKENS = {
  'model', 'curr yr', 'pr yr', 'change',
  'q1 sales', 'q2 sales', 'q3 sales', 'q4 sales',
  'cytd sales', 'vol %',
}
HEADER_PREFIX = ('FCA US LLC Sales Summary',)

# 검증 허용 오차 (대 단위)
# - COMPANY: brand_total SUM == FCA US LLC. PR 자체에서 산출 — 5대 이내 일치.
# - BRAND Q: brand_total vs 모델 SUM. 일부 분기에 PR이 작은 모델/"other" 라인을
#   숨겨 ~20대 이내 미세 불일치 (실제 관찰: 2025Q3 Jeep 15, 2026Q1 Jeep 20 / Dodge 19 / Fiat 16).
# - BRAND YTD: 분기별 source-side 미세 불일치가 누적 — 더 큰 허용치 필요
#   (실제 관찰: 2025Q3 Jeep YTD 36, 누적이라 합리적).
CROSS_CHECK_TOLERANCE_COMPANY = 5
CROSS_CHECK_TOLERANCE_BRAND_Q = 25
CROSS_CHECK_TOLERANCE_BRAND_YTD = 100

# 컬럼 표기 검증용 ('Curr Yr' 헤더 row 토큰)
CURR_YR_TOKENS = {'curr yr', 'curr.yr', 'current year'}
PR_YR_TOKENS = {'pr yr', 'pr.yr', 'prior year'}


# ---------------------------------------------------------------------------
# URL cache
# ---------------------------------------------------------------------------
def load_url_cache() -> dict:
  """JSON cache → dict.

  Returns:
    {'quarters': {'2025-Q4': url, ...}, ...}
  """
  if not URL_CACHE_PATH.exists():
    raise FileNotFoundError(f'URL cache 없음: {URL_CACHE_PATH}')
  with URL_CACHE_PATH.open('r', encoding='utf-8') as f:
    return json.load(f)


def save_url_cache(cache: dict) -> None:
  with URL_CACHE_PATH.open('w', encoding='utf-8') as f:
    json.dump(cache, f, ensure_ascii=False, indent=2)
  logger.info(f'  URL cache 갱신: {URL_CACHE_PATH}')


def extract_release_id(url: str) -> str | None:
  m = RELEASE_ID_RE.search(url)
  return m.group(1) if m else None


# ---------------------------------------------------------------------------
# HTML fetch + sha256 캐시
# ---------------------------------------------------------------------------
def _cache_paths(year_period: str) -> tuple[Path, Path]:
  """(html_path, meta_path) — 변경 감지용."""
  return (
    HTML_CACHE_DIR / f'{year_period}.html',
    HTML_CACHE_DIR / f'{year_period}.meta.json',
  )


def fetch_html(year_period: str, url: str, reprocess: bool) -> tuple[str, dict, bool]:
  """단일 PR HTML → (html_text, meta_dict, changed).

  meta_dict = {'sha256', 'fetched_at', 'url', 'release_id', 'bytes'}.
  reprocess=False 이고 캐시 hit이면 재fetch 안 함 → changed=False.
  """
  HTML_CACHE_DIR.mkdir(parents=True, exist_ok=True)
  html_path, meta_path = _cache_paths(year_period)
  release_id = extract_release_id(url)

  if html_path.exists() and meta_path.exists() and not reprocess:
    try:
      with meta_path.open('r', encoding='utf-8') as f:
        meta = json.load(f)
      # release_id 변경 감지 (CORRECTION 등)
      if meta.get('release_id') == release_id:
        html = html_path.read_text(encoding='utf-8')
        return html, meta, False
      else:
        logger.info(
          f'  {year_period}: release_id 변경 감지 ({meta.get("release_id")} → {release_id}) — 재 fetch'
        )
    except Exception as e:
      logger.debug(f'  {year_period}: 캐시 meta 읽기 실패 {e} — 재 fetch')

  logger.info(f'  {year_period}: fetch {url}')
  try:
    r = requests.get(url, headers=COMMON_HEADERS, timeout=REQUEST_TIMEOUT_S)
  except Exception as e:
    raise RuntimeError(f'{year_period}: HTTP 요청 실패 — {e}') from e
  if r.status_code != 200:
    raise RuntimeError(f'{year_period}: status={r.status_code}')

  html = r.text
  sha = hashlib.sha256(html.encode('utf-8')).hexdigest()
  meta = {
    'sha256': sha,
    'fetched_at': datetime.now(timezone.utc).isoformat(),
    'url': url,
    'release_id': release_id,
    'bytes': len(html.encode('utf-8')),
  }
  html_path.write_text(html, encoding='utf-8')
  with meta_path.open('w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)
  return html, meta, True


def extract_publish_date(html: str) -> str | None:
  """<meta name="date" content="2025-01-03T16:24:00-05:00"> → 'YYYY-MM-DD'."""
  soup = BeautifulSoup(html, 'html.parser')
  meta = soup.find('meta', {'name': 'date'})
  if not meta or not meta.get('content'):
    return None
  raw = str(meta.get('content'))
  # ISO-like; date 부분만 추출
  m = re.match(r'(\d{4}-\d{2}-\d{2})', raw)
  return m.group(1) if m else None


# ---------------------------------------------------------------------------
# 표 추출 + 행 정규화
# ---------------------------------------------------------------------------
def _norm_cell(s: str | None) -> str:
  if s is None:
    return ''
  return s.replace('\xa0', ' ').strip()


def _strip_empty_outer(row: list[str]) -> list[str]:
  """행의 앞 빈 셀 제거 + 끝의 빈 셀은 7개까지만 유지.

  2021Q2 같은 padded layout(앞 1~2 빈 셀, 뒤 1 빈 셀)을 흡수한다.
  뒤의 빈 셀은 YoY %가 비어있는 model 행(예: Recon Q4 2025 — q_prior=0이라
  YoY 계산 불가, '' 그대로 유지) 때문에 보존해야 한다.
  """
  i = 0
  while i < len(row) and row[i] == '':
    i += 1
  trimmed = row[i:]
  # 끝의 빈 셀은 7개를 초과한 경우에만 잘라낸다 (2021Q2 trailing pad).
  while len(trimmed) > 7 and trimmed[-1] == '':
    trimmed = trimmed[:-1]
  return trimmed


def _to_int(s: str) -> int | None:
  if s == '' or s is None:
    return None
  s = s.replace(',', '').replace('\xa0', '').strip()
  if s == '' or s == '-':
    return None
  try:
    return int(s)
  except ValueError:
    try:
      return int(float(s))
    except ValueError:
      return None


def _to_yoy(s: str) -> float | None:
  """'-30 %' / '4 %' / '' / '4603 %' → -30 / 4 / None / 4603."""
  if s == '' or s is None:
    return None
  s = s.replace('%', '').replace(',', '').replace('\xa0', '').strip()
  if s == '' or s == '-':
    return None
  try:
    return float(s)
  except ValueError:
    return None


def extract_table_rows(html: str) -> list[list[str]]:
  """HTML → 표의 정규화된 row 매트릭스.

  대부분 분기 PR은 <table> 1개. 단 2024-Q2처럼 (Q2 sales 표) + (H1 vs H1 표)
  2개 들어있는 케이스가 있어 'Q1/Q2/Q3/Q4 Sales' 헤더 + 'CYTD Sales'를 함께
  가진 표만 선택한다 (H1 Sales 표 제외).
  """
  soup = BeautifulSoup(html, 'html.parser')
  tables = soup.find_all('table')
  if not tables:
    raise RuntimeError('테이블 0개')

  def _is_quarterly_table(table) -> bool:
    """첫 5행 안에 'Q? Sales' + 'CYTD Sales'를 함께 포함하면 우선."""
    head_text = ''
    for tr in table.find_all('tr')[:5]:
      head_text += ' ' + tr.get_text(separator=' ', strip=True).lower()
    has_quarter = bool(re.search(r'q[1-4]\s*sales', head_text))
    has_cytd = 'cytd sales' in head_text
    return has_quarter and has_cytd

  def _cells(table) -> list[list[str]]:
    return [
      [_norm_cell(c.get_text()) for c in tr.find_all(['th', 'td'])]
      for tr in table.find_all('tr')
    ]

  if len(tables) == 1:
    return _cells(tables[0])

  # 여러 표 → quarter+CYTD 헤더를 가진 표 우선
  for t in tables:
    if _is_quarterly_table(t):
      return _cells(t)
  raise RuntimeError(
    f'테이블 {len(tables)}개 — Q?Sales+CYTD 헤더 표 미발견'
  )


def _is_header_row(stripped: list[str]) -> bool:
  if not stripped:
    return True
  joined = ' '.join(stripped).strip().lower()
  if not joined:
    return True
  # 'FCA US LLC Sales Summary Q4 2025'
  for prefix in HEADER_PREFIX:
    if joined.startswith(prefix.lower()):
      return True
  # 'Model | Curr Yr | Pr Yr | ...' 헤더 row
  if any(t in joined for t in CURR_YR_TOKENS) and any(t in joined for t in PR_YR_TOKENS):
    return True
  # 'Q4 Sales | Vol % | CYTD Sales | Vol %' 서브헤더 row
  if 'cytd sales' in joined and 'vol %' in joined:
    return True
  return False


def _row_kind(first: str) -> str:
  """첫 셀 텍스트 → 행 종류."""
  if not first:
    return 'empty'
  upper = first.upper()
  if first in COMPANY_TOTAL_LABELS or upper == 'FCA US LLC':
    return 'company_total'
  m = BRAND_TOTAL_RE.match(first)
  if m:
    return 'brand_total'
  if SUBTOTAL_PREFIX_RE.match(first):
    return 'subtotal'
  return 'model'


def _brand_from_row(first: str) -> str | None:
  """brand_total 행에서 brand 추출 → DB 표기."""
  m = BRAND_TOTAL_RE.match(first)
  if not m:
    return None
  raw = re.sub(r'\s+', ' ', m.group('brand').upper()).strip()
  return BRAND_DISPLAY.get(raw)


def normalize_rows(
  raw_rows: list[list[str]], year_period: str,
) -> tuple[list[dict], list[dict], dict | None]:
  """raw rows → (model_rows, brand_totals, company_total).

  model_rows / brand_totals 각 dict 키:
    {'brand', 'vehicle_model', 'q_curr', 'q_prior', 'q_yoy',
     'ytd_curr', 'ytd_prior', 'ytd_yoy', 'kind'}

  company_total: 최상위 dict (kind='company_total') 또는 None.
  """
  models: list[dict] = []
  brand_totals: list[dict] = []
  company_total: dict | None = None
  current_brand: str | None = None

  for row in raw_rows:
    stripped = _strip_empty_outer([_norm_cell(c) for c in row])
    if _is_header_row(stripped):
      continue
    # 컬럼 7개 기대 (model, q_curr, q_prior, q_yoy, ytd_curr, ytd_prior, ytd_yoy)
    if len(stripped) < 7:
      # 일부 PR에 single-cell footer row 등 — skip
      continue
    first = stripped[0]
    kind = _row_kind(first)
    if kind == 'empty':
      continue

    parsed = {
      'q_curr': _to_int(stripped[1]),
      'q_prior': _to_int(stripped[2]),
      'q_yoy': _to_yoy(stripped[3]),
      'ytd_curr': _to_int(stripped[4]),
      'ytd_prior': _to_int(stripped[5]),
      'ytd_yoy': _to_yoy(stripped[6]),
    }

    if kind == 'company_total':
      company_total = {'kind': 'company_total', **parsed}
      continue

    if kind == 'brand_total':
      brand = _brand_from_row(first)
      if brand is None:
        logger.warning(f'  {year_period}: brand 식별 실패 — first={first!r}')
        continue
      current_brand = brand
      brand_totals.append({
        'kind': 'brand_total',
        'brand': brand,
        **parsed,
      })
      continue

    if kind == 'subtotal':
      # 'TOTAL Ram PU' 등 — 적재 안 함 (cross-check에 영향 없음)
      continue

    # kind == 'model'
    # 직전 brand_total에서 brand 추정. brand_total은 모델 SECTION 뒤에 등장하므로
    # 모델 시점에는 current_brand가 직전 brand_total의 값이다. 따라서 lookahead 필요.
    # 일단 model에 직전 brand_total을 기록할 임시 슬롯 'brand' 미지정으로 추가.
    models.append({
      'kind': 'model',
      'brand': None,                # 후처리 채움
      'vehicle_model': first,
      **parsed,
    })

  # 후처리: model의 brand 채우기 — brand_total은 자기 brand의 모델들 뒤에 등장.
  # raw rows를 다시 한번 순회하며 model index → brand 매핑 구성.
  _assign_brands_to_models(raw_rows, models, year_period)

  return models, brand_totals, company_total


def _assign_brands_to_models(
  raw_rows: list[list[str]], models: list[dict], year_period: str,
) -> None:
  """raw rows에서 (model index, brand) 매핑 → models[i]['brand']에 SET."""
  # 1) raw rows 순회하며 (kind, first) 시퀀스 만들기 — model 순서 보존
  seq: list[tuple[str, str]] = []
  for row in raw_rows:
    stripped = _strip_empty_outer([_norm_cell(c) for c in row])
    if _is_header_row(stripped):
      continue
    if len(stripped) < 7:
      continue
    first = stripped[0]
    kind = _row_kind(first)
    if kind in ('empty', 'company_total'):
      continue
    seq.append((kind, first))

  # 2) brand_total을 향해 lookahead — 같은 brand 그룹의 model에 brand 부여
  brand_for_model: dict[int, str] = {}
  model_idx = 0
  current_group: list[int] = []
  for kind, first in seq:
    if kind == 'model':
      current_group.append(model_idx)
      model_idx += 1
    elif kind == 'subtotal':
      # 모델 SUM에 포함 안 되므로 group은 유지 (다음 brand_total까지 계속)
      pass
    elif kind == 'brand_total':
      brand = _brand_from_row(first)
      if brand is None:
        logger.warning(f'  {year_period}: brand 식별 실패 (lookahead) — first={first!r}')
        current_group = []
        continue
      for i in current_group:
        brand_for_model[i] = brand
      current_group = []

  # 3) models에 brand 부여
  for i, m in enumerate(models):
    b = brand_for_model.get(i)
    if b is None:
      logger.warning(
        f'  {year_period}: model #{i} ({m["vehicle_model"]}) brand 매핑 실패 — Jeep으로 fallback'
      )
      m['brand'] = 'Jeep'  # 안전망 (어차피 cross-check에서 잡힘)
    else:
      m['brand'] = b


# ---------------------------------------------------------------------------
# Cross-check
# ---------------------------------------------------------------------------
def cross_check(
  year_period: str, models: list[dict], brand_totals: list[dict],
  company_total: dict | None,
) -> list[str]:
  """모델 SUM(subtotal 제외) vs brand_total, brand_totals SUM vs company_total.

  Returns:
    실패 메시지 리스트 (빈 리스트면 통과).
  """
  fails: list[str] = []
  # brand별 sum
  q_by_brand: dict[str, int] = {}
  ytd_by_brand: dict[str, int] = {}
  for m in models:
    b = m['brand']
    if not b:
      continue
    q_by_brand[b] = q_by_brand.get(b, 0) + (m.get('q_curr') or 0)
    ytd_by_brand[b] = ytd_by_brand.get(b, 0) + (m.get('ytd_curr') or 0)
  for bt in brand_totals:
    b = bt['brand']
    expected_q = bt.get('q_curr') or 0
    expected_ytd = bt.get('ytd_curr') or 0
    actual_q = q_by_brand.get(b, 0)
    actual_ytd = ytd_by_brand.get(b, 0)
    diff_q = abs(expected_q - actual_q)
    diff_ytd = abs(expected_ytd - actual_ytd)
    if diff_q > CROSS_CHECK_TOLERANCE_BRAND_Q:
      fails.append(
        f'  {year_period} brand={b} Q: 모델 SUM={actual_q:,} vs brand_total={expected_q:,} '
        f'(차={actual_q-expected_q:+,})'
      )
    elif diff_q > CROSS_CHECK_TOLERANCE_COMPANY:
      logger.info(
        f'  {year_period} brand={b} Q: source-side 미세 불일치 무시 '
        f'(적재={actual_q:,} vs brand_total={expected_q:,}, 차={actual_q-expected_q:+,})'
      )
    if diff_ytd > CROSS_CHECK_TOLERANCE_BRAND_YTD:
      fails.append(
        f'  {year_period} brand={b} YTD: 모델 SUM={actual_ytd:,} vs brand_total={expected_ytd:,} '
        f'(차={actual_ytd-expected_ytd:+,})'
      )
    elif diff_ytd > CROSS_CHECK_TOLERANCE_COMPANY:
      logger.info(
        f'  {year_period} brand={b} YTD: source-side 미세 불일치 무시 '
        f'(적재={actual_ytd:,} vs brand_total={expected_ytd:,}, 차={actual_ytd-expected_ytd:+,})'
      )
  # company total — brand_total SUM과 비교 (자체적으로 무조건 일치해야 함)
  if company_total is not None:
    total_q = sum((bt.get('q_curr') or 0) for bt in brand_totals)
    total_ytd = sum((bt.get('ytd_curr') or 0) for bt in brand_totals)
    exp_q = company_total.get('q_curr') or 0
    exp_ytd = company_total.get('ytd_curr') or 0
    if abs(exp_q - total_q) > CROSS_CHECK_TOLERANCE_COMPANY:
      fails.append(
        f'  {year_period} COMPANY Q: brand SUM={total_q:,} vs FCA US LLC={exp_q:,} '
        f'(차={total_q-exp_q:+,})'
      )
    if abs(exp_ytd - total_ytd) > CROSS_CHECK_TOLERANCE_COMPANY:
      fails.append(
        f'  {year_period} COMPANY YTD: brand SUM={total_ytd:,} vs FCA US LLC={exp_ytd:,} '
        f'(차={total_ytd-exp_ytd:+,})'
      )
  return fails


# ---------------------------------------------------------------------------
# 분기 행 → DB row 변환
# ---------------------------------------------------------------------------
def build_db_rows(
  year_period: str, models: list[dict], brand_totals: list[dict],
  company_total: dict | None, url: str, release_id: str | None,
  publish_date: str | None,
) -> list[dict]:
  """DB upsert 대상 dict 리스트.

  적재 정책:
    - period_type='quarter' year_period='YYYY-QN' brand=<brand> vehicle_model=<model>: 각 모델
    - period_type='quarter' year_period='YYYY-QN' brand=<brand> vehicle_model='Total': brand 합계
    - period_type='quarter' year_period='YYYY-QN' brand='Total' vehicle_model='Total': 회사 합계
    - Q4: 위와 동일 구조로 period_type='year' year_period='YYYY' 한 세트 더 (CYTD 사용)
  """
  rows: list[dict] = []
  common = {
    'region': 'US',
    'source_url': url,
    'release_id': release_id,
    'publish_date': publish_date,
  }
  quarter_str = year_period.split('-')[1]   # 'Q4'
  year_str = year_period.split('-')[0]       # '2025'
  is_q4 = quarter_str.upper() == 'Q4'

  # 1) 분기 모델 + brand 합계 + 회사 합계
  for m in models:
    rows.append({
      'period_type': 'quarter',
      'year_period': year_period,
      'brand': m['brand'],
      'vehicle_model': m['vehicle_model'],
      'sales_units': m.get('q_curr') or 0,
      'sales_units_prev': m.get('q_prior'),
      'yoy_pct': m.get('q_yoy'),
      **common,
    })
  for bt in brand_totals:
    rows.append({
      'period_type': 'quarter',
      'year_period': year_period,
      'brand': bt['brand'],
      'vehicle_model': 'Total',
      'sales_units': bt.get('q_curr') or 0,
      'sales_units_prev': bt.get('q_prior'),
      'yoy_pct': bt.get('q_yoy'),
      **common,
    })
  if company_total is not None:
    rows.append({
      'period_type': 'quarter',
      'year_period': year_period,
      'brand': 'Total',
      'vehicle_model': 'Total',
      'sales_units': company_total.get('q_curr') or 0,
      'sales_units_prev': company_total.get('q_prior'),
      'yoy_pct': company_total.get('q_yoy'),
      **common,
    })

  # 2) Q4 → CYTD를 연간 row로 추가 적재
  if is_q4:
    year_period_year = year_str
    for m in models:
      rows.append({
        'period_type': 'year',
        'year_period': year_period_year,
        'brand': m['brand'],
        'vehicle_model': m['vehicle_model'],
        'sales_units': m.get('ytd_curr') or 0,
        'sales_units_prev': m.get('ytd_prior'),
        'yoy_pct': m.get('ytd_yoy'),
        **common,
      })
    for bt in brand_totals:
      rows.append({
        'period_type': 'year',
        'year_period': year_period_year,
        'brand': bt['brand'],
        'vehicle_model': 'Total',
        'sales_units': bt.get('ytd_curr') or 0,
        'sales_units_prev': bt.get('ytd_prior'),
        'yoy_pct': bt.get('ytd_yoy'),
        **common,
      })
    if company_total is not None:
      rows.append({
        'period_type': 'year',
        'year_period': year_period_year,
        'brand': 'Total',
        'vehicle_model': 'Total',
        'sales_units': company_total.get('ytd_curr') or 0,
        'sales_units_prev': company_total.get('ytd_prior'),
        'yoy_pct': company_total.get('ytd_yoy'),
        **common,
      })

  return rows


# ---------------------------------------------------------------------------
# Auto-discover (publisher index)
# ---------------------------------------------------------------------------
HREF_RE = re.compile(
  r'/news-releases/(fca[-\w]+-\d{9})\.html', re.I,
)
TITLE_QUARTER_RE = re.compile(
  r'(?:'
  r'(?P<q4>(?:fourth[\s-]+quarter|q4)[\s\w-]*?(?P<q4y>20\d{2}))'
  r'|(?P<q1>(?:first[\s-]+quarter|q1)[\s\w-]*?(?P<q1y>20\d{2}))'
  r'|(?P<q2>(?:second[\s-]+quarter|q2)[\s\w-]*?(?P<q2y>20\d{2}))'
  r'|(?P<q3>(?:third[\s-]+quarter|q3)[\s\w-]*?(?P<q3y>20\d{2}))'
  r')',
  re.I,
)


def auto_discover_new_quarters(cache: dict) -> int:
  """publisher index에서 신규 분기 PR 발견 → cache 갱신. 신규 발견 수 반환."""
  try:
    r = requests.get(PUBLISHER_INDEX_URL, headers=COMMON_HEADERS, timeout=REQUEST_TIMEOUT_S)
  except Exception as e:
    logger.warning(f'  publisher index fetch 실패: {e}')
    return 0
  if r.status_code != 200:
    logger.warning(f'  publisher index status={r.status_code}')
    return 0
  soup = BeautifulSoup(r.text, 'html.parser')
  added = 0
  for a in soup.find_all('a', href=True):
    href = a.get('href', '')
    if not HREF_RE.search(href):
      continue
    title = a.get_text(strip=True)
    m = TITLE_QUARTER_RE.search(title)
    if not m:
      continue
    if m.group('q1'):
      yp = f'{m.group("q1y")}-Q1'
    elif m.group('q2'):
      yp = f'{m.group("q2y")}-Q2'
    elif m.group('q3'):
      yp = f'{m.group("q3y")}-Q3'
    elif m.group('q4'):
      yp = f'{m.group("q4y")}-Q4'
    else:
      continue
    if yp in cache.get('quarters', {}):
      continue
    full = href if href.startswith('http') else f'https://www.prnewswire.com{href}'
    cache.setdefault('quarters', {})[yp] = full
    added += 1
    logger.info(f'  신규 분기 발견: {yp} → {full}')
  return added


# ---------------------------------------------------------------------------
# 메인 파이프라인
# ---------------------------------------------------------------------------
def _filter_quarters(
  cache_quarters: dict[str, str], year_from: int, year_to: int,
  quarter_filter: int | None,
) -> list[tuple[str, str]]:
  """연도/분기 필터링된 [(year_period, url)] 반환 (정렬됨)."""
  out: list[tuple[str, str]] = []
  for yp, url in cache_quarters.items():
    try:
      y = int(yp.split('-')[0])
      q = int(yp.split('-Q')[1])
    except (ValueError, IndexError):
      continue
    if y < year_from or y > year_to:
      continue
    if quarter_filter is not None and q != quarter_filter:
      continue
    out.append((yp, url))
  out.sort(key=lambda t: t[0])
  return out


def process_quarter(
  year_period: str, url: str, reprocess: bool,
) -> tuple[list[dict], list[str], bool]:
  """단일 분기 PR → (db_rows, check_fails, changed).

  cross-check 실패 시 db_rows는 비어 있음 (호출자가 abort 옵션 따라 처리).
  changed=False 면 캐시 hit (재 fetch/parse 안 했음).
  """
  try:
    html, meta, changed = fetch_html(year_period, url, reprocess)
  except Exception as e:
    logger.error(f'  {year_period}: {e}')
    return [], [f'{year_period}/fetch: {e}'], False

  try:
    raw_rows = extract_table_rows(html)
    models, brand_totals, company_total = normalize_rows(raw_rows, year_period)
    pub_date = extract_publish_date(html)
  except Exception as e:
    logger.error(f'  {year_period}: parse 실패 — {e}')
    return [], [f'{year_period}/parse: {e}'], changed

  fails = cross_check(year_period, models, brand_totals, company_total)
  if fails:
    return [], fails, changed

  # release_id from URL (cache key)
  release_id = extract_release_id(url)
  db_rows = build_db_rows(
    year_period, models, brand_totals, company_total,
    url=url, release_id=release_id, publish_date=pub_date,
  )
  logger.info(
    f'  {year_period}: models={len(models)} brand_totals={len(brand_totals)} '
    f'company_total={"OK" if company_total else "MISSING"} → DB rows={len(db_rows)}'
  )
  return db_rows, [], changed


def parse_args() -> argparse.Namespace:
  p = argparse.ArgumentParser(description='Stellantis NA 분기 판매 수집.')
  p.add_argument('--year-from', type=int, default=DEFAULT_YEAR_FROM,
                 help=f'백필 시작 연도 (default {DEFAULT_YEAR_FROM})')
  p.add_argument('--year-to', type=int, default=None,
                 help='마지막 연도 (default 현재 연도)')
  p.add_argument('--quarter', type=int, choices=[1, 2, 3, 4], default=None,
                 help='특정 분기만 (default 전체)')
  p.add_argument('--reprocess-all', action='store_true',
                 help='HTML sha256 캐시 무시하고 재 fetch + 재 parse')
  p.add_argument('--dry-run', action='store_true',
                 help='DB 쓰기 없이 파싱 + cross-check 결과만')
  p.add_argument('--auto-discover', action='store_true',
                 help='publisher index에서 신규 분기 PR 자동 발견 + cache 갱신')
  p.add_argument('--abort-on-check-fail', action='store_true', default=True,
                 help='cross-check 실패 시 DB 쓰기 중단 (default True)')
  p.add_argument('--no-abort', dest='abort_on_check_fail', action='store_false',
                 help='cross-check 실패 시에도 적재 강행 (긴급용)')
  return p.parse_args()


def _summarize(all_rows: list[dict]) -> dict:
  """적재 요약: 분기별/연도별 / 회사 합계."""
  by_period: dict[str, dict] = {}
  for r in all_rows:
    yp = r['year_period']
    pt = r['period_type']
    key = f'{pt}/{yp}'
    bucket = by_period.setdefault(key, {
      'rows': 0,
      'brands': set(),
      'models': set(),
      'company_total': 0,
    })
    bucket['rows'] += 1
    if r['brand']:
      bucket['brands'].add(r['brand'])
    if r['vehicle_model'] and r['vehicle_model'] != 'Total':
      bucket['models'].add(r['vehicle_model'])
    if r['brand'] == 'Total' and r['vehicle_model'] == 'Total':
      bucket['company_total'] = r.get('sales_units') or 0
  return {
    k: {
      'rows': v['rows'],
      'brands_count': len(v['brands']),
      'models_count': len(v['models']),
      'company_total': v['company_total'],
    } for k, v in sorted(by_period.items())
  }


def main() -> int:
  args = parse_args()
  current_year = datetime.now(timezone.utc).year
  year_to = args.year_to or current_year
  logger.info(
    f'Stellantis NA 분기 판매 수집: {args.year_from}~{year_to} '
    f'quarter={args.quarter} dry_run={args.dry_run} reprocess={args.reprocess_all}'
  )

  cache = load_url_cache()
  if args.auto_discover:
    added = auto_discover_new_quarters(cache)
    if added:
      save_url_cache(cache)

  targets = _filter_quarters(
    cache.get('quarters', {}), args.year_from, year_to, args.quarter,
  )
  if not targets:
    logger.error('대상 분기 없음. URL cache 또는 필터 확인.')
    return 1

  all_db_rows: list[dict] = []
  failed_jobs: list[str] = []
  cache_hits = 0
  fetched = 0

  for yp, url in targets:
    db_rows, fails, changed = process_quarter(yp, url, args.reprocess_all)
    if not changed:
      cache_hits += 1
    else:
      fetched += 1
      time.sleep(REQUEST_SLEEP_S)
    if fails:
      failed_jobs.extend(fails)
      continue
    all_db_rows.extend(db_rows)

  summary = _summarize(all_db_rows)
  logger.info(f'분기 처리: 전체={len(targets)} 캐시hit={cache_hits} 신규fetch={fetched}')
  logger.info(f'DB rows 합계: {len(all_db_rows)}')

  # 결과 JSON 저장
  ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
  log_path = RUN_LOG_DIR / f'_stellantis_collect_run_{ts}.json'
  log_payload = {
    'started_at': ts,
    'args': vars(args),
    'targets': [yp for yp, _ in targets],
    'cache_hits': cache_hits,
    'fetched': fetched,
    'summary': summary,
    'failed_jobs': failed_jobs,
  }
  try:
    with log_path.open('w', encoding='utf-8') as f:
      json.dump(log_payload, f, ensure_ascii=False, indent=2, default=str)
    logger.info(f'결과 로그: {log_path}')
  except Exception as e:
    logger.warning(f'결과 로그 저장 실패: {e}')

  if failed_jobs:
    logger.warning(f'실패/check fail ({len(failed_jobs)}건):')
    for f in failed_jobs:
      logger.warning(f)

  if args.dry_run:
    logger.success(f'dry-run 종료 (DB 쓰기 없음). DB rows={len(all_db_rows)}')
    return 1 if failed_jobs else 0

  has_check_fail = bool(failed_jobs)
  if has_check_fail and args.abort_on_check_fail:
    logger.error('cross-check / 처리 실패 — DB 쓰기 중단 (--no-abort로 강행 가능)')
    return 2

  if not all_db_rows:
    logger.warning('적재할 행 없음 — DB 호출 생략')
    return 1 if failed_jobs else 0

  try:
    with WriteSession() as w:
      BATCH = 500
      for i in range(0, len(all_db_rows), BATCH):
        chunk = all_db_rows[i:i + BATCH]
        w.table('stellantis_na_sales').upsert(
          chunk,
          on_conflict='period_type,year_period,brand,vehicle_model,region',
        ).execute()
      logger.success(f'stellantis_na_sales upsert 완료: {len(all_db_rows)}행')
  except Exception as e:
    logger.exception(f'upsert 실패: {e}')
    return 2

  return 0 if not failed_jobs else 1


if __name__ == '__main__':
  try:
    sys.exit(main())
  except KeyboardInterrupt:
    logger.warning('사용자 중단')
    sys.exit(130)
  except Exception as e:
    logger.exception(f'예기치 못한 오류: {e}')
    sys.exit(1)
