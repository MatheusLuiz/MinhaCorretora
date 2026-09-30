import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';

// A CHAVE (`clientes.carteira_comercial`) não muda; grupo não se apaga, só se desativa.

export interface GrupoCliente {
  id: number;
  chave: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  ordem: number;
  /** Clientes no grupo — para quem administra saber o que está mexendo. */
  clientes: number;
}

export interface DadosGrupoCliente {
  nome: string;
  descricao: string | null;
  ordem: number;
}

export async function listar(): Promise<GrupoCliente[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT g.id, g.chave, g.nome, g.descricao, g.ativo, g.ordem,
            (SELECT COUNT(*) FROM clientes c WHERE c.carteira_comercial = g.chave) AS clientes
       FROM grupos_cliente g
      ORDER BY g.ordem, g.nome`,
  );

  return linhas.map((l) => ({
    id: Number(l.id),
    chave: String(l.chave),
    nome: String(l.nome),
    descricao: l.descricao ? String(l.descricao) : null,
    ativo: Boolean(l.ativo),
    ordem: Number(l.ordem),
    clientes: Number(l.clientes),
  }));
}

/** O que um painel precisa para dar nome aos grupos — sem contagem de base inteira. */
export interface GrupoDoPainel {
  chave: string;
  nome: string;
}

export async function listarParaPaineis(): Promise<GrupoDoPainel[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    'SELECT chave, nome FROM grupos_cliente ORDER BY ordem, nome',
  );
  return linhas.map((l) => ({
    chave: String(l.chave),
    nome: String(l.nome),
  }));
}

export async function buscarPorId(id: number): Promise<GrupoCliente | null> {
  return (await listar()).find((g) => g.id === id) ?? null;
}

/** O grupo ATIVO com esta chave — o que a ficha aceita atribuir. */
export async function ativoPorChave(chave: string): Promise<{ chave: string; nome: string } | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT chave, nome FROM grupos_cliente WHERE chave = ? AND ativo = 1',
    [chave],
  );
  return linhas[0] ? { chave: String(linhas[0].chave), nome: String(linhas[0].nome) } : null;
}

/** Nome já usado por outro grupo? A comparação segue a collation (sem acento, sem caixa). */
export async function nomeEmUso(nome: string, excetoId?: number): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM grupos_cliente WHERE nome = ? AND id <> ? LIMIT 1',
    [nome, excetoId ?? 0],
  );
  return linhas.length > 0;
}

export async function chaveEmUso(chave: string): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM grupos_cliente WHERE chave = ? LIMIT 1',
    [chave],
  );
  return linhas.length > 0;
}

export async function criar(chave: string, dados: DadosGrupoCliente): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO grupos_cliente (chave, nome, descricao, ordem)
     VALUES (?, ?, ?, ?)`,
    [chave, dados.nome, dados.descricao, dados.ordem],
  );
  return r.insertId;
}

/** A chave não muda: é o valor gravado em cada cliente. */
export async function atualizar(id: number, dados: DadosGrupoCliente): Promise<void> {
  await pool.execute(
    `UPDATE grupos_cliente SET nome = ?, descricao = ?, ordem = ? WHERE id = ?`,
    [dados.nome, dados.descricao, dados.ordem, id],
  );
}

export async function definirAtivo(id: number, ativo: boolean): Promise<void> {
  await pool.execute('UPDATE grupos_cliente SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
}
