/**
 * 보고서 페이지 전용 서버 환경 변수 접근 헬퍼.
 * 누락 시 즉시 예외를 던져 디버깅 시간을 단축한다.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경 변수 ${name} 가 설정되지 않았습니다.`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const serverEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  googleApiKey: () => required('GOOGLE_API_KEY'),
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  tavilyApiKey: () => optional('TAVILY_API_KEY'),
};
