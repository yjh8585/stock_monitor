import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

import { fail, ok } from '@/lib/reports/dto/api.dto';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const secret = req.headers.get('x-revalidate-secret') ?? req.nextUrl.searchParams.get('secret');
  const expected = process.env.NEXT_REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json(
      fail('CONFIG_MISSING', 'NEXT_REVALIDATE_SECRET 미설정 (.env.local 추가 필요)'),
      { status: 500 }
    );
  }
  if (secret !== expected) {
    return NextResponse.json(fail('UNAUTHORIZED', 'invalid secret'), { status: 401 });
  }

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    return NextResponse.json(fail('INVALID_ID', '유효하지 않은 ID 입니다.'), { status: 400 });
  }

  revalidateTag('posts', 'max');
  revalidateTag(`post:${numericId}`, 'max');
  return NextResponse.json(ok({ id: numericId, revalidated: true }));
}
