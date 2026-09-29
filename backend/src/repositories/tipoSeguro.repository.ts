import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';

// Tipo efetivo = COALESCE(apolices.tipo_seguro_id, produtos.tipo_seguro_id): o da apólice vence.

export const FORMULARIOS = [
  'veiculo',
  'imovel',
  'pessoas',
  'equipamento',
  'pet',
  'viagem',
  'transporte',
  'responsabilidade',
  'consorcio',
  'generico',
] as const;

export type Formulario = (typeof FORMULARIOS)[number];

export interface TipoSeguro {
  id: number;
  chave: string;
  nome: string;
  formulario: Formulario;
  descricao: string | null;
  ativo: boolean;
  ordem: number;
  /** Ids das seguradoras que oferecem o tipo. */
  seguradoras: number[];
  /** Apólices com este tipo efetivo — o que impede de apagar em vez de desativar. */
  apolices: number;
}

export interface DadosTipoSeguro {
  nome: string;
  formulario: Formulario;
  descricao: string | null;
  ordem: number;
}

export async function listar(): Promise<TipoSeguro[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT t.id, t.chave, t.nome, t.formulario, t.descricao, t.ativo, t.ordem,
            (SELECT GROUP_CONCAT(st.seguradora_id)
               FROM seguradora_tipos_seguro st
              WHERE st.tipo_seguro_id = t.id) AS seguradoras,
            (SELECT COUNT(*)
               FROM apolices a
               LEFT JOIN produtos p ON p.id = a.produto_id
              WHERE COALESCE(a.tipo_seguro_id, p.tipo_seguro_id) = t.id) AS apolices
       FROM tipos_seguro t
      ORDER BY t.ordem, t.nome`,
  );

  return linhas.map((l) => ({
    id: Number(l.id),
    chave: String(l.chave),
    nome: String(l.nome),
    formulario: l.formulario as Formulario,
    descricao: l.descricao ? String(l.descricao) : null,
    ativo: Boolean(l.ativo),
    ordem: Number(l.ordem),
    seguradoras: l.seguradoras ? String(l.seguradoras).split(',').map(Number) : [],
    apolices: Number(l.apolices),
  }));
}

export async function buscarPorId(id: number): Promise<TipoSeguro | null> {
  return (await listar()).find((t) => t.id === id) ?? null;
}

/** Nome já usado por outro tipo? A comparação segue a collation (sem acento, sem caixa). */
export async function nomeEmUso(nome: string, excetoId?: number): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM tipos_seguro WHERE nome = ? AND id <> ? LIMIT 1',
    [nome, excetoId ?? 0],
  );
  return linhas.length > 0;
}

export async function chaveEmUso(chave: string): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM tipos_seguro WHERE chave = ? LIMIT 1',
    [chave],
  );
  return linhas.length > 0;
}

export async function criar(chave: string, dados: DadosTipoSeguro): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO tipos_seguro (chave, nome, formulario, descricao, ordem)
     VALUES (?, ?, ?, ?, ?)`,
    [chave, dados.nome, dados.formulario, dados.descricao, dados.ordem],
  );
  return r.insertId;
}

/** A chave não muda: é a referência estável do tipo. */
export async function atualizar(id: number, dados: DadosTipoSeguro): Promise<void> {
  await pool.execute(
    `UPDATE tipos_seguro SET nome = ?, formulario = ?, descricao = ?, ordem = ? WHERE id = ?`,
    [dados.nome, dados.formulario, dados.descricao, dados.ordem, id],
  );
}

export async function definirAtivo(id: number, ativo: boolean): Promise<void> {
  await pool.execute('UPDATE tipos_seguro SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
}

export async function definirHabilitado(
  tipoId: number,
  seguradoraId: number,
  habilitado: boolean,
): Promise<void> {
  if (habilitado) {
    await pool.execute(
      `INSERT IGNORE INTO seguradora_tipos_seguro (seguradora_id, tipo_seguro_id) VALUES (?, ?)`,
      [seguradoraId, tipoId],
    );
  } else {
    await pool.execute(
      'DELETE FROM seguradora_tipos_seguro WHERE seguradora_id = ? AND tipo_seguro_id = ?',
      [seguradoraId, tipoId],
    );
  }
}

/** A seguradora oferece o tipo, e o tipo está ativo? */
export async function habilitadoPara(tipoId: number, seguradoraId: number): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT 1
       FROM seguradora_tipos_seguro st
       JOIN tipos_seguro t ON t.id = st.tipo_seguro_id
      WHERE st.tipo_seguro_id = ? AND st.seguradora_id = ? AND t.ativo = 1`,
    [tipoId, seguradoraId],
  );
  return linhas.length > 0;
}

export async function idPorChave(chave: string): Promise<number | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM tipos_seguro WHERE chave = ?',
    [chave],
  );
  return linhas[0] ? Number(linhas[0].id) : null;
}
