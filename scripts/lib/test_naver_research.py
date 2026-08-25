"""lib.naver_research 단위 테스트.

실행:
  scripts/venv/Scripts/python.exe scripts/lib/test_naver_research.py

픽스처는 2026-08-24 에 실제로 받은 페이지에서 그대로 잘라 왔다.
🔴 특히 `<td>` 6칸 구조를 고정해 둔다 — 계획서는 5칸이라 적었고, 5칸으로 짜면
   에러 없이 조용히 0건이 되기 때문에 테스트가 없으면 아무도 못 잡는다.
"""
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.naver_research import (  # noqa: E402
    DELTA_MAX_GAP_DAYS,
    KIND_COMPANY,
    MIN_BODY_TEXT,
    KIND_INDUSTRY,
    body_text_length,
    delta_group_key,
    encode_keyword,
    has_robot_keyword,
    is_periodic_title,
    is_summary_target,
    list_url,
    normalize_opinion,
    parse_detail_page,
    parse_list_page,
    parse_target_price,
    parse_total_pages,
    pick_delta_base,
    read_url,
)

# 실물에서 잘라 온 종목분석 행 2개 + 인기검색어 표(섞이면 안 되는 것)
COMPANY_LIST_HTML = """
<table summary="종목분석 리포트 게시판 글목록" class="type_1">
  <tr><th>종목명</th><th>제목</th><th>증권사</th><th>첨부</th><th>작성일</th><th>조회수</th></tr>
  <tr>
    <td><a href="/item/main.naver?code=108490">로보티즈</a></td>
    <td><a href="company_read.naver?nid=95812&amp;page=1">액추에이터 시장 확대 최대 수혜주 기대</a></td>
    <td>미래에셋증권</td>
    <td><a href="https://stock.pstatic.net/stock-research/company/56/20260824_company_210393000.pdf"></a></td>
    <td>26.08.24</td>
    <td>2,364</td>
  </tr>
  <tr>
    <td><a href="/item/main.naver?code=277810">레인보우로보틱스</a></td>
    <td><a href="company_read.naver?nid=95790&amp;page=1">휴머노이드 위클리 코멘트</a></td>
    <td>한화투자증권</td>
    <td></td>
    <td>26.07.01</td>
    <td>512</td>
  </tr>
</table>
<table summary="인기검색어 리스트" class="type_r1">
  <tr><td></td><td><a href="/item/main.naver?code=005930">삼성전자</a></td><td>257,000</td><td></td></tr>
</table>
"""

INDUSTRY_LIST_HTML = """
<table summary="산업분석 리포트 게시판 글목록" class="type_1">
  <tr>
    <td>기타</td>
    <td><a href="industry_read.naver?nid=45773&amp;page=1">안녕하세요 위클리에요(로봇/방산/조선)</a></td>
    <td>유진투자증권</td>
    <td><a href="https://stock.pstatic.net/stock-research/industry/63/20260824_industry_857797000.pdf"></a></td>
    <td>26.08.24</td>
    <td>859</td>
  </tr>
  <tr>
    <td>기계</td>
    <td><a href="industry_read.naver?nid=45700&amp;page=1">휴머노이드 감속기 국산화 점검</a></td>
    <td>NH투자증권</td>
    <td><a href="https://stock.pstatic.net/x.pdf"></a></td>
    <td>26.08.20</td>
    <td>1,020</td>
  </tr>
</table>
"""

# 🔴 계획서가 적었던 5칸 구조(첨부 칸이 없다). 실물이 이렇게 바뀌면 0건이 나와야 한다.
FIVE_COLUMN_HTML = """
<table class="type_1">
  <tr>
    <td><a href="/item/main.naver?code=108490">로보티즈</a></td>
    <td><a href="company_read.naver?nid=95812">액추에이터 시장 확대</a></td>
    <td>미래에셋증권</td>
    <td>26.08.24</td>
    <td>2,364</td>
  </tr>
</table>
"""

