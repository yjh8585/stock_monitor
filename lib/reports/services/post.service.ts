import logger from '@/lib/logger';
import { CLAUDE_SUMMARY_MODEL, getAnthropicClient } from '@/lib/reports/anthropic';
import type { CreatePostInput } from '@/lib/reports/dto/post.dto';
import { PostRepository } from '@/lib/reports/repositories/post.repository';
import type { PostInsert, PostRow } from '@/lib/reports/types';

import { analyzeReportPdf } from './report-pdf.service';
import { analyzeReportWebpage } from './report-web.service';
import { analyzeYoutubeVideo } from './youtube.service';

const TEMP_TITLE = '⏳ 본문 생성 중…';

const CATEGORY_LIST = ['로봇', '기술', '부품사', '전기차', '자율주행', '시장', 'OEM'];

const GITHUB_OWNER = 'yjh8585';
const GITHUB_REPO = 'stock_monitor';
const YT_REPORT_WORKFLOW = 'collect-yt-report.yml';

/**
 * 유튜브 보고서 이미지 보강을 GitHub Actions로 트리거(collect-yt-report.yml).
 *
 * Vercel 서버리스는 yt-dlp/ffmpeg를 못 돌려 프레임 캡처가 불가 → 캡처를 GHA로 위임한다.
 * caller가 텍스트 글을 먼저 완성한 뒤 호출한다. GHA가 유튜브 접근에 성공하면 주요장면·차트를
 * 캡처해 이미지 버전으로 덮어쓴다(collect_yt_report.py --enrich). dispatch·GHA 실패해도
 * 이미 완성된 텍스트 글이 그대로 유지된다(베스트에포트, failed로 downgrade 안 함).
 */
async function triggerYoutubeReportWorkflow(
  postId: number,
  sourceUrl: string
): Promise<{ ok: boolean; error?: string }> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return { ok: false, error: 'GITHUB_PAT 환경변수 미설정' };
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${YT_REPORT_WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          ref: 'master',
          inputs: { post_id: String(postId), source_url: sourceUrl },
        }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 제목 기반으로 카테고리를 Claude로 분류. 실패 시 null 반환. */
async function classifyCategory(title: string): Promise<string | null> {
  try {
    const client = getAnthropicClient();
    const r = await client.messages.create({
      model: CLAUDE_SUMMARY_MODEL,
      max_tokens: 30,
      messages: [
        {
          role: 'user',
          content: `제목: "${title}"\n\n위 제목을 다음 중 하나로 분류: ${CATEGORY_LIST.join(', ')}.\n카테고리 이름만 반환 (없으면 적합한 한 단어).`,
        },
      ],
    });
    const text = r.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * 게시글 라이프사이클을 관리하는 서비스. 단순 CRUD는 caller가 PostRepository를 직접 호출한다.
 *  1) processing 상태로 즉시 INSERT
 *  2) 백그라운드 분석 후 UPDATE
 *  3) 실패 시 status=failed
 */
export class PostService {
  constructor(private readonly repo: PostRepository = new PostRepository()) {}

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
    // 1) 텍스트 먼저 완성 — 항상 Gemini로 본문을 만들어 글을 completed로 확정한다.
    //    봇 차단·GHA 실패와 무관하게 글은 안정적으로 완성된다(이미지 보강은 그 위에 베스트에포트).
    const result = await analyzeYoutubeVideo(sourceUrl);
    const category = await classifyCategory(result.title);
    await this.repo.update(id, {
      title: result.title,
      source_name: result.channelName,
      source_published_at: result.publishedAt,
      thumbnail_url: result.thumbnailUrl,
      content: result.content,
      key_scenes: result.keyScenes,
      category,
      status: 'completed',
    });
    logger.info({ id }, '유튜브 게시글 텍스트 처리 완료');

    // 2) 이미지 보강 — 기본 활성(끄려면 Vercel env `YT_AUTO_REPORT=0`). GHA가 유튜브에 접근
    //    가능하면(로컬/쿠키 등) 주요 장면·차트를 캡처해 이미지 버전으로 덮어쓴다(collect_yt_report.py
    //    --enrich). 봇 차단 등으로 실패하면 위 텍스트 글이 그대로 유지된다 — 실패로 downgrade되지 않는다.
    //    ⚠️ GHA 러너 IP는 유튜브 봇 차단이 잦아, 이미지는 GitHub Secret `YOUTUBE_COOKIES` 없이는
    //    대개 붙지 않는다(그 경우 텍스트로 graceful 유지).
    if (process.env.YT_AUTO_REPORT !== '0') {
      const dispatched = await triggerYoutubeReportWorkflow(id, sourceUrl);
      if (dispatched.ok) logger.info({ id }, '유튜브 이미지 보강 GHA 트리거');
      else
        logger.warn({ id, error: dispatched.error }, 'GHA 이미지 보강 트리거 실패(텍스트 글 유지)');
    }
  }

  private async processReportWeb(id: number, sourceUrl: string) {
    const result = await analyzeReportWebpage(sourceUrl);
    await this.repo.update(id, {
      title: result.title,
      source_name: result.organizationName,
      source_published_at: result.publishedAt,
      content: result.content,
      category: result.category,
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
      category: result.category,
      status: 'completed',
    });
    logger.info({ id }, '보고서 PDF 게시글 처리 완료');
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
