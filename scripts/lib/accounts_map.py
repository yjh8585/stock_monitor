"""
재무 계정과목 3-way 매핑.
DART 한국어 계정명 / yfinance income_stmt·balance_sheet 키 / DB 컬럼명을 연결한다.
단위는 모두 원본 통화 기준 백만 단위로 정규화 후 저장.
"""
from typing import TypedDict


class AccountMapping(TypedDict):
  """재무 계정 매핑 정의."""
  dart_key: str | None      # DART API 계정명 (한국어)
  yf_income: str | None     # yfinance income_stmt 컬럼명
  yf_balance: str | None    # yfinance balance_sheet 컬럼명
  db_col: str               # DB financials 테이블 컬럼명


# 수익성 계정과목 매핑
INCOME_ACCOUNTS: list[AccountMapping] = [
  {
    'dart_key': '매출액',
    'yf_income': 'Total Revenue',
    'yf_balance': None,
    'db_col': 'revenue',
  },
  {
    'dart_key': '매출원가',
    'yf_income': 'Cost Of Revenue',
    'yf_balance': None,
    'db_col': 'cogs',
  },
  {
    'dart_key': '매출총이익',
    'yf_income': 'Gross Profit',
    'yf_balance': None,
    'db_col': 'gross_profit',
  },
  {
    'dart_key': '판매비와관리비',
    'yf_income': 'Selling General And Administration',
    'yf_balance': None,
    'db_col': 'sga',
  },
  {
    'dart_key': '영업이익',
    'yf_income': 'Operating Income',
    'yf_balance': None,
    'db_col': 'operating_income',
  },
  {
    'dart_key': '당기순이익',
    'yf_income': 'Net Income',
    'yf_balance': None,
    'db_col': 'net_income',
  },
  {
    'dart_key': 'EBITDA',
    'yf_income': 'EBITDA',
    'yf_balance': None,
    'db_col': 'ebitda',
  },
]

# 재무건전성 계정과목 매핑
BALANCE_ACCOUNTS: list[AccountMapping] = [
  {
    'dart_key': '자산총계',
    'yf_income': None,
    'yf_balance': 'Total Assets',
    'db_col': 'total_assets',
  },
  {
    'dart_key': '부채총계',
    'yf_income': None,
    'yf_balance': 'Total Liabilities Net Minority Interest',
    'db_col': 'total_liabilities',
  },
  {
    'dart_key': '자본총계',
    'yf_income': None,
    'yf_balance': 'Total Equity Gross Minority Interest',
    'db_col': 'total_equity',
  },
  {
    'dart_key': '유동비율',
    'yf_income': None,
    'yf_balance': None,  # 계산: current_assets / current_liabilities
    'db_col': 'current_ratio',
  },
  {
    'dart_key': 'ROE',
    'yf_income': None,
    'yf_balance': None,  # 계산: net_income / total_equity
    'db_col': 'roe',
  },
  {
    'dart_key': 'ROA',
    'yf_income': None,
    'yf_balance': None,  # 계산: net_income / total_assets
    'db_col': 'roa',
  },
]

# yfinance balance_sheet에서 유동자산/부채 키
YF_CURRENT_ASSETS_KEY = 'Current Assets'
YF_CURRENT_LIABILITIES_KEY = 'Current Liabilities'

# DART → DB 컬럼명 빠른 조회용 딕셔너리
DART_TO_DB: dict[str, str] = {
  m['dart_key']: m['db_col']
  for m in INCOME_ACCOUNTS + BALANCE_ACCOUNTS
  if m['dart_key']
}

# yfinance income_stmt → DB 컬럼명 빠른 조회용 딕셔너리
YF_INCOME_TO_DB: dict[str, str] = {
  m['yf_income']: m['db_col']
  for m in INCOME_ACCOUNTS
  if m['yf_income']
}

# yfinance balance_sheet → DB 컬럼명 빠른 조회용 딕셔너리
YF_BALANCE_TO_DB: dict[str, str] = {
  m['yf_balance']: m['db_col']
  for m in BALANCE_ACCOUNTS
  if m['yf_balance']
}
