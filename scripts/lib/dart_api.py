"""DART OpenAPI 공용 — list.json 페이지 넘김 · document.xml 본문 글. 웹 뷰어(dart.fss.or.kr)는 쓰지 않는다.

키(DART_API_KEY)는 요청 인자에만 — 예외·로그 문자열에 URL 을 그대로 넣지 않는다(쿼리에 키가 있다).
본보기 = scripts/dart_eval/scan_all.py:73 fetch_list.
"""
import io
import os
import time
import zipfile

import requests

from lib.doc_text import xml_to_text
from lib.retry import with_retry

LIST_URL = 'https://opendart.fss.or.kr/api/list.json'
DOC_URL = 'https://opendart.fss.or.kr/api/document.xml'
GAP_S = 0.25


def _key() -> str:
  return os.environ['DART_API_KEY']


def _get(session: requests.Session, url: str, params: dict, timeout: int, label: str) -> requests.Response:
  """키가 예외 문장에 새지 않는 GET.

  requests 의 `raise_for_status()`·연결 오류 문장은 쿼리까지 붙은 URL 을 싣는다(= crtfc_key 노출).
  같은 예외 «종류»로 문장만 바꿔 올려 `with_retry` 의 일시 오류 판정(상태 코드·예외 종류)은 그대로 둔다.
  """
  try:
    r = session.get(url, params=params, timeout=timeout)
  except requests.RequestException as e:
    raise type(e)(f'{label}: {type(e).__name__}') from None
  if r.status_code >= 400:
    raise requests.HTTPError(f'{label}: HTTP {r.status_code}', response=r)
  return r


def list_disclosures(session: requests.Session, corp_code: str, bgn_de: str, end_de: str, detail_ty: str) -> list[dict]:
  """bgn_de·end_de = YYYYMMDD. status 013(조회 결과 없음)은 빈 목록. 그 밖의 비정상 status 는 RuntimeError(키 없는 문장)."""
  out, page = [], 1
  while True:
    label = f'dart list {corp_code} {detail_ty} p{page}'

    def _once():
      return _get(session, LIST_URL, {'crtfc_key': _key(), 'corp_code': corp_code, 'bgn_de': bgn_de,
                                      'end_de': end_de, 'pblntf_detail_ty': detail_ty, 'page_no': page,
                                      'page_count': 100}, 30, label).json()
    j = with_retry(_once, _label=label)
    status = j.get('status')
    if status == '013':
      return out
    if status != '000':
      raise RuntimeError(f'DART list status={status} corp={corp_code} ty={detail_ty}')
    out += j.get('list', [])
    if page >= int(j.get('total_page', 1)):
      return out
    page += 1
    time.sleep(GAP_S)


def document_text(session: requests.Session, rcept_no: str) -> str:
  """document.xml(zip) 안의 xml 전부를 글로 이어 붙인다."""
  label = f'dart document {rcept_no}'

  def _once():
    return _get(session, DOC_URL, {'crtfc_key': _key(), 'rcept_no': rcept_no}, 60, label).content
  raw = with_retry(_once, _label=label)
  time.sleep(GAP_S)
  with zipfile.ZipFile(io.BytesIO(raw)) as z:
    return '\n'.join(xml_to_text(z.read(n).decode('utf-8', errors='replace')) for n in sorted(z.namelist()))
