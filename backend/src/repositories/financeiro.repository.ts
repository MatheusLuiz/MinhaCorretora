import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import type { StatusParcela } from '../services/modelosFinanceiro.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';

export interface ParcelaImportada {
  apoliceId: number;
  sequenciaEmissao: number;
  numero: number;
  vencimento: string | null;
  vencimentoOriginal: string | null;
  valor: string | null;
  iof: string | null;
  formaPagamento: string | null;
  status: StatusParcela;
  statusOrigem: string | null;
  motivoRejeicao: string | null;
  dataRejeicao: string | null;
  origemArquivo: string | null;
  origemLote: string;
}

export async function inserirParcelas(
  parcelas: ParcelaImportada[],
  conexao?: PoolConnection,
): Promise<number> {
  if (parcelas.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();

  const valores: unknown[] = [];
  for (const p of parcelas) {
    valores.push(
      p.apoliceId, p.sequenciaEmissao, p.numero,
      p.vencimento, p.vencimentoOriginal, p.valor, p.iof,
      p.formaPagamento, p.status, p.statusOrigem,
      p.motivoRejeicao, p.dataRejeicao,
      p.origemArquivo, p.origemLote, agora,
    );
  }

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO parcelas
       (apolice_id, sequencia_emissao, numero, vencimento, vencimento_original,
        valor, iof, forma_pagamento, status, status_origem,
        motivo_rejeicao, data_rejeicao, origem_arquivo, origem_lote, importado_em)
     VALUES ${parcelas.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE
       vencimento = VALUES(vencimento),
       vencimento_original = COALESCE(VALUES(vencimento_original), vencimento_original),
       valor = VALUES(valor),
       iof = VALUES(iof),
       forma_pagamento = VALUES(forma_pagamento),
       status = VALUES(status),
       status_origem = VALUES(status_origem),
       motivo_rejeicao = VALUES(motivo_rejeicao),
       data_rejeicao = VALUES(data_rejeicao),
       origem_arquivo = VALUES(origem_arquivo),
       -- origem_lote fora do UPDATE (regra do CLAUDE.md): desfazer a carga
       -- nova não pode apagar o lançamento que a carga anterior trouxe.
       importado_em = VALUES(importado_em)`,
    valores,
  );

  return resultado.affectedRows;
}

/** Marca inadimplentes os clientes `ativo` com parcela em atraso; só roda quando pedido (decisão de negócio). */
export async function marcarInadimplentes(): Promise<number> {
  const [resultado] = await pool.execute<ResultSetHeader>(
    `UPDATE clientes c
        JOIN situacoes_cliente atual ON atual.id = c.situacao_id AND atual.chave = 'ativo'
        JOIN situacoes_cliente nova  ON nova.chave = 'inadimplente'
         SET c.situacao_id = nova.id,
             c.situacao_em = CURDATE()
       WHERE EXISTS (
               SELECT 1
                 FROM parcelas p
                 JOIN apolices a ON a.id = p.apolice_id
                WHERE a.cliente_id = c.id
                  AND p.status = 'atrasado'
             )`,
  );

  return resultado.affectedRows;
}

/** Quantos clientes SERIAM marcados — para o relatório antes de decidir. */
export async function contarInadimplentesEmPotencial(): Promise<number> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT a.cliente_id) AS n
       FROM parcelas p
       JOIN apolices a ON a.id = p.apolice_id
       JOIN clientes c ON c.id = a.cliente_id
       JOIN situacoes_cliente s ON s.id = c.situacao_id AND s.chave = 'ativo'
      WHERE p.status = 'atrasado'`,
  );

  return Number(linhas[0]?.n ?? 0);
}

export interface ComissaoImportada {
  seguradoraId: number;
  competencia: string;
  corretora: string | null;
  filial: string | null;
  codigoCliente: string | null;
  codigoEstabelecimento: string | null;
  numero: string;
  tipo: string | null;
  totalBruto: string | null;
  desconto: string | null;
  impostos: string | null;
  totalLiquido: string | null;
  pagoEm: string | null;
  formaPagamento: string | null;
  origemArquivo: string | null;
  origemLote: string;
}

export async function inserirComissoes(
  comissoes: ComissaoImportada[],
  conexao?: PoolConnection,
): Promise<number> {
  if (comissoes.length === 0) return 0;

  const executor = conexao ?? pool;
  const agora = new Date();

  const valores: unknown[] = [];
  for (const c of comissoes) {
    valores.push(
      c.seguradoraId, c.competencia, c.corretora, c.filial,
      c.codigoCliente, c.codigoEstabelecimento, c.numero, c.tipo,
      c.totalBruto, c.desconto, c.impostos, c.totalLiquido,
      c.pagoEm, c.formaPagamento, c.origemArquivo, c.origemLote, agora,
    );
  }

  const [resultado] = await executor.query<ResultSetHeader>(
    `INSERT INTO comissoes
       (seguradora_id, competencia, corretora, filial, codigo_cliente,
        codigo_estabelecimento, numero, tipo, total_bruto, desconto, impostos,
        total_liquido, pago_em, forma_pagamento, origem_arquivo, origem_lote, importado_em)
     VALUES ${comissoes.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE
       corretora = VALUES(corretora),
       filial = VALUES(filial),
       codigo_cliente = VALUES(codigo_cliente),
       tipo = VALUES(tipo),
       total_bruto = VALUES(total_bruto),
       desconto = VALUES(desconto),
       impostos = VALUES(impostos),
       total_liquido = VALUES(total_liquido),
       pago_em = VALUES(pago_em),
       forma_pagamento = VALUES(forma_pagamento),
       origem_arquivo = VALUES(origem_arquivo),
       -- origem_lote fora do UPDATE: o recibo da Suhai cobre 14 meses, e
       -- reimportá-lo faria a carga nova adotar os recibos antigos.
       importado_em = VALUES(importado_em)`,
    valores,
  );

  return resultado.affectedRows;
}

export interface ResumoFinanceiro {
  parcelas: number;
  parcelasAtrasadas: number;
  valorEmAtraso: number;
  clientesInadimplentes: number;
  apolicesComAtraso: number;
  /** Parcelas com mais de `DIAS_DE_ATRASO_GRAVE` dias de atraso, e o valor delas. */
  parcelasAtrasoGrave: number;
  valorAtrasoGrave: number;
  /** Apólices em atraso sem cliente — a dívida existe e entra no total. */
  atrasoSemCliente: number;
  comissoes: number;
  comissaoLiquida: number;
  competencias: string[];
}

/** Atraso acima disto é o que a tela destaca como mais urgente. */
export const DIAS_DE_ATRASO_GRAVE = 30;

/**
 * Números do topo do painel: mesma view e recorte da tabela. A comissão vem por filial, sem
 * corretor: sem `comissoes.todas`, zero. `seguradora` é o nome (dado, via `?`).
 */
export async function resumo(
  escopo: Escopo = ESCOPO_TOTAL,
  seguradora?: string,
): Promise<ResumoFinanceiro> {
  const q = async (sql: string, valores: unknown[] = []): Promise<RowDataPacket[]> =>
    (await pool.query<RowDataPacket[]>(sql, valores))[0];

  const condicoes: string[] = [];
  const valores: unknown[] = [];

  const carteira = condicaoDeCarteira(escopo, 'produtor_id');

  if (carteira.condicao) {
    condicoes.push(carteira.condicao);
    valores.push(...carteira.valores);
  }

  if (!escopo.inadimplenciaCompleta) condicoes.push('atrasos_do_cliente = 1');

  if (seguradora) {
    condicoes.push('seguradora = ?');
    valores.push(seguradora);
  }

  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

  const [atraso] = await q(
    `SELECT COUNT(*) AS atrasadas,
            COALESCE(SUM(valor), 0) AS valor,
            COUNT(DISTINCT apolice_id) AS apolices,
            COUNT(DISTINCT cliente_id) AS clientes,
            COUNT(DISTINCT CASE WHEN cliente_id IS NULL THEN apolice_id END) AS sem_cliente,
            SUM(dias_em_atraso > ?) AS graves,
            COALESCE(SUM(CASE WHEN dias_em_atraso > ? THEN valor END), 0) AS valor_graves
       FROM vw_inadimplencia ${where}`,
    [DIAS_DE_ATRASO_GRAVE, DIAS_DE_ATRASO_GRAVE, ...valores],
  );

  // Total de parcelas (atrasadas ou não) só faz sentido sem recorte: a view de
  // inadimplência não conhece as parcelas em dia.
  const [p] = escopo.produtorIds === null
    ? await q('SELECT COUNT(*) AS total FROM parcelas')
    : [undefined];

  const [c] = escopo.comissoesTodas
    ? await q('SELECT COUNT(*) AS total, SUM(total_liquido) AS liquido FROM comissoes')
    : [undefined];

  const competencias = escopo.comissoesTodas
    ? await q('SELECT DISTINCT competencia FROM comissoes ORDER BY competencia DESC')
    : [];

  return {
    parcelas: Number(p?.total ?? atraso?.atrasadas ?? 0),
    parcelasAtrasadas: Number(atraso?.atrasadas ?? 0),
    valorEmAtraso: Number(atraso?.valor ?? 0),
    apolicesComAtraso: Number(atraso?.apolices ?? 0),
    atrasoSemCliente: Number(atraso?.sem_cliente ?? 0),
    clientesInadimplentes: Number(atraso?.clientes ?? 0),
    parcelasAtrasoGrave: Number(atraso?.graves ?? 0),
    valorAtrasoGrave: Number(atraso?.valor_graves ?? 0),
    comissoes: Number(c?.total ?? 0),
    comissaoLiquida: Number(c?.liquido ?? 0),
    competencias: competencias.map((l) => String(l.competencia)),
  };
}

/**
 * Parcelas atrasadas visíveis ao usuário. Sem `inadimplencia.completa`, só o cliente com UM
 * atraso — do segundo em diante o caso sai inteiro (meia dívida pareceria o total).
 */
export async function listarInadimplencia(
  limite = 100,
  escopo: Escopo = ESCOPO_TOTAL,
  seguradora?: string,
): Promise<RowDataPacket[]> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 500);

  const condicoes: string[] = [];
  const valores: unknown[] = [];

  // Qualificado por `v`: a junção com `clientes` traz outra `produtor_id`, e
  // sem o prefixo o MySQL recusa a consulta por ambiguidade.
  const carteira = condicaoDeCarteira(escopo, 'v.produtor_id');

  if (carteira.condicao) {
    condicoes.push(carteira.condicao);
    valores.push(...carteira.valores);
  }

  if (!escopo.inadimplenciaCompleta) condicoes.push('v.atrasos_do_cliente = 1');

  if (seguradora) {
    condicoes.push('v.seguradora = ?');
    valores.push(seguradora);
  }

  const where = condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '';

  // O corretor vem de `clientes.produtor_id`: o relatório de parcelas não diz quem vendeu.
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT v.*,
            BIN_TO_UUID(c.uuid, 1) AS cliente_uuid,
            pr.nome  AS produtor,
            sit.nome AS situacao_cliente
       FROM vw_inadimplencia v
       LEFT JOIN clientes c            ON c.id   = v.cliente_id
       LEFT JOIN produtores pr         ON pr.id  = c.produtor_id
       LEFT JOIN situacoes_cliente sit ON sit.id = c.situacao_id
      ${where}
      ORDER BY v.dias_em_atraso DESC, v.valor DESC
      LIMIT ${n}`,
    valores,
  );

  return linhas;
}

export interface ComissaoDeCliente {
  clienteId: string;
  nome: string;
  cpfCnpj: string | null;
  situacao: string | null;
  produtor: string | null;
  apolices: number;
  premio: number;
  comissao: number;
  /** Comissão sobre prêmio, em %. Nulo quando não há prêmio conhecido. */
  percentual: number | null;
}

/**
 * Comissão por cliente sai de `apolices.comissao` (o que a carteira GERA), não de `comissoes`
 * (o que a seguradora PAGOU) — somar as duas contaria em dobro. Período pela EMISSÃO.
 */
function condicoesDaComissaoPorCliente(
  escopo: Escopo,
  periodo?: { de: string; ate: string },
): { condicoes: string[]; valores: unknown[] } {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const condicoes = ['a.comissao IS NOT NULL'];
  const valores: unknown[] = [];

  if (carteira.condicao) {
    condicoes.push(carteira.condicao);
    valores.push(...carteira.valores);
  }
  if (periodo) {
    condicoes.push('a.emitida_em >= ? AND a.emitida_em < ?');
    valores.push(periodo.de, periodo.ate);
  }
  return { condicoes, valores };
}

export async function comissaoPorCliente(
  escopo: Escopo = ESCOPO_TOTAL,
  limite = 100,
  periodo?: { de: string; ate: string },
): Promise<ComissaoDeCliente[]> {
  const n = Math.min(Math.max(Math.trunc(limite), 1), 500);
  const { condicoes, valores } = condicoesDaComissaoPorCliente(escopo, periodo);

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT BIN_TO_UUID(c.uuid, 1) AS cliente_id,
            c.nome, c.cpf_cnpj,
            sit.nome AS situacao,
            pr.nome  AS produtor,
            COUNT(*) AS apolices,
            COALESCE(SUM(a.premio_total), 0) AS premio,
            SUM(a.comissao) AS comissao
       FROM apolices a
       JOIN clientes c ON c.id = a.cliente_id
       LEFT JOIN produtores pr ON pr.id = c.produtor_id
       LEFT JOIN situacoes_cliente sit ON sit.id = c.situacao_id
      WHERE ${condicoes.join(' AND ')}
      GROUP BY c.id
      ORDER BY comissao DESC
      LIMIT ${n}`,
    valores,
  );

  return linhas.map((l) => {
    const premio = Number(l.premio ?? 0);
    const comissao = Number(l.comissao ?? 0);

    return {
      clienteId: String(l.cliente_id),
      nome: String(l.nome),
      cpfCnpj: l.cpf_cnpj === null ? null : String(l.cpf_cnpj),
      situacao: l.situacao === null ? null : String(l.situacao),
      produtor: l.produtor === null ? null : String(l.produtor),
      apolices: Number(l.apolices ?? 0),
      premio,
      comissao,
      // Sem prêmio conhecido o percentual seria divisão por zero — e um "0%"
      // seria lido como comissão zerada, que é outra afirmação.
      percentual: premio > 0 ? (comissao / premio) * 100 : null,
    };
  });
}

