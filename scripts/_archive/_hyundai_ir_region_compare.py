"""현대차 IR audit + 우리 DB cross-check 종합 리포트.

입력: data/_hyundai_ir_region_audit.json (먼저 _hyundai_ir_region_check.py 실행)
출력: data/_hyundai_ir_region_compare.json + 콘솔 표

비교 한계:
  - 사이트는 "현대만" 분리 (4,138K)
  - 우리 DB(MarkLines)는 'Hyundai Kia Automotive Group'(현대+기아 합산, 7,170K)만 보유
  - 따라서 우리 DB의 현대 단독 추출은 불가. 대신 HK 그룹 region 분포로 cross-check.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lib.bootstrap import init_script  # type: ignore  # noqa: E402

init_script(__file__)

import json  # noqa: E402
from collections import defaultdict  # noqa: E402

from loguru import logger  # noqa: E402

from lib.db import get_client  # noqa: E402

OUT_DIR = Path(__file__).parent.parent / 'data'
AUDIT_PATH = OUT_DIR / '_hyundai_ir_region_audit.json'
OUT_PATH = OUT_DIR / '_hyundai_ir_region_compare.json'

# MarkLines country → 현대IR 9 region 매핑 (현대 공식 지역 분류 기준)
# AGENTS.md 규칙: 추측 금지. 매핑은 명시적 화이트리스트만.
HYUNDAI_REGIONS = {
  '북미': ['USA', 'Canada', 'Mexico', 'Puerto Rico'],
  '국내': ['Korea'],
  '유럽': [
    'UK', 'Germany', 'Spain', 'Italy', 'France', 'Poland', 'Netherlands',
    'Belgium', 'Sweden', 'Ireland', 'Czech Republic', 'Austria', 'Norway',
    'Portugal', 'Denmark', 'Finland', 'Greece', 'Hungary', 'Switzerland',
    'Romania', 'Slovakia', 'Bulgaria', 'Slovenia', 'Croatia', 'Lithuania',
    'Latvia', 'Estonia', 'Luxembourg', 'Iceland', 'Cyprus', 'Malta',
  ],
  '인도': ['India'],
  '중남미': [
    'Brazil', 'Colombia', 'Chile', 'Peru', 'Argentina', 'Ecuador',
    'Uruguay', 'Paraguay', 'Bolivia', 'Venezuela', 'Dominican Republic',
    'Guatemala', 'Costa Rica', 'Panama', 'Honduras', 'El Salvador',
    'Nicaragua', 'Trinidad and Tobago',
  ],
  '아중동': [
    'Saudi Arabia', 'Turkiye', 'Israel', 'UAE', 'Egypt', 'Iraq',
    'Jordan', 'Lebanon', 'Kuwait', 'Qatar', 'Bahrain', 'Oman',
    'Yemen', 'Iran', 'Syria', 'Pakistan', 'Bangladesh', 'Sri Lanka',
    'Algeria', 'Morocco', 'Tunisia', 'Libya', 'South Africa',
    'Nigeria', 'Kenya', 'Ethiopia', 'Ghana', 'Angola', 'Senegal',
    'Tanzania', 'Uganda',
  ],
  '아태': [
    'Australia', 'Vietnam', 'Indonesia', 'Thailand', 'Malaysia',
    'Philippines', 'Singapore', 'New Zealand', 'Japan', 'Taiwan',
    'Hong Kong', 'Cambodia', 'Myanmar', 'Laos', 'Brunei',
  ],
  '중국': ['China'],
  '기타': [
    'Kazakhstan', 'Russia', 'Ukraine', 'Uzbekistan', 'Belarus', 'Azerbaijan',
    'Georgia', 'Armenia', 'Kyrgyzstan', 'Tajikistan', 'Turkmenistan',
    'Moldova', 'Mongolia',
  ],
}

REGION_ORDER = ['북미', '국내', '유럽', '인도', '중남미', '아중동', '아태', '중국', '기타']
COUNTRY_TO_REGION = {c: r for r, lst in HYUNDAI_REGIONS.items() for c in lst}


def aggregate_db_by_region(year: int) -> tuple[dict[str, int], list[tuple[str, int]], int]:
  """HK 그룹의 country별 합산 → region 합산."""
  client = get_client()
  rows = client.table('oem_sales_group_country_month').select('country,sales') \
    .eq('oem_group', 'Hyundai Kia Automotive Group') \
    .gte('year_month', year * 100 + 1) \
    .lte('year_month', year * 100 + 12) \
    .execute().data

  country_total: dict[str, int] = defaultdict(int)
  for x in rows:
    country_total[x['country']] += x['sales']

  region_total: dict[str, int] = defaultdict(int)
  unmapped: list[tuple[str, int]] = []
  for ctry, sales in country_total.items():
    region = COUNTRY_TO_REGION.get(ctry)
    if region:
      region_total[region] += sales
    else:
      unmapped.append((ctry, sales))

  grand_total = sum(country_total.values())
  return dict(region_total), unmapped, grand_total


def main() -> None:
  audit = json.loads(AUDIT_PATH.read_text(encoding='utf-8'))

  report: dict = {'years': {}}
  for year_str, ydata in audit.get('years', {}).items():
    year = int(year_str)
    chart = ydata.get('chart_data') or []
    site_by_region = {d['region']: int(d['value']) for d in chart if d.get('region')}
    site_total = ydata.get('total_units')

    db_by_region, unmapped, db_total = aggregate_db_by_region(year)
    db_kia_est = db_total - site_total if site_total else None

    rows = []
    for region in REGION_ORDER:
      site_v = site_by_region.get(region, 0)
      db_hk = db_by_region.get(region, 0)
      diff = db_hk - site_v  # db_hk가 큰 만큼이 기아 추정치
      rows.append({
        'region': region,
        'site_hyundai': site_v,
        'db_hk_group': db_hk,
        'diff_db_minus_site': diff,
      })

    report['years'][year_str] = {
      'site_total_hyundai': site_total,
      'db_total_hk_group': db_total,
      'db_kia_estimate': db_kia_est,
      'rows': rows,
      'unmapped_db_countries': unmapped,
    }

    logger.info(f'\n==== {year} ====')
    logger.info(f'  site (현대만):       {site_total:>12,}')
    logger.info(f'  db   (HK 그룹):     {db_total:>12,}')
    logger.info(f'  diff (기아 추정):   {db_kia_est:>12,}')
    logger.info(f'  {"region":<8} {"site":>12}  {"db_HK":>12}  {"diff(kia추정)":>14}')
    for r in rows:
      logger.info(f'  {r["region"]:<8} {r["site_hyundai"]:>12,}  {r["db_hk_group"]:>12,}  {r["diff_db_minus_site"]:>14,}')
    if unmapped:
      logger.warning(f'  UNMAPPED: {unmapped[:5]}')

  OUT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
  logger.info(f'\nsaved: {OUT_PATH}')


if __name__ == '__main__':
  main()
