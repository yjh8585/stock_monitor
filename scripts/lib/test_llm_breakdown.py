"""lib/llm_breakdown.py 시험 — 정기(API) 지역·차종·점유율 읽기(C-4). 실호출 0 — 가짜 클라이언트만(사용자 지시 2026-11-12
「이번에는 일단 api 쓰지말고 직접해」). 가짜 회사 이름만 쓴다.

실행:
  PYTHONIOENCODING=utf-8 scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_llm_breakdown.py -q
"""
import json
import pathlib
import sys
import unittest
from types import SimpleNamespace as N

_SCRIPTS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_SCRIPTS))

import fitz  # noqa: E402

from customer_parsers.base import Content  # noqa: E402
from lib import customer_breakdown as cb  # noqa: E402
from lib import llm_breakdown as lb  # noqa: E402
from lib.llm_guidance import Incomplete  # noqa: E402

P1 = 'Acme Motors deliveries by region Q3 2026 North America 357 Europe 588 (thousand units)'
P2 = 'Deliveries mix chart'   # 그림 속 숫자 — 글자층엔 값이 없다


def _pdf(*pages: str) -> bytes:
  doc = fitz.open()
  for t in pages:
    doc.new_page().insert_text((40, 60), t, fontsize=8)
  raw = doc.tobytes()
  doc.close()
  return raw


DOC = {'id': 7, 'company_id': 'c-1', 'doc_type': 'presentation', 'title': 'Acme Q3 2026', 'published_at': '2026-10-28'}


class FakeLLM:
  """messages.create 를 흉내 — 받은 인자를 남기고 정해 둔 응답을 돌려준다."""

  def __init__(self, payload, stop='end_turn', usage=(1200, 300)):
    self.calls = []
    body = json.dumps(payload) if not isinstance(payload, str) else payload

    def create(**kw):
      self.calls.append(kw)
      return N(stop_reason=stop, usage=N(input_tokens=usage[0], output_tokens=usage[1]),
               content=[N(type='thinking', text=''), N(type='text', text=body)])
    self.messages = N(create=create)


def _row(**kw):
  base = {'kind': 'region', 'metric': 'deliveries', 'label_raw': 'North America', 'label_ko': '북미',
          'period_grain': 'quarter', 'period': '2026-Q3', 'value': 357000, 'unit': 'units',
          'quote': 'North America 357 Europe 588', 'page': 1, 'definition': None}
  base.update(kw)
  return base


class MessageTest(unittest.TestCase):
  def test_pdf_pages_and_images(self):
    content = Content(text='', tables=[], raw=_pdf(P1, P2, 'p3', 'p4'))
    mats = [{'kind': 'region', 'page': 1, 'note': 'x'}, {'kind': 'model', 'page': 2, 'note': 'y'},
            {'kind': 'share', 'page': 2, 'note': 'z'}, {'kind': 'share', 'page': None, 'note': 'w'}]
    blocks = lb.build_content(DOC, 'ACME', mats, content)
    imgs = [b for b in blocks if b['type'] == 'image']
    self.assertEqual(len(imgs), 2)   # 쪽 1·2 — 같은 쪽은 한 번 · 쪽 없는 재료는 그림 없음
    self.assertEqual(imgs[0]['source']['media_type'], 'image/png')
    text = '\n'.join(b['text'] for b in blocks if b['type'] == 'text')
    self.assertIn('p.1', text)
    self.assertIn(P1, text)
    self.assertNotIn('p3', text.split('C 재료')[-1].split('p.2')[-1])   # 재료 밖 쪽 글은 안 싣는다

  def test_page_cap(self):
    content = Content(text='', tables=[], raw=_pdf(*[f'page {i}' for i in range(1, 12)]))
    mats = [{'kind': 'region', 'page': i, 'note': ''} for i in range(1, 12)]
    blocks = lb.build_content(DOC, 'ACME', mats, content)
    self.assertEqual(sum(1 for b in blocks if b['type'] == 'image'), lb.MAX_PAGES)

  def test_non_pdf_text_only(self):
    content = Content(text='North America sales of $1,815 million represented 89 percent', tables=[], raw=b'')
    blocks = lb.build_content(DOC, 'ACME', [{'kind': 'region', 'page': None, 'note': ''}], content)
    self.assertFalse([b for b in blocks if b['type'] == 'image'])
    self.assertIn('$1,815 million', blocks[-1]['text'])


class ReadTest(unittest.TestCase):
  def setUp(self):
    self.content = Content(text='', tables=[], raw=_pdf(P1, P2))
    self.mats = [{'kind': 'region', 'page': 1, 'note': ''}, {'kind': 'model', 'page': 2, 'note': ''}]

  def test_rows_and_verify(self):
    llm = FakeLLM({'rows': [_row(), _row(kind='model', label_raw='VF 3', label_ko='VF 3', value=47, unit='pct',
                                         quote='Deliveries mix chart', page=2)]})
    rows, tok = lb.read_document(llm, DOC, 'ACME', self.mats, self.content)
    self.assertEqual(tok, (1200, 300))
    self.assertTrue(all(r.extractor == 'llm' for r in rows))
    src = cb.SourcePages(self.content)
    self.assertEqual(cb.verify(rows[0], src), (True, 'ok'))
    ok, note = cb.verify(rows[1], src)   # 그림 속 숫자 — 정기 경로는 두 번째 읽기가 없다
    self.assertFalse(ok)
    self.assertTrue(note.startswith('image_only'))
    kw = llm.calls[0]
    self.assertEqual(kw['output_config']['format']['schema'], lb.SCHEMA)
    self.assertIn('수준', kw['system'])

  def test_bad_rows_dropped(self):
    """스키마 밖 행(필드 빠짐)은 버리고 센다 — 한 행 때문에 문서 전체를 잃지 않게."""
    bad = _row()
    del bad['label_ko']
    rows, _ = lb.read_document(FakeLLM({'rows': [_row(), bad]}), DOC, 'ACME', self.mats, self.content)
    self.assertEqual(len(rows), 1)

  def test_incomplete_raises(self):
    with self.assertRaises(Incomplete):
      lb.read_document(FakeLLM({'rows': []}, stop='max_tokens'), DOC, 'ACME', self.mats, self.content)

  def test_usd(self):
    self.assertAlmostEqual(lb.usd(1_000_000, 100_000), 4.0 + 2.0)


if __name__ == '__main__':
  unittest.main()
