import lib.nhtsa_client as nhtsa_client
from lib.nhtsa_client import (
  NHTSA_COMPETITOR_MAP,
  NHTSA_MODEL_MAP,
  summarize_complaint_components,
  summarize_recalls,
)


def test_미국_판매_차종만_매핑에_있다():
  # 매핑은 (make, 접두 패턴, 제외 접두) 3-tuple 이다. 제외 접두는 접두 매칭의 과잉 매칭을 막는다
  # ('corolla' 가 별개 차종인 'corolla cross' 까지 잡는 문제 — 2026-08-13 전환).
  assert 'grand_cherokee' in NHTSA_MODEL_MAP
  assert NHTSA_MODEL_MAP['grand_cherokee'] == ('jeep', ['grand cherokee'], [])
  # 여러 파생형을 조회하는 차종도 매핑에 있다
  assert NHTSA_MODEL_MAP['ram_truck'] == ('ram', ['ram 1500', 'ram 2500', '3500'], [])
  assert NHTSA_MODEL_MAP['rivian_r1'] == ('rivian', ['r1t', 'r1s'], [])
  # 중국 전용 차종은 미국 NHTSA 대상이 아니다
  assert 'avante_china' not in NHTSA_MODEL_MAP


def test_제외_접두가_있는_매핑():
  # Corolla 와 Corolla Cross 는 다른 차종이고 경쟁군에 각각 따로 있다.
  assert NHTSA_COMPETITOR_MAP['Corolla'] == ('toyota', ['corolla'], ['corolla cross'])


def test_불만_부품군은_콤마로_쪼개_센다():
  # 🔴 리콜은 `Component` 한 개지만 불만은 소문자 `components` 이고 여러 개가 콤마로 붙어 온다.
  # 통째로 세면 조합마다 다른 항목이 돼 상위 3개가 의미를 잃는다.
  results = [
    {'components': 'ELECTRICAL SYSTEM,ENGINE'},
    {'components': 'ENGINE'},
    {'components': 'ENGINE, BRAKES'},
  ]
  out = summarize_complaint_components(results)
  assert out[0] == ('ENGINE', 3)
  assert dict(out)['ELECTRICAL SYSTEM'] == 1
  assert dict(out)['BRAKES'] == 1


def test_불만_부품군이_비면_기타로():
  assert summarize_complaint_components([{'components': ''}]) == [('기타', 1)]
  assert summarize_complaint_components([]) == []


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


def test_get이_전부_None이면_recalls도_None이다(monkeypatch):
  # _get 이 통째로 실패(네트워크 다운 등)해도 recall_ok 가 False 라 recalls 는 None(=알 수 없음).
  # 0 으로 두면 "리콜 없는 안전한 차"로 오독된다(Task 12 브리프).
  monkeypatch.setattr(nhtsa_client, '_resolve', lambda *a, **k: ['grand cherokee'])
  monkeypatch.setattr(nhtsa_client, '_get', lambda *a, **k: None)
  out = nhtsa_client._fetch(('jeep', ['grand cherokee'], []), [2026], 'grand_cherokee', detail=True)
  assert out is not None
  assert out['recalls'] is None


def test_get이_빈배열이면_recalls_count는_0이다(monkeypatch):
  # 조회는 성공했는데 실제로 리콜이 0건인 정상 케이스는 None 이 아니라 {'count': 0} 이어야 한다.
  monkeypatch.setattr(nhtsa_client, '_resolve', lambda *a, **k: ['grand cherokee'])
  monkeypatch.setattr(nhtsa_client, '_get', lambda *a, **k: [])
  out = nhtsa_client._fetch(('jeep', ['grand cherokee'], []), [2026], 'grand_cherokee', detail=True)
  assert out is not None
  assert out['recalls']['count'] == 0


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
