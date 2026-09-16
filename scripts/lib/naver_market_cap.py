"""네이버 금융에서 국내 상장사 시가총액을 받아 온다.

🔴 **pykrx 의 시총 경로가 둘 다 죽어서 만든 대체 출처다**(2026-09-16 GHA 실측):
  - 종목 단위 `get_market_cap()` → KRX 가 JSON 이 아닌 응답을 준다
    (`Expecting value: line 1 column 1`)
  - 시장 전체 `get_market_cap_by_ticker()` → 응답에 「시가총액」 컬럼 자체가 없다
  - 대조군인 주가 `get_market_ohlcv()` 는 **정상**이므로 KRX 접근 자체가 막힌 것은 아니고
    시총 계열 엔드포인트만 깨졌다.

네이버는 시총을 **한국어 문자열**로 준다(「75조 1,461억」·「7,166억」). 숫자로 주는
엔드포인트는 없어서(`/basic` 에는 시총 필드가 없다) 파싱이 필요하고, 파싱은 조용히
틀리기 쉬우므로 이 모듈은 **자가 시험을 내장**한다.
"""
import re
import sys
from typing import Optional

try:
  import requests
except ImportError:  # pragma: no cover - 수집 환경엔 항상 있다
  requests = None

from loguru import logger

API_URL = 'https://m.stock.naver.com/api/stock/{ticker}/integration'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0'
TIMEOUT = 10

# 「75조 1,461억」 · 「7,166억」 · 「1조」 — 조와 억이 각각 없을 수 있다.
_JO = re.compile(r'([\d,]+)\s*조')
_EOK = re.compile(r'([\d,]+)\s*억')


def parse_market_cap_eok(text: Optional[str]) -> Optional[float]:
  """네이버 시총 문자열을 **억원** 단위 숫자로 바꾼다.

  DB 표준이 억원이라 억원으로 맞춘다(1조 = 10,000억).
  조·억이 모두 없으면 None — 「-」나 빈 값이 그대로 0 으로 새지 않게 한다.
  """
  if not text:
    return None
  jo = _JO.search(text)
  eok = _EOK.search(text)
  if not jo and not eok:
    return None
  total = 0.0
  if jo:
    total += float(jo.group(1).replace(',', '')) * 10_000
  if eok:
    total += float(eok.group(1).replace(',', ''))
  return total if total > 0 else None


# ── 자가 시험 ────────────────────────────────────────────────────────────
# 🔴 파싱은 조용히 틀린다. 「조」만 있는 값이나 천 단위 쉼표를 놓치면 자릿수가 통째로
#    어긋나는데 화면에는 그럴듯한 숫자가 뜬다. 실측값을 표본으로 박아 둔다.
_CASES: list[tuple[str, Optional[float]]] = [
  ('75조 1,461억', 751_461.0),   # 현대차 2026-09-16 실측
  ('7,166억', 7_166.0),          # 하이젠알앤엠 2026-09-16 실측
  ('1조', 10_000.0),
  ('1조 5억', 10_005.0),
  ('-', None),
  ('', None),
  (None, None),
]


def self_test() -> None:
  """파싱이 살아 있는지 확인한다. 어긋나면 수집을 진행하지 않는다."""
  for raw, expected in _CASES:
    got = parse_market_cap_eok(raw)
    if got != expected:
      logger.error(f'시총 파싱 자가 시험 실패: {raw!r} → {got} (기대 {expected})')
      sys.exit(2)


def fetch_market_cap_eok(ticker: str) -> Optional[float]:
  """종목 하나의 시가총액을 억원 단위로 받아 온다. 실패하면 None."""
  if requests is None:
    return None
  try:
    r = requests.get(
      API_URL.format(ticker=str(ticker).zfill(6)),
      headers={'User-Agent': UA},
      timeout=TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
  except Exception as e:
    logger.warning(f'네이버 시총 조회 실패 {ticker}: {e}')
    return None

  for info in data.get('totalInfos') or []:
    if info.get('code') == 'marketValue':
      return parse_market_cap_eok(info.get('value'))
  return None
