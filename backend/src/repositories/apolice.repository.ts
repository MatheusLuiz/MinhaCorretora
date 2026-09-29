import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, type Escopo } from '../utils/escopo.js';
import { nomeEmCaixaAlta } from '../utils/texto.js';

export type OrigemSistema = 'seguradora' | 'manual';
export type TipoMovimento = 'apolice' | 'endosso' | 'fatura' | 'cancelamento' | 'outro';

/**
 * Resolve o produto, inserindo se for novo. O ramo mora no produto (um ramo por produto nos
 * relatórios); COALESCE para um arquivo sem ramo não desfazer a classificação feita à mão.
 */
export async function resolverProduto(
  nome: string,
  seguradoraId: number | null,
  ramoId: number | null,
  codigoOrigem: string | null,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO produtos (seguradora_id, nome, ramo_id, codigo_origem) VALUES (?, ?, ?, ?) AS novo
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(produtos.id),
       ramo_id = COALESCE(produtos.ramo_id, novo.ramo_id),
       codigo_origem = COALESCE(produtos.codigo_origem, novo.codigo_origem)`,
    [seguradoraId, nome, ramoId, codigoOrigem],
  );

  return resultado.insertId;
}

/** Resolve o canal de venda pelo NOME: o mesmo canal vem com códigos diferentes entre exportações. */
export async function resolverCanal(
  nome: string,
  codigoOrigem: string | null,
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO canais_producao (nome, codigo_origem) VALUES (?, ?) AS novo
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(canais_producao.id),
       codigo_origem = COALESCE(canais_producao.codigo_origem, novo.codigo_origem)`,
    [nome, codigoOrigem],
  );

  return resultado.insertId;
}

export interface ApoliceImportada {
  seguradoraId: number;
  numero: string;
  /** O número da origem se perdeu: `numero` é um `PROV-` e não referencia nada. */
  numeroProvisorio?: boolean;
  /** SHA-1 do contrato, para promover a provisória quando o número real chegar. */
  chaveNatural?: string | null;
  /** Nº da proposta na origem: sobrevive quando o Excel destrói o número da apólice. */
  numeroProposta?: string | null;
  /** Nº da proposta na companhia, quando difere do interno. */
  propostaCia?: string | null;
  produtoId: number | null;

  clienteId: number | null;
  /** Quem VENDEU. Diferente do produtor da carteira do cliente. */
  produtorId?: number | null;
  nomeSegurado: string;
  documentoSegurado: string | null;
  vinculoOrigem: 'documento' | 'nome' | 'manual' | null;

  emitidaEm: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  premioTotal: string | null;
  premioLiquido: string | null;

  /** Comissão esperada (sistema da corretora); não somar com o demonstrativo da seguradora. */
  comissao: string | null;
  percentualComissao: string | null;
  /** 'novo' ou 'renovacao', vindo do N/R da origem. */
  tipoNegocio?: 'novo' | 'renovacao' | null;
  /** S/N da origem: FREQUÊNCIA de sinistro. Não é sinistralidade — falta o valor pago. */
  possuiSinistro?: boolean | null;
  /** Agrupamento comercial da origem: AUTOMÓVEL, PATRIMONIAL, PESSOAS INDIVIDUAL, OUTROS. */
  celula?: string | null;
  /** O que a COMPANHIA declara. null = a origem não informa — nunca ler como cancelada. */
  situacaoCia?: 'ativa' | 'cancelada' | 'nao_vigente' | 'suspensa' | null;
  /** Número do endosso na companhia; null quando a apólice não tem alteração. */
  endosso?: string | null;
  /** Data em que a companhia cancelou. Null = esta origem não informa. */
  canceladaEm?: string | null;
  motivoCancelamento?: string | null;
  /** Por onde a venda entrou. Diferente de quem vendeu. */
  canalId?: number | null;

  origemSistema: OrigemSistema;
  origemArquivo: string | null;
  origemLote: string;
}

/**
 * Dá o documento que chegou à apólice do mesmo número gravada SEM documento, para o upsert cair
 * nela em vez de criar outra. Só com um candidato e se a apólice daquele documento não existir.
 */
