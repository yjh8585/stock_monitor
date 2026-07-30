"""손익 엑셀 실(sil) 정규화 테스트 — 거래처별 고정 매핑 + PK 합산 병합.

UZ Auto 실적은 2실로 표현한다(사용자 지시 2026-07-30). sil이 upsert 충돌키에 포함되므로
엑셀이 옛 실(3실)로 남아 있으면 정정 없이는 2실/3실 양쪽에 행이 생겨 합계가 이중 계산된다.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sync_pnl_excel import (  # noqa: E402
  HEADERS_MONTHLY,
  merge_by_pk,
  normalize_sil,
  row_to_entry,
)


class TestNormalizeSil:
  def test_uz_auto_3sil_is_corrected_to_2sil(self):
    assert normalize_sil('UZ Auto', '3실') == '2실'

  def test_uz_auto_already_2sil_is_kept(self):
    assert normalize_sil('UZ Auto', '2실') == '2실'

  def test_uz_auto_blank_sil_is_filled(self):
    assert normalize_sil('UZ Auto', '') == '2실'

  def test_customer_case_and_padding_variants_match(self):
    assert normalize_sil('uz auto', '3실') == '2실'
    assert normalize_sil('  UZ AUTO  ', '3실') == '2실'

  def test_unmapped_customer_keeps_excel_value(self):
    assert normalize_sil('GMK', '3실') == '3실'
    assert normalize_sil('POLARIS', '2실') == '2실'
    assert normalize_sil('기타', '기타') == '기타'

  def test_similar_but_different_customer_is_untouched(self):
    """부분일치로 엉뚱한 거래처를 잡지 않는다(정확일치만)."""
    assert normalize_sil('UZ Auto Motors', '3실') == '3실'
    assert normalize_sil('UZAuto', '3실') == '3실'


def _monthly_row(sil: str, customer: str, revenue: float) -> tuple:
  """월 시트 형식(1-indexed 매핑)의 행 튜플 생성 — 지정 컬럼만 채운다."""
  row = [None] * 24
  def put(key: str, value):
    row[HEADERS_MONTHLY[key][0] - 1] = value
  put('year_label', 2026)
  put('period_month', 3)
  put('basis_label', '별도')
  put('sil', sil)
  put('division', '수출')
  put('factory', '아산')
  put('product', 'BODY')
  put('customer', customer)
  put('revenue', revenue)
  return tuple(row)


class TestRowToEntrySilCorrection:
  def test_excel_3sil_row_becomes_2sil_entry(self):
    e = row_to_entry(_monthly_row('3실', 'UZ Auto', 100.0), 'standalone', HEADERS_MONTHLY, 'monthly')
    assert e is not None
    assert e['sil'] == '2실'
    assert e['customer'] == 'UZ Auto'

  def test_other_customer_sil_untouched(self):
    e = row_to_entry(_monthly_row('3실', 'GMK', 100.0), 'standalone', HEADERS_MONTHLY, 'monthly')
    assert e is not None
    assert e['sil'] == '3실'


class TestMergeAfterCorrection:
  def test_2sil_and_3sil_rows_merge_into_one_after_correction(self):
    """엑셀에 2실·3실이 섞여 있어도 정정 후 같은 PK가 되어 합산 병합된다(행 중복 방지)."""
    rows = [
      _monthly_row('3실', 'UZ Auto', 100.0),
      _monthly_row('2실', 'UZ Auto', 40.0),
    ]
    entries = [row_to_entry(r, 'standalone', HEADERS_MONTHLY, 'monthly') for r in rows]
    merged = merge_by_pk([e for e in entries if e is not None])
    assert len(merged) == 1
    assert merged[0]['sil'] == '2실'
    assert merged[0]['revenue'] == 140.0
