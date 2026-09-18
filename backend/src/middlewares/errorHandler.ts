import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Rota não encontrada: ${req.method} ${req.originalUrl}`));
};

/** Só AppError e erro do Zod devolvem mensagem; o resto vira 500 genérico, detalhe só no log. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      campo: issue.path.join('.'),
      mensagem: issue.message,
    }));

    res.status(422).json({
      erro: { codigo: 'VALIDATION_ERROR', mensagem: 'Dados inválidos.', detalhes: details },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.originalUrl }, 'Erro de aplicação');
    } else {
      logger.warn({ code: err.code, path: req.originalUrl, msg: err.message }, 'Requisição rejeitada');
    }

    res.status(err.statusCode).json({
      erro: {
        codigo: err.code,
        mensagem: err.message,
        ...(err.details ? { detalhes: err.details } : {}),
      },
    });
    return;
  }

  logger.error({ err, path: req.originalUrl }, 'Erro não tratado');

  res.status(500).json({
    erro: {
      codigo: 'INTERNAL_ERROR',
      mensagem: 'Erro interno.',
      ...(isProduction ? {} : { detalhes: err instanceof Error ? err.message : String(err) }),
    },
  });
};