async function adotarSemDocumento(
  executor: PoolConnection | typeof pool,
  itens: { seguradoraId: number; numero: string; documento: string | null }[],
): Promise<number> {
  const comDocumento = itens.filter((i) => i.documento);
  if (comDocumento.length === 0) return 0;
  const numeros = [...new Set(comDocumento.map((i) => i.numero))];
  const [linhas] = await executor.query<RowDataPacket[]>(
    'SELECT id, seguradora_id, numero, documento_segurado FROM apolices WHERE numero IN (?)',
    [numeros],
  );
  const doNumero = new Map<string, RowDataPacket[]>();
  for (const l of linhas) {
    const k = `${l.seguradora_id}|${l.numero}`;
    doNumero.set(k, [...(doNumero.get(k) ?? []), l]);
  }
  let adotadas = 0;
  for (const i of comDocumento) {
    const existentes = doNumero.get(`${i.seguradoraId}|${i.numero}`) ?? [];
    const semDocumento = existentes.filter((e) => e.documento_segurado === null);
    if (semDocumento.length !== 1 || existentes.some((e) => e.documento_segurado === i.documento)) continue;
    await executor.query('UPDATE apolices SET documento_segurado = ? WHERE id = ? AND documento_segurado IS NULL', [
      i.documento,
      semDocumento[0]!.id,
    ]);
    semDocumento[0]!.documento_segurado = i.documento;
    adotadas++;
  }
  return adotadas;
}

const COLUNAS_APOLICE = [
  'seguradora_id', 'numero', 'numero_provisorio', 'chave_natural',
  'numero_proposta', 'proposta_cia', 'produto_id',
  'cliente_id', 'produtor_id', 'canal_id', 'nome_segurado', 'documento_segurado', 'vinculo_origem', 'vinculo_em',
  'emitida_em', 'vigencia_inicio', 'vigencia_fim', 'premio_total', 'premio_liquido',
  'comissao', 'percentual_comissao', 'tipo_negocio', 'possui_sinistro', 'celula',
  'situacao_cia', 'endosso', 'cancelada_em', 'motivo_cancelamento',
  'origem_sistema', 'origem_arquivo', 'origem_lote', 'importado_em',
] as const;

