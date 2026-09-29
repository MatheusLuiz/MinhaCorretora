import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';

export type TipoIntegracao = 'nenhuma' | 'api' | 'sftp' | 'portal';
export type Ambiente = 'producao' | 'homologacao';

export interface Seguradora {
  id: number;
  nome: string;
  /** Chave estável (`porto-seguro`): a pasta das rotinas de integração e dos layouts. */
  chave: string | null;
  cnpj: string | null;
  codigoSusep: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  ativa: boolean;
  inativadaEm: Date | null;
  /** Cadastros que citam esta companhia (impedem apagá-la). */
  clientes: number;
  apolices: number;
  integracao: IntegracaoResumo | null;
}

export interface IntegracaoResumo {
  tipo: TipoIntegracao;
  ambiente: Ambiente;
  ativa: boolean;
  baseUrl: string | null;
  usuario: string | null;
  /** Só os últimos caracteres. O segredo em si nunca sai do servidor. */
  segredoDica: string | null;
  temSegredo: boolean;
  observacoes: string | null;
  ultimaSincronizacaoEm: Date | null;
  documentacaoUrl: string | null;
  documentacao: string | null;
  /** Nome e últimos caracteres de cada credencial. O valor nunca sai. */
  credenciais: { nome: string; dica: string | null }[];
}

export interface DadosSeguradora {
  nome: string;
  cnpj: string | null;
  codigoSusep: string | null;
  site: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
}

/** O resumo em claro das credenciais; coluna vazia ou corrompida vira lista vazia. */
function resumoDeCredenciais(bruto: unknown): { nome: string; dica: string | null }[] {
  if (typeof bruto !== 'string' || !bruto) return [];
  try {
    const lista = JSON.parse(bruto) as unknown;
    return Array.isArray(lista)
      ? lista
          .filter((c): c is { nome: string; dica?: string | null } => typeof c?.nome === 'string')
          .map((c) => ({ nome: c.nome, dica: c.dica ?? null }))
      : [];
  } catch {
    return [];
  }
}

function paraSeguradora(l: RowDataPacket): Seguradora {
  return {
    id: Number(l.id),
    nome: String(l.nome),
    chave: l.chave ? String(l.chave) : null,
    cnpj: l.cnpj ? String(l.cnpj) : null,
    codigoSusep: l.codigo_susep ? String(l.codigo_susep) : null,
    site: l.site ? String(l.site) : null,
    telefone: l.telefone ? String(l.telefone) : null,
    email: l.email ? String(l.email) : null,
    observacoes: l.observacoes ? String(l.observacoes) : null,
    ativa: Boolean(l.ativa),
    inativadaEm: (l.inativada_em as Date | null) ?? null,
    clientes: Number(l.clientes ?? 0),
    apolices: Number(l.apolices ?? 0),
    integracao:
      l.tipo === null || l.tipo === undefined
        ? null
        : {
            tipo: l.tipo as TipoIntegracao,
            ambiente: l.ambiente as Ambiente,
            ativa: Boolean(l.integracao_ativa),
            baseUrl: l.base_url ? String(l.base_url) : null,
            usuario: l.usuario ? String(l.usuario) : null,
            segredoDica: l.segredo_dica ? String(l.segredo_dica) : null,
            temSegredo: l.segredo_cifrado !== null,
            observacoes: l.integracao_observacoes ? String(l.integracao_observacoes) : null,
            ultimaSincronizacaoEm: (l.ultima_sincronizacao_em as Date | null) ?? null,
            documentacaoUrl: l.documentacao_url ? String(l.documentacao_url) : null,
            documentacao: l.documentacao ? String(l.documentacao) : null,
            credenciais: resumoDeCredenciais(l.credenciais_resumo),
          },
  };
}

