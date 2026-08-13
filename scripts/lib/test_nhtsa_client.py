from lib.nhtsa_client import NHTSA_MODEL_MAP, summarize_recalls


def test_미국_판매_차종만_매핑에_있다():
  assert 'grand_cherokee' in NHTSA_MODEL_MAP
  assert NHTSA_MODEL_MAP['grand_cherokee'] == ('jeep', 'grand cherokee')
  # 중국 전용 차종은 미국 NHTSA 대상이 아니다
  assert 'avante_china' not in NHTSA_MODEL_MAP


def test_리콜_요약이_부품군별로_집계된다():
  results = [
    {'Component': 'ELECTRICAL SYSTEM:PROPULSION', 'Summary': 'a', 'ReportReceivedDate': '01/02/2026'},
    {'Component': 'ELECTRICAL SYSTEM:PROPULSION', 'Summary': 'b', 'ReportReceivedDate': '02/02/2026'},
    {'Component': 'ENGINE', 'Summary': 'c', 'ReportReceivedDate': '03/02/2026'},
  ]
  out = summarize_recalls(results)
  assert out['count'] == 3
  assert out['top_components'][0] == ('ELECTRICAL SYSTEM:PROPULSION', 2)


def test_빈_결과는_0건으로():
  assert summarize_recalls([])['count'] == 0
