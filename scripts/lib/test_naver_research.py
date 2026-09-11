"""lib.naver_research 단위 테스트.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_naver_research.py

🔴 **2026-09-12 전면 교체.** 네이버 금융이 Next.js 로 개편돼 HTML 목록이 사라졌고
   모바일 JSON API 로 갈아탔다. 옛 픽스처(`<td>` 6칸 표)는 더 이상 실물이 아니라 지웠다.
   아래 픽스처는 **2026-09-12 에 실제로 받은 응답**을 그대로 잘라 온 것이다.

🔴 양방향으로 시험한다 — ①정상 응답을 제대로 읽는지 ②모양이 어긋난 응답에
   **예외를 던지지 않고 빈 목록**을 주는지. 후자가 「파싱 0건 = 구조 변경」 신호로
   이어져 수집기가 exit 3 을 내기 때문이다. 예외로 죽으면 그 신호가 안 나온다.
"""
import json
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.naver_research import (  # noqa: E402
    API_BASE,
    DELTA_MAX_GAP_DAYS,
    KIND_COMPANY,
    KIND_INDUSTRY,
    MIN_BODY_TEXT,
    delta_group_key,
    detail_body_text,
    has_robot_keyword,
    is_periodic_title,
    is_summary_target,
    list_url,
    normalize_opinion,
    parse_detail_payload,
    parse_list_payload,
    parse_target_price,
    pick_delta_base,
    read_url,
)

# 실물 응답(2026-09-12) — 산업분석 2건. 산업분석엔 itemCode 가 없다.
INDUSTRY_LIST = [
    {
        "researchCategory": "산업분석",
        "category": "철강금속",
        "researchId": 46043,
        "title": "신한 자동차/철강금속 Weekly (2026.09.11)",
        "brokerName": "신한투자증권",
        "writeDate": "2026-09-11",
        "readCount": "372",
        "endUrl": "https://m.stock.naver.com/research/industry/46043",
    },
    {
        "researchCategory": "산업분석",
        "category": "기타",
        "researchId": 46041,
        "title": "안녕하세요 데일리에요(로봇/방산/조선)",
        "brokerName": "유진투자증권",
        "writeDate": "2026-09-11",
        "readCount": "471",
        "endUrl": "https://m.stock.naver.com/research/industry/46041",
    },
]

# 실물 응답(2026-09-12) — 종목분석 1건. 종목분석만 itemCode·itemName 이 온다.
COMPANY_LIST = [
    {
        "researchCategory": "종목분석",
        "category": "종목분석",
        "itemCode": "112610",
        "itemName": "씨에스윈드",
        "researchId": 96103,
        "title": "무관심에서 관심의 영역으로",
        "brokerName": "DS투자증권",
        "writeDate": "2026-09-11",
        "readCount": "1956",
        "endUrl": "https://m.stock.naver.com/research/company/96103",
    },
]

# 실물 상세 응답의 모양. `researchSummaries` 는 「같은 종목의 다른 리포트」라 안 쓴다.
DETAIL_COMPANY = {
    "researchContent": {
        "itemCode": "112610",
        "itemName": "씨에스윈드",
        "researchId": 96103,
        "title": "무관심에서 관심의 영역으로",
        "brokerName": "DS투자증권",
        "writeDate": "2026-09-11",
        "readCount": "1956",
        "attachUrl": "https://stock.pstatic.net/stock-research/company/66/20260911_company_146719000.pdf",
        "content": "<p><strong>투자의견 매수, 목표주가 9.5만원 유지</strong></p><p>미국 타워 물량 회복.</p>",
    },
    "researchSummaries": [
        {"researchId": 95393, "title": "2Q26 Review", "brokerName": "교보증권"},
    ],
}


class TestUrl(unittest.TestCase):
    def test_list_url_has_no_keyword(self):
        """🔴 새 API 는 검색을 안 받는다 — keyword 를 붙이면 안 된다(무시되고 전체가 온다)."""
        url = list_url(KIND_INDUSTRY, page=2, page_size=50)
        self.assertEqual(url, f"{API_BASE}/industry?page=2&pageSize=50")
        self.assertNotIn("keyword", url)

    def test_read_url_shape(self):
        self.assertEqual(read_url(KIND_COMPANY, 96103), f"{API_BASE}/company/96103")

    def test_bad_kind_raises(self):
        with self.assertRaises(ValueError):
            list_url("bogus")
        with self.assertRaises(ValueError):
            read_url("bogus", 1)


