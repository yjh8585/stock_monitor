"""DART corp_code 회사명 부분매칭 가드(_name_contains_match) 회귀 검증.

배경(2026-07-17): _resolve_corp_code_impl의 부분매칭이 길이가드 없는 양방향 포함
(`x in _k`)이라, 짧은 상장사명이 우리 회사명 중간에 박혀 오매칭됐다:
  '워트'(396470) in '한국파워트레인', '지디'(155960) in '인지디스플레이'.
→ 비상장 플레이스홀더가 엉뚱한 상장 티커로 승격. 가드가 깨지면 즉시 실패해야 한다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_dart_corp_match.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'collect_dart_audit', SCRIPTS_DIR / 'collect_dart_audit.py'
)
aud = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(aud)

norm = aud._normalize_corp_name
match = aud._name_contains_match


class TestNameContainsGuard(unittest.TestCase):
    def test_blocks_short_midstring_misassignment(self):
        """이번 버그의 핵심: 짧은 상장사명이 우리 이름 중간에 박혀도 매칭 금지."""
        self.assertFalse(match(norm('워트'), norm('한국파워트레인')))
        self.assertFalse(match(norm('지디'), norm('인지디스플레이')))
        # 유사 함정
        self.assertFalse(match(norm('대원'), norm('대원강업')))  # 2자 → 길이가드
        self.assertFalse(match(norm('모비스'), norm('현대모비스자동차')))  # 중간 삽입 아님·접두 아님

    def test_allows_legit_suffix_shortening(self):
        """정상: 우리 이름 = 짧은 정식명 + 접미('공업' 등)."""
        self.assertTrue(match(norm('한일단조'), norm('한일단조공업')))  # 접두 경계·비율 OK
        self.assertTrue(match(norm('SG글로벌'), norm('SG글로벌')))  # 완전일치

    def test_allows_target_inside_corp(self):
        """안전 방향: 우리 이름(target)이 더 긴 corp명 안에 포함 → 허용.
        시그니처는 _name_contains_match(corp_norm, target_norm)이며 실제 호출은
        norms.apply(lambda x, _k=k: _name_contains_match(x=corp, _k=우리이름)) 순서다."""
        self.assertTrue(match(norm('삼기오토모티브'), norm('삼기')))
        self.assertTrue(match(norm('디아이씨컴퍼니'), norm('디아이씨')))

    def test_empty_safe(self):
        self.assertFalse(match('', norm('한국파워트레인')))
        self.assertFalse(match(norm('워트'), ''))


class TestCorpNameForCode(unittest.TestCase):
    def test_lookup(self):
        import pandas as pd

        class FakeDart:
            corp_codes = pd.DataFrame(
                {'corp_code': ['00866451', '00676122'], 'corp_name': ['워트', '지디']}
            )

        self.assertEqual(aud._corp_name_for_code(FakeDart(), '00866451'), '워트')
        self.assertEqual(aud._corp_name_for_code(FakeDart(), '00676122'), '지디')
        self.assertIsNone(aud._corp_name_for_code(FakeDart(), '99999999'))


class TestDomainKey(unittest.TestCase):
    """홈페이지 URL → 비교용 도메인 코어 정규화(엔티티 검증 신호2용)."""

    def test_strips_scheme_www_path_query(self):
        dk = aud._domain_key
        self.assertEqual(dk('https://www.kftec.com/'), 'kftec.com')
        self.assertEqual(dk('www.samsong.com'), 'samsong.com')
        self.assertEqual(dk('www.samsung.com/sec'), 'samsung.com')  # 경로 제거
        self.assertEqual(dk('https://dhautonex.co.kr/?locale=ko'), 'dhautonex.co.kr')  # 쿼리 제거

    def test_cckr_three_labels(self):
        """.co.kr / .or.kr 등 2단계 SLD는 등록가능 도메인이 3라벨."""
        dk = aud._domain_key
        self.assertEqual(dk('http://www.iljeong.co.kr/'), 'iljeong.co.kr')
        self.assertEqual(dk('https://sub.foo.co.kr'), 'foo.co.kr')  # 서브도메인 흡수

    def test_empty_and_junk(self):
        self.assertEqual(aud._domain_key(''), '')
        self.assertEqual(aud._domain_key(None), '')


class TestVerifyCorpIdentity(unittest.TestCase):
    """DART company.json(info)과 우리 프로필(profile)의 개체 동일성 판정.
    반환: 'confirm' | 'reject' | 'unknown'. 동명이인 재오염 방어의 핵심.
    """

    verify = staticmethod(lambda info, profile: aud._verify_corp_identity(info, profile))

    def test_listed_stock_code_match_confirms(self):
        v = aud._verify_corp_identity(
            {'stock_code': '037330', 'corp_cls': 'Y'},
            {'ticker': '037330', 'data_source': 'fnguide'},
        )
        self.assertEqual(v, 'confirm')

    def test_listed_stock_code_mismatch_rejects(self):
        """인지디스플레이(037330)로 해석돼야 하는데 지디(155960)로 잡히면 reject."""
        v = aud._verify_corp_identity(
            {'stock_code': '155960', 'corp_cls': 'Y'},
            {'ticker': '037330', 'data_source': 'fnguide'},
        )
        self.assertEqual(v, 'reject')

    def test_listed_resolved_to_unlisted_rejects(self):
        """우리는 상장(티커 有)인데 resolved corp가 비상장이면 다른 개체 → reject."""
        v = aud._verify_corp_identity(
            {'stock_code': '', 'corp_cls': 'E'},
            {'ticker': '037330', 'data_source': 'fnguide'},
        )
        self.assertEqual(v, 'reject')

    def test_unlisted_placeholder_promoted_to_listed_rejects(self):
        """비상장 placeholder(data_source='dart')가 상장 동명사로 승격 = 워트/지디형 → reject."""
        v = aud._verify_corp_identity(
            {'stock_code': '396470', 'corp_cls': 'Y', 'hm_url': ''},
            {'ticker': '', 'data_source': 'dart', 'homepage_url': ''},
        )
        self.assertEqual(v, 'reject')

    def test_homepage_domain_match_confirms(self):
        """둘 다 비상장이라 상장코드 신호가 없을 때, 홈페이지 도메인 일치로 확증."""
        v = aud._verify_corp_identity(
            {'stock_code': '', 'corp_cls': 'E', 'hm_url': 'www.samsong.com'},
            {'ticker': '', 'data_source': 'dart', 'homepage_url': 'http://www.samsong.com/'},
        )
        self.assertEqual(v, 'confirm')

    def test_homepage_domain_mismatch_is_unknown_not_reject(self):
        """hm_url은 모회사/JV 도메인 잡음(우진공업→ngkntk)이 섞여 불일치만으로 reject 금지."""
        v = aud._verify_corp_identity(
            {'stock_code': '', 'corp_cls': 'E', 'hm_url': 'www.ngkntk.co.kr'},
            {'ticker': '', 'data_source': 'dart', 'homepage_url': 'https://www.woojin.co.kr'},
        )
        self.assertEqual(v, 'unknown')

    def test_both_unlisted_no_homepage_is_unknown(self):
        v = aud._verify_corp_identity(
            {'stock_code': '', 'corp_cls': 'E', 'hm_url': ''},
            {'ticker': '', 'data_source': 'dart', 'homepage_url': ''},
        )
        self.assertEqual(v, 'unknown')

    def test_stock_signal_wins_over_homepage(self):
        """상장코드 일치는 결정적 — 홈페이지가 달라도 confirm."""
        v = aud._verify_corp_identity(
            {'stock_code': '005930', 'corp_cls': 'Y', 'hm_url': 'www.other.com'},
            {'ticker': '005930', 'data_source': 'fnguide', 'homepage_url': 'www.mine.com'},
        )
        self.assertEqual(v, 'confirm')

    def test_bad_info_is_unknown(self):
        self.assertEqual(aud._verify_corp_identity(None, {'ticker': '005930'}), 'unknown')


class TestIdentityAllows(unittest.TestCase):
    """정책: confirm→통과 / reject→차단 / unknown→후보 2개↑면 차단(동명 있을 때만), 1개면 통과."""

    def test_confirm_always_allows(self):
        self.assertTrue(aud._identity_allows('confirm', 1))
        self.assertTrue(aud._identity_allows('confirm', 5))

    def test_reject_always_blocks(self):
        self.assertFalse(aud._identity_allows('reject', 1))
        self.assertFalse(aud._identity_allows('reject', 5))

    def test_unknown_blocks_only_on_homonym(self):
        self.assertTrue(aud._identity_allows('unknown', 1))  # 동명 없음 → 통과
        self.assertFalse(aud._identity_allows('unknown', 2))  # 동명이인 존재 → 차단
        self.assertFalse(aud._identity_allows('unknown', 4))


if __name__ == '__main__':
    unittest.main()
