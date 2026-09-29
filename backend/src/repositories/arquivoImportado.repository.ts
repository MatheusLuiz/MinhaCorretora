import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';

export type EntidadeArquivo = 'clientes' | 'apolices' | 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas';
export type OrigemSistema = 'seguradora' | 'manual';

export interface NovoArquivo {
  lote: string;
  nomeOriginal: string;
  extensao: string;
  tamanhoBytes: number;
  sha256: string;
  caminho: string;
  entidade: EntidadeArquivo;
  seguradora: string | null;
  layout: string | null;
  origemSistema: OrigemSistema;
  importadoPor: number | null;
  resultado: Record<string, unknown> | null;
}

export async function registrar(dados: NovoArquivo): Promise<number> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `INSERT INTO arquivos_importados
       (lote, nome_original, extensao, tamanho_bytes, sha256, caminho,
        entidade, seguradora, layout, origem_sistema, importado_por, resultado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.lote,
      dados.nomeOriginal,
      dados.extensao,
      dados.tamanhoBytes,
      dados.sha256,
      dados.caminho,
      dados.entidade,
      dados.seguradora,
      dados.layout,
      dados.origemSistema,
      dados.importadoPor,
      dados.resultado ? JSON.stringify(dados.resultado) : null,
    ],
  );

  return resultado.insertId;
}

export interface ArquivoRegistrado {
  id: number;
  lote: string;
  nomeOriginal: string;
  sha256: string;
  caminho: string;
  entidade: EntidadeArquivo;
}

function mapear(l: RowDataPacket): ArquivoRegistrado {
  return {
    id: Number(l.id),
    lote: String(l.lote),
    nomeOriginal: String(l.nome_original),
    sha256: String(l.sha256),
    caminho: String(l.caminho),
    entidade: l.entidade as EntidadeArquivo,
  };
}

export async function buscarPorLote(lote: string): Promise<ArquivoRegistrado | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT id, lote, nome_original, sha256, caminho, entidade
       FROM arquivos_importados WHERE lote = ? LIMIT 1`,
    [lote],
  );

  return linhas[0] ? mapear(linhas[0]) : null;
}

/** Já existe importação com conteúdo idêntico? Detecta a planilha rodada duas vezes. */
export async function buscarPorHash(sha256: string): Promise<ArquivoRegistrado | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT id, lote, nome_original, sha256, caminho, entidade
       FROM arquivos_importados
      WHERE sha256 = ? AND desfeito_em IS NULL
      ORDER BY importado_em DESC LIMIT 1`,
    [sha256],
  );

  return linhas[0] ? mapear(linhas[0]) : null;
}

/** Lotes vigentes (não desfeitos) de um layout, do mais antigo ao mais novo. */
export async function lotesDoLayout(layout: string): Promise<string[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT lote FROM arquivos_importados
      WHERE layout = ? AND desfeito_em IS NULL
      ORDER BY importado_em, id`,
    [layout],
  );
  return linhas.map((l) => String(l.lote));
}

export async function listar(limite = 50): Promise<RowDataPacket[]> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 200);

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT a.lote, a.nome_original, a.extensao, a.tamanho_bytes, a.sha256,
            a.entidade, a.seguradora, a.caminho, a.layout, a.origem_sistema, a.importado_em,
            a.desfeito_em, a.motivo_desfazimento, a.resultado,
            u.nome AS importado_por
       FROM arquivos_importados a
       LEFT JOIN usuarios u ON u.id = a.importado_por
      ORDER BY a.importado_em DESC
      LIMIT ${n}`,
  );

  return linhas;
}

/**
 * Marca a carga como desfeita (o registro fica para auditoria) e apaga as linhas
 * que ela trouxe, na ordem das dependências; o resto cai por `ON DELETE CASCADE`.
 */
export async function desfazer(
  lote: string,
  usuarioId: number | null,
  motivo: string,
): Promise<Record<string, number>> {
  const removidos: Record<string, number> = {};

  for (const tabela of ['extratos_comissao', 'apolices_encerradas', 'renovacoes_previstas', 'sinistros', 'parcelas', 'comissoes_itens', 'comissoes', 'apolice_movimentos', 'apolices', 'clientes']) {
    const [r] = await pool.query<ResultSetHeader>(
      `DELETE FROM \`${tabela}\` WHERE origem_lote = ?`,
      [lote],
    );
    if (r.affectedRows > 0) removidos[tabela] = r.affectedRows;
  }

  await pool.execute(
    `UPDATE arquivos_importados
        SET desfeito_em = NOW(3), desfeito_por = ?, motivo_desfazimento = ?
      WHERE lote = ?`,
    [usuarioId, motivo.slice(0, 255), lote],
  );

  return removidos;
}
