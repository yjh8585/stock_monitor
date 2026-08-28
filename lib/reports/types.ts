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
  /** 사외비 여부. true 면 RLS 가 anon 읽기를 차단해 service_role 경로로만 조회된다. */
  is_confidential: boolean;
  /** 원본 HTML 보고서의 reports-html(비공개) 버킷 객체 키. NULL 이면 첨부 없음. */
  html_path: string | null;
  /** 첨부 동영상의 reports-video(비공개) 버킷 객체 키. NULL 이면 첨부 없음. */
  video_path: string | null;
}

/**
 * 보고서 목록 페이지 전용 행 — `content`(본문 markdown/html)와 `key_scenes`를 제외해
 * RSC payload + Supabase 응답 크기를 축소한다. 상세 페이지(`PostRow`)와 다르게
 * 본문이 필요 없는 list/카드 컴포넌트에서만 사용.
 *
 * `html_path`·`video_path` 도 제외한다 — `list()` 의 select 상수(`POST_LIST_COLUMNS`)에
 * 없어서 런타임에 오지 않기 때문이다. `list()` 가 `as PostListRow[]` 캐스트라 여기서 빼 두지
 * 않으면 "값이 있다"는 타입 거짓말이 컴파일 에러 없이 통과한다.
 * 목록에 HTML·영상 배지를 달게 되면 이 줄에서 빼고 `POST_LIST_COLUMNS` 에 함께 추가할 것.
 */
export type PostListRow = Omit<PostRow, 'content' | 'key_scenes' | 'html_path' | 'video_path'>;

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
  is_confidential?: boolean;
  html_path?: string | null;
  video_path?: string | null;
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
  is_confidential?: boolean;
  html_path?: string | null;
  video_path?: string | null;
}
