import { describe, expect, it } from 'vitest';
import { fetchAllPages, SUPABASE_PAGE_SIZE } from '../fetchAllPages';

/** PostgREST 처럼 요청 범위를 1,000행 상한으로 잘라 돌려주는 가짜 표. */
function fakeTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + SUPABASE_PAGE_SIZE);
    return { data: rows.slice(from, end), error: null };
  };
  return { page, calls };
}

describe('fetchAllPages', () => {
  it('1,000행을 넘는 표를 끝까지 읽는다(단건 조회면 1,000에서 잘리던 것)', async () => {
    const t = fakeTable(2_345);
    const out = await fetchAllPages('t', t.page);
    expect(out).toHaveLength(2_345);
    expect(out.at(-1)).toEqual({ id: 2_344 });
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('정확히 1,000행이면 빈 다음 쪽을 한 번 더 확인하고 멈춘다', async () => {
    const t = fakeTable(1_000);
    expect(await fetchAllPages('t', t.page)).toHaveLength(1_000);
    expect(t.calls).toHaveLength(2);
  });

  it('조회 오류는 빈 배열로 삼키지 않고 던진다', async () => {
    const page = async () => ({ data: null, error: { message: 'boom' } });
    await expect(fetchAllPages('pnl_plan', page)).rejects.toThrow('pnl_plan 조회 실패: boom');
  });
});
