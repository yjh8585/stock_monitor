"""캐시 태그 검사기 자신을 시험한다.

🔴 이 레포에서 「위반 0건」이 **대상에서 빠진 것**이었던 사고가 반복됐다(훅 검사기가
「활성 11개」로 멀쩡히 보고하던 것 · 검사기 초판이 역방향 구멍을 통과시키던 것).
그래서 판정 로직(`evaluate`)에 **위반을 심어 실제로 잡히는지** 고정한다.
"""
import verify_revalidate_tags as vrt

NO_EXEMPT: frozenset[str] = frozenset()


def _ev(ts, allt, py, exempt=NO_EXEMPT):
  return vrt.evaluate(set(ts), set(allt), set(py), exempt)


def test_전부_일치하면_위반이_없다():
  found = _ev(['a', 'b'], ['a', 'b'], ['a', 'b'])
  assert all(not v for v in found.values()), found


def test_ALL_TAGS_누락을_잡는다():
  # cacheTag 는 있는데 ALL_TAGS 에 없다 → tag=all 로 안 풀린다
  found = _ev(['a', 'b'], ['a'], ['a', 'b'])
  assert found['missing_in_all'] == ['b']


def test_존재하지_않는_태그를_수집기가_부르면_잡는다():
  found = _ev(['a'], ['a'], ['a', 'ghost'])
  assert found['unknown_in_py'] == ['ghost']


def test_역방향_원천_매핑_누락을_잡는다():
  """2026-09-08 실제 사고의 재현 — 태그는 있는데 그걸 부르는 수집 경로가 없다.

  `oem-hyundai-retail` 은 TS 에도 ALL_TAGS 에도 있었지만 `COLUMN_TO_TAGS` 에
  `hyundai_retail_sales` 키 자체가 없어, 수집이 성공해도 화면이 영원히 낡았다.
  ①②만 보던 초판은 이걸 **통과**시켰다.
  """
  ts = ['oem-hyundai-sales', 'oem-hyundai-retail']
  allt = ['oem-hyundai-sales', 'oem-hyundai-retail']
  py = ['oem-hyundai-sales']  # retail 을 부르는 매핑이 없다
  found = _ev(ts, allt, py)

  assert found['no_collector'] == ['oem-hyundai-retail']
  # 🔴 초판이 보던 두 검사는 여전히 깨끗하다 — 그래서 ③ 이 필요했다
  assert found['missing_in_all'] == []
  assert found['unknown_in_py'] == []


def test_면제_목록에_있으면_역방향에서_빠진다():
  found = _ev(['a', 'seeded'], ['a', 'seeded'], ['a'], frozenset({'seeded'}))
  assert found['no_collector'] == []


def test_면제가_과잉으로_다른_태그까지_풀어_주지_않는다():
  # 면제는 적힌 그 태그에만 걸린다 — 이웃 태그가 함께 통과하면 안 된다
  found = _ev(['seeded', 'other'], ['seeded', 'other'], [], frozenset({'seeded'}))
  assert found['no_collector'] == ['other']


def test_낡은_면제를_경고한다():
  # 면제로 적어 뒀는데 실제로는 매핑이 생겼다 → 예외를 지워야 한다
  found = _ev(['seeded'], ['seeded'], ['seeded'], frozenset({'seeded'}))
  assert found['stale_exempt'] == ['seeded']
  assert found['no_collector'] == []


def test_실제_예외_목록은_최소한으로_유지된다():
  """면제가 늘어나면 검사기가 조용히 무력해진다 — 늘릴 땐 이 테스트를 같이 고칠 것."""
  assert vrt.TAGS_WITHOUT_COLLECTOR == frozenset({'oem_model_brand'})


def test_실패키와_메시지가_짝을_이룬다():
  # 키를 늘리고 메시지를 빠뜨리면 KeyError 로 검사기가 죽는다
  for key in vrt.FAIL_KEYS:
    assert key in vrt.MESSAGES
  sample = vrt.evaluate(set(), set(), set())
  for key in sample:
    assert key in vrt.MESSAGES, key
