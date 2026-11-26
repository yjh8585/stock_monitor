"""모터 명단 정본 검사기·시드 생성기(build_motor_seed.py) 회귀 검증.

배경(2026-11-26): 휴머노이드 「모터」 탭의 회사 명단은 git 밖 JSON 정본에서 시드 SQL 로 만든다.
화면에는 「확인」 공급 이력만 나가고, 로봇 전용 회사는 /domestic 에 섞이면 안 된다.
검사기가 그 전제(유형 4값·등급·근거 링크·상장 티커)를 깨는 명단을 시드 전에 막는다.

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_build_motor_seed.py
"""
import importlib.util
import json
import re
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

    def test_name_with_line_break_rejected(self):
        # 🔴 emit 이 회사명을 SQL 주석(`-- 이름`)으로 쓴다 — 줄바꿈이 있으면 뒷줄이 주석 밖 SQL 이 된다
        #    (2026-11-27 Codex diff 검토). strip() 은 가운데 줄바꿈을 못 지운다.
        errs = seed.validate(_master(_company(name_kr='모터\nDROP TABLE companies;')))
        self.assertEqual(len(errs), 1)
        self.assertIn('줄바꿈', errs[0])
        self.assertEqual(len(seed.validate(_master(_company(name_kr='모터\r사')))), 1)

    def test_product_without_name_rejected(self):
        errs = seed.validate(_master(_company(products=[{'category': '모터'}])))
        self.assertEqual(len(errs), 1)

    def test_existing_company_id_must_be_uuid(self):
        errs = seed.validate(_master(_company(existing_company_id="x' OR 1=1 --")))
        self.assertEqual(len(errs), 1)
        ok = '11111111-2222-3333-4444-555555555555'
        self.assertEqual(seed.validate(_master(_company(existing_company_id=ok))), [])


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


UUID = '11111111-2222-3333-4444-555555555555'
CONFIRMED_AUTO = {
    'customer': '현대차', 'field': 'auto', 'grade': '확인', 'source_url': 'https://x.kr/a',
}


def _statements(sql: str) -> list[str]:
    """주석 줄을 걷어 낸 뒤 문장 단위로 자른다(회사별 주석 줄이 문장째 버려지지 않게)."""
    body = '\n'.join(ln for ln in sql.splitlines() if not ln.lstrip().startswith('--'))
    return [s.strip() for s in re.split(r';\s*\n', body + '\n') if s.strip()]


class TestRenderSeedSql(unittest.TestCase):
    def test_new_company_insert_has_motor_types_inline(self):
        sql = seed.render_seed_sql(_master(_company(name_kr='새모터', motor_types=['robot_motor'])))
        inserts = [s for s in _statements(sql) if s.startswith('INSERT INTO companies')]
        self.assertEqual(len(inserts), 1)
        self.assertIn('motor_types', inserts[0])
        self.assertIn("ARRAY['robot_motor']::text[]", inserts[0])

    def test_quote_escaping(self):
        sql = seed.render_seed_sql(_master(_company(name_kr="O'Neil 모터")))
        self.assertIn("'O''Neil 모터'", sql)

    def test_supply_history_is_jsonb_literal(self):
        sql = seed.render_seed_sql(_master(_company(supply_history=[CONFIRMED_AUTO])))
        m = re.search(r"'(\[\{\"customer\".*?)'::jsonb", sql)
        self.assertIsNotNone(m)
        literal = m.group(1).replace("''", "'")
        self.assertEqual(json.loads(literal)[0]['customer'], '현대차')

    def test_estimated_records_not_emitted(self):
        # companies 는 anon 이 직접 읽는다(anon_read_companies USING true) — 추정을 DB 에 넣으면
        # 화면(뷰)에는 안 나와도 공개 키로 조회된다. 추정은 덱에서 JSON 으로만 쓴다.
        guess = {'customer': '비밀고객', 'field': 'robot', 'grade': '추정'}
        sql = seed.render_seed_sql(_master(
            _company(supply_history=[CONFIRMED_AUTO, guess]),
            _company(name_kr='기존사', existing_company_id=UUID, supply_history=[guess]),
        ))
        self.assertNotIn('비밀고객', sql)
        self.assertNotIn('추정', sql)
        self.assertIn('현대차', sql)

    def test_existing_company_update_and_pages(self):
        c = _company(existing_company_id=UUID, motor_types=['auto_motor'])
        stmts = _statements(seed.render_seed_sql(_master(c)))
        self.assertFalse(any(s.startswith('INSERT INTO companies') for s in stmts))
        updates = [s for s in stmts if s.startswith('UPDATE companies')]
        self.assertEqual(len(updates), 1)
        self.assertIn('motor_types', updates[0])
        self.assertIn('supply_history', updates[0])
        self.assertIn(f"id = '{UUID}'", updates[0])
        pages = ' '.join(s for s in stmts if s.startswith('INSERT INTO company_pages'))
        self.assertIn("'motor'", pages)
        self.assertIn("'domestic'", pages)
        self.assertIn('ON CONFLICT', pages)

    def test_existing_robot_only_gets_motor_page_only(self):
        c = _company(existing_company_id=UUID, motor_types=['robot_motor'])
        pages = ' '.join(
            s for s in _statements(seed.render_seed_sql(_master(c)))
            if s.startswith('INSERT INTO company_pages')
        )
        self.assertIn("'motor'", pages)
        self.assertNotIn("'domestic'", pages)

    def test_new_listed_vs_unlisted_values(self):
        listed = seed.render_seed_sql(_master(_company(
            name_kr='상장모터', listed=True, ticker='012200', market='KOSPI')))
        self.assertIn("'fnguide'", listed)
        self.assertIn("'KOSPI'", listed)
        self.assertIn("'012200'", listed)
        dart = seed.render_seed_sql(_master(_company(name_kr='외감모터', dart_corp_code='00123456')))
        self.assertIn("'dart'", dart)
        self.assertIn("'00123456'", dart)
        # 칸 순서 name, name_kr, ticker — ticker = name_kr (효성전기·퓨트로닉 선례)
        self.assertIn("'외감모터', '외감모터', '외감모터', NULL", dart)
        # data_source 는 NOT NULL — 코드 없는 비상장은 휴머노이드 비상장 선례대로 web_search · ticker NULL
        none = seed.render_seed_sql(_master(_company(name_kr='소기업모터')))
        self.assertIn("'web_search'", none)
        self.assertIn("'소기업모터', '소기업모터', NULL, NULL", none)

    def test_company_type_follows_include_domestic(self):
        auto = seed.render_seed_sql(_master(_company(motor_types=['auto_motor'])))
        self.assertIn("'부품사'", auto)
        robot = seed.render_seed_sql(_master(_company(motor_types=['robot_motor'])))
        self.assertNotIn("'부품사'", robot)

    def test_no_robot_roles_in_output(self):
        sql = seed.render_seed_sql(_master(_company(), _company(name_kr='B', existing_company_id=UUID)))
        self.assertNotIn('robot_roles', sql)


