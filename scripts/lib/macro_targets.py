"""미국경제 전망 수집 대상 ticker 정의 (카테고리별)."""
from typing import Final

MACRO_TICKERS: Final[dict[str, list[tuple[str, str]]]] = {
  '경기 소비재': [
    ('WMT', '월마트'),
    ('TGT', '타겟'),
    ('COST', '코스트코'),
  ],
  '자동차 OEM': [
    ('F', '포드'),
    ('GM', 'GM'),
    ('STLA', '스텔란티스'),
  ],
  '자동차 딜러': [
    ('AN', '오토네이션'),
    ('ABG', '애즈베리'),
    ('LAD', '리시아 모터스'),
  ],
  '물류': [
    ('FDX', '페덱스'),
    ('UPS', 'UPS'),
    ('CASS', 'Cass Information Systems'),
  ],
}

def allTickers() -> list[tuple[str, str, str]]:
  """(category, ticker, name_kr) 튜플 평탄화 리스트."""
  out: list[tuple[str, str, str]] = []
  for category, items in MACRO_TICKERS.items():
    for ticker, name_kr in items:
      out.append((category, ticker, name_kr))
  return out
