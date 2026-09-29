import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, RequestHandler } from 'express';

import { cookieSecure, env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

/**
 * CSRF por cookie de dupla submissão, só nas rotas que autenticam pelo cookie
 * (`/auth/refresh`, `/auth/logout`); defesa em profundidade além do `sameSite`.
 */
const NOME_COOKIE = 'minhacorretora_csrf';
const NOME_CABECALHO = 'x-csrf-token';

function opcoes(expiraEm?: Date): CookieOptions {
  return {
    // Legível de propósito: o frontend precisa copiá-lo para o cabeçalho.
    httpOnly: false,
    secure: cookieSecure,
    sameSite: 'strict',
    path: '/',
    // Mesma validade do refresh: como cookie de sessão, sumiria antes dele e a renovação daria 403.
    ...(expiraEm ? { expires: expiraEm } : {}),
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

/** Emite um token novo; `expiraEm` = o vencimento do refresh token. */
export function emitirTokenCsrf(res: Parameters<RequestHandler>[1], expiraEm?: Date): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(NOME_COOKIE, token, opcoes(expiraEm));
  return token;
}

export function limparTokenCsrf(res: Parameters<RequestHandler>[1]): void {
  res.clearCookie(NOME_COOKIE, { ...opcoes(), expires: undefined });
}

/** Comparação em tempo constante, para o erro não virar oráculo. */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Exige que cookie e cabeçalho batam. */
export const exigirCsrf: RequestHandler = (req, _res, next) => {
  const doCookie = (req.cookies as Record<string, string> | undefined)?.[NOME_COOKIE];
  const doCabecalho = req.get(NOME_CABECALHO);

  if (!doCookie || !doCabecalho || !iguais(doCookie, doCabecalho)) {
    next(
      AppError.forbidden(
        'Requisição sem confirmação de origem. Recarregue a página e tente de novo.',
      ),
    );
    return;
  }

  next();
};
