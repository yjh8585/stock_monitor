import { z } from 'zod';

/** 게시글 작성 요청 DTO. kind 별로 입력 필드가 달라진다. */
export const youtubeUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => /(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(url),
    '유효한 유튜브 URL이 아닙니다.'
  );

const youtubeInput = z.object({
  kind: z.literal('youtube'),
  source_url: youtubeUrlSchema,
});

const reportWebInput = z.object({
  kind: z.literal('report-web'),
  source_url: z.string().url(),
});

const reportFileInput = z.object({
  kind: z.literal('report-file'),
  /** Supabase Storage 에 사전 업로드된 객체 경로 */
  file_path: z.string().min(1),
  file_name: z.string().min(1),
});

export const createPostInputSchema = z.discriminatedUnion('kind', [
  youtubeInput,
  reportWebInput,
  reportFileInput,
]);

export type CreatePostInput = z.infer<typeof createPostInputSchema>;
export type YoutubeInput = z.infer<typeof youtubeInput>;
export type ReportWebInput = z.infer<typeof reportWebInput>;
export type ReportFileInput = z.infer<typeof reportFileInput>;

export const postListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type PostListQuery = z.infer<typeof postListQuerySchema>;
