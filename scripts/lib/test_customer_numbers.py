"""collect_customer_numbers.py 시험 — 판정·적재 행·받기 실패·파서 예외·방향·--add-file·파서 없는 회사(네트워크·DB 없음).

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_customer_numbers.py -q
"""
import importlib.util
import io
import os
import pathlib
import re
import sys
import tempfile
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

from customer_parsers import base  # noqa: E402

_p = _SCRIPTS / 'collect_customer_numbers.py'
spec = importlib.util.spec_from_file_location('ccn', _p)
ccn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ccn)

# 시험 회사는 가짜 이름 — 공개 레포
_TEXT = 'Acme Motors delivered | 1,234 | vehicles in the third quarter of 2026. Results on October 28, 2026 after close.'
_DOC = base.Doc(id=7, company_id='c-1', ticker='ACME', source='ir', doc_type='sales_release', form='', items='',
                title='Acme Motors Q3 2026 deliveries', url='https://ir.example.com/q3.pdf', published_at='2026-10-02',
                source_id='ir.example.com/q3.pdf')
_MOBIS_LIKE = 'https://www.example.co.kr/cmm/fms/PdfFileDown.do?fileId=ABC&fileNm=x.pdf'


def _vol(period='2026-Q3', value=1234, quote='Acme Motors delivered | 1,234 | vehicles'):
  return base.VolumeRow('deliveries', 'total', 'quarter', period, value, 'retail', quote)


def _date(event='2026-10-28'):
  return base.EarningsDate('2026-Q3', event, 'Results on October 28, 2026 after close')


def _doc(**kw):
  return base.Doc(**{**_DOC.__dict__, **kw})


def _http_error(code):
  return requests.HTTPError('boom https://secret.example/?k=1', response=SimpleNamespace(status_code=code))


def _mod(fetch=None, parse=None):
  return SimpleNamespace(TICKERS=('ACME',), wants=lambda d: True, fetch=fetch or (lambda s, d: base.Content(_TEXT)),
                         parse=parse or (lambda d, c: base.ParseResult(volume=[_vol()], recognized=True)))


def _run(mod, dry_run=False):
  ws = MagicMock()
  return ccn._CompanyRun(mod, MagicMock(), None, ws, SimpleNamespace(dry_run=dry_run, no_llm=True), 'c-1'), ws


def _doc_patches(ws) -> list[dict]:
  return [c.args[0] for c in ws.table.return_value.update.call_args_list]


class JudgeTests(unittest.TestCase):
  def test_order(self):
    R = base.ParseResult
    self.assertEqual(ccn.judge(R(volume=[_vol()]), 1, 0), ('not_target', None))
    self.assertEqual(ccn.judge(R(recognized=True), 0, 0), ('failed', '새 문서인데 숫자 0개'))
    self.assertEqual(ccn.judge(R(dates=[_date()], recognized=True), 0, 1), ('parsed', None))   # 일정 전용 문서
    self.assertEqual(ccn.judge(R(dates=[_date()], recognized=True), 0, 0), ('failed', '대조 통과 0'))
    self.assertEqual(ccn.judge(R(volume=[_vol()], dates=[_date()], recognized=True), 0, 1), ('failed', '대조 통과 0'))
    self.assertEqual(ccn.judge(R(volume=[_vol()], recognized=True), 1, 0), ('parsed', None))

  def test_llm_rows_override_unrecognized(self):
    """코드 파서가 못 알아본 문서(recognized=False)라도 LLM 행이 있으면 대상이다."""
    R = base.ParseResult
    self.assertEqual(ccn.judge(R(guidance=[_guid()]), 1, 0, llm_rows=1), ('parsed', None))
    self.assertEqual(ccn.judge(R(guidance=[_guid()]), 0, 0, llm_rows=1), ('failed', '대조 통과 0'))
    self.assertEqual(ccn.judge(R(), 0, 0, llm_rows=0), ('not_target', None))


def _guid():
  return base.GuidanceRow('revenue', 'Revenue', 'FY2026', 10.0, 12.0, None, 'billion', None, 'revenue of $10 to $12 billion')


