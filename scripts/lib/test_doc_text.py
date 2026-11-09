"""lib.doc_text 회귀 테스트 — 스텔란티스 수집기에서 옮긴 표 함수가 옮기기 전과 같은 결과를 내는지.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_doc_text.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

from lib import doc_text  # noqa: E402

# 셀이 쪼개진 괄호 음수(`(13,441,754` · `)`) · &nbsp; 만 있는 셀 · 빈 셀 · 빈 표 · 표 밖 글.
HTML = (
  '<table>'
  '<tr><td>Net revenues</td><td>&nbsp;</td><td>(13,441,754</td><td>)</td></tr>'
  '<tr><td></td><td>&nbsp;</td></tr>'
  '<tr><th>Shipments&nbsp;(000s)</th><td> 1,472 </td></tr>'
  '</table>'
  '<table><tr><td>&nbsp;</td></tr></table>'
  '<p>no table</p>'
  '<table><tr><td>A <b>B</b></td></tr></table>'
)
# 옮기기 전 collect_stellantis_shipments.html_to_table_rows 가 같은 입력에 낸 값(2026-11-09 실측).
EXPECTED_ROWS = [[['Net revenues', '(13,441,754', ')'], ['Shipments (000s)', '1,472']], [['A  B']]]


class TableRowsTest(unittest.TestCase):
  def test_same_as_before_move(self):
    self.assertEqual(doc_text.html_to_table_rows(HTML), EXPECTED_ROWS)

  def test_normalize_cell(self):
    self.assertEqual(doc_text.normalize_cell(None), '')
    self.assertEqual(doc_text.normalize_cell('\xa0 x\xa0'), 'x')

  def test_stellantis_reexports_same_function(self):
    """원 파일은 같은 함수 객체를 다시 내보낸다 — 기존 호출부·시험이 그대로 돈다."""
    spec = importlib.util.spec_from_file_location(
      'collect_stellantis_shipments', SCRIPTS_DIR / 'collect_stellantis_shipments.py')
    col = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(col)
    self.assertIs(col.html_to_table_rows, doc_text.html_to_table_rows)
    self.assertIs(col.normalize_cell, doc_text.normalize_cell)


class TextTest(unittest.TestCase):
  def test_norm_text_dashes_quotes_spaces(self):
    self.assertEqual(doc_text.norm_text('2026–2027 “guidance”\xa0 − 5\n x'),
                     '2026-2027 "guidance" - 5 x')

  def test_html_to_text_drops_script_style(self):
    html = '<html><style>p{}</style><script>var x=1</script><p>Revenue&nbsp;up</p><p>’s</p></html>'
    self.assertEqual(doc_text.html_to_text(html), "Revenue up 's")

  def test_xml_to_text(self):
    xml = '<DOCUMENT><P>매출액&amp;영업이익</P>\n<TD>1,234</TD></DOCUMENT>'
    self.assertEqual(doc_text.xml_to_text(xml), '매출액&영업이익 1,234')

  def test_row_text(self):
    self.assertEqual(doc_text.row_text(['Net revenues', '(13,441,754', '–']), 'Net revenues | (13,441,754 | -')


class PdfTextTest(unittest.TestCase):
  def test_pages_joined(self):
    import fitz

    doc = fitz.open()
    for word in ('first page', 'second page'):
      doc.new_page().insert_text((72, 72), word)
    data = doc.tobytes()
    doc.close()
    text = doc_text.pdf_text(data)
    self.assertIn('first page', text)
    self.assertIn('second page', text)
    self.assertLess(text.index('first page'), text.index('second page'))

  def test_broken_pdf_raises(self):
    """깨진 PDF 를 빈 문자열로 삼키지 않는다 — 「숫자 0개」와 구분돼야 한다."""
    with self.assertRaises(Exception):
      doc_text.pdf_text(b'not a pdf')


if __name__ == '__main__':
  unittest.main()