/** Contagens por subconsulta: um JOIN duplo multiplicaria linhas em silêncio. */
const SELECT_BASE = `
  SELECT s.id, s.nome, s.chave, s.cnpj, s.codigo_susep, s.site, s.telefone, s.email,
         s.observacoes, s.ativa, s.inativada_em,
         (SELECT COUNT(*) FROM seguradoras_clientes sc WHERE sc.seguradora_id = s.id) AS clientes,
         (SELECT COUNT(*) FROM apolices a WHERE a.seguradora_id = s.id) AS apolices,
         i.tipo, i.ambiente, i.ativa AS integracao_ativa, i.base_url, i.usuario,
         i.segredo_dica, i.segredo_cifrado, i.observacoes AS integracao_observacoes,
         i.ultima_sincronizacao_em, i.documentacao_url, i.documentacao, i.credenciais_resumo
    FROM seguradoras s
    LEFT JOIN seguradora_integracoes i ON i.seguradora_id = s.id`;

export async function listar(incluirInativas: boolean): Promise<Seguradora[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `${SELECT_BASE}
     ${incluirInativas ? '' : 'WHERE s.ativa = 1'}
     ORDER BY s.ativa DESC, s.nome`,
  );

  return linhas.map(paraSeguradora);
}

export async function buscarPorId(id: number): Promise<Seguradora | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(`${SELECT_BASE} WHERE s.id = ?`, [id]);
  return linhas[0] ? paraSeguradora(linhas[0]) : null;
}