class PendingTests(unittest.TestCase):
  """wants 거짓·LLM 대기 문서는 not_target 으로 닫지 않는다 — 나중에 파서·LLM 이 생기면 다시 봐야 한다."""

  def test_wants_false_stays_pending_with_note(self):
    mod = _mod()
    mod.wants = lambda d: False
    run, ws = _run(mod)
    run.process(_DOC, None, None)
    self.assertEqual(_doc_patches(ws), [{'parse_status': 'pending', 'parse_note': ccn.NOTE_NO_PARSER}])
    self.assertEqual(run.outcomes['not_target'], 0)

  def test_wants_false_same_note_no_write(self):
    mod = _mod()
    mod.wants = lambda d: False
    run, ws = _run(mod)
    run.process(_DOC, None, ccn.NOTE_NO_PARSER)
    ws.table.assert_not_called()

  def test_llm_wanted_but_not_run_stays_pending(self):
    """중장기 Investor Day 처럼 코드가 못 알아보고(recognized=False) LLM 이 읽을 문서인데 LLM 이 안 돌았다 → pending."""
    mod = _mod(parse=lambda d, c: base.ParseResult())
    mod.llm_wants = lambda d, r: True
    run, ws = _run(mod)   # no_llm=True
    run.process(_DOC, None, None)
    self.assertEqual(_doc_patches(ws), [{'parse_status': 'pending', 'parse_note': ccn.NOTE_LLM_WAIT}])
    run2, ws2 = _run(mod)
    run2.process(_DOC, None, ccn.NOTE_LLM_WAIT)
    ws2.table.assert_not_called()

  def test_parsed_but_llm_not_run_keeps_pending(self):
    """최종 검토 P8 — 코드 행은 뽑혀 parsed 감인데 llm_wants 가 참이고 LLM 이 안 돌았다 → 코드 행은 싣되 문서는 pending +
    NOTE_LLM_WAIT(다음 실행이 다시 집는다 · 전엔 parsed 로 닫혀 사람이 --reparse 해야 했다). llm_wants 거짓이면 parsed."""
    for wants, want in ((True, ('pending', ccn.NOTE_LLM_WAIT)), (False, ('parsed', None))):
      mod = _mod()
      mod.llm_wants = lambda d, r, w=wants: w
      run, ws = _run(mod)   # no_llm=True
      with patch.object(ccn, 'existing_pubs', return_value={}):
        run.process(_DOC, None, None)
      last = _doc_patches(ws)[-1]
      self.assertEqual((last['parse_status'], last['parse_note']), want)
      self.assertTrue(ws.table.return_value.upsert.called)   # 코드 행은 어느 쪽이든 실린다
      if wants:
        self.assertEqual(run.outcomes['parsed'], 0)
        self.assertEqual(run.outcomes['llm_wait_parsed'], 1)   # finish 가 방향을 다시 매기는 근거
    # 같은 note 면 문서 행은 다시 쓰지 않는다(코드 행 upsert 는 멱등)
    mod = _mod()
    mod.llm_wants = lambda d, r: True
    run, ws = _run(mod)
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, ccn.NOTE_LLM_WAIT)
    self.assertEqual(_doc_patches(ws), [])

  def test_failed_but_llm_not_run_keeps_pending(self):
    """최종 검토 P8(검토 M1) — 코드가 서식은 알아봤는데 0행(failed 감)이고 LLM 이 읽을 문서인데 안 돌았다 → pending."""
    mod = _mod(parse=lambda d, c: base.ParseResult(recognized=True))
    mod.llm_wants = lambda d, r: True
    run, ws = _run(mod)
    run.process(_DOC, None, None)
    self.assertEqual(_doc_patches(ws), [{'parse_status': 'pending', 'parse_note': ccn.NOTE_LLM_WAIT}])
    self.assertEqual(run.outcomes['failed'], 0)

  def test_llm_no_key_keeps_pending(self):
    """LLM 을 켜고(no_llm=False) 돌렸는데 키가 없다(클라이언트 None) → 예외 없이 pending + LLM 대기 · extract 안 부른다."""
    mod = _mod(parse=lambda d, c: base.ParseResult())
    mod.llm_wants = lambda d, r: True
    ws = MagicMock()
    run = ccn._CompanyRun(mod, MagicMock(), None, ws, SimpleNamespace(dry_run=False, no_llm=False), 'c-1', None)
    with patch('lib.llm_guidance.extract') as ex:
      run.process(_DOC, None, None)
    ex.assert_not_called()
    self.assertEqual(_doc_patches(ws), [{'parse_status': 'pending', 'parse_note': ccn.NOTE_LLM_WAIT}])
    self.assertEqual(run.llm_calls, 0)

  def test_unrecognized_without_llm_wants_closes(self):
    """LLM 도 안 읽는 문서(NDR 등)는 그대로 not_target."""
    mod = _mod(parse=lambda d, c: base.ParseResult())
    mod.llm_wants = lambda d, r: False
    run, ws = _run(mod)
    run.process(_DOC, None, None)
    self.assertEqual(_doc_patches(ws)[-1]['parse_status'], 'not_target')

  def test_llm_rows_with_unrecognized_code_parse_is_parsed(self):
    """LLM 행 1건 + 코드 recognized=False → parsed(가짜 _llm 결과)."""
    mod = _mod(parse=lambda d, c: base.ParseResult())
    run, ws = _run(mod)

    def fake_llm(doc, content, res, notes):
      g = _guid()
      res.guidance.append(g)
      return {id(g)}
    with patch.object(run, '_llm', side_effect=fake_llm), \
         patch.object(ccn, 'verify', side_effect=lambda res, text: {id(g): (True, None) for g in res.guidance}), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None)
    self.assertEqual(run.outcomes['parsed'], 1)
    self.assertEqual(_doc_patches(ws)[-1]['parse_status'], 'parsed')


# LLM 경로(Task 11) — 가짜 extract · 원문 = _TEXT 에 가이던스 문장을 붙인 것
_G_TEXT = _TEXT + ' Acme Motors expects 2026 deliveries of 5,000 to 6,000 vehicles and revenue of $1.0 to $1.2 billion.'
_G_CODE = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 5000.0, 6000.0, None, 'units', None,
                           'Acme Motors expects 2026 deliveries of 5,000 to 6,000 vehicles')
_G_LLM_REV = base.GuidanceRow('revenue', 'Revenue', 'FY2026', 1.0, 1.2, None, 'billion', None,
                              'deliveries of 5,000 to 6,000 vehicles and revenue of $1.0 to $1.2 billion')


def _llm_mod(code_guidance=(), code_miss=False, recognized=True, volume=True):
  def parse(d, c):
    return base.ParseResult(volume=[_vol()] if volume else [], guidance=list(code_guidance), recognized=recognized,
                            code_miss=code_miss)
  mod = _mod(fetch=lambda s, d: base.Content(_G_TEXT), parse=parse)
  mod.llm_wants = lambda d, r: True
  return mod


def _llm_run(mod, llm=None):
  ws = MagicMock()
  run = ccn._CompanyRun(mod, MagicMock(), None, ws, SimpleNamespace(dry_run=False, no_llm=False), 'c-1',
                        llm if llm is not None else MagicMock())
  return run, ws


def _upserted_guidance(ws) -> list[dict]:
  return [r for c in ws.table.return_value.upsert.call_args_list for r in c.args[0] if 'extractor' in r]


def _ok(rows, why=None):
  """가짜 extract 반환 — (행, 거른 사유 Counter)."""
  return rows, Counter(why or {})


def _status_patches(ws) -> list[dict]:
  return [p for p in _doc_patches(ws) if 'parse_status' in p]


