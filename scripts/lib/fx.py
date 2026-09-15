"""
환율 관련 상수 및 유틸리티.
지원 통화: USD, EUR, GBP, JPY, HKD, CNY, VND → KRW
"""
from typing import Final

# yfinance 환율 ticker 매핑 (1 base = X KRW) — 직접 환율
FX_TICKERS: Final[dict[str, str]] = {
  'USD': 'USDKRW=X',
  'EUR': 'EURKRW=X',
  'GBP': 'GBPKRW=X',
  'JPY': 'JPYKRW=X',
  'HKD': 'HKDKRW=X',
  'CNY': 'CNYKRW=X',
}

# yfinance에 직접 X/KRW 환율이 없는 통화 — USD를 경유한 cross-rate
# (cross_ticker는 1 USD = N x_currency 형식; X→KRW = USD→KRW / cross)
FX_CROSS_VIA_USD: Final[dict[str, str]] = {
  'VND': 'USDVND=X',
}

# KRW 종목이 사용하는 통화 (환산 불필요)
BASE_CURRENCY: Final[str] = 'KRW'

# 지원하는 모든 외화 목록
SUPPORTED_CURRENCIES: Final[list[str]] = list(FX_TICKERS.keys()) + list(FX_CROSS_VIA_USD.keys())


def get_fx_ticker(currency: str) -> str | None:
  """통화 코드에 대응하는 yfinance 환율 ticker를 반환한다."""
  return FX_TICKERS.get(currency.upper())


def needs_conversion(currency: str) -> bool:
  """KRW가 아닌 통화이면 True (환산 필요)."""
  return currency.upper() != BASE_CURRENCY


def krw_rate_on(base: str, on: str | None = None) -> float | None:
  """보고서 원화 환산에 쓸 환율(1 base = N KRW)을 돌려준다.

  보고서는 **작성 시점 환율 하나**로 환산한다(report.md §3-B · 사용자 지시
  2026-09-15 "어차피 환산값인데 복잡하게 만들지 마"). 그래서 기본값은 현재값
  테이블이고, `on` 을 주면 그 날짜 이전의 가장 가까운 일봉을 쓴다.

  값이 없으면 None — 호출자는 환산을 생략하고 그 사실을 적는다.
  """
  from lib.db import get_client

  client = get_client()
  if on is None:
    res = (
      client.table('exchange_rates_live')
      .select('rate')
      .eq('base', base.upper())
      .eq('quote', BASE_CURRENCY)
      .execute()
    )
  else:
    res = (
      client.table('exchange_rates')
      .select('rate')
      .eq('base', base.upper())
      .eq('quote', BASE_CURRENCY)
      .lte('rate_date', on)
      .order('rate_date', desc=True)
      .limit(1)
      .execute()
    )
  rows = res.data or []
  return float(rows[0]['rate']) if rows else None


def krw_text(amount: float, rate: float) -> str:
  """외화 금액 × 환율을 보고서 표기용 원화 문자열로 만든다.

  자릿수 규칙(report.md §3-B): 10조 이상 소수 1자리 · 1~10조 소수 2자리 ·
  1조 미만 억원 정수.
  """
  won = amount * rate
  jo = won / 1_000_000_000_000
  if jo >= 10:
    return f'{jo:,.1f}조원'
  if jo >= 1:
    return f'{jo:,.2f}조원'
  return f'{won / 100_000_000:,.0f}억원'
