"""
DB 기반 회사 메타 로더.

이전에는 companies.json 정적 파일을 읽었지만, 회사 추가 시 자동 반영되지
않는 문제가 있어 DB(companies + company_pages)에서 직접 조회하도록 전환했다.

- 결과는 프로세스 lifetime 동안 lru_cache로 1회 캐시한다 (수집 스크립트 1회성 실행 기준).
- companies.json은 seed_companies.py가 최초 부트스트랩 용도로만 참조한다.
"""
from functools import lru_cache
from typing import TypedDict, NotRequired

from lib.db import get_client


class CompanyInfo(TypedDict):
  """기업 정보 타입 (DB companies 행 + company_pages 집계)."""
  id: str
  ticker: str | None
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


def _fetch_companies_with_pages() -> list[CompanyInfo]:
  """DB에서 companies + company_pages 매핑을 한 번에 로드."""
  client = get_client()

  companies_res = (
    client.table('companies')
    .select(
      'id,ticker,name,name_kr,market,country,currency,data_source,status,'
      'is_seed,group_name,homepage_url'
    )
    .execute()
  )
  pages_res = client.table('company_pages').select('company_id,page').execute()

  pages_by_id: dict[str, list[str]] = {}
  for row in pages_res.data:
    pages_by_id.setdefault(row['company_id'], []).append(row['page'])

  companies: list[CompanyInfo] = []
  for r in companies_res.data:
    item: CompanyInfo = {
      'id': r['id'],
      'ticker': r.get('ticker'),
      'name': r.get('name', ''),
      'name_kr': r.get('name_kr', '') or r.get('name', ''),
      'market': r.get('market'),
      'country': r.get('country') or '',
      'currency': r.get('currency') or '',
      'data_source': r.get('data_source') or '',
      'status': r.get('status') or '',
      'is_seed': bool(r.get('is_seed', False)),
      'pages': pages_by_id.get(r['id'], list(DEFAULT_PAGES)),
      'group_name': r.get('group_name'),
      'homepage_url': r.get('homepage_url'),
    }
    companies.append(item)
  return companies


@lru_cache(maxsize=1)
def load_companies() -> list[CompanyInfo]:
  """전체 회사 목록을 반환한다 (프로세스 캐시)."""
  return _fetch_companies_with_pages()


def get_active_companies() -> list[CompanyInfo]:
  """status가 active인 기업만 반환한다."""
  return [c for c in load_companies() if c['status'] == 'active']


def get_kr_companies() -> list[CompanyInfo]:
  """KR 상장사(active + market 존재)를 반환한다.

  과거에는 data_source='fnguide'로만 한정했지만, fnguide 외 KR 상장사
  (예: pykrx+dart 대기업 8개사)도 fnguide 스크래핑이 가능해 모두 포함.
  """
  return [
    c for c in load_companies()
    if c['status'] == 'active' and c['country'] == 'KR' and c.get('market')
  ]


def get_global_companies() -> list[CompanyInfo]:
  """해외 상장사(active + KR 외 + market 존재)를 반환한다."""
  return [
    c for c in load_companies()
    if c['status'] == 'active' and c['country'] != 'KR' and c.get('market')
  ]


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