class LlmPathTests(unittest.TestCase):
  def test_extract_called_with_client_label_hint(self):
    """extract(client, doc, text, company_label, hint, 보고 통화, LLM_DROP) — 클라이언트는 실행에서 받은 것 · hint 는 모듈
    LLM_HINT(함수도 된다)."""
    mod = _llm_mod()
    mod.LLM_HINT = lambda d: f'hint-for-{d.ticker}'
    mod.BASE_CURRENCY = 'USD'
    mod.LLM_DROP = re.compile('scooter')
    client = MagicMock()
    run, _ = _llm_run(mod, client)
    run._company_label = 'Acme Motors'
    with patch('lib.llm_guidance.extract', return_value=_ok([])) as ex, \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None)
    ex.assert_called_once_with(client, _DOC, _G_TEXT, 'Acme Motors', 'hint-for-ACME', 'USD', mod.LLM_DROP)
    self.assertEqual(run.llm_calls, 1)

  def test_llm_exception_code_rows_kept_doc_pending_retry(self):
    """🔴 (a) 코드 행이 있는 문서에서 extract 예외 → 코드 행은 적재 · 문서는 pending + llm_attempts 1 · note
    「LLM 대기 — LLM 실패: <클래스> (1/3)」 · 다음 문서는 계속 · exit 1 사유 아님(재시도 대기)."""
    mod = _llm_mod(code_guidance=[_G_CODE])
    run, ws = _llm_run(mod)
    doc2 = _doc(id=8)
    calls = iter([RuntimeError('api down https://secret.example/?k=1'), _ok([_G_LLM_REV])])

    def fake_extract(*a, **kw):
      x = next(calls)
      if isinstance(x, Exception):
        raise x
      return x
    with patch('lib.llm_guidance.extract', side_effect=fake_extract), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None, 0)
      run.process(doc2, None, None, 0)
    first, second = _status_patches(ws)
    self.assertEqual(first['parse_status'], 'pending')
    self.assertEqual(first['parse_note'], f'LLM 대기 — {ccn.NOTE_LLM_FAIL}: RuntimeError (1/3)')
    self.assertEqual(first['llm_attempts'], 1)
    self.assertTrue(first['parse_note'].startswith('LLM 대기'))   # LIKE 'LLM 대기%' 로 같이 뽑힌다
    self.assertNotIn('secret', first['parse_note'])
    self.assertEqual(second['parse_status'], 'parsed')
    self.assertIsNone(second['parse_note'])
    self.assertNotIn('llm_attempts', second)   # 0 회였으면 건드리지 않는다
    self.assertEqual(run.outcomes['llm_retry'], 1)
    # 첫 문서 코드 행은 적재됐다(LLM 행 없음) · 둘째 문서는 코드 + LLM
    self.assertEqual(sorted(g['extractor'] for g in _upserted_guidance(ws)), ['code', 'code', 'llm'])
    with patch('collect_customer_docs.write_status') as ws_status, patch.object(run, '_directions', return_value=0):
      self.assertEqual(run.finish('ACME', 2), 0)
    self.assertEqual(ws_status.call_args.args[3], 'ok')

  def test_llm_retry_code_rows_idempotent(self):
    """재시도마다 같은 코드 행을 다시 싣는다 — 두 번 돌려도 적재 행(upsert 인자)이 같다(멱등)."""
    payloads = []
    for attempts in (0, 1):
      run, ws = _llm_run(_llm_mod(code_guidance=[_G_CODE]))
      with patch('lib.llm_guidance.extract', side_effect=RuntimeError('x')), \
           patch.object(ccn, 'existing_pubs', return_value={}):
        run.process(_DOC, None, None, attempts)
      payloads.append([c.args[0] for c in ws.table.return_value.upsert.call_args_list])
      self.assertEqual(_status_patches(ws)[-1]['llm_attempts'], attempts + 1)
    self.assertEqual(payloads[0], payloads[1])

  def test_llm_exception_unrecognized_doc_pending_retry(self):
    """코드가 못 알아보는 문서에서 LLM 이 실패하면 pending + 「LLM 대기 — LLM 실패: <클래스> (1/3)」."""
    run, ws = _llm_run(_llm_mod(recognized=False, volume=False))
    with patch('lib.llm_guidance.extract', side_effect=ValueError('bad json')):
      run.process(_DOC, None, None, 0)
    last = _status_patches(ws)[-1]
    self.assertEqual(last['parse_status'], 'pending')
    self.assertEqual(last['parse_note'], f'LLM 대기 — {ccn.NOTE_LLM_FAIL}: ValueError (1/3)')
    self.assertEqual(last['llm_attempts'], 1)

  def test_llm_exception_on_recognized_empty_doc_pending_retry(self):
    """🔴 수정 2회차 A — 코드가 서식을 알아봤지만 0행이라 판정이 failed 인 문서(kr_dart 가이던스 G_ANNUAL·0행)에서
    LLM 이 실패하면 곧바로 failed(exit 1)가 아니라 재시도 대기 · judge note 는 뒤에 남긴다."""
    run, ws = _llm_run(_llm_mod(recognized=True, volume=False))
    with patch('lib.llm_guidance.extract', side_effect=RuntimeError('x')), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None, 0)
    last = _status_patches(ws)[-1]
    self.assertEqual(last['parse_status'], 'pending')
    self.assertTrue(last['parse_note'].startswith(f'LLM 대기 — {ccn.NOTE_LLM_FAIL}: RuntimeError (1/3) · '))
    self.assertIn('숫자 0개', last['parse_note'])
    self.assertEqual(last['llm_attempts'], 1)
    self.assertEqual(run.outcomes['failed'], 0)
    with patch('collect_customer_docs.write_status'), patch.object(run, '_directions', return_value=0):
      self.assertEqual(run.finish('ACME', 1), 0)

  def test_directions_recomputed_after_llm_retry_with_code_rows(self):
    """수정 2회차 C — 재시도 대기 중이라도 코드 가이던스를 실었으면 방향을 다시 매긴다(parsed 문서가 없어도)."""
    run, ws = _llm_run(_llm_mod(code_guidance=[_G_CODE]))
    with patch('lib.llm_guidance.extract', side_effect=RuntimeError('x')), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None, 0)
    self.assertEqual((run.outcomes['parsed'], run.outcomes['llm_retry']), (0, 1))
    with patch('collect_customer_docs.write_status'), patch.object(run, '_directions', return_value=0) as d:
      run.finish('ACME', 1)
    d.assert_called_once()

  def test_reparse_resets_attempts(self):
    """수정 2회차 N6 — --reparse 는 사람이 다시 돌린 것이라 DB 의 llm_attempts 를 이어 세지 않는다(새로 3회)."""
    seen = []
    row = {**{k: v for k, v in _DOC.__dict__.items() if k != 'ticker'}, 'llm_attempts': 2,
           'parse_note': 'LLM 대기 — LLM 실패: RuntimeError (2/3)'}
    for reparse, want in ((None, 2), (7, 0)):
      args = SimpleNamespace(dry_run=False, no_llm=False, reparse=reparse)
      with patch.object(ccn._CompanyRun, 'process', side_effect=lambda *a: seen.append(a[-1])), \
           patch.object(ccn._CompanyRun, 'finish', return_value=0), \
           patch('customer_parsers.module_for', return_value=_mod()):
        ccn._run([row], {'c-1': 'ACME'}, MagicMock(), None, MagicMock(), args, None)
      self.assertEqual(seen[-1], want)

  def test_all_llm_rows_unverified_pending_retry(self):
    """🔴 (b) 값 행이 전부 LLM 행인데 전부 대조 실패 → failed 가 아니라 pending + llm_attempts +1(LLM 은 실행마다 다르다)."""
    run, ws = _llm_run(_llm_mod(recognized=False, volume=False))
    bad = base.GuidanceRow('revenue', 'Revenue', 'FY2026', 9.0, 9.5, None, 'billion', None, 'not in source text at all')
    with patch('lib.llm_guidance.extract', return_value=_ok([bad])), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None, 1)
    last = _status_patches(ws)[-1]
    self.assertEqual(last['parse_status'], 'pending')
    self.assertEqual(last['parse_note'], f'LLM 대기 — {ccn.NOTE_LLM_UNVERIFIED} (2/3)')
    self.assertEqual(last['llm_attempts'], 2)
    self.assertEqual(_upserted_guidance(ws), [])   # 대조 실패 LLM 행은 싣지 않는다
    self.assertEqual(run.outcomes['failed'], 0)

  def test_llm_attempts_cap_closes(self):
    """🔴 (c) 3회째 — 코드 값 행이 있으면 parsed + 「LLM 3회 실패」(exit 사유 아님) · 없으면 failed(exit 1)."""
    run, ws = _llm_run(_llm_mod(code_guidance=[_G_CODE]))
    with patch('lib.llm_guidance.extract', side_effect=RuntimeError('x')), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None, 2)
    last = _status_patches(ws)[-1]
    self.assertEqual(last['parse_status'], 'parsed')
    self.assertTrue(last['parse_note'].startswith(ccn.NOTE_LLM_GAVE_UP))
    self.assertEqual(last['llm_attempts'], 3)
    self.assertEqual([g['extractor'] for g in _upserted_guidance(ws)], ['code'])
    with patch('collect_customer_docs.write_status'), patch.object(run, '_directions', return_value=0):
      self.assertEqual(run.finish('ACME', 1), 0)
    # 코드 행 없는 문서(LLM 만 읽는 IR 등) — 예외든 전부 대조 실패든 failed
    bad = base.GuidanceRow('revenue', 'Revenue', 'FY2026', 9.0, 9.5, None, 'billion', None, 'not in source text at all')
    for effect in ({'side_effect': RuntimeError('x')}, {'return_value': _ok([bad])}):
      run, ws = _llm_run(_llm_mod(recognized=False, volume=False))
      with patch('lib.llm_guidance.extract', **effect), patch.object(ccn, 'existing_pubs', return_value={}):
        run.process(_DOC, None, None, 2)
      last = _status_patches(ws)[-1]
      self.assertEqual(last['parse_status'], 'failed')
      self.assertTrue(last['parse_note'].startswith(ccn.NOTE_LLM_GAVE_UP))
      with patch('collect_customer_docs.write_status'), patch.object(run, '_directions', return_value=0):
        self.assertEqual(run.finish('ACME', 1), 1)

  def test_llm_success_resets_attempts(self):
    """재시도 끝에 LLM 이 제대로 돌면 llm_attempts 를 0 으로."""
    run, ws = _llm_run(_llm_mod(code_guidance=[_G_CODE]))
    with patch('lib.llm_guidance.extract', return_value=_ok([_G_LLM_REV])), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, 'LLM 대기 — LLM 실패: RuntimeError (2/3)', 2)
    last = _status_patches(ws)[-1]
    self.assertEqual((last['parse_status'], last['llm_attempts']), ('parsed', 0))

  def test_llm_hint_exception(self):
    """LLM_HINT 함수 예외 — 일반 예외는 그 문서만 LLM 재시도 대기(다음 문서 계속) · 프로그래밍 오류는 파서 예외(failed)."""
    for err, want_status, want_note in ((RuntimeError('x'), 'pending', 'LLM 실패: RuntimeError'),
                                        (KeyError('x'), 'failed', '파서 예외: KeyError')):
      mod = _llm_mod(recognized=False, volume=False)
      mod.LLM_HINT = MagicMock(side_effect=[err, ''])
      run, ws = _llm_run(mod)
      with patch('lib.llm_guidance.extract', return_value=_ok([_G_LLM_REV])) as ex, \
           patch.object(ccn, 'existing_pubs', return_value={}):
        run.process(_DOC, None, None, 0)
        run.process(_doc(id=8), None, None, 0)
      first, second = _status_patches(ws)
      self.assertEqual(first['parse_status'], want_status)
      self.assertIn(want_note, first['parse_note'])
      self.assertEqual(second['parse_status'], 'parsed')
      self.assertEqual(ex.call_count, 1)
      self.assertEqual(run.llm_calls, 1)   # hint 에서 죽은 문서는 호출로 세지 않는다

  def test_extract_programming_error_is_parser_error(self):
    """extract 안의 KeyError·TypeError 는 「LLM 실패」로 뭉개지 않고 파서 예외(failed)."""
    run, ws = _llm_run(_llm_mod(code_guidance=[_G_CODE]))
    with patch('lib.llm_guidance.extract', side_effect=TypeError('x')):
      run.process(_DOC, None, None, 0)
    self.assertEqual(_status_patches(ws)[-1], {'parse_status': 'failed', 'parse_note': '파서 예외: TypeError'})

  def test_label_db_error_not_llm_failure(self):
    """회사 이름 조회(DB) 오류는 LLM 실패로 바뀌지 않고 그대로 올라간다."""
    run, ws = _llm_run(_llm_mod())
    run.client.table.side_effect = ConnectionError('db down')
    with patch('lib.llm_guidance.extract', return_value=_ok([])) as ex, self.assertRaises(ConnectionError):
      run.process(_DOC, None, None, 0)
    ex.assert_not_called()

  def test_screened_counts_in_note(self):
    """extract 가 거른 사유별 건수가 문서 note 에 남는다(「LLM 이 못 찾음」과 「검사가 다 버림」을 가른다)."""
    run, ws = _llm_run(_llm_mod(code_guidance=[_G_CODE]))
    with patch('lib.llm_guidance.extract', return_value=_ok([], {'규모': 2, '분기·반기': 1})), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None, 0)
    self.assertIn('LLM 거름 규모 2 · 분기·반기 1', _status_patches(ws)[-1]['parse_note'])
    self.assertEqual(run.llm_screened['규모'], 2)

  def test_code_row_wins_same_key(self):
    """🔴 코드 우선 — 같은 (metric, period) 의 LLM 행은 버린다 · 다른 칸의 LLM 행은 extractor='llm'."""
    mod = _llm_mod(code_guidance=[_G_CODE])
    run, ws = _llm_run(mod)
    llm_same = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 5500.0, 5500.0, None, 'units', None, 'zzz')
    with patch('lib.llm_guidance.extract', return_value=_ok([llm_same, _G_LLM_REV])), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None)
    rows = {(g['metric'], g['extractor']): g for g in _upserted_guidance(ws)}
    self.assertEqual(set(rows), {('deliveries', 'code'), ('revenue', 'llm')})
    self.assertEqual(rows[('deliveries', 'code')]['low'], 5000.0)
    self.assertTrue(rows[('revenue', 'llm')]['verified'])
    self.assertIsNone(rows[('deliveries', 'code')]['currency'])   # 코드 행 통화 = None(보고 통화)

  def test_code_miss_note(self):
    """코드 표식은 있는데 코드 가이던스 0행 → LLM 이 채워도 note 「코드 문구 미스 — LLM 행만」(일부면 「빠진 항목 메움」)."""
    for code, want in (([], ccn.NOTE_CODE_MISS_ONLY), ([_G_CODE], ccn.NOTE_CODE_MISS_FILL)):
      run, ws = _llm_run(_llm_mod(code_guidance=code, code_miss=True))
      with patch('lib.llm_guidance.extract', return_value=_ok([_G_LLM_REV])), \
           patch.object(ccn, 'existing_pubs', return_value={}):
        run.process(_DOC, None, None)
      last = _doc_patches(ws)[-1]
      self.assertEqual(last['parse_status'], 'parsed')
      self.assertIn(want, last['parse_note'])
      self.assertEqual(run.outcomes['code_miss'], 1)
    # 원래 서술형 문서(code_miss 거짓)는 표식 없음
    run, ws = _llm_run(_llm_mod())
    with patch('lib.llm_guidance.extract', return_value=_ok([_G_LLM_REV])), \
         patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None, None)
    self.assertIsNone(_doc_patches(ws)[-1]['parse_note'])

  def test_llm_only_doc_not_fetched_without_llm(self):
    """LLM 만 읽는 문서(llm_only)는 LLM 이 안 도는 실행에서 내려받지 않고 LLM 대기로 둔다."""
    fetched = []
    mod = _llm_mod(recognized=False, volume=False)
    mod.fetch = lambda s, d: fetched.append(d) or base.Content(_G_TEXT)
    mod.llm_only = lambda d: True
    run, ws = _run(mod)   # no_llm=True
    run.process(_DOC, None, None)
    self.assertEqual(fetched, [])
    self.assertEqual(_doc_patches(ws), [{'parse_status': 'pending', 'parse_note': ccn.NOTE_LLM_WAIT}])


