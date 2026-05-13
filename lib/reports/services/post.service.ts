import logger from '@/lib/logger';
import type { CreatePostInput } from '@/lib/reports/dto/post.dto';
import { PostRepository } from '@/lib/reports/repositories/post.repository';
import type { PostInsert, PostRow } from '@/lib/reports/types';

import { analyzeReportPdf } from './report-pdf.service';
import { analyzeReportWebpage } from './report-web.service';
import { analyzeYoutubeVideo } from './youtube.service';

const TEMP_TITLE = '⏳ 본문 생성 중…';

/**
 * 게시글 라이프사이클을 관리하는 서비스.
 *  1) processing 상태로 즉시 INSERT
 *  2) 백그라운드 분석 후 UPDATE
 *  3) 실패 시 status=failed
 */
export class PostService {
  constructor(private readonly repo: PostRepository = new PostRepository()) {}

  async list(page: number, pageSize: number) {
    return this.repo.list(page, pageSize);
  }

  async findById(id: number) {
    return this.repo.findById(id);
  }

  /**
   * 메타정보만 INSERT 하고 즉시 반환. 본문은 백그라운드에서 채운다.
   */
  async createInitial(input: CreatePostInput): Promise<PostRow> {
    const insert: PostInsert = buildInitialInsert(input);
    const row = await this.repo.create(insert);
    logger.info({ id: row.id, kind: input.kind }, '게시글 초기 생성');
    return row;
  }

  /**
   * 백그라운드에서 호출. 분석 실패 시 status=failed 로 마킹.
   */
  async runBackground(id: number, input: CreatePostInput): Promise<void> {
    try {
      switch (input.kind) {
        case 'youtube':
          await this.processYoutube(id, input.source_url);
          break;
        case 'report-web':
          await this.processReportWeb(id, input.source_url);
          break;
        case 'report-file':
          await this.processReportFile(id, input.file_path);
          break;
      }
    } catch (err) {
      logger.error({ err, id }, '게시글 백그라운드 처리 실패');
      const message = err instanceof Error ? err.message : String(err);
      await this.repo.update(id, {
        status: 'failed',
        error_message: message.slice(0, 500),
      });
    }
  }

  private async processYoutube(id: number, sourceUrl: string) {
    const result = await analyzeYoutubeVideo(sourceUrl);
    await this.repo.update(id, {
      title: result.title,
      source_name: result.channelName,
      source_published_at: result.publishedAt,
      thumbnail_url: result.thumbnailUrl,
      content: result.content,
      key_scenes: result.keyScenes,
      status: 'completed',
    });
    logger.info({ id }, '유튜브 게시글 처리 완료');
  }

  private async processReportWeb(id: number, sourceUrl: string) {
    const result = await analyzeReportWebpage(sourceUrl);
    await this.repo.update(id, {
      title: result.title,
      source_name: result.organizationName,
      source_published_at: result.publishedAt,
      content: result.content,
      status: 'completed',
    });
    logger.info({ id }, '보고서 웹 게시글 처리 완료');
  }

  private async processReportFile(id: number, filePath: string) {
    const result = await analyzeReportPdf(filePath);
    await this.repo.update(id, {
      title: result.title,
      source_name: result.organizationName,
      source_published_at: result.publishedAt,
      content: result.content,
      status: 'completed',
    });
    logger.info({ id }, '보고서 PDF 게시글 처리 완료');
  }

  async delete(id: number) {
    return this.repo.delete(id);
  }
}

function buildInitialInsert(input: CreatePostInput): PostInsert {
  const base = {
    title: TEMP_TITLE,
    status: 'processing' as const,
    source_name: null,
    source_url: null,
    file_path: null,
    file_name: null,
    thumbnail_url: null,
    content: null,
    key_scenes: null,
    error_message: null,
    source_published_at: null,
  };

  switch (input.kind) {
    case 'youtube':
      return { ...base, source_type: 'youtube', source_url: input.source_url };
    case 'report-web':
      return { ...base, source_type: 'report', source_url: input.source_url };
    case 'report-file':
      return {
        ...base,
        source_type: 'report',
        file_path: input.file_path,
        file_name: input.file_name,
      };
  }
}