NNAVI_HTML = """
<table class="Nnavi" summary="페이지 네비게이션 리스트"><tr>
  <td><a href="/research/industry_list.naver?page=1">1</a></td>
  <td><a href="/research/industry_list.naver?page=2">2</a></td>
  <td><a href="/research/industry_list.naver?page=11">다음</a></td>
  <td><a href="/research/industry_list.naver?page=21">맨뒤</a></td>
</tr></table>
"""

# 🔴 실물 구조 그대로 — 분류/종목명(<em>) + 제목 + 증권사 | 날짜 | 조회수 가 한 덩어리다.
#    이 구조를 잘못 읽어 제목이 "기타"·"조선" 으로 덮인 사고가 있었다(2026-08-24, 407건 오염).
DETAIL_HTML = """
<th class="view_sbj"><em>로보티즈</em> 액추에이터 시장 확대 최대 수혜주 기대 미래에셋증권 | 2026.08.24 | 조회 2,391</th>
<div class="view_cnt">투자의견: 매수 / 목표주가: 45,000원 으로 상향</div>
<a href="https://stock.pstatic.net/stock-research/company/56/20260824_company_210393000.pdf">첨부</a>
"""

DETAIL_INDUSTRY_HTML = """
<th class="view_sbj"><em>기타</em> 안녕하세요 위클리에요(로봇/방산/조선/항공/해운) - 2026/08/17~2026/08/23 유진투자증권 | 2026.08.24 | 조회 871</th>
"""


class TestUrl(unittest.TestCase):
    def test_encode_keyword_is_euckr(self):
        # 🔴 '로봇' 의 EUC-KR 바이트는 B7 CE BA CB 다. UTF-8 이면 %EB%A1%9C... 가 된다.
        self.assertEqual(encode_keyword("로봇"), "%B7%CE%BA%BF")

    def test_encode_keyword_is_not_utf8(self):
        self.assertNotIn("%EB", encode_keyword("로봇"))

    def test_list_url_shape(self):
        u = list_url(KIND_COMPANY, "로봇", 3)
        self.assertIn("company_list.naver", u)
        self.assertIn("keyword=%B7%CE%BA%BF", u)
        self.assertIn("page=3", u)
        self.assertIn("searchType=keyword", u)

    def test_read_url_shape(self):
        self.assertIn("industry_read.naver?nid=45773", read_url(KIND_INDUSTRY, 45773))

    def test_bad_kind_raises(self):
        with self.assertRaises(ValueError):
            list_url("bogus", "로봇")
        with self.assertRaises(ValueError):
            read_url("bogus", 1)


class TestParseList(unittest.TestCase):
    def test_company_rows_count(self):
        rows = parse_list_page(COMPANY_LIST_HTML, KIND_COMPANY)
        # 인기검색어 표의 행이 섞이면 3이 된다.
        self.assertEqual(len(rows), 2)

    def test_company_first_row_fields(self):
        r = parse_list_page(COMPANY_LIST_HTML, KIND_COMPANY)[0]
        self.assertEqual(r["naver_nid"], 95812)
        self.assertEqual(r["target_name"], "로보티즈")
        self.assertEqual(r["ticker"], "108490")
        self.assertEqual(r["broker"], "미래에셋증권")
        self.assertEqual(r["published_at"], date(2026, 8, 24))
        self.assertEqual(r["view_count"], 2364)
        self.assertTrue(r["pdf_url"].endswith(".pdf"))
        self.assertFalse(r["is_periodic"])

    def test_missing_pdf_is_none_not_error(self):
        r = parse_list_page(COMPANY_LIST_HTML, KIND_COMPANY)[1]
        self.assertIsNone(r["pdf_url"])
        self.assertTrue(r["is_periodic"])  # '위클리'

    def test_industry_has_no_ticker(self):
        rows = parse_list_page(INDUSTRY_LIST_HTML, KIND_INDUSTRY)
        self.assertEqual(len(rows), 2)
        self.assertIsNone(rows[0]["ticker"])
        self.assertEqual(rows[0]["target_name"], "기타")

    def test_five_column_table_yields_nothing(self):
        # 🔴 계획서가 적었던 5칸 구조. 실물이 그렇게 바뀌면 0건이 나와야 하고,
        #    수집기는 그 0건을 '구조 변경'으로 보고 종료 코드 3을 낸다.
        self.assertEqual(parse_list_page(FIVE_COLUMN_HTML, KIND_COMPANY), [])

    def test_seven_column_table_also_yields_nothing(self):
        # 칸이 늘어나는 쪽으로 바뀌어도 마찬가지로 0건이어야 한다(조용한 오파싱 방지).
        seven = FIVE_COLUMN_HTML.replace(
            "<td>2,364</td>", "<td>2,364</td><td>x</td><td>y</td>"
        )
        self.assertEqual(parse_list_page(seven, KIND_COMPANY), [])

    def test_no_table_returns_empty(self):
        self.assertEqual(parse_list_page("<html>없음</html>", KIND_COMPANY), [])

    def test_bad_date_becomes_none(self):
        html = COMPANY_LIST_HTML.replace("26.08.24", "2026-08-24")
        self.assertIsNone(parse_list_page(html, KIND_COMPANY)[0]["published_at"])


