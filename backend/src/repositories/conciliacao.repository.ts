import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';

/**
 * Conciliação: recibos (`comissoes`) contra o extrato do portal (`extratos_comissao`) — o mesmo
 * dinheiro, só se compara, nunca se soma. Mês do recibo = mês do PAGAMENTO; `competencia` só sem `pago_em`.
 */

const MES_DO_RECIBO = "COALESCE(DATE_FORMAT(c.pago_em, '%Y-%m'), c.competencia)";

/** `DATE` chega como string pelo `dateStrings` do pool; defesa para Date. */
function dataIso(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return null;
}

const dinheiro = (v: unknown): number => Number(v ?? 0);
const dinheiroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface OrdemDoExtrato {
  ordem: string;
  pagoEm: string | null;
  bruto: number;
  liquido: number | null;
  inss: number | null;
  irrf: number | null;
  iss: number | null;
}

/** ACRESCENTA (COALESCE). `origem_lote` fica FORA do UPDATE: o desfazer apaga por ele. */
export async function gravarExtrato(
  seguradoraId: number,
  ordens: OrdemDoExtrato[],
  lote: string,
  arquivo: string,
  conexao: Pool | PoolConnection = pool,
): Promise<{ inseridas: number; atualizadas: number }> {
  if (ordens.length === 0) return { inseridas: 0, atualizadas: 0 };

  const valores = ordens.map((o) => [
    seguradoraId,
    o.ordem.slice(0, 20),
    o.pagoEm,
    o.pagoEm ? o.pagoEm.slice(0, 7) : null,
    o.bruto,
    o.inss,
    o.irrf,
    o.iss,
    o.liquido,
    arquivo.slice(0, 120),
    lote,
  ]);

  const [r] = await conexao.query<ResultSetHeader>(
    `INSERT INTO extratos_comissao
       (seguradora_id, numero_ordem, pago_em, competencia, total_bruto, inss, irrf, iss,
        total_liquido, origem_arquivo, origem_lote, importado_em)
     VALUES ${valores.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))').join(', ')}
     ON DUPLICATE KEY UPDATE
       pago_em        = COALESCE(VALUES(pago_em), pago_em),
       competencia    = COALESCE(VALUES(competencia), competencia),
       total_bruto    = COALESCE(VALUES(total_bruto), total_bruto),
       inss           = COALESCE(VALUES(inss), inss),
       irrf           = COALESCE(VALUES(irrf), irrf),
       iss            = COALESCE(VALUES(iss), iss),
       total_liquido  = COALESCE(VALUES(total_liquido), total_liquido),
       origem_arquivo = VALUES(origem_arquivo),
       importado_em   = VALUES(importado_em)`,
    valores.flat(),
  );

  // No upsert do MySQL, linha nova conta 1 e linha alterada conta 2.
  const atualizadas = Math.max(0, r.affectedRows - ordens.length);
  return { inseridas: ordens.length - atualizadas, atualizadas };
}

export interface ReciboConciliacao {
  id: number;
  seguradoraId: number;
  seguradora: string;
  mes: string;
  numero: string;
  pagoEm: string | null;
  bruto: number;
  desconto: number;
  impostos: number;
  liquido: number;
  /** Linhas de detalhe do crédito (`comissoes_itens`); 0 = crédito sem detalhe. */
  itens: number;
  somaItens: number;
}

export interface OrdemGravada {
  seguradoraId: number;
  seguradora: string;
  mes: string | null;
  numero: string;
  pagoEm: string | null;
  bruto: number;
  liquido: number | null;
  inss: number | null;
  irrf: number | null;
  iss: number | null;
}

function paraRecibo(l: RowDataPacket): ReciboConciliacao {
  return {
    id: Number(l.id),
    seguradoraId: Number(l.seguradora_id),
    seguradora: String(l.seguradora),
    mes: String(l.mes),
    numero: String(l.numero),
    pagoEm: dataIso(l.pago_em),
    bruto: dinheiro(l.total_bruto),
    desconto: dinheiro(l.desconto),
    impostos: dinheiro(l.impostos),
    liquido: dinheiro(l.total_liquido),
    itens: Number(l.itens ?? 0),
    somaItens: dinheiro(l.soma_itens),
  };
}

function paraOrdem(l: RowDataPacket): OrdemGravada {
  return {
    seguradoraId: Number(l.seguradora_id),
    seguradora: String(l.seguradora),
    mes: l.competencia === null ? null : String(l.competencia),
    numero: String(l.numero_ordem),
    pagoEm: dataIso(l.pago_em),
    bruto: dinheiro(l.total_bruto),
    liquido: dinheiroOuNulo(l.total_liquido),
    inss: dinheiroOuNulo(l.inss),
    irrf: dinheiroOuNulo(l.irrf),
    iss: dinheiroOuNulo(l.iss),
  };
}

/* Impostos ausentes = bruto − desconto − líquido, para não mostrar imposto zero que ninguém declarou. */
const SELECT_RECIBO = `
  SELECT c.id, c.seguradora_id, s.nome AS seguradora, ${MES_DO_RECIBO} AS mes, c.numero, c.pago_em,
         c.total_bruto, c.desconto,
         COALESCE(c.impostos, c.total_bruto - COALESCE(c.desconto, 0) - c.total_liquido) AS impostos,
         c.total_liquido, it.itens, it.soma_itens
    FROM comissoes c
    JOIN seguradoras s ON s.id = c.seguradora_id
    LEFT JOIN (
      SELECT comissao_id, COUNT(*) AS itens, SUM(comissao) AS soma_itens
        FROM comissoes_itens
       GROUP BY comissao_id
    ) it ON it.comissao_id = c.id`;

