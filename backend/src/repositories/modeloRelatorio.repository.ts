import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { binarioParaUuid, uuidParaBinario } from '../utils/uuid.js';

/**
 * Modelos de relatório cadastrados pela tela: o de-para cobre o caso comum; os formatos com
 * tratamento próprio continuam em `seguradoras/<chave>/modelos/`.
 */

export type Familia = 'carteira' | 'apolices' | 'financeiro' | 'clientes';
export type Entidade = 'parcelas' | 'comissoes';

export interface ModeloRelatorio {
  uuid: string;
  seguradoraId: number | null;
  seguradoraNome: string | null;
  chave: string;
  nome: string;
  descricao: string | null;
  familia: Familia;
  entidade: Entidade | null;
  assinatura: string | null;
  ativo: boolean;
  /** Nome normalizado da coluna do arquivo → campo do sistema. */
  colunas: Record<string, string>;
}

function montar(linha: RowDataPacket, colunas: Record<string, string>): ModeloRelatorio {
  return {
    uuid: binarioParaUuid(linha.uuid as Buffer),
    seguradoraId: linha.seguradora_id === null ? null : Number(linha.seguradora_id),
    seguradoraNome: linha.seguradora_nome === null ? null : String(linha.seguradora_nome),
    chave: String(linha.chave),
    nome: String(linha.nome),
    descricao: linha.descricao === null ? null : String(linha.descricao),
    familia: String(linha.familia) as Familia,
    entidade: linha.entidade === null ? null : (String(linha.entidade) as Entidade),
    assinatura: linha.assinatura === null ? null : String(linha.assinatura),
    ativo: Number(linha.ativo) === 1,
    colunas,
  };
}

const SELECT_BASE = `
  SELECT m.id, m.uuid, m.seguradora_id, s.nome AS seguradora_nome,
         m.chave, m.nome, m.descricao, m.familia, m.entidade,
         m.assinatura, m.ativo
    FROM modelos_relatorio m
    LEFT JOIN seguradoras s ON s.id = m.seguradora_id`;

/** Carrega o de-para de vários modelos numa consulta só. */
async function colunasDe(ids: number[]): Promise<Map<number, Record<string, string>>> {
  const mapa = new Map<number, Record<string, string>>();
  if (ids.length === 0) return mapa;

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT modelo_id, origem, canonica FROM modelos_relatorio_colunas
      WHERE modelo_id IN (?)`,
    [ids],
  );

  for (const l of linhas) {
    const id = Number(l.modelo_id);
    const atual = mapa.get(id) ?? {};
    atual[String(l.origem)] = String(l.canonica);
    mapa.set(id, atual);
  }

  return mapa;
}

export async function listar(incluirInativos = false): Promise<ModeloRelatorio[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `${SELECT_BASE} ${incluirInativos ? '' : 'WHERE m.ativo = 1'} ORDER BY s.nome, m.nome`,
  );

  const colunas = await colunasDe(linhas.map((l) => Number(l.id)));
  return linhas.map((l) => montar(l, colunas.get(Number(l.id)) ?? {}));
}

export interface DadosModelo {
  seguradoraId: number | null;
  nome: string;
  descricao: string | null;
  familia: Familia;
  entidade: Entidade | null;
  assinatura: string | null;
  colunas: Record<string, string>;
  criadoPor: number | null;
}

/** Slug a partir do nome, estável e legível na URL. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Cria ou substitui um modelo. O de-para é reescrito, não mesclado: coluna desmarcada deixa de valer. */
export async function salvar(dados: DadosModelo, uuid?: string): Promise<string> {
  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    const id = uuid
      ? await atualizar(conexao, uuid, dados)
      : await criar(conexao, dados);

    await conexao.execute('DELETE FROM modelos_relatorio_colunas WHERE modelo_id = ?', [id]);

    const pares = Object.entries(dados.colunas).filter(([o, c]) => o && c);
    if (pares.length > 0) {
      await conexao.query(
        `INSERT INTO modelos_relatorio_colunas (modelo_id, origem, canonica) VALUES ?`,
        [pares.map(([origem, canonica]) => [id, origem, canonica])],
      );
    }

    const [linhas] = await conexao.execute<RowDataPacket[]>(
      'SELECT uuid FROM modelos_relatorio WHERE id = ?',
      [id],
    );

    await conexao.commit();
    return binarioParaUuid(linhas[0]!.uuid as Buffer);
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

async function criar(conexao: PoolConnection, d: DadosModelo): Promise<number> {
  // Sufixo numérico: duas companhias podem dar o mesmo nome ao relatório.
  const raiz = chaveDoNome(d.nome) || 'modelo';
  let chave = raiz;

  for (let tentativa = 2; tentativa < 100; tentativa++) {
    const [existe] = await conexao.execute<RowDataPacket[]>(
      'SELECT 1 FROM modelos_relatorio WHERE chave = ? LIMIT 1',
      [chave],
    );
    if (existe.length === 0) break;
    chave = `${raiz}-${tentativa}`;
  }

  const [r] = await conexao.execute<ResultSetHeader>(
    `INSERT INTO modelos_relatorio
       (seguradora_id, chave, nome, descricao, familia, entidade, assinatura, criado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.seguradoraId,
      chave,
      d.nome,
      d.descricao,
      d.familia,
      d.entidade,
      d.assinatura,
      d.criadoPor,
    ],
  );

  return r.insertId;
}

async function atualizar(
  conexao: PoolConnection,
  uuid: string,
  d: DadosModelo,
): Promise<number> {
  const [linhas] = await conexao.execute<RowDataPacket[]>(
    'SELECT id FROM modelos_relatorio WHERE uuid = ? LIMIT 1',
    [uuidParaBinario(uuid)],
  );

  const id = linhas[0]?.id;
  if (!id) throw new Error('Modelo de relatório não encontrado.');

  await conexao.execute(
    `UPDATE modelos_relatorio
        SET seguradora_id = ?, nome = ?, descricao = ?, familia = ?,
            entidade = ?, assinatura = ?
      WHERE id = ?`,
    [d.seguradoraId, d.nome, d.descricao, d.familia, d.entidade, d.assinatura, id],
  );

  return Number(id);
}

export async function definirAtivo(uuid: string, ativo: boolean): Promise<void> {
  await pool.execute('UPDATE modelos_relatorio SET ativo = ? WHERE uuid = ?', [
    ativo ? 1 : 0,
    uuidParaBinario(uuid),
  ]);
}
