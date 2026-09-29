import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { binarioParaUuid, uuidParaBinario } from '../utils/uuid.js';

// Uma caixa PADRÃO (índice único `padrao_unico`). A senha sai daqui CIFRADA; só o serviço de e-mail decifra.

export type Seguranca = 'starttls' | 'tls';

export interface CaixaEmail {
  id: number;
  uuid: string;
  nome: string;
  ativo: boolean;
  padrao: boolean;
  host: string;
  porta: number;
  seguranca: Seguranca;
  usuario: string | null;
  senhaCifrada: Buffer | null;
  senhaDica: string | null;
  remetenteNome: string | null;
  remetenteEmail: string;
  responderPara: string | null;
  ultimoTesteEm: Date | null;
  ultimoTesteOk: boolean | null;
  ultimoTesteErro: string | null;
  atualizadoEm: Date;
  atualizadoPor: string | null;
  /** Quantos layouts saem por esta caixa. */
  modelos: number;
}

const SELECT = `
  SELECT c.id, c.uuid, c.nome, c.ativo, c.padrao, c.host, c.porta, c.seguranca, c.usuario,
         c.senha_cifrada, c.senha_dica, c.remetente_nome, c.remetente_email, c.responder_para,
         c.ultimo_teste_em, c.ultimo_teste_ok, c.ultimo_teste_erro, c.atualizado_em,
         TRIM(CONCAT(u.nome, ' ', COALESCE(u.sobrenome, ''))) AS atualizado_por,
         (SELECT COUNT(*) FROM modelos_email m WHERE m.caixa_id = c.id) AS modelos
    FROM caixas_email c
    LEFT JOIN usuarios u ON u.id = c.atualizado_por`;

function mapear(l: RowDataPacket): CaixaEmail {
  return {
    id: Number(l.id),
    uuid: binarioParaUuid(l.uuid as Buffer),
    nome: l.nome,
    ativo: l.ativo === 1,
    padrao: l.padrao === 1,
    host: l.host,
    porta: Number(l.porta),
    seguranca: l.seguranca as Seguranca,
    usuario: l.usuario,
    senhaCifrada: l.senha_cifrada as Buffer | null,
    senhaDica: l.senha_dica,
    remetenteNome: l.remetente_nome,
    remetenteEmail: l.remetente_email,
    responderPara: l.responder_para,
    ultimoTesteEm: l.ultimo_teste_em,
    ultimoTesteOk: l.ultimo_teste_ok === null ? null : l.ultimo_teste_ok === 1,
    ultimoTesteErro: l.ultimo_teste_erro,
    atualizadoEm: l.atualizado_em,
    atualizadoPor: l.atualizado_por || null,
    modelos: Number(l.modelos),
  };
}

export async function listar(): Promise<CaixaEmail[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(`${SELECT} ORDER BY c.padrao DESC, c.nome`);
  return linhas.map(mapear);
}

export async function buscarPorUuid(uuid: string): Promise<CaixaEmail | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(`${SELECT} WHERE c.uuid = ?`, [uuidParaBinario(uuid)]);
  return linhas[0] ? mapear(linhas[0]) : null;
}

export async function nomeEmUso(nome: string, excetoId?: number): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM caixas_email WHERE nome = ? AND id <> ? LIMIT 1',
    [nome, excetoId ?? 0],
  );
  return linhas.length > 0;
}

export interface DadosCaixa {
  nome: string;
  ativo: boolean;
  padrao: boolean;
  host: string;
  porta: number;
  seguranca: Seguranca;
  usuario: string | null;
  remetenteNome: string | null;
  remetenteEmail: string;
  responderPara: string | null;
  /** `undefined` mantém a gravada; `null` apaga; objeto troca. */
  senha?: { cifrada: Buffer; dica: string | null } | null;
  usuarioId: number | null;
}

/** Desmarca as outras ANTES de gravar: o índice único não admite duas padrão nem por um instante. */
async function liberarPadrao(conexao: PoolConnection, excetoId: number): Promise<void> {
  await conexao.execute('UPDATE caixas_email SET padrao = 0 WHERE padrao = 1 AND id <> ?', [excetoId]);
}

export async function criar(d: DadosCaixa): Promise<string> {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    if (d.padrao) await liberarPadrao(conexao, 0);
    const [r] = await conexao.execute<ResultSetHeader>(
      `INSERT INTO caixas_email
         (nome, ativo, padrao, host, porta, seguranca, usuario, senha_cifrada, senha_dica,
          remetente_nome, remetente_email, responder_para, atualizado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.nome, d.ativo ? 1 : 0, d.padrao ? 1 : 0, d.host, d.porta, d.seguranca, d.usuario,
        d.senha?.cifrada ?? null, d.senha?.dica ?? null,
        d.remetenteNome, d.remetenteEmail, d.responderPara, d.usuarioId,
      ],
    );
    const [[l]] = await conexao.query<RowDataPacket[]>('SELECT uuid FROM caixas_email WHERE id = ?', [r.insertId]);
    await conexao.commit();
    return binarioParaUuid(l!.uuid as Buffer);
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

export async function atualizar(id: number, d: DadosCaixa): Promise<void> {
  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();
    if (d.padrao) await liberarPadrao(conexao, id);
    const trocaSenha = d.senha !== undefined;
    await conexao.execute(
      `UPDATE caixas_email
          SET nome = ?, ativo = ?, padrao = ?, host = ?, porta = ?, seguranca = ?, usuario = ?,
              remetente_nome = ?, remetente_email = ?, responder_para = ?, atualizado_por = ?
              ${trocaSenha ? ', senha_cifrada = ?, senha_dica = ?' : ''}
        WHERE id = ?`,
      [
        d.nome, d.ativo ? 1 : 0, d.padrao ? 1 : 0, d.host, d.porta, d.seguranca, d.usuario,
        d.remetenteNome, d.remetenteEmail, d.responderPara, d.usuarioId,
        ...(trocaSenha ? [d.senha?.cifrada ?? null, d.senha?.dica ?? null] : []),
        id,
      ],
    );
    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/** Os layouts desta caixa voltam para a padrão (ON DELETE SET NULL). */
export async function excluir(id: number): Promise<void> {
  await pool.execute('DELETE FROM caixas_email WHERE id = ?', [id]);
}

/** O resultado do último teste — gravado mesmo quando falha, que é quando mais importa. */
export async function registrarTeste(id: number, ok: boolean, erro: string | null): Promise<void> {
  await pool.execute(
    `UPDATE caixas_email
        SET ultimo_teste_em = NOW(3), ultimo_teste_ok = ?, ultimo_teste_erro = ?
      WHERE id = ?`,
    [ok ? 1 : 0, erro ? erro.slice(0, 500) : null, id],
  );
}