class PayloadTests(unittest.TestCase):
  def test_verified_flags_extractor_and_dates(self):
    g_code = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 1000.0, 2000.0, None, 'units', None, 'x')
    g_llm = base.GuidanceRow('revenue', 'Revenue', 'FY2026', 1.0, 2.0, None, 'billion', None, 'y')
    bad_date = _date('2026-10-29')
    res = base.ParseResult(volume=[_vol()], guidance=[g_code, g_llm], dates=[_date(), bad_date], recognized=True)
    checks = ccn.verify(res, _TEXT)
    out = ccn.payloads(_DOC, res, checks, {id(g_llm)})
    v = out['customer_volume_ir'][0]
    self.assertTrue(v['verified'])
    self.assertEqual((v['document_id'], v['source'], v['source_ref'], v['published_at']),
                     (7, 'ir', 'ir.example.com/q3.pdf', '2026-10-02'))
    self.assertEqual([g['extractor'] for g in out['customer_guidance']], ['code', 'llm'])
    self.assertEqual([g['verified'] for g in out['customer_guidance']], [False, False])   # quote 가 원문에 없다
    self.assertEqual([d['event_date'] for d in out['customer_earnings_dates']], ['2026-10-28'])  # 통과한 일정만


class NewerOnlyTests(unittest.TestCase):
  def _row(self, metric, pub='2026-10-02', verified=True):
    return {'metric': metric, 'published_at': pub, 'verified': verified}

  def test_later_existing_wins(self):
    rows = [self._row('deliveries'), self._row('production')]
    existing = {('deliveries',): ('2026-11-01', True), ('production',): ('2026-10-02', True)}
    self.assertEqual([r['metric'] for r in ccn.newer_only(rows, existing, ('metric',))], ['production'])

  def test_unverified_never_covers_verified(self):
    """나중 문서의 대조 실패 행이 앞 문서의 검증 행을 덮지 않는다(덮으면 화면이 빈칸)."""
    rows = [self._row('deliveries', '2026-11-03', False), self._row('production', '2026-11-03', False),
            self._row('sales', '2026-11-03', True)]
    existing = {('deliveries',): ('2026-10-02', True), ('production',): ('2026-10-02', False),
                ('sales',): ('2026-10-02', True)}
    self.assertEqual([r['metric'] for r in ccn.newer_only(rows, existing, ('metric',))], ['production', 'sales'])

  def test_verified_replaces_unverified_regardless_of_date(self):
    """백필·--add-file 로 앞 문서가 나중에 들어와도, 기존이 미검증이면 검증 행이 싣힌다(화면 빈칸 해소)."""
    rows = [self._row('deliveries', '2026-08-01', True), self._row('production', '2026-08-01', False)]
    existing = {('deliveries',): ('2026-11-03', False), ('production',): ('2026-11-03', False)}
    self.assertEqual([r['metric'] for r in ccn.newer_only(rows, existing, ('metric',))], ['deliveries'])

  def test_earnings_dates_later_published_wins(self):
    """최종 검토 P11 — 실적 일정 표도 «나중 공시 우선»(백필·--reparse 로 앞 문서가 늦게 돌아도 새 일정을 덮지 않는다).
    일정 표엔 verified 칸이 없다(통과한 일정만 싣는다) — 조회도 verified 를 묻지 않는다."""
    self.assertEqual(ccn.TABLES['customer_earnings_dates'][1], ('period',))
    old = {'company_id': 'c-1', 'period': '2026-Q3', 'event_date': '2026-10-28', 'published_at': '2026-07-01'}
    new = {**old, 'event_date': '2026-10-30', 'published_at': '2026-10-02'}
    client = MagicMock()
    q = client.table.return_value.select.return_value.eq.return_value
    q.order.return_value.range.return_value.execute.return_value.data = [{'period': '2026-Q3',
                                                                          'published_at': '2026-10-02'}]
    existing = ccn.existing_pubs(client, 'customer_earnings_dates', 'c-1', ('period',))
    self.assertEqual(client.table.return_value.select.call_args.args[0], 'period,published_at')
    self.assertEqual(ccn.newer_only([old], existing, ('period',)), [])
    self.assertEqual(ccn.newer_only([new], existing, ('period',)), [new])   # 같은 날이면 덮는다

  def test_earnings_dates_store_skips_older(self):
    """_store 경로 — 앞 문서의 일정 행은 기존 나중 공시 행이 있으면 싣지 않는다."""
    run, ws = _run(_mod())
    tables = {'customer_earnings_dates': [{'company_id': 'c-1', 'period': '2026-Q3', 'event_date': '2026-10-28',
                                           'quote': 'q', 'source': 'ir', 'source_ref': 'x', 'url': 'u',
                                           'published_at': '2026-07-01'}]}
    with patch.object(ccn, 'existing_pubs', return_value={('2026-Q3',): ('2026-10-02', True)}):
      run._store(_DOC, tables, llm_ran=False)
    ws.table.return_value.upsert.assert_not_called()


