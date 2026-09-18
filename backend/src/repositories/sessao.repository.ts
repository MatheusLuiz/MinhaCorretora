import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';

export type MotivoRevogacao =
  | 'logout'
  | 'rotacao'
  | 'reuso_detectado'
  | 'senha_alterada'
  | 'admin'
  | 'expirado';

export interface Sessao {
  id: number;
  usuarioId: number;
  familia: Buffer;
  expiraEm: Date;
  usadoEm: Date | null;
  revogadoEm: Date | null;
}

interface LinhaSessao extends RowDataPacket {
  id: number;
  usuario_id: number;
  familia: Buffer;
  expira_em: Date;
  usado_em: Date | null;
  revogado_em: Date | null;
}

export interface NovaSessao {
  usuarioId: number;
  tokenHash: Buffer;
  familia: Buffer;
  expiraEm: Date;
  ip: Buffer | null;
  userAgent: string | null;
}

export async function criar(dados: NovaSessao, conexao?: PoolConnection): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `INSERT INTO sessoes (usuario_id, token_hash, familia, expira_em, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      dados.usuarioId,
      dados.tokenHash,
      dados.familia,
      dados.expiraEm,
      dados.ip,
      dados.userAgent?.slice(0, 255) ?? null,
    ],
  );

  return resultado.insertId;
}

/** Busca pelo hash SEM filtrar revogado/validade: token conhecido e já usado é o sinal de reuso. */
export async function buscarPorHash(tokenHash: Buffer): Promise<Sessao | null> {
  const [linhas] = await pool.execute<LinhaSessao[]>(
    `SELECT id, usuario_id, familia, expira_em, usado_em, revogado_em
       FROM sessoes
      WHERE token_hash = ?
      LIMIT 1`,
    [tokenHash],
  );

  const linha = linhas[0];
  if (!linha) return null;

  return {
    id: linha.id,
    usuarioId: linha.usuario_id,
    familia: linha.familia,
    expiraEm: linha.expira_em,
    usadoEm: linha.usado_em,
    revogadoEm: linha.revogado_em,
  };
}

/** Consome a sessão na rotação; `usado_em IS NULL` é a trava de corrida (quem perde recebe false = reuso). */
export async function marcarComoUsada(
  sessaoId: number,
  conexao?: PoolConnection,
): Promise<boolean> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `UPDATE sessoes
        SET usado_em         = NOW(3),
            revogado_em      = NOW(3),
            motivo_revogacao = 'rotacao'
      WHERE id = ?
        AND usado_em IS NULL
        AND revogado_em IS NULL`,
    [sessaoId],
  );

  return resultado.affectedRows === 1;
}

export async function revogar(
  sessaoId: number,
  motivo: MotivoRevogacao,
  conexao?: PoolConnection,
): Promise<void> {
  const executor = conexao ?? pool;

  await executor.execute(
    `UPDATE sessoes
        SET revogado_em      = NOW(3),
            motivo_revogacao = ?
      WHERE id = ?
        AND revogado_em IS NULL`,
    [motivo, sessaoId],
  );
}

/** Revoga a família inteira: no reuso não dá para saber qual ponta é a vítima, então caem as duas. */
export async function revogarFamilia(
  familia: Buffer,
  motivo: MotivoRevogacao,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `UPDATE sessoes
        SET revogado_em      = NOW(3),
            motivo_revogacao = ?
      WHERE familia = ?
        AND revogado_em IS NULL`,
    [motivo, familia],
  );

  return resultado.affectedRows;
}

/** Derruba todas as sessões de um usuário (troca de senha, bloqueio, logout total). */
export async function revogarTodasDoUsuario(
  usuarioId: number,
  motivo: MotivoRevogacao,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.execute<ResultSetHeader>(
    `UPDATE sessoes
        SET revogado_em      = NOW(3),
            motivo_revogacao = ?
      WHERE usuario_id = ?
        AND revogado_em IS NULL`,
    [motivo, usuarioId],
  );

  // A versão entra no JWT: incrementar invalida na hora os access tokens já emitidos.
  await executor.execute(
    'UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE id = ?',
    [usuarioId],
  );

  return resultado.affectedRows;
}

/** Limpeza de sessões antigas. Em lote, para não segurar lock na tabela. */
export async function limparExpiradas(diasRetencao = 30, limite = 5000): Promise<number> {
  // mysql2 manda o LIMIT como string e o MySQL recusa; por isso entra na string, já truncado e limitado.
  const limiteSeguro = Math.min(Math.max(Math.trunc(limite), 1), 50_000);

  const [resultado] = await pool.execute<ResultSetHeader>(
    `DELETE FROM sessoes
      WHERE expira_em < NOW(3) - INTERVAL ? DAY
      LIMIT ${limiteSeguro}`,
    [Math.trunc(diasRetencao)],
  );

  return resultado.affectedRows;
}
