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
  fiscal_year_end_month: int  # 회계 결산월 (1~12, default 12)
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
      'is_seed,fiscal_year_end_month,group_name,homepage_url'
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
      'fiscal_year_end_month': int(r.get('fiscal_year_end_month') or 12),
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


def has_authoritative_summary(c: dict) -> bool:
  """이 회사의 business_summary 는 **외부 정본**(fnguide 기업개요)이 채우는가.

  🔴 국내 상장사의 회사 설명 정본은 fnguide 기업개요다(`collect_kr_snapshot.py`).
     LLM 보강 스크립트는 이 값을 **덮어쓰면 안 된다** — 제품·홈페이지가 비었다는
     이유로 보강 대상이 되더라도 설명은 그대로 두고 나머지만 채운다.

  🔴 2026-07-17 실사고: `enrich_description_v2.py` 가 **폐지된 구 fnguide 도메인**을
     보고 있었다. 폐지된 도메인은 404 가 아니라 HTTP 200 안내 페이지를 돌려주므로
     오류 없이 「내용 없음」이 되어, 국내 상장사 **166곳**이 조용히 2차 LLM 경로로
     넘어가 홈페이지 요약문으로 덮였다. 도메인은 3주 뒤 고쳤지만 값은 안 돌아왔고,
     8월 휴머노이드 보강 때 `enrich_company.py` 가 한 번 더 덮었다.
     2026-09-16 전수 조사에서 국내 상장사 180곳 중 fnguide 원문 생존은 **0곳**이었다.

  ⚠️ 비상장사(`data_source='dart'`)는 fnguide 에 없으므로 대상이 아니다 — LLM 보강이
     유일한 경로라 막으면 영영 빈 채로 남는다. 판정 기준을 `country=='KR'` 만으로
     넓히지 말 것.
  """
  return c.get('country') == 'KR' and bool(c.get('market'))


def keeps_existing_summary(c: dict) -> bool:
  """LLM 보강이 이 회사의 business_summary 를 **건드리면 안 되는가**.

  정본 회사라도 값이 **비어 있으면** LLM 이 임시로 채우는 것을 허용한다(사용자 결정
  2026-09-16) — 새로 상장해 fnguide 에 아직 기업개요가 없는 회사가 영영 빈 칸으로
  남는 것을 막기 위해서다. 다음 분기 수집이 정본으로 바꿔 놓는다.

  🔴 보강 스크립트는 이 판정이 True 인 회사의 설명을 **쓰지 않는다**. 제품·홈페이지
     같은 나머지 항목은 그대로 보강한다 — 대상 판정과 저장 항목을 묶지 말 것
     (2026-08-25 사고: 제품이 비었다는 이유로 대상이 됐는데 설명까지 덮었다).
  """
  return has_authoritative_summary(c) and bool(c.get('business_summary'))


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