/** Grava um lote de apólices. COALESCE no cabeçalho: carga só de faturas não apaga vigência/prêmio. */
export async function inserirApolices(
  apolices: ApoliceImportada[],
  conexao?: PoolConnection,
): Promise<number> {
  if (apolices.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();
  await adotarSemDocumento(executor, apolices.map((a) => ({ seguradoraId: a.seguradoraId, numero: a.numero, documento: a.documentoSegurado })));

  const valores: unknown[] = [];
  for (const a of apolices) {
    valores.push(
      a.seguradoraId, a.numero, a.numeroProvisorio ? 1 : 0, a.chaveNatural ?? null,
      a.numeroProposta ?? null, a.propostaCia ?? null, a.produtoId,
      a.clienteId, a.produtorId ?? null, a.canalId ?? null, nomeEmCaixaAlta(a.nomeSegurado), a.documentoSegurado, a.vinculoOrigem,
      a.vinculoOrigem ? agora : null,
      a.emitidaEm, a.vigenciaInicio, a.vigenciaFim, a.premioTotal, a.premioLiquido,
      a.comissao, a.percentualComissao, a.tipoNegocio ?? null,
      a.possuiSinistro === null || a.possuiSinistro === undefined ? null : a.possuiSinistro ? 1 : 0,
      a.celula ?? null,
      a.situacaoCia ?? null, a.endosso ?? null,
      a.canceladaEm ?? null, a.motivoCancelamento ?? null,
      a.origemSistema, a.origemArquivo, a.origemLote, agora,
    );
  }

  const tupla = `(${COLUNAS_APOLICE.map(() => '?').join(', ')})`;

  const PRESERVAR_SE_NULO = new Set([
    'cliente_id', 'produtor_id', 'documento_segurado', 'vinculo_origem', 'vinculo_em',
    'emitida_em', 'vigencia_inicio', 'vigencia_fim', 'premio_total', 'premio_liquido',
    'comissao', 'percentual_comissao', 'tipo_negocio', 'possui_sinistro', 'celula',
    'situacao_cia', 'endosso',
    // Cancelamento só se desfaz à mão: reimportar emissões não pode reativar.
    'cancelada_em', 'motivo_cancelamento',
    'chave_natural', 'numero_proposta', 'proposta_cia', 'canal_id',
    'produto_id',
  ]);

  // origem_lote FORA do UPDATE: desfazer apaga por lote e levaria apólices de outra carga.
  const NUNCA = new Set([
    'seguradora_id', 'numero', 'origem_lote',
    // Promoção é de mão única.
    'numero_provisorio',
  ]);

  const atualizaveis = COLUNAS_APOLICE.filter((c) => !NUNCA.has(c))
    .map((c) =>
      PRESERVAR_SE_NULO.has(c)
        ? `\`${c}\` = COALESCE(VALUES(\`${c}\`), \`${c}\`)`
        : `\`${c}\` = VALUES(\`${c}\`)`,
    )
    .join(', ');

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO apolices (${COLUNAS_APOLICE.map((c) => `\`${c}\``).join(', ')})
     VALUES ${apolices.map(() => tupla).join(', ')}
     ON DUPLICATE KEY UPDATE ${atualizaveis}`,
    valores,
  );

  return resultado.affectedRows;
}

/** Mapa "seguradoraId|numero" → id interno, para ligar os movimentos. */
export async function mapearIdsPorNumero(
  chaves: { seguradoraId: number; numero: string }[],
  conexao?: PoolConnection,
): Promise<Map<string, number>> {
  if (chaves.length === 0) return new Map();

  const executor = conexao ?? pool;

  const [linhas] = await executor.query<RowDataPacket[]>(
    `SELECT id, seguradora_id, numero FROM apolices WHERE (seguradora_id, numero) IN (?)`,
    [chaves.map((c) => [c.seguradoraId, c.numero])],
  );

  return new Map(
    linhas.map((l) => [`${Number(l.seguradora_id)}|${String(l.numero)}`, Number(l.id)]),
  );
}

export interface MovimentoImportado {
  apoliceId: number;
  sequencia: number;
  tipo: TipoMovimento;
  tipoOrigem: string | null;
  emitidaEm: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  premioTotal: string | null;
  premioLiquido: string | null;
  origemLote: string;
}

export async function inserirMovimentos(
  movimentos: MovimentoImportado[],
  conexao?: PoolConnection,
): Promise<number> {
  if (movimentos.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();

  const valores: unknown[] = [];
  for (const m of movimentos) {
    valores.push(
      m.apoliceId, m.sequencia, m.tipo, m.tipoOrigem,
      m.emitidaEm, m.vigenciaInicio, m.vigenciaFim,
      m.premioTotal, m.premioLiquido, m.origemLote, agora,
    );
  }

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO apolice_movimentos
       (apolice_id, sequencia, tipo, tipo_origem, emitida_em, vigencia_inicio,
        vigencia_fim, premio_total, premio_liquido, origem_lote, importado_em)
     VALUES ${movimentos.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE
       tipo_origem = VALUES(tipo_origem),
       emitida_em = VALUES(emitida_em),
       vigencia_inicio = VALUES(vigencia_inicio),
       vigencia_fim = VALUES(vigencia_fim),
       premio_total = VALUES(premio_total),
       premio_liquido = VALUES(premio_liquido),
       -- origem_lote fora do UPDATE (desfazer apaga por lote).
       importado_em = VALUES(importado_em)`,
    valores,
  );

  return resultado.affectedRows;
}

/**
 * Liga órfãs do lote pelo nome só quando casa com UM cliente (homônimo seria chute).
 * `vinculo_origem = 'nome'` permite revisar quando o documento aparecer.
 */