class FetchFailureTests(unittest.TestCase):
  def test_note_has_class_and_status_only(self):
    self.assertEqual(ccn.fetch_failure_note(_http_error(404), _DOC), '내용 받기 실패: HTTPError HTTP 404')

  def test_expiring_url_marked_and_retried(self):
    doc = _doc(url=_MOBIS_LIKE)
    self.assertIn('만료 가능 URL', ccn.fetch_failure_note(_http_error(404), doc))
    self.assertEqual(ccn.fetch_failure_kind(_http_error(404), doc), 'retry')   # 목록 수집기가 새 URL 을 넣으면 받힌다

  def test_kinds(self):
    k = ccn.fetch_failure_kind
    self.assertEqual(k(_http_error(403), _DOC), 'blocked')
    self.assertEqual(k(_http_error(401), _DOC), 'blocked')
    self.assertEqual(k(_http_error(503), _DOC), 'retry')
    self.assertEqual(k(_http_error(408), _DOC), 'retry')
    self.assertEqual(k(_http_error(425), _DOC), 'retry')
    self.assertEqual(k(_http_error(429), _DOC), 'retry')
    self.assertEqual(k(_http_error(400), _DOC), 'failed')
    self.assertEqual(k(requests.ConnectionError('x'), _DOC), 'retry')
    self.assertEqual(k(requests.Timeout('x'), _DOC), 'retry')
    self.assertEqual(k(_http_error(404), _DOC), 'failed')
    self.assertEqual(k(_http_error(410), _DOC), 'failed')
    self.assertEqual(k(ValueError('not a pdf'), _DOC), 'failed')

  def test_dart_unavailable_is_retry(self):
    """최종 검토 P10 — DART 키 없음·비-zip status 응답은 일시 오류(pending) · note 에 status 를 남긴다."""
    from lib import dart_api
    e = dart_api.DartUnavailable('dart document 20261030000002: zip 아님 status=020')
    self.assertEqual(ccn.fetch_failure_kind(e, _DOC), 'retry')
    self.assertEqual(ccn.fetch_failure_note(e, _DOC),
                     '내용 받기 실패: DartUnavailable (dart document 20261030000002: zip 아님 status=020)')
    self.assertEqual(ccn.fetch_failure_kind(dart_api.DartUnavailable('DART_API_KEY 없음'), _DOC), 'retry')

  def _one(self, code):
    def fetch(session, doc):
      raise _http_error(code)
    run, ws = _run(_mod(fetch=fetch))
    with patch('collect_customer_docs.write_status') as st:
      fails = run.process(_DOC, None) or run.finish('ACME', 1)
    return _doc_patches(ws)[0], st.call_args.args[3], st.call_args.args[4], fails

  def test_403_pending_and_blocked(self):
    patch_, status, reason, fails = self._one(403)
    self.assertEqual(patch_, {'parse_status': 'pending', 'parse_note': '내용 받기 실패: HTTPError HTTP 403'})
    self.assertEqual(status, 'blocked')
    self.assertIn('접근 차단(HTTP 401·403)', reason)
    self.assertEqual(fails, 0)

  def test_404_failed(self):
    patch_, status, _, fails = self._one(404)
    self.assertEqual(patch_['parse_status'], 'failed')
    self.assertEqual(status, 'error')
    self.assertEqual(fails, 1)

  def test_5xx_pending_and_error(self):
    patch_, status, _, fails = self._one(502)
    self.assertEqual(patch_['parse_status'], 'pending')
    self.assertEqual(status, 'error')
    self.assertEqual(fails, 1)

  def test_failure_marks_only_that_doc_and_continues(self):
    """받기 실패 문서는 그것만 처리되고 다음 문서는 그대로 파싱된다."""
    calls = []

    def fetch(session, doc):
      calls.append(doc.id)
      if doc.id == 1:
        raise _http_error(404)
      return base.Content(_TEXT)

    run, ws = _run(_mod(fetch=fetch))
    with patch.object(ccn, 'existing_pubs', return_value={}), patch('collect_customer_docs.write_status'):
      run.process(_doc(id=1), None)
      run.process(_DOC, None)
      run.finish('ACME', 2)
    self.assertEqual(calls, [1, 7])
    self.assertEqual(run.outcomes, {'fetch_failed': 1, 'parsed': 1})
    self.assertEqual([p['parse_status'] for p in _doc_patches(ws)], ['failed', 'parsed'])


