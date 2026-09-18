import pino from 'pino';

import { env, isDevelopment, isProduction } from './env.js';

/** Campos que jamais podem aparecer no log (inclui os tokens de sessão). */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'senha',
  'Senha',
  '*.password',
  '*.senha',
  '*.Senha',
  'accessToken',
  'refreshToken',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDIGIDO]',
  },
  base: { env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,env' },
        },
      }
    : {}),
  ...(isProduction ? { formatters: { level: (label: string) => ({ level: label }) } } : {}),
});

export type Logger = typeof logger;
