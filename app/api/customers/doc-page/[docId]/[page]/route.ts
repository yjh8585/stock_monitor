import { NextResponse } from 'next/server';

import { canAccessCustomers } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/get-current-user';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { confidentialDb } from '@/lib/supabase/confidential';

interface RouteContext {
  params: Promise<{ docId: string; page: string }>;
}

const BUCKET = 'customer-doc-pages';

function forbidden() {
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

/** DB 행의 pages(JSONB)에서 그 쪽의 Storage 키. 형태가 어긋나면 null(배열 아니면 버린다). */
function keyForPage(pages: unknown, page: number): string | null {
  if (!Array.isArray(pages)) return null;
  for (const p of pages) {
    if (p && typeof p === 'object' && (p as { page?: unknown }).page === page) {
      const key = (p as { key?: unknown }).key;
      return typeof key === 'string' && key ? key : null;
    }
  }
  return null;
}

/**
 * 고객사 공식 문서 요약의 근거 쪽 캡처(PNG) 스트리밍. 비공개 버킷이라 service_role(admin client)로 download.
 * 미로그인은 proxy.ts 가 먼저 /login 으로 보낸다 — 그러나 proxy 의 역할 분기는 /api/* 에 return true 라
 * 여기서 반드시 canAccessCustomers 를 다시 본다(세션 통과 ≠ 권한).
 * 🔴 Storage 키는 DB 행의 pages[].key 만 쓴다 — 요청 값으로 경로를 조립하지 않는다.
 */
export async function GET(_req: Request, { params }: RouteContext) {
  const user = await getCurrentUser();
  if (!user || !canAccessCustomers(user.role)) {
    return forbidden();
  }

  const { docId, page } = await params;
  if (!/^[1-9]\d{0,9}$/.test(docId) || !/^[1-9]\d{0,2}$/.test(page)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const { data: row, error } = await confidentialDb
    .from('customer_doc_summaries')
    .select('pages,status')
    .eq('doc_id', Number(docId))
    .maybeSingle();
  const key = row && row.status === 'ok' ? keyForPage(row.pages, Number(page)) : null;
  if (error || !key) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(key);
  if (dlErr || !blob) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // 사외비 — 브라우저 디스크 캐시 금지. 매 조회마다 서버 권한 게이트를 다시 거치게 한다.
      'Cache-Control': 'private, no-store',
    },
  });
}