class ParserErrorTests(unittest.TestCase):
  def test_parse_exception_fails_that_doc_only(self):
    def parse(d, c):
      if d.id == 1:
        raise ZeroDivisionError
      return base.ParseResult(volume=[_vol()], recognized=True)
    run, ws = _run(_mod(parse=parse))
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_doc(id=1), None)
      run.process(_DOC, None)
    self.assertEqual(run.outcomes, {'failed': 1, 'parsed': 1})
    self.assertEqual(_doc_patches(ws)[0], {'parse_status': 'failed', 'parse_note': '파서 예외: ZeroDivisionError'})

  def test_module_fetch_programming_error_is_parser_error(self):
    def fetch(session, doc):
      raise AttributeError('x')
    run, ws = _run(_mod(fetch=fetch))
    run.process(_DOC, None)
    self.assertEqual(run.outcomes, {'failed': 1})
    self.assertEqual(_doc_patches(ws)[0]['parse_note'], '파서 예외: AttributeError')


class VocabDropInRunTests(unittest.TestCase):
  def test_bad_period_row_dropped_good_row_kept(self):
    res = base.ParseResult(volume=[_vol(), _vol(period='2026Q3')], recognized=True)
    run, ws = _run(_mod(parse=lambda d, c: res))
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None)
    self.assertEqual(run.rows['customer_volume_ir'], 1)
    patch_ = _doc_patches(ws)[0]
    self.assertEqual(patch_['parse_status'], 'parsed')
    self.assertIn('형식 밖 1행', patch_['parse_note'])

  def test_drop_runs_before_dedupe(self):
    """같은 키의 (형식 밖 행, 맞는 행) — dedupe 가 먼저면 앞의 형식 밖 행이 남았다가 버려져 둘 다 잃는다."""
    q = 'Acme Motors delivered | 1,234 | vehicles'
    bad = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 1234.0, None, None, 'cars', None, q)
    good = base.GuidanceRow('deliveries', 'Deliveries', 'FY2026', 1234.0, None, None, 'units', None, q)
    res = base.ParseResult(guidance=[bad, good], recognized=True)
    run, _ = _run(_mod(parse=lambda d, c: res), dry_run=True)
    with patch.object(ccn, 'fetch_all', return_value=[]):
      run.process(_DOC, None)
    self.assertEqual(run.rows['customer_guidance'], 1)
    self.assertEqual(run.outcomes, {'parsed': 1})


