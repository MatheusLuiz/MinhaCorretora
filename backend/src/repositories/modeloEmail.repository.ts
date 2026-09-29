import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { binarioParaUuid, uuidParaBinario } from '../utils/uuid.js';

// A finalidade é chave do catálogo em código; o banco garante um ATIVO por finalidade (índice único).

export interface ModeloEmail {
  id: number;
  uuid: string;
  nome: string;
  finalidade: string;
  caixaId: number | null;
  caixaUuid: string | null;
  caixaNome: string | null;
  assunto: string;
  corpoHtml: string;
  corpoTexto: string | null;
  usarMoldura: boolean;
  ativo: boolean;
  atualizadoEm: Date;
  atualizadoPor: string | null;
}

const SELECT = `
  SELECT m.id, m.uuid, m.nome, m.finalidade, m.caixa_id, c.uuid AS caixa_uuid, c.nome AS caixa_nome,
         m.assunto, m.corpo_html, m.corpo_texto, m.usar_moldura, m.ativo, m.atualizado_em,
         TRIM(CONCAT(u.nome, ' ', COALESCE(u.sobrenome, ''))) AS atualizado_por
    FROM modelos_email m
    LEFT JOIN caixas_email c ON c.id = m.caixa_id
    LEFT JOIN usuarios u ON u.id = m.atualizado_por`;

function mapear(l: RowDataPacket): ModeloEmail {
  return {
    id: Number(l.id),
    uuid: binarioParaUuid(l.uuid as Buffer),
    nome: l.nome,
    finalidade: l.finalidade,
    caixaId: l.caixa_id === null ? null : Number(l.caixa_id),
    caixaUuid: l.caixa_uuid ? binarioParaUuid(l.caixa_uuid as Buffer) : null,
    caixaNome: l.caixa_nome,
    assunto: l.assunto,
    corpoHtml: l.corpo_html,
    corpoTexto: l.corpo_texto,
    usarMoldura: l.usar_moldura === 1,
    ativo: l.ativo === 1,
    atualizadoEm: l.atualizado_em,
    atualizadoPor: l.atualizado_por || null,
  };
}

export async function listar(): Promise<ModeloEmail[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(`${SELECT} ORDER BY m.finalidade = 'livre', m.finalidade, m.nome`);
  return linhas.map(mapear);
}

export async function buscarPorUuid(uuid: string): Promise<ModeloEmail | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(`${SELECT} WHERE m.uuid = ?`, [uuidParaBinario(uuid)]);
  return linhas[0] ? mapear(linhas[0]) : null;
}

/** O layout que o sistema usa para a finalidade agora — só um pode estar ativo. */
export async function ativoDaFinalidade(finalidade: string): Promise<ModeloEmail | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `${SELECT} WHERE m.finalidade = ? AND m.ativo = 1 LIMIT 1`,
    [finalidade],
  );
  return linhas[0] ? mapear(linhas[0]) : null;
}

/** Outro layout ATIVO da mesma finalidade — para a mensagem dizer qual. */
export async function outroAtivo(finalidade: string, excetoId: number): Promise<string | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT nome FROM modelos_email
      WHERE finalidade = ? AND finalidade <> 'livre' AND ativo = 1 AND id <> ? LIMIT 1`,
    [finalidade, excetoId],
  );
  return linhas[0] ? String(linhas[0].nome) : null;
}

export interface DadosModelo {
  nome: string;
  finalidade: string;
  caixaId: number | null;
  assunto: string;
  corpoHtml: string;
  corpoTexto: string | null;
  usarMoldura: boolean;
  ativo: boolean;
  usuarioId: number | null;
}

export async function criar(d: DadosModelo): Promise<string> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO modelos_email
       (nome, finalidade, caixa_id, assunto, corpo_html, corpo_texto, usar_moldura, ativo, atualizado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.nome, d.finalidade, d.caixaId, d.assunto, d.corpoHtml, d.corpoTexto, d.usarMoldura ? 1 : 0, d.ativo ? 1 : 0, d.usuarioId],
  );
  const [[l]] = await pool.query<RowDataPacket[]>('SELECT uuid FROM modelos_email WHERE id = ?', [r.insertId]);
  return binarioParaUuid(l!.uuid as Buffer);
}

export async function atualizar(id: number, d: DadosModelo): Promise<void> {
  await pool.execute(
    `UPDATE modelos_email
        SET nome = ?, finalidade = ?, caixa_id = ?, assunto = ?, corpo_html = ?, corpo_texto = ?,
            usar_moldura = ?, ativo = ?, atualizado_por = ?
      WHERE id = ?`,
    [d.nome, d.finalidade, d.caixaId, d.assunto, d.corpoHtml, d.corpoTexto, d.usarMoldura ? 1 : 0, d.ativo ? 1 : 0, d.usuarioId, id],
  );
}

export async function excluir(id: number): Promise<void> {
  await pool.execute('DELETE FROM modelos_email WHERE id = ?', [id]);
}
