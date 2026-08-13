from lib.outlook_prompt import build_digest


def test_다이제스트에_판매표와_경쟁표와_검색결과가_모두_들어간다():
  digest = build_digest(
    model_name='Jeep Grand Cherokee',
    markets=[{
      'label': '미국', 'market': 'USA',
      'metrics': {'recent_sales': 115251, 'yoy_pct': -6.2, 'share_pct': 9.8, 'prev_share_pct': 12.4, 'months': 7},
      'competitors': [{'model': 'Explorer', 'sales': 145829, 'yoy_pct': 14.7}],
    }],
    production_gap={'sales_total': 100, 'production_total': 120, 'gap': 20},
    safety={'model_year': 2026, 'recalls': {'count': 3, 'top_components': [('ELECTRICAL', 2)], 'latest': ['a']}, 'complaint_count': 11},
    inventory={'brand': 'Jeep', 'days_supply': 95, 'year_month': 202606},
    web_results=[{'title': '2027 Grand Cherokee', 'url': 'https://x', 'date': '2026-08-12', 'snippet': 'Upland trim'}],
  )
  assert '115,251' in digest
  assert 'Explorer' in digest
  assert '2027 Grand Cherokee' in digest
  assert 'ELECTRICAL' in digest
  assert '95' in digest


def test_없는_섹션은_생략되고_에러가_나지_않는다():
  digest = build_digest(
    model_name='X', markets=[], production_gap=None, safety=None, inventory=None, web_results=[]
  )
  assert 'X' in digest


def test_시장_헤더에_기준월이_표시된다():
  """compute_market_metrics 가 돌려주는 anchor_month 를 시장 헤더에 노출해야
  AI 와 화면이 "언제 시점 숫자인지" 알 수 있다(Task 7 브리프 갱신 사항)."""
  digest = build_digest(
    model_name='Kia Seltos',
    markets=[{
      'label': '미국', 'market': 'USA',
      'metrics': {
        'recent_sales': 50000, 'yoy_pct': 1.0, 'share_pct': 20.0, 'prev_share_pct': 19.0,
        'months': 12, 'anchor_month': 202606,
      },
      'competitors': [],
    }],
    production_gap=None, safety=None, inventory=None, web_results=[],
  )
  assert '(202606 기준 최근 12개월)' in digest


def test_anchor_month_없으면_기준월_문구를_생략한다():
  digest = build_digest(
    model_name='X',
    markets=[{
      'label': '미국', 'market': 'USA',
      'metrics': {'recent_sales': 100, 'yoy_pct': 1.0, 'months': 12},
      'competitors': [],
    }],
    production_gap=None, safety=None, inventory=None, web_results=[],
  )
  assert '기준' not in digest