export async function vincularPorNomeExato(lote: string): Promise<number> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `UPDATE apolices a
        JOIN (
          SELECT c.nome, MIN(c.id) AS cliente_id
            FROM clientes c
           GROUP BY c.nome
          HAVING COUNT(*) = 1
        ) unicos ON unicos.nome = a.nome_segurado
        SET a.cliente_id     = unicos.cliente_id,
            a.vinculo_origem = 'nome',
            a.vinculo_em     = NOW(3)
      WHERE a.origem_lote = ?
        AND a.cliente_id IS NULL`,
    [lote],
  );

  return resultado.affectedRows;
}

export interface ResumoApolices {
  apolices: number;
  movimentos: number;
  semCliente: number;
  comVinculoPorNome: number;
  produtos: number;
  porTipo: Record<string, number>;
}

export async function resumo(): Promise<ResumoApolices> {
  const q = async (sql: string): Promise<RowDataPacket[]> => (await pool.query<RowDataPacket[]>(sql))[0];

  const [totais] = await q(
    `SELECT
       (SELECT COUNT(*) FROM apolices) AS apolices,
       (SELECT COUNT(*) FROM apolice_movimentos) AS movimentos,
       (SELECT COUNT(*) FROM apolices WHERE cliente_id IS NULL) AS sem_cliente,
       (SELECT COUNT(*) FROM apolices WHERE vinculo_origem = 'nome') AS por_nome,
       (SELECT COUNT(*) FROM produtos) AS produtos`,
  );

  const tipos = await q(
    'SELECT tipo, COUNT(*) AS n FROM apolice_movimentos GROUP BY tipo ORDER BY n DESC',
  );

  return {
    apolices: Number(totais?.apolices ?? 0),
    movimentos: Number(totais?.movimentos ?? 0),
    semCliente: Number(totais?.sem_cliente ?? 0),
    comVinculoPorNome: Number(totais?.por_nome ?? 0),
    produtos: Number(totais?.produtos ?? 0),
    porTipo: Object.fromEntries(tipos.map((l) => [String(l.tipo), Number(l.n)])),
  };
}

export interface ApoliceLinha extends RowDataPacket {
  id: number;
  uuid: Buffer;
  tipo_seguro: string | null;
  formulario: string | null;
  numero: string;
  seguradora: string;
  produto: string | null;
  nome_segurado: string;
  cliente_uuid: Buffer | null;
  cliente_nome: string | null;
  vinculo_origem: string | null;
  emitida_em: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  premio_total: string | null;
  premio_liquido: string | null;
  movimentos: number;
}

export interface FiltroApolices {
  busca?: string;
  seguradora?: string;
  /** 'sim' = só as sem cliente; 'nao' = só as vinculadas. */
  semCliente?: boolean;
  pagina: number;
  limite: number;

  /** Recorte de carteira: apólice sem cliente some para quem é recortado. */
  escopo?: Escopo;
}

const SELECT_APOLICE = `
  a.id, a.uuid, a.numero, a.numero_provisorio, a.nome_segurado, a.vinculo_origem,
  a.emitida_em, a.vigencia_inicio, a.vigencia_fim,
  a.premio_total, a.premio_liquido,
  s.nome AS seguradora,
  p.nome AS produto,
  t.nome AS tipo_seguro,
  t.formulario,
  c.uuid AS cliente_uuid,
  c.nome AS cliente_nome,
  (SELECT COUNT(*) FROM apolice_movimentos m WHERE m.apolice_id = a.id) AS movimentos`;

const FROM_APOLICE = `
  FROM apolices a
  JOIN seguradoras s ON s.id = a.seguradora_id
  LEFT JOIN produtos p ON p.id = a.produto_id
  -- O tipo da apólice vence o do produto.
  LEFT JOIN tipos_seguro t ON t.id = COALESCE(a.tipo_seguro_id, p.tipo_seguro_id)
  LEFT JOIN clientes c ON c.id = a.cliente_id`;

