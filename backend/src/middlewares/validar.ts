import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';

type Origem = 'body' | 'query' | 'params';

/** Valida e SUBSTITUI a parte da requisição pelo resultado do schema (sem chaves extras). */
export function validar(schema: ZodSchema, origem: Origem = 'body'): RequestHandler {
  return (req, _res, next) => {
    const resultado = schema.safeParse(req[origem]);

    if (!resultado.success) {
      next(resultado.error);
      return;
    }

    if (origem === 'body') {
      req.body = resultado.data;
    } else {
      // `req.query` e `req.params` são getters no Express 5.
      Object.defineProperty(req, origem, {
        value: resultado.data,
        writable: true,
        configurable: true,
      });
    }

    next();
  };
}