/** Totais da comissão apurada por apólice, para o topo da tela. */
export async function totaisComissaoDaCarteira(
  escopo: Escopo = ESCOPO_TOTAL,
  periodo?: { de: string; ate: string },
): Promise<{ clientes: number; apolices: number; comissao: number; premio: number }> {
  const { condicoes, valores } = condicoesDaComissaoPorCliente(escopo, periodo);

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT c.id) AS clientes, COUNT(*) AS apolices,
            SUM(a.comissao) AS comissao, COALESCE(SUM(a.premio_total), 0) AS premio
       FROM apolices a
       JOIN clientes c ON c.id = a.cliente_id
      WHERE ${condicoes.join(' AND ')}`,
    valores,
  );

  const l = linhas[0];

  return {
    clientes: Number(l?.clientes ?? 0),
    apolices: Number(l?.apolices ?? 0),
    comissao: Number(l?.comissao ?? 0),
    premio: Number(l?.premio ?? 0),
  };
}

/** Uma linha do "Analítico dos Pagamentos de Comissões". */
export interface ItemAnalitico {
  sequencia: number;
  numeroApolice: string;
  nomeSegurado: string | null;
  marca: string | null;
  sucursal: string | null;
  ramoCodigo: string | null;
  susepProducao: string | null;
  faturaEndosso: string | null;
  parcela: number | null;
  carne: string | null;
  data: string | null;
  /** Nulo quando o demonstrativo não traz prêmio (Suhai). */
  premioLiquido: number | null;
  percentualComissao: number;
  comissao: number;
  tipoCodigo: string | null;
  tipoDescricao: string | null;
  /** Resolvido por `apolicesPorNumero`; nulo quando a apólice não está na base. */
  apoliceId?: number | null;
}

/** Número de apólice → id, por companhia (o número só é único dentro dela). */
export async function apolicesPorNumero(
  seguradoraId: number,
  numeros: string[],
): Promise<Map<string, number>> {
  const limpos = [...new Set(numeros.filter(Boolean))];
  if (limpos.length === 0) return new Map();

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT id, numero FROM apolices
      WHERE seguradora_id = ? AND numero IN (${limpos.map(() => '?').join(', ')})`,
    [seguradoraId, ...limpos],
  );

  const mapa = new Map(linhas.map((l) => [String(l.numero), Number(l.id)]));

  // A Porto grava `531-7-23456789`; o analítico traz `23456789`. Sem casar inteiro, tenta o
  // último pedaço, só se for único na companhia.
  const faltam = limpos.filter((n) => !mapa.has(n));
  if (faltam.length > 0) {
    const [porPedaco] = await pool.query<RowDataPacket[]>(
      `SELECT SUBSTRING_INDEX(numero, '-', -1) AS pedaco, MIN(id) AS id, COUNT(*) AS n
         FROM apolices
        WHERE seguradora_id = ? AND numero LIKE '%-%' AND SUBSTRING_INDEX(numero, '-', -1) IN (?)
        GROUP BY pedaco`,
      [seguradoraId, faltam],
    );
    for (const l of porPedaco) if (Number(l.n) === 1) mapa.set(String(l.pedaco), Number(l.id));
  }

  return mapa;
}

