"""회사별 규칙 파서 등록부. 새 회사 = 모듈 하나 + 아래 목록 한 줄.

Task 6 시점엔 회사별 모듈이 없어 빈 튜플이다 — Task 7~10 이 한 줄씩 더한다
('kr_dart', 'gm', 'rivian', 'polaris', 'vinfast', 'stellantis', 'vw', 'porsche').
등록부에 없는 회사의 문서는 오케스트레이터가 pending 그대로 둔다(나중에 파서가 생기면 그때 읽는다).
"""
import importlib

MODULE_NAMES: tuple[str, ...] = (
  'kr_dart',
  'gm',
  'rivian',
  'polaris',
)


def modules():
  return [importlib.import_module(f'customer_parsers.{n}') for n in MODULE_NAMES]


def module_for(ticker: str):
  return next((m for m in modules() if ticker in m.TICKERS), None)


def parser_tickers() -> set[str]:
  return {t for m in modules() for t in m.TICKERS}