/** Recibos com mês de pagamento dentro do período (`AAAA-MM`, inclusivo). */
export async function recibosNoPeriodo(de: string, ate: string): Promise<ReciboConciliacao[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `${SELECT_RECIBO}
      WHERE ${MES_DO_RECIBO} BETWEEN ? AND ?
      ORDER BY mes, s.nome, c.pago_em, c.numero`,
    [de, ate],
  );
  return linhas.map(paraRecibo);
}

/** Recibos de uma companhia, de qualquer mês: a ordem pode ter sido paga no mês anterior ao do extrato. */
export async function recibosDaSeguradora(seguradoraId: number): Promise<ReciboConciliacao[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `${SELECT_RECIBO}
      WHERE c.seguradora_id = ?
      ORDER BY mes, c.pago_em, c.numero`,
    [seguradoraId],
  );
  return linhas.map(paraRecibo);
}

/** Ordens do extrato gravado. Sem período: todas (a comparação precisa das vizinhas). */
export async function ordensGravadas(seguradoraId?: number): Promise<OrdemGravada[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT e.seguradora_id, s.nome AS seguradora, e.competencia, e.numero_ordem, e.pago_em,
            e.total_bruto, e.total_liquido, e.inss, e.irrf, e.iss
       FROM extratos_comissao e
       JOIN seguradoras s ON s.id = e.seguradora_id
      WHERE (? IS NULL OR e.seguradora_id = ?)
      ORDER BY e.competencia, e.pago_em, e.numero_ordem`,
    [seguradoraId ?? null, seguradoraId ?? null],
  );
  return linhas.map(paraOrdem);
}

/** Primeiro e último mês com recibo: só o buraco ENTRE eles denuncia relatório não importado. */
export async function faixaDeRecebimento(): Promise<
  { seguradoraId: number; seguradora: string; primeiro: string; ultimo: string; temDetalhe: boolean }[]
> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT c.seguradora_id, s.nome AS seguradora,
            MIN(${MES_DO_RECIBO}) AS primeiro, MAX(${MES_DO_RECIBO}) AS ultimo,
            EXISTS (SELECT 1 FROM comissoes_itens i JOIN comissoes c2 ON c2.id = i.comissao_id
                     WHERE c2.seguradora_id = c.seguradora_id) AS tem_detalhe
       FROM comissoes c
       JOIN seguradoras s ON s.id = c.seguradora_id
      GROUP BY c.seguradora_id, s.nome
      ORDER BY s.nome`,
  );
  return linhas.map((l) => ({
    seguradoraId: Number(l.seguradora_id),
    seguradora: String(l.seguradora),
    primeiro: String(l.primeiro),
    ultimo: String(l.ultimo),
    temDetalhe: Number(l.tem_detalhe) === 1,
  }));
}

export interface LinhaRetencao {
  mes: string;
  seguradora: string;
  recibos: number;
  bruto: number;
  desconto: number;
  impostos: number;
  liquido: number;
  /** Recibos cujo imposto foi calculado (bruto − desconto − líquido) por falta da coluna. */
  impostosCalculados: number;
}

/** Totais por mês × companhia. INSS/IRRF/ISS separados só no extrato (`impostosDoExtrato`), nunca somados aqui. */
export async function retencoes(de: string, ate: string): Promise<LinhaRetencao[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT ${MES_DO_RECIBO} AS mes, s.nome AS seguradora, COUNT(*) AS recibos,
            SUM(c.total_bruto) AS bruto, SUM(COALESCE(c.desconto, 0)) AS desconto,
            SUM(COALESCE(c.impostos, c.total_bruto - COALESCE(c.desconto, 0) - c.total_liquido)) AS impostos,
            SUM(c.total_liquido) AS liquido,
            SUM(c.impostos IS NULL) AS impostos_calculados
       FROM comissoes c
       JOIN seguradoras s ON s.id = c.seguradora_id
      WHERE ${MES_DO_RECIBO} BETWEEN ? AND ?
      GROUP BY mes, s.nome
      ORDER BY mes DESC, s.nome`,
    [de, ate],
  );
  return linhas.map((l) => ({
    mes: String(l.mes),
    seguradora: String(l.seguradora),
    recibos: Number(l.recibos),
    bruto: dinheiro(l.bruto),
    desconto: dinheiro(l.desconto),
    impostos: dinheiro(l.impostos),
    liquido: dinheiro(l.liquido),
    impostosCalculados: Number(l.impostos_calculados ?? 0),
  }));
}

/** INSS/IRRF/ISS por mês × companhia, só de onde o extrato gravado trouxe as colunas. */
export async function impostosDoExtrato(
  de: string,
  ate: string,
): Promise<{ mes: string; seguradora: string; inss: number | null; irrf: number | null; iss: number | null }[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT e.competencia AS mes, s.nome AS seguradora,
            SUM(e.inss) AS inss, SUM(e.irrf) AS irrf, SUM(e.iss) AS iss
       FROM extratos_comissao e
       JOIN seguradoras s ON s.id = e.seguradora_id
      WHERE e.competencia BETWEEN ? AND ?
        AND (e.inss IS NOT NULL OR e.irrf IS NOT NULL OR e.iss IS NOT NULL)
      GROUP BY e.competencia, s.nome`,
    [de, ate],
  );
  return linhas.map((l) => ({
    mes: String(l.mes),
    seguradora: String(l.seguradora),
    inss: dinheiroOuNulo(l.inss),
    irrf: dinheiroOuNulo(l.irrf),
    iss: dinheiroOuNulo(l.iss),
  }));
}