export interface AnaliticoParaGravar {
  seguradoraId: number;
  competencia: string;
  /** Rótulo do pagamento em `comissoes.tipo`; padrão "Analítico de comissões" (Porto). */
  tipo?: string;
  /** A ordem de pagamento — é ela que identifica o demonstrativo. */
  ordem: string;
  pagoEm: string | null;
  empresa: string | null;
  susepFavorecida: string | null;
  comissaoBruta: number;
  impostos: number;
  liquido: number;
  itens: ItemAnalitico[];
  origemArquivo: string | null;
  origemLote: string;
}

/**
 * Grava a ordem e suas linhas numa transação. Apaga as linhas antes de inserir: um
 * demonstrativo corrigido com uma linha a MENOS deixaria a última órfã no upsert.
 */
export async function gravarAnalitico(dados: AnaliticoParaGravar): Promise<number> {
  const conexao = await pool.getConnection();
  const agora = new Date();

  try {
    await conexao.beginTransaction();

    await inserirComissoes(
      [
        {
          seguradoraId: dados.seguradoraId,
          competencia: dados.competencia,
          corretora: dados.empresa,
          // A Susep de produção varia DENTRO da ordem, então ela é do item.
          // Aqui a filial é a favorecida, que é única por pagamento.
          filial: dados.susepFavorecida,
          codigoCliente: null,
          codigoEstabelecimento: dados.susepFavorecida,
          numero: dados.ordem,
          tipo: dados.tipo ?? 'Analítico de comissões',
          totalBruto: dados.comissaoBruta.toFixed(2),
          desconto: null,
          impostos: dados.impostos.toFixed(2),
          totalLiquido: dados.liquido.toFixed(2),
          pagoEm: dados.pagoEm,
          formaPagamento: null,
          origemArquivo: dados.origemArquivo,
          origemLote: dados.origemLote,
        },
      ],
      conexao,
    );

    const [achado] = await conexao.query<RowDataPacket[]>(
      `SELECT id, origem_lote FROM comissoes
        WHERE seguradora_id = ? AND competencia = ?
          AND codigo_estabelecimento <=> ? AND numero = ?`,
      [dados.seguradoraId, dados.competencia, dados.susepFavorecida, dados.ordem],
    );

    const comissaoId = Number(achado[0]?.id ?? 0);
    if (!comissaoId) throw new Error('A ordem de pagamento não pôde ser localizada após a gravação.');

    // origem_lote: linha regravada mantém o lote de quem criou o pagamento, nunca o desta carga.
    const loteDasLinhas = (achado[0]?.origem_lote as string | null) ?? dados.origemLote;

    await conexao.query('DELETE FROM comissoes_itens WHERE comissao_id = ?', [comissaoId]);

    if (dados.itens.length > 0) {
      const valores: unknown[] = [];
      for (const i of dados.itens) {
        valores.push(
          comissaoId, i.sequencia, i.apoliceId ?? null, i.numeroApolice, i.nomeSegurado,
          i.marca, i.sucursal, i.ramoCodigo, i.susepProducao, i.faturaEndosso,
          i.parcela, i.carne, i.data,
          i.premioLiquido === null ? null : i.premioLiquido.toFixed(2), i.percentualComissao.toFixed(2), i.comissao.toFixed(2),
          i.tipoCodigo, i.tipoDescricao, loteDasLinhas, agora,
        );
      }

      await conexao.query(
        `INSERT INTO comissoes_itens
           (comissao_id, sequencia, apolice_id, numero_apolice, nome_segurado,
            marca, sucursal, ramo_codigo, susep_producao, fatura_endosso,
            parcela, carne, data,
            premio_liquido, percentual_comissao, comissao,
            tipo_codigo, tipo_descricao, origem_lote, importado_em)
         VALUES ${dados.itens.map(() => `(${new Array(20).fill('?').join(', ')})`).join(', ')}`,
        valores,
      );
    }

    await conexao.commit();
    return comissaoId;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/** Ordens pedidas (o que falta) e todas as da competência (o que sobra), para conferir o extrato. */
export async function comissoesPorOrdem(
  ordens: string[],
  competencias: string[],
): Promise<{
  porOrdem: Map<string, { bruto: number; liquido: number }>;
  daCompetencia: { ordem: string; competencia: string; bruto: number; liquido: number }[];
}> {
  const limpas = [...new Set(ordens.filter(Boolean))];
  const porOrdem = new Map<string, { bruto: number; liquido: number }>();

  if (limpas.length > 0) {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT numero, total_bruto, total_liquido FROM comissoes
        WHERE numero IN (${limpas.map(() => '?').join(', ')})`,
      limpas,
    );

    for (const l of linhas) {
      porOrdem.set(String(l.numero), {
        bruto: Number(l.total_bruto ?? 0),
        liquido: Number(l.total_liquido ?? 0),
      });
    }
  }

  const meses = [...new Set(competencias.filter(Boolean))];
  let daCompetencia: { ordem: string; competencia: string; bruto: number; liquido: number }[] = [];

  if (meses.length > 0) {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT numero, competencia, total_bruto, total_liquido FROM comissoes
        WHERE competencia IN (${meses.map(() => '?').join(', ')})
        ORDER BY numero`,
      meses,
    );

    daCompetencia = linhas.map((l) => ({
      ordem: String(l.numero),
      competencia: String(l.competencia),
      bruto: Number(l.total_bruto ?? 0),
      liquido: Number(l.total_liquido ?? 0),
    }));
  }

  return { porOrdem, daCompetencia };
}

/**
 * Fração do prêmio que vira comissão: % declarado, senão comissão ÷ prêmio. Nula (Bradesco)
 * não é zero: entra como "sem percentual".
 */
export const TAXA_DA_APOLICE = `COALESCE(a.percentual_comissao / 100, a.comissao / NULLIF(a.premio_total, 0))`;

export interface RecebidoLinha {
  mes: string;
  seguradora: string;
  lancamentos: number;
  bruto: number;
  impostos: number;
  liquido: number;
}

export interface PendenteLinha {
  mes: string;
  seguradora: string;
  /** `aberto` = ainda vai vencer; `atraso` = venceu e o cliente não pagou. */
  situacao: 'aberto' | 'atraso';
  parcelas: number;
  premio: number;
  /** Comissão estimada das parcelas COM taxa conhecida. */
  comissao: number;
  semTaxaParcelas: number;
  semTaxaPremio: number;
}

/**
 * Comissão recebida (demonstrativo, por `pago_em`) e a receber (parcela não paga × taxa, pelo
 * vencimento) em [de, ate). As duas não se conciliam linha a linha.
 * `atrasoAnterior`: pendências vencidas antes do período, ainda sem pagamento.
 */
export async function comissaoNoPeriodo(
  de: string,
  ate: string,
  escopo?: Escopo,
): Promise<{
  recebido: RecebidoLinha[];
  pendente: PendenteLinha[];
  atrasoAnterior: Omit<PendenteLinha, 'mes' | 'situacao'>[];
}> {
  const carteira = condicaoDeCarteira(escopo ?? ESCOPO_TOTAL, 'c.produtor_id');
  const filtroCarteira = carteira.condicao ? `AND ${carteira.condicao}` : '';

  const colunasPendentes = `
    COUNT(*) AS parcelas,
    SUM(p.valor) AS premio,
    -- Arredondada POR PARCELA antes de somar, como a Fila de comissões
    -- (parcelasAReceber) mostra cada uma: somar sem arredondar dava 1 centavo
    -- de diferença entre a fila e este total.
    SUM(CASE WHEN ${TAXA_DA_APOLICE} IS NOT NULL THEN ROUND(p.valor * ${TAXA_DA_APOLICE}, 2) ELSE 0 END) AS comissao,
    SUM(${TAXA_DA_APOLICE} IS NULL) AS sem_taxa_parcelas,
    SUM(CASE WHEN ${TAXA_DA_APOLICE} IS NULL THEN p.valor ELSE 0 END) AS sem_taxa_premio`;

  const [[recebido], [pendente], [anterior]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(cm.pago_em, '%Y-%m') AS mes, s.nome AS seguradora,
              COUNT(*) AS lancamentos,
              SUM(cm.total_bruto) AS bruto, SUM(cm.impostos) AS impostos,
              SUM(cm.total_liquido) AS liquido
         FROM comissoes cm
         JOIN seguradoras s ON s.id = cm.seguradora_id
        WHERE cm.pago_em >= ? AND cm.pago_em < ?
        GROUP BY mes, s.nome
        ORDER BY mes, s.nome`,
      [de, ate],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(p.vencimento, '%Y-%m') AS mes, s.nome AS seguradora,
              CASE WHEN p.status = 'atrasado' OR p.vencimento < CURDATE()
                   THEN 'atraso' ELSE 'aberto' END AS situacao,
              ${colunasPendentes}
         FROM parcelas p
         JOIN apolices a ON a.id = p.apolice_id
         JOIN seguradoras s ON s.id = a.seguradora_id
         LEFT JOIN clientes c ON c.id = a.cliente_id
        WHERE p.status IN ('aberto', 'atrasado')
          AND p.vencimento >= ? AND p.vencimento < ?
          ${filtroCarteira}
        GROUP BY mes, s.nome, situacao
        ORDER BY mes, s.nome`,
      [de, ate, ...carteira.valores],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT s.nome AS seguradora, ${colunasPendentes}
         FROM parcelas p
         JOIN apolices a ON a.id = p.apolice_id
         JOIN seguradoras s ON s.id = a.seguradora_id
         LEFT JOIN clientes c ON c.id = a.cliente_id
        WHERE p.status IN ('aberto', 'atrasado')
          AND p.vencimento < ? AND p.vencimento < CURDATE()
          ${filtroCarteira}
        GROUP BY s.nome
        ORDER BY s.nome`,
      [de, ...carteira.valores],
    ),
  ]);

  const pendentes = (l: RowDataPacket): Omit<PendenteLinha, 'mes' | 'situacao'> => ({
    seguradora: String(l.seguradora),
    parcelas: Number(l.parcelas),
    premio: Number(l.premio ?? 0),
    // Estimativa em centavos: a multiplicação pela taxa deixa dízima.
    comissao: Math.round(Number(l.comissao ?? 0) * 100) / 100,
    semTaxaParcelas: Number(l.sem_taxa_parcelas ?? 0),
    semTaxaPremio: Number(l.sem_taxa_premio ?? 0),
  });

  return {
    recebido: recebido.map((l) => ({
      mes: String(l.mes),
      seguradora: String(l.seguradora),
      lancamentos: Number(l.lancamentos),
      bruto: Number(l.bruto ?? 0),
      impostos: Number(l.impostos ?? 0),
      liquido: Number(l.liquido ?? 0),
    })),
    pendente: pendente.map((l) => ({
      mes: String(l.mes),
      situacao: l.situacao === 'atraso' ? 'atraso' : 'aberto',
      ...pendentes(l),
    })),
    atrasoAnterior: anterior.map(pendentes),
  };
}

export interface ParcelaAReceber {
  parcelaId: number;
  mes: string;
  vencimento: string | null;
  situacao: 'aberto' | 'atraso';
  seguradora: string;
  apolice: string;
  numeroParcela: number;
  valor: number;
  /** Comissão estimada: valor × taxa da apólice. NULL = taxa desconhecida. */
  comissao: number | null;
  percentual: number | null;
  clienteUuid: string | null;
  cliente: string;
  corretor: string | null;
  telefone: string | null;
  email: string | null;
}

/** A receber parcela a parcela (Fila de comissões): mesmas regras de `comissaoNoPeriodo`, para as somas baterem. */
export async function parcelasAReceber(de: string, ate: string, escopo?: Escopo): Promise<ParcelaAReceber[]> {
  const carteira = condicaoDeCarteira(escopo ?? ESCOPO_TOTAL, 'c.produtor_id');
  const filtroCarteira = carteira.condicao ? `AND ${carteira.condicao}` : '';

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT p.id, DATE_FORMAT(p.vencimento, '%Y-%m') AS mes, p.vencimento, p.numero AS numero_parcela,
            p.valor,
            CASE WHEN p.status = 'atrasado' OR p.vencimento < CURDATE() THEN 'atraso' ELSE 'aberto' END AS situacao,
            s.nome AS seguradora, a.numero AS apolice, a.nome_segurado,
            ${TAXA_DA_APOLICE} AS taxa,
            -- ROUND decimal do MySQL, igual ao de comissaoNoPeriodo: arredondar
            -- em JS (ponto flutuante) poderia divergir no meio centavo.
            ROUND(p.valor * ${TAXA_DA_APOLICE}, 2) AS comissao,
            BIN_TO_UUID(c.uuid, 1) AS cliente_uuid, c.nome AS cliente, pr.nome AS corretor,
            (SELECT t.completo FROM telefones t
              WHERE t.cliente_id = c.id ORDER BY t.principal DESC, t.id LIMIT 1) AS telefone,
            (SELECT e.endereco FROM emails e
              WHERE e.cliente_id = c.id ORDER BY e.principal DESC, e.id LIMIT 1) AS email
       FROM parcelas p
       JOIN apolices a ON a.id = p.apolice_id
       JOIN seguradoras s ON s.id = a.seguradora_id
       LEFT JOIN clientes c ON c.id = a.cliente_id
       LEFT JOIN produtores pr ON pr.id = c.produtor_id
      WHERE p.status IN ('aberto', 'atrasado')
        AND p.vencimento >= ? AND p.vencimento < ?
        ${filtroCarteira}
      ORDER BY p.vencimento, s.nome, a.numero
      LIMIT 2000`,
    [de, ate, ...carteira.valores],
  );

  return linhas.map((l) => {
    const taxa = l.taxa === null ? null : Number(l.taxa);
    const valor = Number(l.valor ?? 0);
    return {
      parcelaId: Number(l.id),
      mes: String(l.mes),
      vencimento: l.vencimento === null ? null : String(l.vencimento).slice(0, 10),
      situacao: l.situacao === 'atraso' ? 'atraso' : 'aberto',
      seguradora: String(l.seguradora),
      apolice: String(l.apolice),
      numeroParcela: Number(l.numero_parcela),
      valor,
      comissao: l.comissao === null ? null : Number(l.comissao),
      percentual: taxa === null ? null : Math.round(taxa * 10000) / 100,
      clienteUuid: l.cliente_uuid === null ? null : String(l.cliente_uuid),
      cliente: String(l.cliente ?? l.nome_segurado ?? ''),
      corretor: l.corretor === null ? null : String(l.corretor),
      telefone: l.telefone === null ? null : String(l.telefone),
      email: l.email === null ? null : String(l.email),
    };
  });
}

/** Lançamentos pagos em [de, ate) (teto 1.000: a tela soma a lista) ou os 200 mais recentes. */
export async function listarLancamentos(de?: string, ate?: string): Promise<RowDataPacket[]> {
  const noPeriodo = de && ate;
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT c.competencia, c.corretora, c.filial, c.numero, c.tipo,
            c.total_bruto, c.desconto, c.impostos, c.total_liquido,
            c.pago_em, c.forma_pagamento, s.nome AS seguradora,
            -- Mesma regra de comissaoPorTipoDeServico: sem filial, vale o tipo
            -- único habilitado da seguradora (Suhai = Auto).
            COALESCE(c.filial,
              (SELECT MIN(t.nome) FROM seguradora_tipos_seguro st
                 JOIN tipos_seguro t ON t.id = st.tipo_seguro_id AND t.ativo = 1
                WHERE st.seguradora_id = c.seguradora_id HAVING COUNT(*) = 1)) AS tipo_servico
       FROM comissoes c
       JOIN seguradoras s ON s.id = c.seguradora_id
      ${noPeriodo ? 'WHERE c.pago_em >= ? AND c.pago_em < ?' : ''}
      ORDER BY c.pago_em DESC, c.numero
      LIMIT ${noPeriodo ? 1000 : 200}`,
    noPeriodo ? [de, ate] : [],
  );
  return linhas;
}

/** Créditos do extrato do Bradesco de uma empresa do grupo (`AAAA-MM-DD AUTO|VIDA|SAUDE`), por data. */
export async function creditosBradesco(
  seguradoraId: number,
  empresa: 'AUTO' | 'VIDA' | 'SAUDE',
): Promise<{ id: number; pagoEm: string; bruto: number }[]> {
  const [linhas] = await pool.execute<RowDataPacket[]>(
    `SELECT id, pago_em, total_bruto
       FROM comissoes
      WHERE seguradora_id = ? AND numero LIKE ? AND pago_em IS NOT NULL
      ORDER BY pago_em`,
    [seguradoraId, `% ${empresa}`],
  );
  return linhas.map((l) => ({
    id: Number(l.id),
    pagoEm: String(l.pago_em).slice(0, 10),
    bruto: Number(l.total_bruto ?? 0),
  }));
}

/** Número → id só quando ÚNICO na companhia: item de frota (`123456/7`) chega sem item e fica nulo. */
export async function apolicesUnicasPorNumero(
  seguradoraId: number,
  numeros: string[],
): Promise<Map<string, number>> {
  const limpos = [...new Set(numeros.filter(Boolean))];
  if (limpos.length === 0) return new Map();
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT numero, MIN(id) AS id
       FROM apolices
      WHERE seguradora_id = ? AND numero IN (?)
      GROUP BY numero
     HAVING COUNT(*) = 1`,
    [seguradoraId, limpos],
  );
  return new Map(linhas.map((l) => [String(l.numero), Number(l.id)]));
}

