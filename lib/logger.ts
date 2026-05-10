// 서버 전용 모듈 — client component에서 잘못 import 시 즉시 실패시켜 번들 누수 방지.
if (typeof window !== 'undefined') {
  throw new Error('lib/logger.ts는 서버에서만 사용 가능합니다 (client에서 import 금지).');
}

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/** 애플리케이션 전역 로거 (서버 전용) */
const logger = pino({
  level: isDev ? 'debug' : 'info',
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
});

export default logger;
