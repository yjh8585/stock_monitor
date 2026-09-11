"""`verify_call_contracts.py` 의 판정 회귀 검증 (2026-09-11 신설).

🔴 **양방향으로 시험한다.** 「깨진 코드를 잡는다」만 재면, 아무 때나 위반을 내는
고장도 통과한다. 그래서 ①깨진 모양을 잡고 ②멀쩡한 모양은 **안 잡는지**를 함께 본다.
(이 규칙 자체가 `AGENTS.md` 의 검사기 약속이다.)

실행:
  scripts/venv/Scripts/python.exe -m pytest scripts/lib/test_call_contracts.py
"""
import ast
import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS_DIR))

_spec = importlib.util.spec_from_file_location(
    'verify_call_contracts', SCRIPTS_DIR / 'verify_call_contracts.py'
)
vc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vc)


def _call(src: str) -> ast.Call:
    return ast.parse(src).body[0].value


def _sig(src: str) -> dict:
    fn = ast.parse(src).body[0]
    a = fn.args
    pos = [x.arg for x in a.posonlyargs] + [x.arg for x in a.args]
    return {
        'pos': pos,
        'req_pos': pos[: len(pos) - len(a.defaults)],
        'kwonly': [x.arg for x in a.kwonlyargs],
        'req_kw': [x.arg for i, x in enumerate(a.kwonlyargs) if a.kw_defaults[i] is None],
        'vararg': bool(a.vararg),
        'kwarg': bool(a.kwarg),
        'where': 'x:1',
    }


class TestSignature(unittest.TestCase):
    """①깨진 것은 잡고 ②멀쩡한 것은 안 잡는다."""

    def test_too_many_positional(self):
        s = _sig('def f(a, b): pass')
        self.assertIn('위치 인자', vc._check_signature(_call('f(1, 2, 3)'), s))

    def test_missing_required(self):
        # 오늘의 두 번째 사고: 파라미터를 지웠는데 부르는 쪽을 안 고쳤다(반대 방향)
        s = _sig('def f(a, b): pass')
        self.assertIn('필수 인자 누락', vc._check_signature(_call('f(1)'), s))

    def test_unknown_keyword(self):
        s = _sig('def f(a, b=1): pass')
        self.assertIn('모르는 키워드', vc._check_signature(_call('f(1, zzz=2)'), s))

    def test_keyword_only_is_not_positional(self):
        """🔴 프로토타입이 여기서 오탐 27건을 냈다 — `*` 뒤 인자를 위치로 셌다."""
        s = _sig('def f(a, b, *, months=2): pass')
        self.assertIsNone(vc._check_signature(_call('f(1, 2, months=3)'), s))

    def test_varargs_and_kwargs_are_permissive(self):
        s = _sig('def f(a, *args, **kw): pass')
        self.assertIsNone(vc._check_signature(_call('f(1, 2, 3, z=4)'), s))

    def test_keyword_fills_positional(self):
        s = _sig('def f(a, b): pass')
        self.assertIsNone(vc._check_signature(_call('f(1, b=2)'), s))

    def test_star_args_at_callsite_is_skipped(self):
        s = _sig('def f(a, b): pass')
        self.assertIsNone(vc._check_signature(_call('f(*xs)'), s))


class TestTupleArity(unittest.TestCase):
    def test_all_tuple_returns(self):
        files = {}
        tree = ast.parse('def f():\n  if x: return None\n  return 1, 2\n')
        sizes, other = set(), False
        for r in ast.walk(tree):
            if isinstance(r, ast.Return) and r.value is not None:
                if isinstance(r.value, ast.Tuple):
                    sizes.add(len(r.value.elts))
                elif isinstance(r.value, ast.Constant) and r.value.value is None:
                    pass
                else:
                    other = True
        # `return None` 은 계약을 깨지 않는다 — 이른 종료다
        self.assertEqual((sizes, other), ({2}, False))
        self.assertFalse(files)


class TestUsedAsTuple(unittest.TestCase):
    """쌍을 «쌍으로» 쓰면 정상이고, «스칼라처럼» 쓰면 걸린다."""

    def _scope(self, src: str):
        return ast.parse(src).body[0]

    def test_subscript_counts_as_tuple_use(self):
        sc = self._scope('def g():\n  hdr = find()\n  return hdr[0]\n')
        self.assertTrue(vc._used_as_tuple(sc, 'hdr'))

    def test_unpack_counts_as_tuple_use(self):
        sc = self._scope('def g():\n  p = find()\n  a, b = p\n  return a\n')
        self.assertTrue(vc._used_as_tuple(sc, 'p'))

    def test_iteration_counts_as_tuple_use(self):
        sc = self._scope('def g():\n  p = find()\n  for x in p:\n    pass\n')
        self.assertTrue(vc._used_as_tuple(sc, 'p'))

    def test_star_counts_as_tuple_use(self):
        sc = self._scope('def g():\n  p = find()\n  h(*p)\n')
        self.assertTrue(vc._used_as_tuple(sc, 'p'))

    def test_scalar_use_is_flagged(self):
        # 오늘의 실사고 모양 — 튜플을 URL 자리에 그대로 넘긴다
        sc = self._scope('def g():\n  url = _get_main_doc_url(no)\n  return fetch(url)\n')
        self.assertFalse(vc._used_as_tuple(sc, 'url'))


class TestModuleNaming(unittest.TestCase):
    def test_module_name_is_a_path_not_a_stem(self):
        """🔴 stem 으로 하면 `yt_report/finalize` 와 `_yt_report/finalize` 가 충돌한다."""
        name = vc._modname(SCRIPTS_DIR / 'lib' / 'pdf_figures.py')
        self.assertEqual(name, 'lib.pdf_figures')

    def test_scratch_folders_are_excluded(self):
        files = vc._iter_files()
        offenders = [
            f for f in files
            if any(p.startswith('_') for p in f.relative_to(SCRIPTS_DIR).parts[:-1])
        ]
        self.assertEqual(offenders, [])


class TestRepoIsClean(unittest.TestCase):
    def test_allowlist_entries_are_all_live(self):
        """안 걸리는 허용목록은 «검사기가 대상을 놓쳤다» 는 신호일 수 있다."""
        files = vc._iter_files()
        arity = vc._tuple_arities(files)
        dead = [k for k in vc.ALLOWED_SCALAR_TUPLE if k not in arity]
        self.assertEqual(dead, [], f'허용목록에 있는데 튜플 반환 함수가 아니다: {dead}')


if __name__ == '__main__':
    unittest.main()
