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


if __name__ == '__main__':
    unittest.main()
