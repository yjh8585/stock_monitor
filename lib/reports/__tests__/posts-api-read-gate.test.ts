/**
 * 게시글 API(`GET /api/posts/[id]` · `GET /api/posts`)도 상세 화면·첨부 프록시와 같은 열람 판정(`canReadPost`)을 탄다.
 *
 * 2026-11-20 코드 리뷰 「낮음·참고」: 두 API 가 권한을 안 봤다. 사외비 행은 anon RLS 가 걸러 주지만
 * 경영표준(카테고리 판정)은 RLS 밖이라, 사외비 표시가 빠진 경영표준 글이 생기면 mobility·guest 에게 열렸다.
 * 시험이 라우트를 직접 불러 배선을 본다(판정 자체는 `lib/auth/permissions.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MGMT_STANDARD_CATEGORY } from '@/lib/reports/mgmtStandard';

const user = vi.hoisted(() => ({ current: null as null | { role: string } }));
const repo = vi.hoisted(() => ({ findById: vi.fn(), list: vi.fn() }));

vi.mock('@/lib/auth/get-current-user', () => ({ getCurrentUser: async () => user.current }));
vi.mock('@/lib/reports/repositories/post.repository', () => ({
  PostRepository: class {
    findById = repo.findById;
    list = repo.list;
  },
}));
vi.mock('@/lib/reports/services/post.service', () => ({ PostService: class {} }));

const { GET: getOne } = await import('@/app/api/posts/[id]/route');
const { GET: getList } = await import('@/app/api/posts/route');

const one = (id: string) =>
  getOne(new Request(`http://x/api/posts/${id}`), { params: Promise.resolve({ id }) });

describe('GET /api/posts/[id] 열람 판정', () => {
  beforeEach(() => {
    repo.findById.mockReset();
    repo.findById.mockResolvedValue({
      id: 1,
      is_confidential: false,
      category: MGMT_STANDARD_CATEGORY,
    });
  });

  it('경영표준 글은 mobility 에게 404(존재 자체를 숨긴다)', async () => {
    user.current = { role: 'mobility' };
    expect((await one('1')).status).toBe(404);
  });

  it('경영표준 글은 admin 에게 200', async () => {
    user.current = { role: 'admin' };
    expect((await one('1')).status).toBe(200);
  });

  it('세션이 없으면 401', async () => {
    user.current = null;
    expect((await one('1')).status).toBe(401);
  });
});

describe('GET /api/posts 목록', () => {
  beforeEach(() => {
    repo.list.mockReset();
    repo.list.mockResolvedValue({ rows: [], total: 0 });
  });

  it('경영표준 열람 권한이 없으면 그 카테고리를 뺀다', async () => {
    user.current = { role: 'mobility' };
    expect((await getList(new Request('http://x/api/posts'))).status).toBe(200);
    expect(repo.list.mock.calls[0][2]).toEqual({ excludeCategories: [MGMT_STANDARD_CATEGORY] });
  });

  it('권한이 있으면 빼지 않는다', async () => {
    user.current = { role: 'holdings' };
    await getList(new Request('http://x/api/posts'));
    expect(repo.list.mock.calls[0][2]).toEqual({ excludeCategories: [] });
  });
});
