import 'server-only';

const GITHUB_OWNER = 'yjh8585';
const GITHUB_REPO = 'stock_monitor';

export type DispatchResult = { ok: boolean; url?: string; error?: string };

/**
 * GitHub Actions workflow_dispatch 트리거 (fire-and-forget).
 *
 * @param workflow  워크플로 파일명 (예: 'sync-management.yml')
 * @param inputs    workflow_dispatch inputs
 * @returns ok=false 시 error 메시지. 호출부에서 graceful 처리.
 */
export async function dispatchWorkflow(
  workflow: string,
  inputs: Record<string, string>
): Promise<DispatchResult> {
  const pat = process.env.GITHUB_PAT;
  if (!pat) return { ok: false, error: 'GITHUB_PAT 환경변수 미설정' };
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref: 'master', inputs }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `GitHub API ${res.status}: ${text.slice(0, 200)}` };
    }
    return {
      ok: true,
      url: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflow}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
