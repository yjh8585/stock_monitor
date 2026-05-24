/**
 * posts 테이블 타입. supabase/migrations/20260514000001_create_posts.sql 과 동기화.
 */

export type PostSourceType = 'youtube' | 'report';
export type PostStatus = 'processing' | 'completed' | 'failed';

export interface KeyScene {
  timestampSec: number;
  timestampLabel: string;
  description: string;
  imageUrl?: string;
}

export interface PostRow {
  id: number;
  source_type: PostSourceType;
  title: string;
  source_name: string | null;
  source_url: string | null;
  file_path: string | null;
  file_name: string | null;
  thumbnail_url: string | null;
  content: string | null;
  key_scenes: KeyScene[] | null;
  status: PostStatus;
  error_message: string | null;
  source_published_at: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * 보고서 목록 페이지 전용 행 — `content`(본문 markdown/html)와 `key_scenes`를 제외해
 * RSC payload + Supabase 응답 크기를 축소한다. 상세 페이지(`PostRow`)와 다르게
 * 본문이 필요 없는 list/카드 컴포넌트에서만 사용.
 */
export type PostListRow = Omit<PostRow, 'content' | 'key_scenes'>;

export interface PostInsert {
  id?: number;
  source_type: PostSourceType;
  title: string;
  source_name?: string | null;
  source_url?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  thumbnail_url?: string | null;
  content?: string | null;
  key_scenes?: KeyScene[] | null;
  status?: PostStatus;
  error_message?: string | null;
  source_published_at?: string | null;
  category?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PostUpdate {
  source_type?: PostSourceType;
  title?: string;
  source_name?: string | null;
  source_url?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  thumbnail_url?: string | null;
  content?: string | null;
  key_scenes?: KeyScene[] | null;
  status?: PostStatus;
  error_message?: string | null;
  source_published_at?: string | null;
  category?: string | null;
  updated_at?: string;
}
