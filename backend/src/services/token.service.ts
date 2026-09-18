import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const CHAVE_HMAC = new TextEncoder().encode(env.JWT_SECRET);
const ALGORITMO = 'HS256';

export interface ConteudoAccessToken {
  /** uuid público do usuário — nunca o id sequencial */
  sub: string;
  email: string;
  nome: string;
  papel: string;
  permissoes: string[];
  sessaoVersao: number;
}

/** JWT é assinado, não cifrado: só entra o que já é do próprio usuário. */
export async function gerarAccessToken(dados: ConteudoAccessToken): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const expiraEm = agora + env.ACCESS_TOKEN_TTL_MIN * 60;

  return new SignJWT({
    email: dados.email,
    nome: dados.nome,
    papel: dados.papel,
    permissoes: dados.permissoes,
    sessaoVersao: dados.sessaoVersao,
  })
    .setProtectedHeader({ alg: ALGORITMO, typ: 'JWT' })
    .setSubject(dados.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt(agora)
    .setNotBefore(agora)
    .setExpirationTime(expiraEm)
    .setJti(randomUUID())
    .sign(CHAVE_HMAC);
}

export interface AccessTokenVerificado extends JWTPayload, Omit<ConteudoAccessToken, 'sub'> {
  sub: string;
}

/** Fixar `algorithms` impede token forjado com `alg: none` ou algoritmo trocado. */
export async function verificarAccessToken(token: string): Promise<AccessTokenVerificado> {
  try {
    const { payload } = await jwtVerify(token, CHAVE_HMAC, {
      algorithms: [ALGORITMO],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      clockTolerance: 5,
    });

    if (typeof payload.sub !== 'string') {
      throw AppError.unauthorized('Token sem identificação de usuário.');
    }

    if (
      payload.sessaoVersao !== undefined &&
      (!Number.isSafeInteger(payload.sessaoVersao) || Number(payload.sessaoVersao) < 0)
    ) {
      throw AppError.unauthorized('Token de sessão inválido.');
    }

    return payload as AccessTokenVerificado;
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    // Genérica de propósito: não dizer a quem sonda se expirou ou se a assinatura é falsa.
    throw AppError.unauthorized('Sessão inválida ou expirada.');
  }
}

export interface RefreshTokenGerado {
  /** Valor em claro — vai para o cookie e nunca é gravado no banco. */
  token: string;
  /** SHA-256 do token — é isto que vai para `sessoes.token_hash`. */
  hash: Buffer;
  expiraEm: Date;
}

/** Refresh opaco (não JWT) para ser revogável no servidor: revogar é um UPDATE em `sessoes`. */
export function gerarRefreshToken(): RefreshTokenGerado {
  const token = randomBytes(32).toString('base64url');
  const expiraEm = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  return { token, hash: hashRefreshToken(token), expiraEm };
}

/** SHA-256 do refresh token. Ver database/README.md para o porquê de não ser Argon2. */
export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** Identificador da família de rotação (16 bytes, cabe em BINARY(16)). */
export function gerarFamiliaSessao(): Buffer {
  return randomBytes(16);
}

export interface TokenRedefinicaoGerado {
  /** Valor em claro — vai no link do e-mail e nunca é gravado no banco. */
  token: string;
  /** SHA-256 do token — é isto que vai para `tokens_redefinicao_senha.token_hash`. */
  hash: Buffer;
  expiraEm: Date;
}

/** Token do "esqueci minha senha": opaco como o refresh; base64url porque viaja na query string. */
export function gerarTokenRedefinicao(): TokenRedefinicaoGerado {
  const token = randomBytes(32).toString('base64url');
  const expiraEm = new Date(Date.now() + env.RESET_SENHA_TTL_MIN * 60 * 1000);

  return { token, hash: hashTokenRedefinicao(token), expiraEm };
}

export function hashTokenRedefinicao(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
