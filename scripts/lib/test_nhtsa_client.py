from lib.nhtsa_client import NHTSA_MODEL_MAP, summarize_recalls


def test_미국_판매_차종만_매핑에_있다():
  assert 'grand_cherokee' in NHTSA_MODEL_MAP
  assert NHTSA_MODEL_MAP['grand_cherokee'] == ('jeep', ['grand cherokee'])
  # 여러 모델을 조회하는 차종도 매핑에 있다
  assert NHTSA_MODEL_MAP['ram_truck'] == ('ram', ['1500', '2500', '3500'])
  assert NHTSA_MODEL_MAP['rivian_r1'] == ('rivian', ['r1t', 'r1s'])
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


def test_latest는_앞의_2건만_담는다():
  results = [
    {'Component': 'A', 'Summary': 'first', 'ReportReceivedDate': '01/02/2026'},
    {'Component': 'B', 'Summary': 'second', 'ReportReceivedDate': '02/02/2026'},
    {'Component': 'C', 'Summary': 'third', 'ReportReceivedDate': '03/02/2026'},
  ]
  out = summarize_recalls(results)
  assert len(out['latest']) == 2
  assert out['latest'][0] == 'first'
  assert out['latest'][1] == 'second'


def test_top_components는_상위_3개까지만_나온다():
  results = [
    {'Component': 'ENGINE', 'Summary': 'a', 'ReportReceivedDate': '01/02/2026'},
    {'Component': 'ENGINE', 'Summary': 'b', 'ReportReceivedDate': '02/02/2026'},
    {'Component': 'ENGINE', 'Summary': 'c', 'ReportReceivedDate': '03/02/2026'},
    {'Component': 'TRANSMISSION', 'Summary': 'd', 'ReportReceivedDate': '04/02/2026'},
    {'Component': 'TRANSMISSION', 'Summary': 'e', 'ReportReceivedDate': '05/02/2026'},
    {'Component': 'BRAKES', 'Summary': 'f', 'ReportReceivedDate': '06/02/2026'},
    {'Component': 'SUSPENSION', 'Summary': 'g', 'ReportReceivedDate': '07/02/2026'},  # 4번째
  ]
  out = summarize_recalls(results)
  assert len(out['top_components']) == 3
  assert out['top_components'][0] == ('ENGINE', 3)
  assert out['top_components'][1] == ('TRANSMISSION', 2)
  assert out['top_components'][2] == ('BRAKES', 1)
