"""sync_oem_china_excel 의 순서·안전 장치 시험 — 네트워크·DB 없음(load 와 session 을 가짜로 바꾼다)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sync_oem_china_excel as sync  # noqa: E402
from lib.china_excel import ParseResult  # noqa: E402

ROWS = [{'vehicle_type': 'SUV', 'segment': 'SUV-C', 'year_month': 202601, 'production': 5}]


def _files(tmp_path, old=b'old', new=b'new'):
  tmp, target = tmp_path / 'dl.xlsx', tmp_path / 'local.xlsx'
  tmp.write_bytes(new)
  target.write_bytes(old)
  return tmp, target


@pytest.fixture
def no_load(monkeypatch):
  calls = []
  monkeypatch.setattr(sync.imp, 'load', lambda *a, **k: calls.append(a))
  return calls


def test_적재_실패면_로컬_파일을_그대로_둬_다음_회차가_다시_적재한다(tmp_path, monkeypatch):
  tmp, target = _files(tmp_path)

  def boom(*a, **k):
    raise RuntimeError('DB 끊김')

  monkeypatch.setattr(sync.imp, 'load', boom)
  with pytest.raises(sync.SyncError) as e:
    sync.sync_one('nev', tmp, target, lambda p: (ParseResult(ROWS), [2026]), dry_run=False)
  assert e.value.code == 5
  assert target.read_bytes() == b'old'  # 먼저 바꿨다면 다음 회차가 「변경 없음」으로 건너뛴다
  assert not tmp.exists()


def test_적재가_끝나야_파일을_바꾼다(tmp_path, no_load):
  tmp, target = _files(tmp_path)
  sync.sync_one('nev', tmp, target, lambda p: (ParseResult(ROWS), [2026]), dry_run=False)
  assert len(no_load) == 1 and target.read_bytes() == b'new'


def test_최신_연도_시트가_너무_오래되면_멈춘다(tmp_path, no_load):
  tmp, target = _files(tmp_path)
  with pytest.raises(sync.SyncError) as e:
    sync.sync_one('export', tmp, target, lambda p: (ParseResult(ROWS), [2018, 2019]), dry_run=False)
  assert e.value.code == 4 and no_load == []


def test_승용차는_바이트가_달라도_읽은_행이_같으면_건너뛴다(tmp_path, no_load):
  tmp, target = _files(tmp_path)  # 받을 때마다 zip 안 시각이 바뀌어 바이트가 다르다
  assert sync.sync_one('passenger', tmp, target, lambda p: (ParseResult(list(ROWS)), [2026]), dry_run=False) is None
  assert no_load == [] and target.read_bytes() == b'old'


def test_승용차도_행이_다르면_적재한다(tmp_path, no_load):
  tmp, target = _files(tmp_path)

  def parse(p):
    return ParseResult([{**ROWS[0], 'production': 9 if p == tmp else 5}]), [2026]

  sync.sync_one('passenger', tmp, target, parse, dry_run=False)
  assert len(no_load) == 1


def test_지울_행이_너무_많으면_upsert_도_하지_않는다(monkeypatch):
  # upsert 를 먼저 하면 멈추기 전에 새 키가 들어가 옛 키와 이중으로 세진다(검토 지적 2026-10-30)
  monkeypatch.setattr(sync.imp, '_fetch_keys', lambda *a: {('SUV', f'S{i}', 202601) for i in range(100)})
  upserted = []
  monkeypatch.setattr(sync.imp, 'upsert_rows', lambda *a, **k: upserted.append(a))
  with pytest.raises(RuntimeError, match='oem_china_segment_month'):
    sync.imp.load('passenger', ParseResult(ROWS), [2026], dry_run=False)
  assert upserted == []


class _Resp:
  def __init__(self, status, location=None, text=''):
    self.status_code = status
    self.headers = {'Location': location} if location else {}
    self.text = text


class _Session:
  def __init__(self, responses):
    self.responses = responses
    self.urls = []

  def get(self, url, timeout, allow_redirects):
    assert allow_redirects is False  # 자동 리다이렉트는 쿠키 헤더를 떨군다
    self.urls.append(url)
    return self.responses.pop(0)


def test_리다이렉트는_MarkLines_안에서만_손으로_따라간다():
  s = _Session([_Resp(303, '/statics/x.xlsx'), _Resp(200)])
  r, url = sync._get(s, f'{sync.BASE}/en/a')
  assert r.status_code == 200 and url == f'{sync.BASE}/statics/x.xlsx'

  s = _Session([_Resp(302, 'https://cdn.example.com/x.xlsx'), _Resp(200)])
  with pytest.raises(sync.SyncError) as e:
    sync._get(s, f'{sync.BASE}/en/a')
  assert e.value.code == 3 and s.urls == [f'{sync.BASE}/en/a']  # 쿠키를 들고 밖으로 나가지 않았다


def test_비회원_화면도_쿠키_만료로_본다():
  s = _Session([_Resp(200, text='<form id="login_form">')])
  with pytest.raises(sync.SyncError) as e:
    sync.fetch_page(s, f'{sync.BASE}/en/statistics/product/china_export')
  assert e.value.code == 1