export interface ItemDetalheComissao {
  sequencia: number;
  apoliceId: number | null;
  numeroApolice: string;
  nomeSegurado: string | null;
  marca: string | null;
  sucursal: string | null;
  ramoCodigo: string | null;
  faturaEndosso: string | null;
  parcela: number | null;
  data: string | null;
  premioLiquido: number | null;
  percentualComissao: number | null;
  comissao: number;
  tipoCodigo: string | null;
  tipoDescricao: string | null;
}

/** Troca os itens de vários créditos numa transação: apaga e regrava, sem linha órfã. */
export async function substituirItensDeComissoes(
  porComissao: Map<number, ItemDetalheComissao[]>,
  origemLote: string,
): Promise<number> {
  const conexao = await pool.getConnection();
  const agora = new Date();
  let gravados = 0;

  try {
    await conexao.beginTransaction();

    for (const [comissaoId, itens] of porComissao) {
      // Regravado, o item conserva o lote de quem o criou (regra do
      // `origem_lote`, ver `gravarAnalitico`); item novo leva o desta carga.
      const [antes] = await conexao.query<RowDataPacket[]>(
        'SELECT origem_lote FROM comissoes_itens WHERE comissao_id = ? AND origem_lote IS NOT NULL ORDER BY id LIMIT 1',
        [comissaoId],
      );
      const loteDasLinhas = (antes[0]?.origem_lote as string | undefined) ?? origemLote;

      await conexao.query('DELETE FROM comissoes_itens WHERE comissao_id = ?', [comissaoId]);
      if (itens.length === 0) continue;

      const valores: unknown[] = [];
      for (const i of itens) {
        valores.push(
          comissaoId, i.sequencia, i.apoliceId, i.numeroApolice, i.nomeSegurado,
          i.marca, i.sucursal, i.ramoCodigo, null, i.faturaEndosso,
          i.parcela, null, i.data,
          i.premioLiquido === null ? null : i.premioLiquido.toFixed(2),
          i.percentualComissao === null ? null : i.percentualComissao.toFixed(2),
          i.comissao.toFixed(2),
          i.tipoCodigo, i.tipoDescricao, loteDasLinhas, agora,
        );
      }

      await conexao.query(
        `INSERT INTO comissoes_itens
           (comissao_id, sequencia, apolice_id, numero_apolice, nome_segurado,
            marca, sucursal, ramo_codigo, susep_producao, fatura_endosso,
            parcela, carne, data,
            premio_liquido, percentual_comissao, comissao,
            tipo_codigo, tipo_descricao, origem_lote, importado_em)
         VALUES ${itens.map(() => `(${new Array(20).fill('?').join(', ')})`).join(', ')}`,
        valores,
      );
      gravados += itens.length;
    }

    await conexao.commit();
    return gravados;
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}

/** Comissão líquida por competência. */
export async function comissaoPorCompetencia(): Promise<RowDataPacket[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT competencia AS rotulo, SUM(total_liquido) AS valor
       FROM comissoes
      GROUP BY competencia
      ORDER BY competencia`,
  );
  return linhas;
}

/**
 * Comissão recebida por tipo de serviço (`filial`). Sem o campo (Suhai), herda o tipo da
 * seguradora só se ela tiver UM habilitado; com mais, fica "sem tipo".
 */
export async function comissaoPorTipoDeServico(): Promise<RowDataPacket[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(
              c.filial,
              (SELECT MIN(t.nome)
                 FROM seguradora_tipos_seguro st
                 JOIN tipos_seguro t ON t.id = st.tipo_seguro_id AND t.ativo = 1
                WHERE st.seguradora_id = c.seguradora_id
               HAVING COUNT(*) = 1)
            ) AS rotulo,
            SUM(c.total_liquido) AS valor,
            COUNT(*) AS lancamentos
       FROM comissoes c
      GROUP BY rotulo
      ORDER BY valor DESC`,
  );
  return linhas;
}