class StoreTests(unittest.TestCase):
  def test_parsed_doc_guidance_rows_deleted_first(self):
    """다시 파싱한 문서에서 사라진 가이던스 칸이 옛 행으로 남지 않게 — document_id 조건으로 지운 뒤 싣는다."""
    run, ws = _run(_mod())
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None)
    ws.table.return_value.delete.return_value.eq.assert_called_once_with('document_id', 7)
    names = [c.args[0] for c in ws.table.call_args_list]
    self.assertLess(names.index('customer_guidance'), names.index('customer_volume_ir'))

  def test_llm_rows_kept_when_llm_did_not_run(self):
    """--no-llm·모듈 없음 — LLM 행은 다시 만들 수 없으니 코드 행만 지운다."""
    run, ws = _run(_mod())
    with patch.object(ccn, 'existing_pubs', return_value={}):
      run.process(_DOC, None)
    ws.table.return_value.delete.return_value.eq.return_value.eq.assert_called_once_with('extractor', 'code')

  def test_all_rows_deleted_when_llm_ran(self):
    run, ws = _run(_mod())
    with patch.object(ccn, 'existing_pubs', return_value={}), patch.object(run, '_llm', return_value=set()):
      run.process(_DOC, None)
    ws.table.return_value.delete.return_value.eq.return_value.eq.assert_not_called()
    ws.table.return_value.delete.return_value.eq.return_value.execute.assert_called_once()

  def test_directions_recomputed_when_parsed_even_without_guidance(self):
    """실은 가이던스 0행이어도 선삭제가 옛 행을 지웠을 수 있다 → parsed 문서가 있으면 다시 매긴다."""
    run, _ = _run(_mod())
    with patch.object(ccn, 'existing_pubs', return_value={}), patch('collect_customer_docs.write_status'), \
         patch.object(run, '_directions', return_value=0) as d:
      run.process(_DOC, None)
      run.finish('ACME', 1)
    self.assertEqual(run.rows['customer_guidance'], 0)
    d.assert_called_once()

  def test_directions_skipped_without_parsed(self):
    mod = _mod()
    mod.wants = lambda d: False
    run, _ = _run(mod)
    with patch('collect_customer_docs.write_status'), patch.object(run, '_directions', return_value=0) as d:
      run.process(_DOC, None, ccn.NOTE_NO_PARSER)
      run.finish('ACME', 1)
    d.assert_not_called()


class FinishStatusTests(unittest.TestCase):
  """finish 의 상태 행·경고 — P3 닫힌 실패 · P4 서식 미인식 · P6 차단 경고 · P8 LLM 키 없음."""

  def _finish(self, run, gha=False):
    env = {'GITHUB_ACTIONS': 'true'} if gha else {}
    with patch('collect_customer_docs.write_status') as st, patch.dict(os.environ, env), \
         patch('sys.stdout', new_callable=io.StringIO) as out:
      if not gha:
        os.environ.pop('GITHUB_ACTIONS', None)
      fails = run.finish('ACME', 1)
    return st.call_args.args[3], st.call_args.args[4] or '', fails, out.getvalue()

  def test_closed_failures_make_parse_failed(self):
    """P3 — 이번 실행엔 실패가 없어도 DB 에 닫힌 failed 문서가 있으면 parse_failed(다음 날 ok 로 덮이지 않게) ·
    exit 사유엔 안 넣는다(새로 생긴 실패만 exit 1)."""
    run, _ = _run(_mod())
    docs = run.client.table.return_value.select.return_value.eq.return_value.eq.return_value
    docs.execute.return_value.data = [{'id': 1}, {'id': 2}]
    status, reason, fails, _ = self._finish(run)
    self.assertEqual(status, 'parse_failed')
    self.assertIn('닫힌 실패 문서 2건 — --reparse 필요', reason)
    self.assertEqual(fails, 0)
    run.client.table.assert_any_call('customer_documents')
    run.client.table.return_value.select.return_value.eq.return_value.eq.assert_any_call('parse_status', 'failed')

  def test_no_closed_failures_ok(self):
    run, _ = _run(_mod())
    run.client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    status, reason, fails, _ = self._finish(run)
    self.assertEqual((status, reason, fails), ('ok', '', 0))

  def test_unrecognized_note_reason_warning(self):
    """P4 — 숫자가 반드시 있어야 하는 문서(EDGAR 8-K Item 2.02 · 파서 expects_numbers)가 not_target 이면 note 「서식 미인식」 ·
    상태 사유 · GHA 경고(exit 0). Item 2.02 가 없는 8-K 는 그대로 조용한 not_target."""
    mod = _mod(parse=lambda d, c: base.ParseResult())
    run, ws = _run(mod)
    run.process(_doc(source='edgar', doc_type='earnings_release', form='8-K', items='2.02,9.01'), None, None)
    last = _doc_patches(ws)[-1]
    self.assertEqual((last['parse_status'], last['parse_note']), ('not_target', ccn.NOTE_UNRECOGNIZED))
    status, reason, fails, out = self._finish(run, gha=True)
    self.assertEqual((status, fails), ('ok', 0))
    self.assertIn('서식 미인식 1건', reason)
    self.assertIn('::warning::ACME', out)
    # Item 2.02 없음 → note 없음
    run2, ws2 = _run(mod)
    run2.process(_doc(source='edgar', doc_type='current_report', form='8-K', items='5.02,9.01'), None, None)
    last2 = _doc_patches(ws2)[-1]
    self.assertEqual((last2['parse_status'], last2['parse_note']), ('not_target', None))
    # 파서가 판정을 정하면(kr_dart 잠정실적 등) 그것을 쓴다
    mod3 = _mod(parse=lambda d, c: base.ParseResult())
    mod3.expects_numbers = lambda d: True
    run3, ws3 = _run(mod3)
    run3.process(_DOC, None, None)
    self.assertEqual(_doc_patches(ws3)[-1]['parse_note'], ccn.NOTE_UNRECOGNIZED)

  def test_blocked_warning_in_gha(self):
    """P6 — 숫자 수집기의 내용 접근 차단도 목록 수집기처럼 GHA 경고(exit 0)."""
    def fetch(session, doc):
      raise _http_error(403)
    run, _ = _run(_mod(fetch=fetch))
    run.process(_DOC, None)
    status, _, fails, out = self._finish(run, gha=True)
    self.assertEqual((status, fails), ('blocked', 0))
    self.assertIn('::warning::ACME', out)
    self.assertIn('접근 차단', out)

  def test_llm_no_key_reason(self):
    """P8 — 키가 없어 LLM 칸을 못 돌린 문서 수를 상태 사유에(pending 으로 남아 다음 실행이 다시 집는다)."""
    mod = _mod(parse=lambda d, c: base.ParseResult())
    mod.llm_wants = lambda d, r: True
    ws = MagicMock()
    run = ccn._CompanyRun(mod, MagicMock(), None, ws, SimpleNamespace(dry_run=False, no_llm=False), 'c-1', None)
    run.process(_DOC, None, None)
    _, reason, fails, _ = self._finish(run)
    self.assertIn('LLM 키 없음 1건', reason)
    self.assertEqual(fails, 0)


