"""`collect_news.py` 의 «보통명사 사명» 대책 회귀 검증 (2026-09-11 신설).

🔴 **양방향으로 시험한다.** 「오염을 막는다」만 재면, 멀쩡한 회사의 뉴스까지
0건으로 만드는 고장도 통과한다. 그래서 ①모호한 이름은 좁히고 ②또렷한 이름은
**안 좁히는지**를 함께 본다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_news_query.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location('collect_news', SCRIPTS_DIR / 'collect_news.py')
cn = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cn)


class TestQuery(unittest.TestCase):
  def test_two_char_name_is_pinned_to_corporate_form(self):
    """두 글자는 법인 표기 + 맥락어를 **AND** 로 묶는다."""
    q = cn._kr_unlisted_query('경신', False)
    self.assertEqual(q, '("(주)경신" OR "㈜경신") 자동차부품')

  def test_two_char_query_has_no_bare_name_clause(self):
    """🔴 맨 사명 절이 OR 로 남으면 오염이 되돌아온다(세정 실측 20/20 동명 타사)."""
    q = cn._kr_unlisted_query('세정', False)
    self.assertNotIn('OR "세정 ', q)

  def test_three_char_name_keeps_bare_phrase(self):
    """세 글자는 법인 표기를 요구하지 않는다 — 기사가 맨 이름으로 쓴다."""
    self.assertEqual(cn._kr_unlisted_query('코렌스', False), '"코렌스" 자동차부품')

  def test_robot_company_gets_robot_context(self):
    self.assertEqual(cn._kr_unlisted_query('테솔로', True), '"테솔로" 로봇')

  def test_two_char_robot_company(self):
    self.assertEqual(cn._kr_unlisted_query('로봇', True), '("(주)로봇" OR "㈜로봇") 로봇')

  def test_long_name_is_not_narrowed_by_corporate_form(self):
    q = cn._kr_unlisted_query('유라코퍼레이션', False)
    self.assertNotIn('(주)', q)


class TestTitleFilter(unittest.TestCase):
  def test_title_with_name_passes(self):
    self.assertTrue(cn._title_mentions('㈜호원 노조, 공장 점거농성', '호원'))

  def test_title_without_name_is_dropped(self):
    """맥락어에 딸려 온 남의 기사 — 나전 실측에서 8건 중 8건이 이 모양이었다."""
    self.assertFalse(cn._title_mentions('광주시, 1605억 투자유치…자동차·인공지능', '나전'))

  def test_name_inside_longer_company_name_passes(self):
    """🔴 「씨티알」 기사는 「씨티알모빌리티」로 쓴다 — 부분일치를 막으면 안 된다."""
    self.assertTrue(cn._title_mentions('씨티알모빌리티, 2025년 별도 매출 3505억', '씨티알'))

  def test_empty_title_is_dropped(self):
    self.assertFalse(cn._title_mentions('', '호원'))
    self.assertFalse(cn._title_mentions(None, '호원'))


class TestTitleCheckScope(unittest.TestCase):
  """제목 필터는 두 글자에만 — 넓히면 «진짜 뉴스» 를 떨어뜨린다."""

  def test_two_char_name_is_checked(self):
    self.assertTrue(cn._needs_title_check('호원'))

  def test_longer_names_are_not_checked(self):
    """🔴 실측: 현대성우쏠라이트 기사는 「쏠라이트」로만 써 55/60 이 탈락했다."""
    for n in ('코렌스', '현대성우쏠라이트', '타타대우모빌리티', '베바스토코리아'):
      self.assertFalse(cn._needs_title_check(n), n)


if __name__ == '__main__':
  unittest.main()
