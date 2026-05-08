"""companies.json 데이터 로더."""
import json
from pathlib import Path
from typing import TypedDict, NotRequired

COMPANIES_JSON_PATH = Path(__file__).parent / 'companies.json'


class CompanyInfo(TypedDict):
  """기업 정보 타입."""
  ticker: str
  name: str
  name_kr: str
  market: str | None
  country: str
  currency: str
  data_source: str
  status: str
  is_seed: bool
  pages: NotRequired[list[str]]
  group_name: NotRequired[str | None]
  homepage_url: NotRequired[str | None]


DEFAULT_PAGES: list[str] = ['related-stocks']


def load_companies() -> list[CompanyInfo]:
  """companies.json을 읽어 반환한다."""
  return json.loads(COMPANIES_JSON_PATH.read_text(encoding='utf-8'))


def get_active_companies() -> list[CompanyInfo]:
  """status가 active인 기업만 반환한다."""
  return [c for c in load_companies() if c['status'] == 'active']


def get_kr_companies() -> list[CompanyInfo]:
  """한국 기업(fnguide 소스)만 반환한다."""
  return [c for c in load_companies() if c['data_source'] == 'fnguide']


def get_global_companies() -> list[CompanyInfo]:
  """글로벌 기업(yfinance 소스)만 반환한다."""
  return [c for c in load_companies() if c['data_source'] == 'yfinance']


def get_company_pages(c: CompanyInfo) -> list[str]:
  """회사가 노출되는 페이지 목록을 반환한다(미지정 시 디폴트)."""
  pages = c.get('pages')
  return list(pages) if pages else list(DEFAULT_PAGES)


def get_companies_by_page(page: str, only_active: bool = True) -> list[CompanyInfo]:
  """page 식별자로 회사 목록을 반환한다."""
  result: list[CompanyInfo] = []
  for c in load_companies():
    if only_active and c['status'] != 'active':
      continue
    if page in get_company_pages(c):
      result.append(c)
  return result


def get_domestic_companies(only_active: bool = True) -> list[CompanyInfo]:
  """국내자동차 페이지에 노출되는 회사 목록을 반환한다."""
  return get_companies_by_page('domestic', only_active=only_active)