function montarFiltro(filtro: FiltroApolices): { sql: string; valores: unknown[] } {
  const condicoes: string[] = [];
  const valores: unknown[] = [];

  const carteira = condicaoDeCarteira(filtro.escopo, 'c.produtor_id');

  if (carteira.condicao) {
    condicoes.push(carteira.condicao);
    valores.push(...carteira.valores);
  }

  const busca = filtro.busca?.trim();

  if (busca) {
    condicoes.push('(a.numero LIKE ? OR a.nome_segurado LIKE ?)');
    valores.push(`%${busca}%`, `%${busca}%`);
  }

  if (filtro.seguradora) {
    condicoes.push('s.nome = ?');
    valores.push(filtro.seguradora);
  }

  if (filtro.semCliente === true) condicoes.push('a.cliente_id IS NULL');
  if (filtro.semCliente === false) condicoes.push('a.cliente_id IS NOT NULL');

  return { sql: condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '', valores };
}

export async function listar(
  filtro: FiltroApolices,
): Promise<{ total: number; linhas: ApoliceLinha[] }> {
  const { sql: where, valores } = montarFiltro(filtro);

  const [contagem] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${FROM_APOLICE} ${where}`,
    valores,
  );

  // Interpolados: o mysql2 manda LIMIT como string e o MySQL recusa. Valores com clamp.
  const limite = Math.min(Math.max(Math.trunc(filtro.limite), 1), 200);
  const offset = Math.max(Math.trunc((filtro.pagina - 1) * limite), 0);

  const [linhas] = await pool.query<ApoliceLinha[]>(
    `SELECT ${SELECT_APOLICE} ${FROM_APOLICE} ${where}
      ORDER BY a.vigencia_inicio DESC, a.numero
      LIMIT ${limite} OFFSET ${offset}`,
    valores,
  );

  return { total: Number(contagem[0]?.total ?? 0), linhas };
}

/** Apólices de um cliente, para a ficha. */
export async function listarDoCliente(clienteId: number): Promise<ApoliceLinha[]> {
  const [linhas] = await pool.execute<ApoliceLinha[]>(
    `SELECT ${SELECT_APOLICE} ${FROM_APOLICE}
      WHERE a.cliente_id = ?
      ORDER BY a.vigencia_fim DESC, a.numero`,
    [clienteId],
  );

  return linhas;
}

export interface MovimentoLinha extends RowDataPacket {
  sequencia: number;
  tipo: string;
  tipo_origem: string | null;
  emitida_em: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  premio_total: string | null;
  premio_liquido: string | null;
}

/** Seguradoras que têm apólice — para o filtro da tela. */
export async function seguradorasComApolice(): Promise<string[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT s.nome FROM apolices a
       JOIN seguradoras s ON s.id = a.seguradora_id
      ORDER BY s.nome`,
  );

  return linhas.map((l) => String(l.nome));
}

