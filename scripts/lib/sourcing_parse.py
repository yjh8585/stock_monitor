"""MarkLines 서플라이어 DB 상세 JSON → sourcing_suppliers 행 (순수 함수).

계획 = docs/plans/2026-11-13-suppliers-page-phase1.md Task 2.
상세 JSON 구조는 2026-11-13 실측(GET /en/supplier_db/{rand_code}/?is_modal=true).
"""
from __future__ import annotations

import re

# 공정 분류는 products 의 이 키 아래 들어 있다(실측). 나머지 키는 부품 분류.
PROCESS_KEY_PREFIX = 'Process type'

# 국가(MarkLines mst_nation.name) → 지역 9탭. 지역 구분은 지리라 공개 무방.
REGION_BY_COUNTRY: dict[str, str] = {
  **{c: '한국' for c in ('Korea', 'South Korea', 'Republic of Korea')},
  **{c: '중국' for c in ('China', 'Hong Kong')},
  'Japan': '일본',
  **{c: '북미' for c in ('USA', 'U.S.A.', 'United States', 'Canada', 'Mexico')},
  'India': '인도',
  **{c: '동남아' for c in ('Thailand', 'Indonesia', 'Malaysia', 'Vietnam', 'Philippines',
                         'Singapore', 'Myanmar', 'Cambodia', 'Laos')},
  **{c: '유럽' for c in ('Germany', 'France', 'Italy', 'Spain', 'United Kingdom', 'UK', 'Portugal',
                        'Czech Republic', 'Czechia', 'Poland', 'Hungary', 'Slovakia', 'Slovenia',
                        'Romania', 'Bulgaria', 'Serbia', 'Austria', 'Switzerland', 'Belgium',
                        'Netherlands', 'Sweden', 'Finland', 'Denmark', 'Norway', 'Ireland',
                        'Turkey', 'Türkiye')},
}

# region_of 가 모르는 국가를 모은다 — 수집기가 끝에 출력해 표를 보강한다.
UNKNOWN_COUNTRIES: set[str] = set()


def region_of(country: str | None) -> str:
  if not country:
    return '기타'
  region = REGION_BY_COUNTRY.get(country.strip())
  if region is None:
    UNKNOWN_COUNTRIES.add(country.strip())
    return '기타'
  return region


def parse_employees(text: str | None) -> int | None:
  if not text:
    return None
  m = re.search(r'\d[\d,]*', text)
  return int(m.group(0).replace(',', '')) if m else None


def _names(items: list[dict] | None, key: str) -> list[str]:
  return [str(x[key]).strip() for x in (items or []) if x.get(key)]


def parse_detail(detail: dict, rand_code: str) -> dict:
  profile = detail['profile']
  i18n = (profile.get('i18n_suppliers') or [{}])[0]
  country = (profile.get('mst_nation') or {}).get('name')
  products = detail.get('products') or {}
  categories: list[str] = []
  processes: list[str] = []
  for key, items in products.items():
    (processes if key.startswith(PROCESS_KEY_PREFIX) else categories).extend(_names(items, 's_name'))
  comments = (detail.get('parts_comments') or {}).get('en') or []
  delivers = detail.get('delivers') or {}
  return {
    'source': 'marklines',
    'ml_supplier_id': int(profile['id']),
    'ml_rand_code': rand_code,
    'name': (i18n.get('name') or '').strip(),
    'country': country,
    'region': region_of(country),
    'location': None,
    'address': i18n.get('address'),
    'homepage': i18n.get('homepage'),
    'established': i18n.get('establish'),
    'sales_text': i18n.get('sales'),
    'employees': parse_employees(i18n.get('employee')),
    'certifications': _names(profile.get('quality_assurances'), 'name'),
    'product_categories': categories,
    'processes': processes,
    'parts_comments': _names(comments, 'parts'),
    'delivers_oem': _names(delivers.get('oem'), 'name'),
    'delivers_supplier': _names(delivers.get('supplier'), 'name'),
    'remarks': _names(i18n.get('i18n_supplier_remarks'), 'remark'),
    'source_url': f'https://www.marklines.com/en/supplier_db/{rand_code}/',
  }