/** Conflito de nome ou de CNPJ com OUTRA companhia. */
export async function conflito(
  nome: string,
  cnpj: string | null,
  ignorarId?: number,
): Promise<string | null> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT nome, cnpj FROM seguradoras
      WHERE (nome = ? OR (? IS NOT NULL AND cnpj = ?))
        AND id <> ?
      LIMIT 1`,
    [nome, cnpj, cnpj, ignorarId ?? 0],
  );

  const achado = linhas[0];
  if (!achado) return null;

  return String(achado.nome) === nome
    ? `Já existe uma seguradora com o nome ${nome}.`
    : `O CNPJ informado já está cadastrado para ${String(achado.nome)}.`;
}

export async function criar(dados: DadosSeguradora): Promise<number> {
  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO seguradoras (nome, cnpj, codigo_susep, site, telefone, email, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.nome,
      dados.cnpj,
      dados.codigoSusep,
      dados.site,
      dados.telefone,
      dados.email,
      dados.observacoes,
    ],
  );

  return r.insertId;
}

export async function atualizar(id: number, dados: DadosSeguradora): Promise<void> {
  await pool.execute(
    `UPDATE seguradoras
        SET nome = ?, cnpj = ?, codigo_susep = ?, site = ?, telefone = ?,
            email = ?, observacoes = ?
      WHERE id = ?`,
    [
      dados.nome,
      dados.cnpj,
      dados.codigoSusep,
      dados.site,
      dados.telefone,
      dados.email,
      dados.observacoes,
      id,
    ],
  );
}

/** Liga e desliga sem apagar; desligar a companhia desliga também a integração. */
export async function definirAtiva(id: number, ativa: boolean): Promise<void> {
  await pool.execute(
    `UPDATE seguradoras
        SET ativa = ?, inativada_em = ${ativa ? 'NULL' : 'NOW(3)'}
      WHERE id = ?`,
    [ativa ? 1 : 0, id],
  );

  if (!ativa) {
    await pool.execute(
      'UPDATE seguradora_integracoes SET ativa = 0 WHERE seguradora_id = ?',
      [id],
    );
  }
}

export interface DadosIntegracao {
  tipo: TipoIntegracao;
  ambiente: Ambiente;
  ativa: boolean;
  baseUrl: string | null;
  usuario: string | null;
  observacoes: string | null;
  /** `undefined` = não mexer; `null` = apagar. A tela nunca recebe o segredo e manda vazio. */
  segredo?: { cifrado: Buffer; dica: string | null } | null;
  documentacaoUrl: string | null;
  documentacao: string | null;
  /** `undefined` = não mexer; `null` = apagar todas; objeto = substituir (já fundido). */
  credenciais?: { cifrado: Buffer; resumo: string } | null;
}

export async function salvarIntegracao(id: number, dados: DadosIntegracao): Promise<void> {
  const trocaSegredo = dados.segredo !== undefined;
  const trocaCredenciais = dados.credenciais !== undefined;

  await pool.execute(
    `INSERT INTO seguradora_integracoes
       (seguradora_id, tipo, ambiente, ativa, base_url, usuario, observacoes,
        documentacao_url, documentacao,
        segredo_cifrado, segredo_dica, credenciais_cifradas, credenciais_resumo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       tipo = VALUES(tipo), ambiente = VALUES(ambiente), ativa = VALUES(ativa),
       base_url = VALUES(base_url), usuario = VALUES(usuario),
       observacoes = VALUES(observacoes),
       documentacao_url = VALUES(documentacao_url), documentacao = VALUES(documentacao)${
         trocaSegredo
           ? ', segredo_cifrado = VALUES(segredo_cifrado), segredo_dica = VALUES(segredo_dica)'
           : ''
       }${
         trocaCredenciais
           ? ', credenciais_cifradas = VALUES(credenciais_cifradas), credenciais_resumo = VALUES(credenciais_resumo)'
           : ''
       }`,
    [
      id,
      dados.tipo,
      dados.ambiente,
      dados.ativa ? 1 : 0,
      dados.baseUrl,
      dados.usuario,
      dados.observacoes,
      dados.documentacaoUrl,
      dados.documentacao,
      dados.segredo?.cifrado ?? null,
      dados.segredo?.dica ?? null,
      dados.credenciais?.cifrado ?? null,
      dados.credenciais?.resumo ?? null,
    ],
  );
}

/** O pacote cifrado das credenciais com nome, para fundir ou para usar. */
export async function credenciaisDe(id: number): Promise<Buffer | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT credenciais_cifradas FROM seguradora_integracoes WHERE seguradora_id = ?',
    [id],
  );

  const bruto = linhas[0]?.credenciais_cifradas;
  return Buffer.isBuffer(bruto) ? bruto : null;
}

/** Companhias ativas, para telas de escolha; dado histórico usa `opcoesDeFiltro` (vê as inativas). */
export async function nomesAtivos(): Promise<string[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    'SELECT nome FROM seguradoras WHERE ativa = 1 ORDER BY nome',
  );

  return linhas.map((l) => String(l.nome));
}

/** Id de uma companhia ATIVA pelo nome. `null` quando não existe ou está inativa. */
export async function idAtivaPorNome(nome: string): Promise<number | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM seguradoras WHERE nome = ? AND ativa = 1 LIMIT 1',
    [nome],
  );

  return linhas[0] ? Number(linhas[0].id) : null;
}

export interface SeguradoraDeLayout {
  id: number;
  nome: string;
  chave: string;
  ativa: boolean;
}

/**
 * Pela chave, nunca pelo nome (renomear criaria outra companhia na importação).
 * Devolve também a inativa: quem chama decide como recusar.
 */
export async function porChave(chave: string): Promise<SeguradoraDeLayout | null> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT id, nome, chave, ativa FROM seguradoras WHERE chave = ? LIMIT 1',
    [chave],
  );

  const l = linhas[0];
  if (!l) return null;

  return {
    id: Number(l.id),
    nome: String(l.nome),
    chave: String(l.chave),
    ativa: Number(l.ativa) === 1,
  };
}

/** Todas as companhias que têm chave, para a tela de importação montar a lista. */
export async function comChave(): Promise<SeguradoraDeLayout[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    'SELECT id, nome, chave, ativa FROM seguradoras WHERE chave IS NOT NULL ORDER BY nome',
  );

  return linhas.map((l) => ({
    id: Number(l.id),
    nome: String(l.nome),
    chave: String(l.chave),
    ativa: Number(l.ativa) === 1,
  }));
}

/** Dos nomes dados, os já cadastrados (a collation ignora caixa e acento). */
export async function nomesCadastrados(nomes: string[]): Promise<string[]> {
  if (nomes.length === 0) return [];
  const [linhas] = await pool.query<RowDataPacket[]>('SELECT nome FROM seguradoras WHERE nome IN (?)', [nomes]);
  return linhas.map((l) => String(l.nome));
}