class TestParseList(unittest.TestCase):
    def test_industry_rows(self):
        rows = parse_list_payload(INDUSTRY_LIST, KIND_INDUSTRY)
        self.assertEqual(len(rows), 2)
        r = rows[0]
        self.assertEqual(r["naver_nid"], 46043)
        self.assertEqual(r["kind"], KIND_INDUSTRY)
        self.assertEqual(r["broker"], "신한투자증권")
        self.assertEqual(r["published_at"], date(2026, 9, 11))
        self.assertEqual(r["view_count"], 372)
        self.assertIsNone(r["ticker"], "산업분석엔 종목코드가 없다")
        self.assertEqual(r["target_name"], "철강금속", "산업분석은 분류명이 대상 이름이다")

    def test_periodic_flag_is_set_from_title(self):
        rows = parse_list_payload(INDUSTRY_LIST, KIND_INDUSTRY)
        self.assertTrue(rows[0]["is_periodic"], "Weekly 는 정기물")
        self.assertTrue(rows[1]["is_periodic"], "데일리 는 정기물")

    def test_company_row_has_ticker(self):
        r = parse_list_payload(COMPANY_LIST, KIND_COMPANY)[0]
        self.assertEqual(r["ticker"], "112610")
        self.assertEqual(r["target_name"], "씨에스윈드")

    def test_pdf_url_is_none_in_list(self):
        """🔴 목록엔 PDF 주소가 없다 — 상세의 attachUrl 에서 채운다."""
        for rows in (parse_list_payload(INDUSTRY_LIST, KIND_INDUSTRY),
                     parse_list_payload(COMPANY_LIST, KIND_COMPANY)):
            self.assertIsNone(rows[0]["pdf_url"])

    def test_accepts_json_string(self):
        rows = parse_list_payload(json.dumps(COMPANY_LIST, ensure_ascii=False), KIND_COMPANY)
        self.assertEqual(len(rows), 1)

    def test_broken_shapes_yield_empty_not_raise(self):
        """🔴 예외로 죽으면 «구조 변경» 신호가 안 나온다 — 빈 목록을 줘야 한다."""
        for bad in ("<html>개편된 페이지</html>", "", None, {}, {"foo": 1}, 42, [None, 3]):
            self.assertEqual(parse_list_payload(bad, KIND_COMPANY), [], repr(bad))

    def test_rows_without_id_or_title_are_skipped(self):
        payload = [
            {"researchId": None, "title": "아이디 없음", "writeDate": "2026-09-11"},
            {"researchId": 1, "title": "", "writeDate": "2026-09-11"},
            {"researchId": 2, "title": "정상", "writeDate": "2026-09-11"},
        ]
        rows = parse_list_payload(payload, KIND_INDUSTRY)
        self.assertEqual([r["naver_nid"] for r in rows], [2])

    def test_bad_date_becomes_none(self):
        rows = parse_list_payload([{"researchId": 9, "title": "t", "writeDate": "몰라"}], KIND_INDUSTRY)
        self.assertIsNone(rows[0]["published_at"])

    def test_old_two_digit_date_still_parses(self):
        """판본이 섞여 와도 조용히 None 이 되지 않게."""
        rows = parse_list_payload([{"researchId": 9, "title": "t", "writeDate": "26.08.24"}], KIND_INDUSTRY)
        self.assertEqual(rows[0]["published_at"], date(2026, 8, 24))


class TestDetail(unittest.TestCase):
    def test_detail_fields(self):
        d = parse_detail_payload(DETAIL_COMPANY)
        self.assertEqual(d["title"], "무관심에서 관심의 영역으로")
        self.assertTrue(d["pdf_url"].endswith(".pdf"))
        self.assertEqual(d["opinion"], "매수")
        self.assertEqual(d["target_price"], 95_000)
        self.assertGreater(d["body_len"], 0)

    def test_body_len_counts_text_not_markup(self):
        """본문 길이는 태그를 뺀 «읽을 글자» 수여야 한다(MIN_BODY_TEXT 판정에 쓴다)."""
        d = parse_detail_payload(DETAIL_COMPANY)
        self.assertLess(d["body_len"], len(DETAIL_COMPANY["researchContent"]["content"]))
        self.assertIsInstance(MIN_BODY_TEXT, int)

    def test_detail_body_text_returns_readable_text(self):
        text = detail_body_text(DETAIL_COMPANY)
        self.assertIn("미국 타워 물량 회복", text)
        self.assertNotIn("<p>", text)

    def test_broken_detail_is_empty_not_raise(self):
        for bad in ("<html>개편</html>", "", None, [], {"researchSummaries": []}):
            d = parse_detail_payload(bad)
            self.assertIsNone(d["title"], repr(bad))
            self.assertIsNone(d["pdf_url"], repr(bad))
            self.assertEqual(d["body_len"], 0, repr(bad))
            self.assertEqual(detail_body_text(bad), "", repr(bad))

    def test_unwrapped_detail_also_works(self):
        """감싸개 없이 바로 오는 판본 대비."""
        d = parse_detail_payload(DETAIL_COMPANY["researchContent"])
        self.assertEqual(d["title"], "무관심에서 관심의 영역으로")

    def test_missing_optional_fields_are_none(self):
        d = parse_detail_payload({"researchContent": {"title": "제목만", "content": "<p>본문</p>"}})
        self.assertEqual(d["title"], "제목만")
        self.assertIsNone(d["pdf_url"])
        self.assertIsNone(d["target_price"])
        self.assertIsNone(d["opinion"])


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


class TestBodyLen(unittest.TestCase):
    """요약 재료가 있나 (2026-08-25 — 신한투자증권 12건이 정리 불가로 남았던 건).

    🔴 옛 판은 상세 HTML 에서 `.view_cnt` 만 골라 셌다. 새 API 는 본문만 따로 주므로
       그 선별이 필요 없어졌고, 길이는 `parse_detail_payload()['body_len']` 이 준다.
    """

    def _detail(self, body: str) -> dict:
        return parse_detail_payload({"researchContent": {"title": "t", "content": body}})

    def test_counts_text_not_markup(self):
        # 🔴 태그를 세면 재료가 없는 글도 문턱을 넘어 통과한다.
        body = "<p>" + ("가" * 400) + "</p>"
        self.assertEqual(self._detail(body)["body_len"], 400)

    def test_short_body_is_below_threshold(self):
        # 신한 실물: 요지 한 줄(131자)뿐 → 요약 불가.
        self.assertLess(self._detail("<p>" + ("가" * 131) + "</p>")["body_len"], MIN_BODY_TEXT)

    def test_long_body_clears_threshold(self):
        self.assertGreaterEqual(self._detail("<p>" + ("가" * 350) + "</p>")["body_len"], MIN_BODY_TEXT)

    def test_missing_content_is_zero(self):
        self.assertEqual(parse_detail_payload({"researchContent": {"title": "t"}})["body_len"], 0)


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
