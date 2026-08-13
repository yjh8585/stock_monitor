from lib.perplexity_client import build_model_queries, parse_search_response


def test_차종당_3개_검색어가_생성된다():
  qs = build_model_queries('Jeep Grand Cherokee', ['Explorer', 'Traverse'])
  assert len(qs) == 3
  assert any('redesign' in q for q in qs)
  assert any('complaints' in q or 'review' in q for q in qs)
  assert any('Explorer' in q for q in qs)


def test_응답_파싱이_필요한_필드만_남긴다():
  raw = {'id': 'x', 'results': [
    {'title': 'T', 'url': 'https://a', 'date': '2026-08-12', 'snippet': 'S' * 900,
     'last_updated': '2026-08-12'},
  ]}
  out = parse_search_response(raw, snippet_limit=100)
  assert out == [{'title': 'T', 'url': 'https://a', 'date': '2026-08-12', 'snippet': 'S' * 100}]


def test_결과가_없으면_빈리스트():
  assert parse_search_response({'results': []}) == []
  assert parse_search_response({}) == []