class TestPagination(unittest.TestCase):
    def test_last_page_from_nnavi(self):
        self.assertEqual(parse_total_pages(NNAVI_HTML), 21)

    def test_missing_nnavi_is_one(self):
        self.assertEqual(parse_total_pages("<html></html>"), 1)

    def test_without_last_link_uses_max_number(self):
        html = NNAVI_HTML.replace('<td><a href="/research/industry_list.naver?page=21">맨뒤</a></td>', "")
        self.assertEqual(parse_total_pages(html), 11)


class TestDetail(unittest.TestCase):
    def test_detail_fields(self):
        d = parse_detail_page(DETAIL_HTML, broker="미래에셋증권", target_name="로보티즈")
        self.assertTrue(d["pdf_url"].endswith(".pdf"))
        self.assertEqual(d["target_price"], 45000)
        self.assertEqual(d["opinion"], "매수")
        self.assertEqual(d["title"], "액추에이터 시장 확대 최대 수혜주 기대")

    def test_title_is_never_the_category(self):
        # 🔴 실제로 터진 사고 — 제목이 분류명으로 덮여 407건이 "기타"·"조선" 이 됐다.
        d = parse_detail_page(DETAIL_INDUSTRY_HTML, broker="유진투자증권", target_name="기타")
        self.assertNotEqual(d["title"], "기타")
        self.assertEqual(
            d["title"], "안녕하세요 위클리에요(로봇/방산/조선/항공/해운) - 2026/08/17~2026/08/23"
        )

    def test_title_without_broker_hint_still_strips_tail(self):
        # broker 를 안 넘겨도 '…증권' 꼬리는 잘라야 한다(폴백 경로).
        d = parse_detail_page(DETAIL_HTML)
        self.assertEqual(d["title"], "액추에이터 시장 확대 최대 수혜주 기대")

    def test_title_keeps_robot_keyword(self):
        # 제목이 오염되면 핵심어 판정도 함께 무너진다 — 그 연결을 시험으로 묶어 둔다.
        d = parse_detail_page(DETAIL_INDUSTRY_HTML, broker="유진투자증권", target_name="기타")
        self.assertTrue(has_robot_keyword(d["title"]))

    def test_target_price_accepts_목표가_form(self):
        # 🔴 실물 상세 페이지는 「목표주가」가 아니라 **「목표가」**로 적는다.
        #    이걸 놓쳐 종목분석 194건 중 65건(33.5%)만 채워져 있었다.
        html = '<div class="view_cnt">목표가 790,000 | 투자의견 매수</div>'
        d = parse_detail_page(html)
        self.assertEqual(d["target_price"], 790000)
        self.assertEqual(d["opinion"], "매수")

    def test_target_price_still_accepts_목표주가_form(self):
        d = parse_detail_page('<div class="view_cnt">목표주가: 45,000원</div>')
        self.assertEqual(d["target_price"], 45000)

    def test_missing_optional_fields_are_none(self):
        d = parse_detail_page("<html><body>본문만 있다</body></html>")
        self.assertIsNone(d["pdf_url"])
        self.assertIsNone(d["target_price"])
        self.assertIsNone(d["opinion"])
        self.assertIsNone(d["title"])


