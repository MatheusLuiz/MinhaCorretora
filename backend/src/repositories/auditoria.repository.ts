import type { PoolConnection } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';

export interface RegistroAuditoria {
  usuarioId?: number | null;
  acao: string;
  entidade?: string | null;
  entidadeId?: string | null;
  detalhes?: Record<string, unknown> | null;
  ip?: Buffer | null;
  userAgent?: string | null;
}

/** Campos que nunca podem ir para `auditoria.detalhes`. */
const CHAVES_PROIBIDAS = new Set([
  'senha', 'password', 'senha_hash', 'senhahash',
  'token', 'accesstoken', 'refreshtoken', 'authorization',
  'identificacao', 'corretora', 'usuario_ws', 'jwt_secret',
]);

function sanitizarDetalhes(detalhes: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(detalhes)) {
    if (CHAVES_PROIBIDAS.has(chave.toLowerCase())) {
      limpo[chave] = '[REDIGIDO]';
      continue;
    }

    limpo[chave] =
      valor !== null && typeof valor === 'object' && !Array.isArray(valor)
        ? sanitizarDetalhes(valor as Record<string, unknown>)
        : valor;
  }

  return limpo;
}

/** Grava um evento de auditoria. Nunca propaga erro: auditoria não pode derrubar o login. */
export async function registrar(
  evento: RegistroAuditoria,
  conexao?: PoolConnection,
): Promise<void> {
  const executor = conexao ?? pool;

  try {
    await executor.execute(
      `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        evento.usuarioId ?? null,
        evento.acao,
        evento.entidade ?? null,
        evento.entidadeId ?? null,
        evento.detalhes ? JSON.stringify(sanitizarDetalhes(evento.detalhes)) : null,
        evento.ip ?? null,
        evento.userAgent?.slice(0, 255) ?? null,
      ],
    );
  } catch (erro) {
    logger.error({ err: erro, acao: evento.acao }, 'Falha ao gravar auditoria');
  }
}

export interface TentativaLogin {
  emailTentado: string;
  usuarioId?: number | null;
  sucesso: boolean;
  motivo?: string | null;
  ip?: Buffer | null;
  userAgent?: string | null;
}

export async function registrarTentativaLogin(tentativa: TentativaLogin): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO tentativas_login (email_tentado, usuario_id, sucesso, motivo, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tentativa.emailTentado.slice(0, 254),
        tentativa.usuarioId ?? null,
        tentativa.sucesso ? 1 : 0,
        tentativa.motivo ?? null,
        tentativa.ip ?? null,
        tentativa.userAgent?.slice(0, 255) ?? null,
      ],
    );
  } catch (erro) {
    logger.error({ err: erro }, 'Falha ao registrar tentativa de login');
  }
}
