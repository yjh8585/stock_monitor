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
