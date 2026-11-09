"""
KOMIS(한국광해광업공단 자원정보서비스) 광물 가격 일별 시계열 조회 공용 모듈.

철광석(collect_steel_kr.py)·LME 구리·알루미늄(collect_komis_lme.py)이 같은 ajax 엔드포인트를 쓴다.
광종은 그룹(HP001 비철 · HP003 철광석·에너지 …)과 광종 코드(MNRL…)로, 가격 기준은
이름(cdVal)으로 고른다.

🔴 가격기준 코드(cdKey)는 KOMIS 내부 ID 라 예고 없이 바뀐다(2026-11 초 철 793→878).
옛 코드는 HTTP 200 + 빈 배열을 주므로 박지 말고 매 실행마다 이름으로 조회한다
(docs/gotchas-data-collection.md 「KOMIS 가격기준 코드는 예고 없이 바뀐다」).
"""
import time
from dataclasses import dataclass
from datetime import date

from loguru import logger
from playwright.sync_api import APIRequestContext, sync_playwright

from lib.series_sources import KOMIS_CHART_API, KOMIS_PRICE_CRTR_API, USER_AGENT

# KOMIS가 GHA IP에 간헐 지연/빈응답 → 지수 백오프 재시도
MAX_FETCH_ATTEMPTS = 3
RETRY_BACKOFF_SEC = 10


@dataclass(frozen=True)
class KomisTarget:
  """KOMIS 에서 받을 한 시계열의 좌표."""
  series_code: str   # market_series_daily 에 적재할 코드
  page_url: str      # 세션 쿠키·Referer 용 페이지
  hp_group: str      # 광종 그룹(HP001 비철 · HP003 철광석·에너지)
  mnrl_code: str     # 광종 코드(MNRL…)
  price_name: str    # 가격기준 이름(cdVal) — 코드가 아니라 이름으로 고른다


def _ajaxHeaders(target: KomisTarget) -> dict:
  return {'Referer': target.page_url, 'X-Requested-With': 'XMLHttpRequest'}


def normalizeNumber(raw: str) -> float | None:
  """쉼표 제거 후 float 변환. 실패 시 None."""
  if raw is None:
    return None
  s = str(raw).strip().replace(',', '')
  if not s or s in ('-', 'N/A', '.', 'nan'):
    return None
  try:
    return float(s)
  except (TypeError, ValueError):
    return None


def resolvePriceCode(request_ctx: APIRequestContext, target: KomisTarget) -> str | None:
  """광종의 현재 가격기준 코드를 이름으로 찾는다(코드는 KOMIS가 예고 없이 바꾼다)."""
  try:
    resp = request_ctx.post(
      KOMIS_PRICE_CRTR_API,
      form={'HP000': target.hp_group, 'mnrkndUnqCd': target.mnrl_code},
      headers=_ajaxHeaders(target),
      timeout=60000,
    )
    if not resp.ok:
      logger.warning(f"KOMIS: 가격기준 조회 HTTP {resp.status}")
      return None
    entries = resp.json().get('data') or []
  except Exception as e:
    logger.error(f"KOMIS: 가격기준 조회 실패 — {e}")
    return None

  for entry in entries:
    if str(entry.get('cdVal', '')).strip() == target.price_name:
      return str(entry.get('cdKey'))
  logger.error(f"KOMIS: 가격기준 '{target.price_name}' 없음 — 받은 목록: {entries}")
  return None


def parseChartPayload(body: dict, series_code: str) -> list[dict]:
  """getChartData 응답을 (series_code, trade_date, close) 행으로 변환."""
  data = body.get('data') or {}
  xaxis = data.get('xaxis') or []
  series = data.get('series') or []
  if not xaxis or not series:
    logger.warning(f"KOMIS: 빈 응답 (xaxis={len(xaxis)}, series={len(series)})")
    return []

  values = series[0].get('data') or []
  if len(values) != len(xaxis):
    logger.warning(f"KOMIS: xaxis/values 길이 불일치 ({len(xaxis)} vs {len(values)})")
    return []

  rows: list[dict] = []
  for raw_date, raw_val in zip(xaxis, values):
    # KOMIS는 'YYYY.MM.DD' 포맷
    try:
      y, m, d = raw_date.split('.')
      trade_date = f"{y}-{m}-{d}"
    except (ValueError, AttributeError):
      continue
    val = normalizeNumber(raw_val)
    if val is None:
      continue
    rows.append({'series_code': series_code, 'trade_date': trade_date, 'close': val})
  return rows


def fetchDailySeries(request_ctx: APIRequestContext, target: KomisTarget, years: int) -> list[dict]:
  """KOMIS 차트 API 에서 일별 시계열을 받는다. 실패·빈 응답이면 빈 목록."""
  end_year = date.today().year
  start_year = end_year - years

  # 1) GET 으로 세션 쿠키 확보
  try:
    request_ctx.get(target.page_url, headers={'Referer': target.page_url}, timeout=60000)
  except Exception as e:
    logger.error(f"KOMIS: 페이지 GET 실패 — {e}")
    return []

  # 2) 가격기준 코드 조회
  price_code = resolvePriceCode(request_ctx, target)
  if price_code is None:
    return []

  # 3) 차트 데이터 POST (form-urlencoded)
  form = {
    'mnrkndUnqRadioCd': target.mnrl_code,
    'srchMnrkndUnqCd': target.mnrl_code,
    'srchPrcCrtr': price_code,
    'srchAvgOpt': 'DAY',
    'srchField': 'year',
    'srchStartDate': str(start_year),
    'srchEndDate': str(end_year),
    'srchCompareMnrkndUnqCd': '',
    'srchComparePrcCrtr': '[선택]',
    'lmeInvt': 'Y',
    'HP000': target.hp_group,
  }
  try:
    resp = request_ctx.post(KOMIS_CHART_API, form=form, headers=_ajaxHeaders(target), timeout=60000)
    if not resp.ok:
      logger.warning(f"KOMIS: HTTP {resp.status}")
      return []
    body = resp.json()
  except Exception as e:
    logger.error(f"KOMIS: 차트 API 실패 — {e}")
    return []

  rows = parseChartPayload(body, target.series_code)
  if not rows:
    logger.warning(f"KOMIS: 가격기준 코드 {price_code} 로 빈 시계열")
  return rows


def fetchWithRetry(target: KomisTarget, years: int) -> list[dict]:
  """브라우저 요청 컨텍스트를 열어 fetchDailySeries 를 백오프 재시도한다."""
  rows: list[dict] = []
  with sync_playwright() as p:
    request_ctx = p.request.new_context(
      user_agent=USER_AGENT,
      extra_http_headers={'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'},
    )
    for attempt in range(1, MAX_FETCH_ATTEMPTS + 1):
      rows = fetchDailySeries(request_ctx, target, years)
      if rows:
        break
      if attempt < MAX_FETCH_ATTEMPTS:
        wait = RETRY_BACKOFF_SEC * attempt
        logger.warning(f"KOMIS: 응답 없음 — {wait}s 후 재시도 ({attempt}/{MAX_FETCH_ATTEMPTS})")
        time.sleep(wait)
    request_ctx.dispose()
  return rows