class TestFinancialTargets(unittest.TestCase):
    def test_financial_targets_excludes_web_search_route(self):
        rows = [
            {'ticker': 'A', 'data_source': 'fnguide'},
            {'ticker': 'B', 'data_source': 'dart'},
            {'ticker': 'C', 'data_source': None},
            {'ticker': 'D', 'data_source': 'other'},
            {'ticker': 'E', 'data_source': 'web_search'},
            {'ticker': 'F', 'data_source': 'marklines'},
        ]
        self.assertEqual(seed.financial_targets(rows), ['A', 'B'])


class TestProductsAppendSql(unittest.TestCase):
    """기존 회사 제품 칸에 명단의 모터 제품을 덧붙이는 SQL(사용자 승인 2026-11-27 · products 는 append-only)."""

    def test_only_existing_companies_get_update(self):
        sql = seed.render_products_append_sql(_master(
            _company(name_kr='기존사', existing_company_id=UUID, products=[{'name': '시트 모터', 'category': '모터'}]),
            _company(name_kr='신규사', products=[{'name': '신규 전용 제품'}]),
        ))
        updates = [s for s in _statements(sql) if s.startswith('UPDATE companies')]
        self.assertEqual(len(updates), 1)
        self.assertIn(f"c.id = '{UUID}'", updates[0])
        self.assertIn('시트 모터', updates[0])
        self.assertNotIn('신규 전용 제품', sql)

    def test_appends_without_overwriting_and_skips_same_name(self):
        sql = seed.render_products_append_sql(_master(
            _company(existing_company_id=UUID, products=[{'name': 'EPB 액추에이터'}]),
        ))
        update = [s for s in _statements(sql) if s.startswith('UPDATE companies')][0]
        # 기존 배열 뒤에 붙인다(덮어쓰면 다른 화면의 제품이 사라진다)
        self.assertRegex(update, r"SET products = COALESCE\(c\.products, '\[\]'::jsonb\) \|\|")
        # 이름이 이미 있으면 건너뛴다 — 두 번 돌려도 같다(멱등)
        self.assertIn("q->>'name' = p.item->>'name'", update)

    def test_item_marked_same_as_existing_is_not_appended(self):
        # 띄어쓰기·표현만 다른 같은 제품(「EPS 모터」 ↔ 기존 「EPS 모터 (조향 장치용)」)은 붙이지 않는다 —
        # products 는 append-only 라 한 번 붙은 중복은 지울 수 없다
        sql = seed.render_products_append_sql(_master(
            _company(existing_company_id=UUID, products=[
                {'name': 'EPS 모터', 'same_as': 'EPS 모터 (조향 장치용)'},
                {'name': '전동 컴프레서 모터'},
            ]),
            _company(name_kr='전부중복', existing_company_id='22222222-2222-3333-4444-555555555555',
                     products=[{'name': 'DYNAMIXEL 액추에이터', 'same_as': 'DYNAMIXEL'}]),
        ))
        updates = [s for s in _statements(sql) if s.startswith('UPDATE companies')]
        self.assertEqual(len(updates), 1)
        self.assertIn('전동 컴프레서 모터', updates[0])
        self.assertNotIn('"EPS 모터"', sql)
        self.assertNotIn('DYNAMIXEL 액추에이터', sql)

    def test_existing_company_without_products_emits_nothing(self):
        sql = seed.render_products_append_sql(_master(
            _company(name_kr='제품없음', existing_company_id=UUID, products=[]),
        ))
        self.assertEqual([s for s in _statements(sql) if s.startswith('UPDATE')], [])


if __name__ == '__main__':
    unittest.main()
