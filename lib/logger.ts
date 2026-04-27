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