class TestPeriodic(unittest.TestCase):
    def test_periodic_titles(self):
        for t in ["데일리 코멘트", "Weekly Report", "주간 시황", "모닝브리프",
                  "이슈 코멘트", "스몰캡 브리프", "8월 캘린더", "먼슬리 전략"]:
            self.assertTrue(is_periodic_title(t), t)

    def test_non_periodic_titles(self):
        for t in ["휴머노이드 감속기 국산화 점검", "로보티즈 실적 리뷰", "액추에이터 수혜"]:
            self.assertFalse(is_periodic_title(t), t)


class TestRobotKeyword(unittest.TestCase):
    def test_hits(self):
        for t in ["휴머노이드 시대", "로봇 산업 전망", "감속기 국산화", "Humanoid robot",
                  "협동로봇 시장", "그리퍼 기술", "볼스크류 수요", "액츄에이터 공급망"]:
            self.assertTrue(has_robot_keyword(t), t)

    def test_misses(self):
        # 🔴 이 셋이 걸리면 반도체·2차전지 리포트가 통째로 딸려 온다.
        for t in ["반도체 업황 점검", "2차전지 셀 가격", "조선 수주 잔고"]:
            self.assertFalse(has_robot_keyword(t), t)


class TestSummaryTarget(unittest.TestCase):
    """저장·정리 대상 판정 (규칙 개정 2026-08-25 · 사용자 승인)."""

    def test_periodic_always_excluded(self):
        # 🔴 개정 전엔 "추적 종목이면 정기물이어도 요약"이었다. 사용자 지시
        #    "위클리 등 관련성 떨어지는 거 제거"로 뒤집혔다 — 되돌리지 말 것.
        self.assertFalse(is_summary_target(KIND_COMPANY, True, "위클리 코멘트", True))

    def test_untracked_company_with_robot_title_kept(self):
        # 🔴 개정 전엔 추적 목록 밖이면 무조건 버렸다. 그 규칙이 클로봇·씨메스·큐렉소
        #    같은 로봇 기업 리포트를 통째로 떨어뜨려 제목 핵심어를 OR 로 더했다.
        self.assertTrue(is_summary_target(KIND_COMPANY, False, "액추에이터 수혜", False))

    def test_untracked_company_without_robot_title_dropped(self):
        self.assertFalse(is_summary_target(KIND_COMPANY, False, "3분기 실적 호조", False))

    def test_tracked_company_kept_regardless_of_title(self):
        self.assertTrue(is_summary_target(KIND_COMPANY, True, "3분기 실적 호조", False))

    def test_industry_keyword_and_not_periodic(self):
        self.assertTrue(is_summary_target(KIND_INDUSTRY, False, "휴머노이드 감속기 점검", False))

    def test_industry_periodic_excluded(self):
        self.assertFalse(is_summary_target(KIND_INDUSTRY, False, "로봇 위클리", True))

    def test_industry_without_keyword_excluded(self):
        self.assertFalse(is_summary_target(KIND_INDUSTRY, False, "반도체 업황", False))


class TestBodyTextLength(unittest.TestCase):
    """요약 재료가 있나 (2026-08-25 — 신한투자증권 12건이 정리 불가로 남았던 건)."""

    def test_counts_only_report_body(self):
        # 🔴 네비게이션·목록 텍스트는 세면 안 된다. 세면 재료가 없는 글도 통과한다.
        html = (
            '<div class="view_cnt">' + ("가" * 400) + "</div>"
            '<div class="lst">' + ("메뉴 " * 200) + "</div>"
        )
        self.assertEqual(body_text_length(html), 400)

    def test_short_body_is_below_threshold(self):
        # 신한 실물: `.view_cnt` 에 131자 요지 한 줄뿐 → 요약 불가.
        html = '<div class="view_cnt">' + ("가" * 131) + "</div>"
        self.assertLess(body_text_length(html), MIN_BODY_TEXT)

    def test_missing_node_is_zero(self):
        self.assertEqual(body_text_length("<html><body>없음</body></html>"), 0)

    def test_detail_page_reports_body_len(self):
        html = '<div class="view_cnt">' + ("가" * 350) + "</div>"
        self.assertEqual(parse_detail_page(html)["body_len"], 350)


