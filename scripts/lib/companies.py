"""companies.json 데이터 로더."""
import json
from pathlib import Path
from typing import TypedDict

COMPANIES_JSON_PATH = Path(__file__).parent / 'companies.json'


class CompanyInfo(TypedDict):
  """기업 정보 타입."""
  ticker: str
  name: str
  name_kr: str
  market: str
  country: str
  currency: str
  data_source: str
  status: str
  is_seed: bool


def load_companies() -> list[CompanyInfo]:
  """companies.json을 읽어 반환한다."""
  return json.loads(COMPANIES_JSON_PATH.read_text(encoding='utf-8'))


def get_active_companies() -> list[CompanyInfo]:
  """status가 active인 기업만 반환한다."""
  return [c for c in load_companies() if c['status'] == 'active']


def get_kr_companies() -> list[CompanyInfo]:
  """한국 기업(pykrx+dart 소스)만 반환한다."""
  return [c for c in load_companies() if c['data_source'] == 'pykrx+dart']


def get_global_companies() -> list[CompanyInfo]:
  """글로벌 기업(yfinance 소스)만 반환한다."""
  return [c for c in load_companies() if c['data_source'] == 'yfinance']
