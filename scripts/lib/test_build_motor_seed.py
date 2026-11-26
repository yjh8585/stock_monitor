"""모터 명단 정본 검사기·시드 생성기(build_motor_seed.py) 회귀 검증.

배경(2026-11-26): 휴머노이드 「모터」 탭의 회사 명단은 git 밖 JSON 정본에서 시드 SQL 로 만든다.
화면에는 「확인」 공급 이력만 나가고, 로봇 전용 회사는 /domestic 에 섞이면 안 된다.
검사기가 그 전제(유형 4값·등급·근거 링크·상장 티커)를 깨는 명단을 시드 전에 막는다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_build_motor_seed.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'build_motor_seed', SCRIPTS_DIR / 'build_motor_seed.py'
)
seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed)


def _company(**over):
    base = {
        'name_kr': '테스트모터',
        'motor_types': ['auto_motor'],
        'products': [{'name': 'BLDC 모터'}],
        'supply_history': [],
        'listed': False,
    }
    base.update(over)
    return base


def _master(*companies):
    return {'companies': list(companies), 'excluded': []}


class TestValidate(unittest.TestCase):
    def test_valid_minimal_passes(self):
        self.assertEqual(seed.validate(_master(_company())), [])

    def test_unknown_motor_type_rejected(self):
        errs = seed.validate(_master(_company(motor_types=['inverter'])))
        self.assertEqual(len(errs), 1)
        self.assertIn('inverter', errs[0])

    def test_empty_motor_types_rejected(self):
        self.assertEqual(len(seed.validate(_master(_company(motor_types=[])))), 1)

    def test_confirmed_needs_source_url(self):
        no_url = {'customer': '한화로보틱스', 'field': 'robot', 'grade': '확인'}
        self.assertEqual(len(seed.validate(_master(_company(supply_history=[no_url])))), 1)
        guess = {'customer': '한화로보틱스', 'field': 'robot', 'grade': '추정'}
        self.assertEqual(seed.validate(_master(_company(supply_history=[guess]))), [])

    def test_bad_grade_and_field_rejected(self):
        bad = {'customer': 'A', 'field': 'car', 'grade': '확인됨', 'source_url': 'https://x.kr'}
        self.assertEqual(len(seed.validate(_master(_company(supply_history=[bad])))), 2)

    def test_listed_needs_6digit_ticker(self):
        self.assertEqual(
            len(seed.validate(_master(_company(listed=True, ticker='12345', market='KOSDAQ')))), 1
        )
        self.assertEqual(
            seed.validate(_master(_company(listed=True, ticker='012200', market='KOSPI'))), []
        )

    def test_duplicate_name_rejected(self):
        errs = seed.validate(_master(_company(), _company()))
        self.assertEqual(len(errs), 1)


class TestIncludeDomestic(unittest.TestCase):
    def test_include_domestic(self):
        self.assertFalse(seed.include_domestic(_company(motor_types=['robot_motor'])))
        self.assertTrue(seed.include_domestic(_company(motor_types=['auto_motor'])))
        auto_ok = {'customer': '현대차', 'field': 'auto', 'grade': '확인', 'source_url': 'https://x.kr'}
        self.assertTrue(
            seed.include_domestic(_company(motor_types=['control'], supply_history=[auto_ok]))
        )
        auto_guess = {'customer': '현대차', 'field': 'auto', 'grade': '추정'}
        self.assertFalse(
            seed.include_domestic(_company(motor_types=['control'], supply_history=[auto_guess]))
        )


if __name__ == '__main__':
    unittest.main()
