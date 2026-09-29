import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';

/** O token em claro nunca chega aqui: o que circula é o SHA-256 dele. */

export type MotivoInvalidacao = 'substituido' | 'senha_redefinida' | 'admin';

export interface TokenRedefinicao {
  id: number;
  usuarioId: number;
  expiraEm: Date;
  usadoEm: Date | null;
  invalidadoEm: Date | null;
}

interface LinhaToken extends RowDataPacket {
  id: number;
  usuario_id: number;
  expira_em: Date;
  usado_em: Date | null;
  invalidado_em: Date | null;
}

export interface NovoToken {
  usuarioId: number;
  tokenHash: Buffer;
  expiraEm: Date;
  ip: Buffer | null;
  userAgent: string | null;
}

export async function criar(dados: NovoToken, conexao?: PoolConnection): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `INSERT INTO tokens_redefinicao_senha
       (usuario_id, token_hash, expira_em, ip_solicitacao, user_agent_solicitacao)
     VALUES (?, ?, ?, ?, ?)`,
    [
      dados.usuarioId,
      dados.tokenHash,
      dados.expiraEm,
      dados.ip,
      dados.userAgent?.slice(0, 255) ?? null,
    ],
  );

  return resultado.insertId;
}

export async function buscarPorHash(tokenHash: Buffer): Promise<TokenRedefinicao | null> {
  const [linhas] = await pool.execute<LinhaToken[]>(
    `SELECT id, usuario_id, expira_em, usado_em, invalidado_em
       FROM tokens_redefinicao_senha
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );

  const linha = linhas[0];

  return linha
    ? {
        id: linha.id,
        usuarioId: linha.usuario_id,
        expiraEm: linha.expira_em,
        usadoEm: linha.usado_em,
        invalidadoEm: linha.invalidado_em,
      }
    : null;
}

/** Consome o token; `usado_em IS NULL` é a trava contra dois cliques simultâneos. */
export async function marcarComoUsado(
  id: number,
  ip: Buffer | null,
  conexao?: PoolConnection,
): Promise<boolean> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `UPDATE tokens_redefinicao_senha
        SET usado_em = NOW(3),
            ip_uso   = ?
      WHERE id = ?
        AND usado_em      IS NULL
        AND invalidado_em IS NULL`,
    [ip, id],
  );

  return resultado.affectedRows === 1;
}

/** Invalida os tokens pendentes (ao emitir um novo e ao concluir); `exceto` poupa o da própria operação. */
export async function invalidarPendentes(
  usuarioId: number,
  motivo: MotivoInvalidacao,
  conexao?: PoolConnection,
  exceto?: number,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `UPDATE tokens_redefinicao_senha
        SET invalidado_em      = NOW(3),
            motivo_invalidacao = ?
      WHERE usuario_id    = ?
        AND usado_em      IS NULL
        AND invalidado_em IS NULL
        AND id <> ?`,
    [motivo, usuarioId, exceto ?? 0],
  );

  return resultado.affectedRows;
}

/** Pedidos da última hora, inclusive os invalidados: o limite é de e-mails disparados. */
export async function contarPedidosRecentes(
  usuarioId: number,
  minutos = 60,
): Promise<number> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM tokens_redefinicao_senha
      WHERE usuario_id = ?
        AND criado_em > NOW(3) - INTERVAL ? MINUTE`,
    [usuarioId, Math.trunc(minutos)],
  );

  return Number(linhas[0]?.total ?? 0);
}