/** Quantas órfãs têm 0, 1 ou vários clientes com o mesmo nome. */
export async function resumoConciliacao(): Promise<{
  semCandidato: number;
  umCandidato: number;
  variosCandidatos: number;
}> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT SUM(candidatos = 0) AS sem,
            SUM(candidatos = 1) AS um,
            SUM(candidatos > 1) AS varios
       FROM vw_apolices_sem_cliente`,
  );

  const l = linhas[0];

  return {
    semCandidato: Number(l?.sem ?? 0),
    umCandidato: Number(l?.um ?? 0),
    variosCandidatos: Number(l?.varios ?? 0),
  };
}

/**
 * Recalcula o cabeçalho a partir de TODOS os movimentos gravados: o arquivo é filtrado por período,
 * e derivar dele deixaria um endosso sobrescrever a vigência real. Prêmio e emissão só do movimento
 * `apolice`; vigência aceita `endosso`; `fatura` nunca (a vigência dela é o mês cobrado).
 */
export async function recalcularCabecalhos(
  apoliceIds: number[],
  conexao?: PoolConnection,
): Promise<void> {
  if (apoliceIds.length === 0) return;

  const executor = conexao ?? pool;

  await executor.query(
    `UPDATE apolices a
       JOIN apolice_movimentos m ON m.id = (
              SELECT m2.id
                FROM apolice_movimentos m2
               WHERE m2.apolice_id = a.id
                 AND m2.tipo = 'apolice'
               ORDER BY m2.sequencia
               LIMIT 1
            )
        SET a.premio_total   = m.premio_total,
            a.premio_liquido = m.premio_liquido,
            a.emitida_em     = m.emitida_em
      WHERE a.id IN (?)`,
    [apoliceIds],
  );

  await executor.query(
    `UPDATE apolices a
       JOIN apolice_movimentos m ON m.id = (
              SELECT m2.id
                FROM apolice_movimentos m2
               WHERE m2.apolice_id = a.id
                 AND m2.tipo IN ('apolice', 'endosso')
               ORDER BY FIELD(m2.tipo, 'apolice', 'endosso'), m2.sequencia
               LIMIT 1
            )
        SET a.vigencia_inicio = m.vigencia_inicio,
            a.vigencia_fim    = m.vigencia_fim
      WHERE a.id IN (?)`,
    [apoliceIds],
  );
}

/** Liga órfãs pelo DOCUMENTO e reaponta as ligadas por nome: documento vence nome. */
export async function vincularPorDocumento(): Promise<{ novos: number; corrigidos: number }> {
  const [corrigidos] = await pool.execute<ResultSetHeader>(
    `UPDATE apolices a
        JOIN clientes c ON c.cpf_cnpj_numeros = a.documento_segurado
         SET a.cliente_id     = c.id,
             a.vinculo_origem = 'documento',
             a.vinculo_em     = NOW(3)
       WHERE a.documento_segurado IS NOT NULL
         AND a.vinculo_origem = 'nome'
         AND (a.cliente_id IS NULL OR a.cliente_id <> c.id)`,
  );

  const [novos] = await pool.execute<ResultSetHeader>(
    `UPDATE apolices a
        JOIN clientes c ON c.cpf_cnpj_numeros = a.documento_segurado
         SET a.cliente_id     = c.id,
             a.vinculo_origem = 'documento',
             a.vinculo_em     = NOW(3)
       WHERE a.documento_segurado IS NOT NULL
         AND a.cliente_id IS NULL`,
  );

  return { novos: novos.affectedRows, corrigidos: corrigidos.affectedRows };
}

export interface ApoliceCarteira {
  seguradoraId: number;
  numero: string;
  produtoId: number | null;
  nomeSegurado: string;
  documentoSegurado: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  numeroRenovacao: string | null;
  canceladaEm: string | null;
  motivoCancelamento: string | null;
  origemSistema: OrigemSistema;
  origemArquivo: string | null;
  origemLote: string;
}

/** Grava apólices de relatório de CARTEIRA: não toca prêmio, emissão nem movimentos; COALESCE no resto. */
export async function inserirCarteira(
  apolices: ApoliceCarteira[],
  conexao?: PoolConnection,
): Promise<number> {
  if (apolices.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();
  await adotarSemDocumento(executor, apolices.map((a) => ({ seguradoraId: a.seguradoraId, numero: a.numero, documento: a.documentoSegurado })));

  const COLUNAS = [
    'seguradora_id', 'numero', 'produto_id', 'nome_segurado', 'documento_segurado',
    'vigencia_inicio', 'vigencia_fim', 'numero_renovacao',
    'cancelada_em', 'motivo_cancelamento',
    'origem_sistema', 'origem_arquivo', 'origem_lote', 'importado_em',
  ];

  const valores: unknown[] = [];
  for (const a of apolices) {
    valores.push(
      a.seguradoraId, a.numero, a.produtoId, nomeEmCaixaAlta(a.nomeSegurado), a.documentoSegurado,
      a.vigenciaInicio, a.vigenciaFim, a.numeroRenovacao,
      a.canceladaEm, a.motivoCancelamento,
      a.origemSistema, a.origemArquivo, a.origemLote, agora,
    );
  }

  const tupla = `(${COLUNAS.map(() => '?').join(', ')})`;

  // origem_lote fora do UPDATE: a Porto repete apólices entre meses, e desfazer apagaria as de outra carga.
  const atualizaveis = COLUNAS.filter((c) => c !== 'seguradora_id' && c !== 'numero' && c !== 'origem_lote')
    .map((c) =>
      c === 'nome_segurado' || c === 'origem_arquivo' || c === 'importado_em'
        ? `\`${c}\` = VALUES(\`${c}\`)`
        : `\`${c}\` = COALESCE(VALUES(\`${c}\`), \`${c}\`)`,
    )
    .join(', ');

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO apolices (${COLUNAS.map((c) => `\`${c}\``).join(', ')})
     VALUES ${apolices.map(() => tupla).join(', ')}
     ON DUPLICATE KEY UPDATE ${atualizaveis}`,
    valores,
  );

  return resultado.affectedRows;
}

/**
 * Troca o número `PROV-` pelo verdadeiro, ligando pela `chave_natural` — sem isso o contrato
 * entraria duas vezes. Mão única: `numero_provisorio` está fora do UPDATE do upsert.
 */
export async function promoverProvisorias(
  candidatas: { seguradoraId: number; chaveNatural: string; numero: string }[],
  conexao?: PoolConnection,
): Promise<number> {
  if (candidatas.length === 0) return 0;

  const executor = conexao ?? pool;
  let promovidas = 0;

  for (const c of candidatas) {
    // Uma a uma: colisão na chave única abortaria um UPDATE em massa; aqui só é ignorada.
    try {
      const [r] = await executor.execute<ResultSetHeader>(
        `UPDATE apolices
            SET numero = ?, numero_provisorio = 0
          WHERE seguradora_id = ?
            AND chave_natural = ?
            AND numero_provisorio = 1`,
        [c.numero, c.seguradoraId, c.chaveNatural],
      );

      promovidas += r.affectedRows;
    } catch (erro) {
      // Duplicata: a apólice real já existe; a provisória sai na limpeza.
      if ((erro as { code?: string }).code !== 'ER_DUP_ENTRY') throw erro;
    }
  }

  return promovidas;
}

/**
 * Renomeia `PROV-<hash>` para `PROP-<proposta>` ANTES da gravação: o número é parte da chave e,
 * sem isso, a apólice entraria de novo. Uma a uma, como `promoverProvisorias`.
 */
export async function renumerarProvisoriasPelaProposta(
  candidatas: { seguradoraId: number; chaveNatural: string; numero: string }[],
  conexao?: PoolConnection,
): Promise<number> {
  if (candidatas.length === 0) return 0;

  const executor = conexao ?? pool;
  let renumeradas = 0;

  for (const c of candidatas) {
    try {
      const [r] = await executor.execute<ResultSetHeader>(
        `UPDATE apolices
            SET numero = ?
          WHERE seguradora_id = ?
            AND chave_natural = ?
            AND numero_provisorio = 1
            AND numero <> ?`,
        [c.numero, c.seguradoraId, c.chaveNatural, c.numero],
      );

      renumeradas += r.affectedRows;
    } catch (erro) {
      if ((erro as { code?: string }).code !== 'ER_DUP_ENTRY') throw erro;
    }
  }

  return renumeradas;
}

/** Apaga a provisória que tem gêmea de número real com a mesma chave natural (inflaria prêmio). */
export async function limparProvisoriasDuplicadas(
  conexao?: PoolConnection,
): Promise<number> {
  const executor = conexao ?? pool;

  const [r] = await executor.execute<ResultSetHeader>(
    // Alias `definitiva`: REAL é palavra reservada no MySQL.
    `DELETE prov FROM apolices prov
       JOIN apolices definitiva
         ON definitiva.seguradora_id  = prov.seguradora_id
        AND definitiva.chave_natural  = prov.chave_natural
        AND definitiva.numero_provisorio = 0
      WHERE prov.numero_provisorio = 1`,
  );

  return r.affectedRows;
}

export interface NovaApoliceManual {
  seguradoraId: number;
  tipoSeguroId: number;
  numero: string;
  produtoId: number | null;
  clienteId: number;
  nomeSegurado: string;
  documentoSegurado: string | null;
  emitidaEm: string | null;
  vigenciaInicio: string;
  vigenciaFim: string;
  tipoNegocio: 'novo' | 'renovacao' | null;
  premioTotal: number | null;
  premioLiquido: number | null;
}

/** A chave única da apólice já está ocupada? */
export async function existeNumero(
  seguradoraId: number,
  numero: string,
  documento: string | null,
): Promise<boolean> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    'SELECT 1 FROM apolices WHERE seguradora_id = ? AND numero = ? AND documento_chave = ?',
    [seguradoraId, numero, documento ?? ''],
  );
  return linhas.length > 0;
}

/** Apólice digitada na ficha: origem 'manual' sem lote (nenhum desfazer a apaga); situacao_cia nula. */
export async function criarManual(dados: NovaApoliceManual, conexao?: PoolConnection): Promise<number> {
  const executor = conexao ?? pool;
  const [r] = await executor.execute<ResultSetHeader>(
    `INSERT INTO apolices
       (seguradora_id, numero, numero_provisorio, produto_id, tipo_seguro_id, cliente_id,
        nome_segurado, documento_segurado, vinculo_origem, vinculo_em,
        emitida_em, vigencia_inicio, vigencia_fim, tipo_negocio,
        premio_total, premio_liquido, origem_sistema)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, 'manual', CURRENT_TIMESTAMP(3), ?, ?, ?, ?, ?, ?, 'manual')`,
    [
      dados.seguradoraId, dados.numero, dados.produtoId, dados.tipoSeguroId, dados.clienteId,
      nomeEmCaixaAlta(dados.nomeSegurado), dados.documentoSegurado,
      dados.emitidaEm, dados.vigenciaInicio, dados.vigenciaFim, dados.tipoNegocio,
      dados.premioTotal, dados.premioLiquido,
    ],
  );
  return r.insertId;
}

export interface DonoDaApolice {
  apoliceId: number;
  clienteId: number;
  nome: string;
  nomeSegurado: string | null;
  /** CPF/CNPJ do dono (só dígitos) — a consulta do portal da Porto não traz. */
  documento: string;
}

/** Dono de cada apólice da companhia, pelo número exato. */
export async function donosPorNumero(seguradoraId: number, numeros: string[]): Promise<Map<string, DonoDaApolice[]>> {
  const mapa = new Map<string, DonoDaApolice[]>();
  if (numeros.length === 0) return mapa;
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT a.id, a.numero, a.nome_segurado, c.id AS cliente_id, c.nome, c.cpf_cnpj_numeros
       FROM apolices a
       JOIN clientes c ON c.id = a.cliente_id
      WHERE a.seguradora_id = ? AND a.numero IN (?)`,
    [seguradoraId, [...new Set(numeros)]],
  );
  for (const l of linhas) {
    const k = String(l.numero);
    mapa.set(k, [
      ...(mapa.get(k) ?? []),
      {
        apoliceId: Number(l.id),
        clienteId: Number(l.cliente_id),
        nome: String(l.nome),
        nomeSegurado: l.nome_segurado === null ? null : String(l.nome_segurado),
        documento: String(l.cpf_cnpj_numeros),
      },
    ]);
  }
  return mapa;
}

