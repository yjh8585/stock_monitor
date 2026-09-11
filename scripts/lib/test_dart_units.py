"""DART 재무제표 파싱의 «단위»·«주석 번호» 회귀 검증 (2026-09-11 실사고 3건).

세 함정 모두 **값이 그럴듯해서** 눈으로도 급변 검사로도 안 잡혔다. 그래서 여기에 못 박는다.

1) 단위 오인 — 진영산업 FY2023
   연결손익계산서의 선언은 `(단위:원)` 인데 본문 어딘가에
   「중단사업이익(법인세효과:당기 1,339,797천원 …)」 이 있어 '천원' 이 잡혔다.
   divider 가 1,000 이 되어 매출이 **1,000배**(1,488억 → 148.8조)로 적재됐다.

2) 주석 번호 유입 — 현대트랜시스 FY2022
   영업이익 행이 `['영업이익', '34', '151,726', '95,016']` 이라 **주석 번호 34** 가
   당기 영업이익이 됐다(실제 1,517억). 기존 «최댓값의 1/10,000» 문턱은 4,462배를
   못 넘어 그대로 통과시킨다.

3) 정정 공시 stub — 화승코퍼레이션 FY2021 (`test_dart_docsel.py` 와 짝)
   여기서는 `_read_year` 의 «연결을 못 찾으면 다음 후보» 규칙만 검증한다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_dart_units.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_dart_audit', SCRIPTS_DIR / 'collect_dart_audit.py'
)
aud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aud)


def _table(html: str):
    return BeautifulSoup(html, 'html.parser').find('table')


class TestUnitDivider(unittest.TestCase):
    """단위는 «선언» 으로 정한다 — 본문에 스쳐 든 키워드로 정하지 않는다."""

    def test_declaration_in_sibling_beats_keyword_in_body(self):
        # 진영산업 FY2023 실물 구조: 표 위에 `(단위:원)`, 표 안에 '천원' 이 스쳐 있다.
        soup = BeautifulSoup(
            '<p>(단위:원)</p>'
            '<table><tr><td>매출액</td><td>148,866,274,722</td></tr>'
            '<tr><td>중단사업이익(법인세효과:당기 1,339,797천원)</td><td>1</td></tr></table>',
            'html.parser',
        )
        self.assertEqual(aud._table_unit_divider(soup.find('table')), aud.MILLION)

    def test_sibling_declaration_beats_declaration_at_table_bottom(self):
        """현대위아 FY2021: 표 맨 끝 주당이익 줄의 `(단위:원)` 을 표 단위로 읽으면 100만분의 1."""
        soup = BeautifulSoup(
            '<p>(단위:백만원)</p>'
            '<table>'
            '<tr><td>과목</td><td>제46(당)기</td></tr>'
            '<tr><td>매출액</td><td>7,527,739</td></tr>'
            '<tr><td>주당이익(단위:원)</td><td>5,000</td></tr>'
            '</table>',
            'html.parser',
        )
        self.assertEqual(aud._table_unit_divider(soup.find('table')), 1)

    def test_declaration_in_table_head_wins(self):
        """표가 «자기 머리» 에 밝혔으면 그것이 먼저다."""
        soup = BeautifulSoup(
            '<p>(단위:원)</p>'
            '<table><tr><td>(단위:백만원)</td><td>제1기</td></tr>'
            '<tr><td>매출액</td><td>7,527,739</td></tr></table>',
            'html.parser',
        )
        self.assertEqual(aud._table_unit_divider(soup.find('table')), 1)

    def test_declaration_million_won(self):
        soup = BeautifulSoup(
            '<p>(단위:백만원)</p><table><tr><td>매출액</td><td>10,256,254</td></tr></table>',
            'html.parser',
        )
        self.assertEqual(aud._table_unit_divider(soup.find('table')), 1)

    def test_declaration_thousand_won(self):
        soup = BeautifulSoup(
            '<p>(단위 : 천원)</p><table><tr><td>매출액</td><td>1,000</td></tr></table>',
            'html.parser',
        )
        self.assertEqual(aud._table_unit_divider(soup.find('table')), 1000)

    def test_million_is_matched_before_bare_won(self):
        """'백만원' 안에 '원' 이 들어 있다 — 정규식 교대 순서가 뒤집히면 조용히 100만배."""
        self.assertEqual(aud._detect_unit_divider('(단위:백만원)'), 1)

    def test_falls_back_to_bare_keyword_when_no_declaration(self):
        """선언을 생략한 보고서가 있다 — 옛 방식 폴백은 남긴다."""
        self.assertEqual(aud._detect_unit_divider('금액은 천원 기준이다'), 1000)
        self.assertEqual(aud._detect_unit_divider('아무 단위 표기 없음'), aud.MILLION)


class TestStripLeadingNoteNo(unittest.TestCase):
    """계정명 뒤 «작은 정수» 는 주석 번호다 — 단, 셋을 모두 만족할 때만."""

    def test_drops_note_number(self):
        # 현대트랜시스 FY2022 영업이익 행
        self.assertEqual(
            aud._strip_leading_note_no([34.0, 151726.0, 95016.0]), [151726.0, 95016.0]
        )

    def test_keeps_when_even_count(self):
        """짝수면 이미 당기·전기 짝이 맞는다 — 손대지 않는다."""
        self.assertEqual(
            aud._strip_leading_note_no([34.0, 151726.0]), [34.0, 151726.0]
        )

    def test_keeps_large_head(self):
        self.assertEqual(
            aud._strip_leading_note_no([1500.0, 151726.0, 95016.0]),
            [1500.0, 151726.0, 95016.0],
        )

    def test_keeps_when_rest_is_not_1000x(self):
        """자릿수 차가 작으면 주석 번호가 아니라 진짜 값이다."""
        self.assertEqual(
            aud._strip_leading_note_no([34.0, 500.0, 480.0]), [34.0, 500.0, 480.0]
        )

    def test_keeps_non_integer_head(self):
        self.assertEqual(
            aud._strip_leading_note_no([34.5, 151726.0, 95016.0]),
            [34.5, 151726.0, 95016.0],
        )


class TestParseUsesBothFixes(unittest.TestCase):
    """파서 전체를 통과시켰을 때 두 수리가 함께 먹는지."""

    def test_income_table_end_to_end(self):
        html = (
            '<p>(단위:백만원)</p>'
            '<table>'
            '<tr><td>매출액</td><td>23,33,34</td><td>10,256,254</td><td>8,143,951</td></tr>'
            '<tr><td>영업이익</td><td>34</td><td>151,726</td><td>95,016</td></tr>'
            '<tr><td>당기순이익</td><td>35</td><td>123,483</td><td>80,000</td></tr>'
            '</table>'
        )
        parsed = aud._parse_financial_tables([_table(html)])
        self.assertEqual(parsed['revenue']['current'], 10256254.0)
        self.assertEqual(parsed['operating_income']['current'], 151726.0)
        self.assertEqual(parsed['operating_income']['prior'], 95016.0)


class TestReadYearWalksCandidates(unittest.TestCase):
    """정정 공시가 별도만 담고 있으면 원본으로 내려간다."""

    def setUp(self):
        self._orig_url = aud._get_main_doc_url
        self._orig_tables = aud._fetch_tables
        self._orig_parse = aud._parse_financial_tables
        self.fetched: list[str] = []

    def tearDown(self):
        aud._get_main_doc_url = self._orig_url
        aud._fetch_tables = self._orig_tables
        aud._parse_financial_tables = self._orig_parse

    def _wire(self, consolidated_for: set[str]):
        def _url(rcpt_no):
            self.fetched.append(rcpt_no)
            return f'http://x/{rcpt_no}', rcpt_no in consolidated_for

        aud._get_main_doc_url = _url
        aud._fetch_tables = lambda url: ['table']
        aud._parse_financial_tables = lambda tables: {'revenue': {'current': 1.0, 'prior': None}}

    def test_walks_past_correction_stub_to_original(self):
        # 화승코퍼레이션 FY2021: 1등이 [첨부정정](별도만) · 2등이 원본(연결 포함)
        self._wire(consolidated_for={'ORIG'})
        parsed, cons = aud._read_year(
            '00166272', 2021,
            [('FIX', '[첨부정정]사업보고서 (2021.12)', False),
             ('ORIG', '사업보고서 (2021.12)', False)],
        )
        self.assertTrue(parsed)
        self.assertEqual(cons, 'consolidated')
        self.assertEqual(self.fetched, ['FIX', 'ORIG'])

    def test_stops_at_first_when_not_a_correction(self):
        """정정본이 아닌데 연결이 없으면 그 회사는 정말 별도뿐 — HTTP 를 더 쓰지 않는다."""
        self._wire(consolidated_for=set())
        parsed, cons = aud._read_year(
            '00123456', 2021,
            [('A', '감사보고서 (2021.12)', False), ('B', '감사보고서 (2021.12)', False)],
        )
        self.assertTrue(parsed)
        self.assertEqual(cons, 'separate')
        self.assertEqual(self.fetched, ['A'])

    def test_takes_first_candidate_when_none_consolidated(self):
        self._wire(consolidated_for=set())
        parsed, cons = aud._read_year(
            '00166272', 2021,
            [('FIX', '[첨부정정]사업보고서 (2021.12)', False),
             ('ORIG', '사업보고서 (2021.12)', False)],
        )
        self.assertEqual(cons, 'separate')
        self.assertEqual(self.fetched, ['FIX', 'ORIG'])


if __name__ == '__main__':
    unittest.main()