class TestTargetPrice(unittest.TestCase):
    """목표주가 단위 파싱 (2026-08-25 회귀 — 65건 중 26건이 1/10000 로 저장돼 있었다)."""

    def test_plain_won(self):
        self.assertEqual(parse_target_price("목표주가 45,000원 | 투자의견 매수"), 45000)

    def test_manwon_with_decimal(self):
        # 🔴 실물 사고. 「35.6만원」이 `35` 로 저장됐다.
        self.assertEqual(parse_target_price("목표주가 35.6만원"), 356000)

    def test_manwon_without_decimal(self):
        self.assertEqual(parse_target_price("목표가 40만원"), 400000)

    def test_eokwon(self):
        self.assertEqual(parse_target_price("목표가 1.2억원"), 120000000)

    def test_absent(self):
        self.assertIsNone(parse_target_price("투자의견 매수"))


class TestNormalizeOpinion(unittest.TestCase):
    def test_folds_english_and_korean(self):
        for raw in ["Buy", "BUY", "buy", "매수", "Outperform"]:
            self.assertEqual(normalize_opinion(raw), "매수", raw)
        for raw in ["Hold", "HOLD", "중립", "Neutral"]:
            self.assertEqual(normalize_opinion(raw), "중립", raw)
        for raw in ["Sell", "매도", "Underperform"]:
            self.assertEqual(normalize_opinion(raw), "매도", raw)

    def test_unknown_kept_as_is(self):
        self.assertEqual(normalize_opinion("Not Rated"), "Not Rated")

    def test_none(self):
        self.assertIsNone(normalize_opinion(None))
        self.assertIsNone(normalize_opinion(""))


class TestDelta(unittest.TestCase):
    def _row(self, broker, name, d):
        return {"broker": broker, "target_name": name, "published_at": d}

    def test_group_key(self):
        self.assertEqual(
            delta_group_key(self._row("미래에셋증권", "로보티즈", date(2026, 8, 1))),
            ("미래에셋증권", "로보티즈"),
        )

    def test_picks_nearest_earlier(self):
        a = self._row("미래", "로보티즈", date(2026, 8, 1))
        b = self._row("미래", "로보티즈", date(2026, 8, 20))
        cur = self._row("미래", "로보티즈", date(2026, 8, 24))
        self.assertIs(pick_delta_base([a, b, cur], cur), b)

    def test_ignores_other_broker(self):
        other = self._row("한화", "로보티즈", date(2026, 8, 20))
        cur = self._row("미래", "로보티즈", date(2026, 8, 24))
        self.assertIsNone(pick_delta_base([other, cur], cur))

    def test_ignores_too_old(self):
        old = self._row("미래", "로보티즈", date(2026, 8, 24) - __import__("datetime").timedelta(days=DELTA_MAX_GAP_DAYS + 1))
        cur = self._row("미래", "로보티즈", date(2026, 8, 24))
        self.assertIsNone(pick_delta_base([old, cur], cur))

    def test_boundary_day_is_included(self):
        edge = self._row("미래", "로보티즈", date(2026, 8, 24) - __import__("datetime").timedelta(days=DELTA_MAX_GAP_DAYS))
        cur = self._row("미래", "로보티즈", date(2026, 8, 24))
        self.assertIs(pick_delta_base([edge, cur], cur), edge)

    def test_ignores_later_report(self):
        later = self._row("미래", "로보티즈", date(2026, 9, 1))
        cur = self._row("미래", "로보티즈", date(2026, 8, 24))
        self.assertIsNone(pick_delta_base([later, cur], cur))

    def test_none_date_is_safe(self):
        cur = self._row("미래", "로보티즈", None)
        self.assertIsNone(pick_delta_base([], cur))


if __name__ == "__main__":
    unittest.main(verbosity=2)