/** Troca o nome MASCARADO do segurado; a regex com COLLATE utf8mb4_bin nunca toca nome limpo. */
export async function trocarSeguradoMascarado(
  apoliceIds: number[],
  nome: string,
  conexao: PoolConnection,
): Promise<number> {
  if (apoliceIds.length === 0) return 0;
  const [r] = await conexao.query<ResultSetHeader>(
    `UPDATE apolices SET nome_segurado = ?
      WHERE id IN (?) AND nome_segurado COLLATE utf8mb4_bin REGEXP '(^|[^[:alpha:]])X{2,}[a-z]'`,
    [nomeEmCaixaAlta(nome), apoliceIds],
  );
  return r.affectedRows;
}

/** Chaves `SEGURADORA|numero|documento` — espelho da chave única do banco. */
export async function chavesExistentes(numeros: string[]): Promise<string[]> {
  if (numeros.length === 0) return [];
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT UPPER(s.nome) AS seguradora, a.numero, COALESCE(a.documento_segurado, '') AS documento
       FROM apolices a JOIN seguradoras s ON s.id = a.seguradora_id
      WHERE a.numero IN (?)`,
    [numeros],
  );
  return linhas.map((l) => `${String(l.seguradora)}|${String(l.numero)}|${String(l.documento)}`);
}
