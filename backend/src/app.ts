import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { env, isProduction } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { apiRouter } from './routes/index.js';
import { AppError } from './utils/AppError.js';

/** Rede privada (RFC 1918) e loopback: aceitos só em desenvolvimento, para abrir pelo IP. */
const REDE_PRIVADA =
  /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

function origemPermitida(origin: string): boolean {
  if (env.CORS_ORIGINS.includes(origin)) return true;

  // Em produção, só a allowlist: faixa privada lá seria confiar em toda a rede do datacenter.
  return !isProduction && REDE_PRIVADA.test(origin);
}

export function createApp(): Express {
  const app = express();

  // Só confie em X-Forwarded-* com proxy reverso configurado; senão o IP do rate limit é forjável.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');

  // CORS só barra a LEITURA; isto impede origem não autorizada de executar escrita.
  app.use((req, _res, next) => {
    const origin = req.get('origin');
    const alteraEstado = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

    if (alteraEstado && origin && !origemPermitida(origin)) {
      next(AppError.forbidden('Origem da requisição não permitida.'));
      return;
    }

    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (origemPermitida(origin)) {
          callback(null, true);
          return;
        }

        // `false`, não erro: erro daria 403 até em mesma origem (o proxy do Vite repassa `Origin`).
        logger.warn({ origin }, 'Origem fora da allowlist — cabeçalhos CORS omitidos');
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    }),
  );

  // Em produção, origem desconhecida não executa requisição que muda estado (o `cors` só omite cabeçalhos).
  if (isProduction) {
    app.use((req, _res, next) => {
      const origem = req.get('origin');
      const mudaEstado = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

      if (mudaEstado && origem && !origemPermitida(origem)) {
        logger.warn({ origem, metodo: req.method, caminho: req.path }, 'Origem recusada');
        next(AppError.forbidden('Origem não autorizada.'));
        return;
      }

      next();
    });
  }

  // Teto baixo de propósito; as rotas de importação têm o seu.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(compression());

  app.use(
    pinoHttp({
      logger,
      customLogLevel(_req, res, err) {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(AppError.tooManyRequests()),
    }),
  );

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