class DirectionTests(unittest.TestCase):
  def test_only_changed_rows_updated(self):
    base_row = {'metric': 'deliveries', 'period': 'FY2026', 'value_text': None, 'stated': None}
    rows = [{**base_row, 'id': 1, 'published_at': '2026-02-01', 'document_id': 1, 'low': 100, 'high': 200,
             'direction': 'initiated'},
            {**base_row, 'id': 2, 'published_at': '2026-05-01', 'document_id': 2, 'low': 150, 'high': 200,
             'direction': None}]
    run, ws = _run(_mod())
    with patch.object(ccn, 'fetch_all', return_value=rows):
      self.assertEqual(run._directions(), 1)
    ws.table.return_value.update.assert_called_once_with({'direction': 'raised'})
    ws.table.return_value.update.return_value.eq.assert_called_once_with('id', 2)

  def test_currency_differs_not_compared(self):
    """수정 2회차 N5 — 통화가 다른 행끼리는 숫자를 견주지 않는다 · null 은 회사 보고 통화(BASE_CURRENCY)로 본다."""
    base_row = {'metric': 'revenue', 'period': 'FY2026', 'value_text': None, 'stated': None, 'unit': 'billion',
                'direction': None}
    for cur2, want in (('USD', None), ('EUR', 'raised')):
      rows = [{**base_row, 'id': 1, 'published_at': '2026-02-01', 'document_id': 1, 'low': 35, 'high': 36,
               'currency': None},
              {**base_row, 'id': 2, 'published_at': '2026-05-01', 'document_id': 2, 'low': 38, 'high': 39,
               'currency': cur2}]
      mod = _mod()
      mod.BASE_CURRENCY = 'EUR'
      run, ws = _run(mod)
      with patch.object(ccn, 'fetch_all', return_value=rows):
        run._directions()
      got = {c.args[0]['direction'] for c in ws.table.return_value.update.call_args_list}
      self.assertEqual(got, {'initiated', want} - {None}, cur2)

  def test_dry_run_does_not_write(self):
    rows = [{'id': 1, 'metric': 'm', 'period': 'FY2026', 'published_at': '2026-02-01', 'document_id': 1, 'low': 1,
             'high': 2, 'value_text': None, 'stated': None, 'direction': None}]
    run, ws = _run(_mod(), dry_run=True)
    with patch.object(ccn, 'fetch_all', return_value=rows):
      self.assertEqual(run._directions(), 1)
    ws.table.assert_not_called()


class AddFileTests(unittest.TestCase):
  def _args(self, **kw):
    a = dict(company='ACME', url='https://ir.example.com/fact.pdf', doc_type='fact_sheet', title='T',
             published='2026-02-26', dry_run=False)
    return SimpleNamespace(**{**a, **kw})

  def test_arg_errors(self):
    self.assertIn('--url', ccn._add_file_error(self._args(url=None)))
    self.assertIn('--published', ccn._add_file_error(self._args(published=None)))
    self.assertIn('형식 아님', ccn._add_file_error(self._args(published='2026/02/26')))
    self.assertIsNone(ccn._add_file_error(self._args()))

  def test_main_exit_2_on_missing_args(self):
    self.assertEqual(ccn.main(['--add-file', 'x.pdf']), 2)

  def test_existing_list_row_kept(self):
    """IR 목록이 넣은 행이 있으면 title·published_at 등을 덮지 않고 그 행을 그대로 쓴다."""
    listed = {'id': 42, 'company_id': 'c-1', 'source': 'ir', 'source_id': 'ir.example.com/fact.pdf',
              'doc_type': 'fact_sheet', 'form': 'list-form', 'items': None, 'title': '목록 제목',
              'url': 'https://ir.example.com/fact.pdf?v=1', 'published_at': '2026-02-20'}
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [listed]
    with patch('lib.db.upsert_rows') as up:
      got = ccn.add_file_doc(client, self._args(), {'id': 'c-1'}, b'%PDF-1.4')
    up.assert_not_called()
    self.assertEqual(got, listed)

  def test_no_parser_exit_2_before_creating_row(self):
    with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
      f.write(b'%PDF-1.4 test')
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [{'id': 'c-1',
                                                                                                 'ticker': 'ACME'}]
    argv = ['--add-file', f.name, '--company', 'ACME', '--url', 'https://ir.example.com/fact.pdf', '--doc-type',
            'fact_sheet', '--title', 'T', '--published', '2026-02-26']
    try:
      with patch('lib.db.get_client', return_value=client), patch.object(ccn, 'add_file_doc') as add:
        self.assertEqual(ccn.main(argv), 2)
      add.assert_not_called()
    finally:
      pathlib.Path(f.name).unlink()


class NoParserTests(unittest.TestCase):
  def test_company_without_parser_untouched(self):
    """등록부가 비어(Task 6) 파서 없는 회사 — 문서 상태·상태 표를 건드리지 않고 실패 0."""
    ws = MagicMock()
    docs = [{'id': 1, 'company_id': 'c-1'}, {'id': 2, 'company_id': 'c-1'}]
    args = SimpleNamespace(dry_run=False, no_llm=False)
    with patch('customer_parsers.module_for', return_value=None):
      self.assertEqual(ccn._run(docs, {'c-1': 'ACME'}, MagicMock(), None, ws, args, None), 0)
    ws.table.assert_not_called()


class SelfTests(unittest.TestCase):
  def test_self_tests_pass(self):
    self.assertEqual(ccn.self_tests(), [])


if __name__ == '__main__':
  unittest.main()
