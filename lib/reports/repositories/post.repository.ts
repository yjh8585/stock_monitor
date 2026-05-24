import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseAnonClient } from '@/lib/supabase/anon';
import type {
  PostInsert,
  PostListRow,
  PostRow,
  PostSourceType,
  PostUpdate,
} from '@/lib/reports/types';

const POSTS_TABLE = 'posts';

/**
 * 목록 페이지 전용 select 컬럼 — `content`(본문)와 `key_scenes`를 제외해 payload 축소.
 * 상세 fetch(`findById`)는 select('*') 그대로 사용.
 */
const POST_LIST_COLUMNS =
  'id,source_type,title,source_name,source_url,file_path,file_name,thumbnail_url,status,error_message,source_published_at,category,created_at,updated_at';

/**
 * posts 테이블 접근 레이어. 쓰기는 service role, 읽기는 anon 키로 분리한다.
 * 클라이언트는 lazy 로 초기화 — 환경 변수가 빠져 있어도 사용하는 메서드만 호출하면 동작.
 */
export class PostRepository {
  private _read?: SupabaseClient;
  private _write?: SupabaseClient;

  constructor(read?: SupabaseClient, write?: SupabaseClient) {
    this._read = read;
    this._write = write;
  }

  private get read(): SupabaseClient {
    if (!this._read) this._read = createSupabaseAnonClient() as unknown as SupabaseClient;
    return this._read;
  }

  private get write(): SupabaseClient {
    if (!this._write) this._write = createSupabaseAdminClient() as unknown as SupabaseClient;
    return this._write;
  }

  async list(
    page: number,
    pageSize: number,
    options?: {
      sort?: 'created_at' | 'source_published_at';
      order?: 'asc' | 'desc';
      sourceType?: PostSourceType;
      category?: string;
      sourceName?: string;
    }
  ): Promise<{ rows: PostListRow[]; total: number }> {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const sort = options?.sort ?? 'source_published_at';
    const order = options?.order ?? 'desc';
    const ascending = order === 'asc';

    let query = this.read.from(POSTS_TABLE).select(POST_LIST_COLUMNS, { count: 'exact' });

    if (options?.sourceType) query = query.eq('source_type', options.sourceType);
    if (options?.category) query = query.eq('category', options.category);
    if (options?.sourceName) query = query.eq('source_name', options.sourceName);

    if (sort === 'source_published_at') {
      // NULL 은 항상 마지막에 — 비어 있는 작성일 행이 상단을 차지하지 않도록.
      query = query
        .order('source_published_at', { ascending, nullsFirst: false })
        .order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending });
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;
    return { rows: (data ?? []) as PostListRow[], total: count ?? 0 };
  }

  /** 필터 드롭다운용 카테고리 목록 (NULL 제외, 가나다 정렬) */
  async getDistinctCategories(): Promise<string[]> {
    const { data, error } = await this.read
      .from(POSTS_TABLE)
      .select('category')
      .not('category', 'is', null)
      .order('category', { ascending: true });
    if (error) throw error;
    const set = new Set((data ?? []).map((r: { category: string | null }) => r.category as string));
    return [...set];
  }

  /** 필터 드롭다운용 출처 목록 (NULL 제외, 가나다 정렬) */
  async getDistinctSourceNames(): Promise<string[]> {
    const { data, error } = await this.read
      .from(POSTS_TABLE)
      .select('source_name')
      .not('source_name', 'is', null)
      .order('source_name', { ascending: true });
    if (error) throw error;
    const set = new Set(
      (data ?? []).map((r: { source_name: string | null }) => r.source_name as string)
    );
    return [...set];
  }

  async findById(id: number): Promise<PostRow | null> {
    const { data, error } = await this.read
      .from(POSTS_TABLE)
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return (data ?? null) as PostRow | null;
  }

  async create(input: PostInsert): Promise<PostRow> {
    const { data, error } = await this.write.from(POSTS_TABLE).insert(input).select('*').single();

    if (error) throw error;
    return data as PostRow;
  }

  async update(id: number, patch: PostUpdate): Promise<PostRow> {
    const { data, error } = await this.write
      .from(POSTS_TABLE)
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return data as PostRow;
  }

  async delete(id: number): Promise<void> {
    const { error } = await this.write.from(POSTS_TABLE).delete().eq('id', id);
    if (error) throw error;
  }
}
