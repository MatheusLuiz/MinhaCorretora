import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';

/**
 * Financeiro › Estornos. Duas fontes que NÃO se somam: estorno descontado (linha/recibo negativo,
 * extrato) e comissão perdida (`apolices.comissao` da cancelada, contrato) — seria o mesmo dinheiro duas vezes.
 */

export interface EstornoLinha {
  /** `item` = linha do detalhe; `recibo` = recibo inteiro negativo sem detalhe. */
  origem: 'item' | 'recibo';
  mes: string;
  pagoEm: string | null;
  data: string | null;
  seguradora: string;
  recibo: string;
  apolice: string | null;
  segurado: string | null;
  parcela: number | null;
  tipo: string | null;
  premio: number | null;
  valor: number;
  clienteUuid: string | null;
  cliente: string | null;
}

export interface CancelamentoLinha {
  mes: string;
  canceladaEm: string | null;
  seguradora: string;
  apolice: string;
  segurado: string;
  motivo: string | null;
  inadimplencia: boolean;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  premio: number | null;
  /** Null = a origem não informa. Nunca zero: zero afirmaria que não havia comissão. */
  comissao: number | null;
  clienteUuid: string | null;
  cliente: string | null;
  corretor: string | null;
}

export interface EstornoMes {
  mes: string;
  seguradora: string;
  lancamentos: number;
  valor: number;
}

export interface CancelamentoMes {
  mes: string;
  seguradora: string;
  apolices: number;
  comissaoInformada: number;
  semComissao: number;
  premioInformado: number;
  semPremio: number;
}

/** `DATE` chega como string pelo `dateStrings` do pool; defesa para Date. */
function dataIso(valor: unknown): string | null {
  if (!valor) return null;
  if (typeof valor === 'string') return valor.slice(0, 10);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return null;
}

const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/**
 * Estornos pela data de PAGAMENTO do recibo. O recorte de carteira vai só no JOIN de clientes, para o total
 * bater com o extrato. Recibo negativo só entra sem detalhe (com detalhe, dobraria).
 */
async function estornosPagos(de: string, ate: string, escopo: Escopo): Promise<EstornoLinha[]> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const recorteCliente = carteira.condicao ? `AND ${carteira.condicao}` : '';

  const [[itens], [recibos]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(cm.pago_em, '%Y-%m') AS mes, cm.pago_em, ci.data,
              s.nome AS seguradora, cm.numero AS recibo,
              COALESCE(a.numero, ci.numero_apolice) AS apolice, ci.nome_segurado,
              ci.parcela, COALESCE(ci.tipo_descricao, ci.tipo_codigo) AS tipo,
              ci.premio_liquido, ci.comissao,
              BIN_TO_UUID(c.uuid, 1) AS cliente_uuid, c.nome AS cliente
         FROM comissoes_itens ci
         JOIN comissoes cm ON cm.id = ci.comissao_id
         JOIN seguradoras s ON s.id = cm.seguradora_id
         LEFT JOIN apolices a ON a.id = ci.apolice_id
         LEFT JOIN clientes c ON c.id = a.cliente_id ${recorteCliente}
        WHERE ci.comissao < 0
          AND cm.pago_em >= ? AND cm.pago_em < ?
        ORDER BY cm.pago_em DESC, ci.comissao, ci.id
        LIMIT 5000`,
      [...carteira.valores, de, ate],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(cm.pago_em, '%Y-%m') AS mes, cm.pago_em,
              s.nome AS seguradora, cm.numero AS recibo, cm.tipo, cm.total_liquido
         FROM comissoes cm
         JOIN seguradoras s ON s.id = cm.seguradora_id
        WHERE cm.total_liquido < 0
          AND cm.pago_em >= ? AND cm.pago_em < ?
          AND NOT EXISTS (SELECT 1 FROM comissoes_itens ci WHERE ci.comissao_id = cm.id)
        ORDER BY cm.pago_em DESC`,
      [de, ate],
    ),
  ]);

  return [
    ...itens.map(
      (l): EstornoLinha => ({
        origem: 'item',
        mes: String(l.mes),
        pagoEm: dataIso(l.pago_em),
        data: dataIso(l.data),
        seguradora: String(l.seguradora),
        recibo: String(l.recibo),
        apolice: textoOuNulo(l.apolice),
        segurado: textoOuNulo(l.nome_segurado),
        parcela: numeroOuNulo(l.parcela),
        tipo: textoOuNulo(l.tipo),
        premio: numeroOuNulo(l.premio_liquido),
        valor: Number(l.comissao),
        clienteUuid: textoOuNulo(l.cliente_uuid),
        cliente: textoOuNulo(l.cliente),
      }),
    ),
    ...recibos.map(
      (l): EstornoLinha => ({
        origem: 'recibo',
        mes: String(l.mes),
        pagoEm: dataIso(l.pago_em),
        data: null,
        seguradora: String(l.seguradora),
        recibo: String(l.recibo),
        apolice: null,
        segurado: null,
        parcela: null,
        tipo: textoOuNulo(l.tipo),
        premio: null,
        valor: Number(l.total_liquido),
        clienteUuid: null,
        cliente: null,
      }),
    ),
  ];
}

/**
 * Canceladas pelo mês do cancelamento; sem data, pelo fim de vigência. O recorte de carteira filtra a
 * LINHA; apólice sem cliente só aparece para quem vê a base inteira.
 */
async function cancelamentos(de: string, ate: string, escopo: Escopo): Promise<CancelamentoLinha[]> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const filtroCarteira = carteira.condicao ? `AND ${carteira.condicao}` : '';

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT x.*, DATE_FORMAT(x.data_cancelamento, '%Y-%m') AS mes
       FROM (
         SELECT COALESCE(a.cancelada_em, a.vigencia_fim) AS data_cancelamento,
                a.cancelada_em, s.nome AS seguradora, a.numero AS apolice, a.nome_segurado,
                a.motivo_cancelamento, a.vigencia_inicio, a.vigencia_fim,
                a.premio_total, a.comissao,
                BIN_TO_UUID(c.uuid, 1) AS cliente_uuid, c.nome AS cliente, pr.nome AS corretor
           FROM apolices a
           JOIN seguradoras s ON s.id = a.seguradora_id
           LEFT JOIN clientes c ON c.id = a.cliente_id
           LEFT JOIN produtores pr ON pr.id = c.produtor_id
          WHERE (a.cancelada_em IS NOT NULL OR a.situacao_cia = 'cancelada')
            ${filtroCarteira}
       ) x
      WHERE x.data_cancelamento >= ? AND x.data_cancelamento < ?
      ORDER BY x.data_cancelamento DESC, x.apolice
      LIMIT 5000`,
    [...carteira.valores, de, ate],
  );

  return linhas.map((l) => {
    const motivo = textoOuNulo(l.motivo_cancelamento);
    return {
      mes: String(l.mes),
      canceladaEm: dataIso(l.cancelada_em),
      seguradora: String(l.seguradora),
      apolice: String(l.apolice),
      segurado: String(l.nome_segurado ?? ''),
      motivo,
      // Em JS a comparação não ignora acento como a collation: normaliza antes.
      inadimplencia:
        motivo !== null &&
        motivo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes('inadimpl'),
      vigenciaInicio: dataIso(l.vigencia_inicio),
      vigenciaFim: dataIso(l.vigencia_fim),
      premio: numeroOuNulo(l.premio_total),
      comissao: numeroOuNulo(l.comissao),
      clienteUuid: textoOuNulo(l.cliente_uuid),
      cliente: textoOuNulo(l.cliente),
      corretor: textoOuNulo(l.corretor),
    };
  });
}

const centavos = (v: number): number => Math.round(v * 100);

/** As duas listas e os totais mensais de cada uma, SEPARADOS e somados das próprias linhas. */
export async function estornosNoPeriodo(
  de: string,
  ate: string,
  escopo: Escopo = ESCOPO_TOTAL,
): Promise<{
  estornos: { linhas: EstornoLinha[]; porMes: EstornoMes[] };
  cancelamentos: { linhas: CancelamentoLinha[]; porMes: CancelamentoMes[] };
}> {
  const [estornos, canceladas] = await Promise.all([
    estornosPagos(de, ate, escopo),
    cancelamentos(de, ate, escopo),
  ]);

  const porMesEstorno = new Map<string, EstornoMes & { c: number }>();
  for (const e of estornos) {
    const chave = `${e.mes}|${e.seguradora}`;
    const g = porMesEstorno.get(chave) ?? { mes: e.mes, seguradora: e.seguradora, lancamentos: 0, valor: 0, c: 0 };
    g.lancamentos++;
    g.c += centavos(e.valor);
    porMesEstorno.set(chave, g);
  }

  const porMesCancel = new Map<string, CancelamentoMes & { cc: number; cp: number }>();
  for (const a of canceladas) {
    const chave = `${a.mes}|${a.seguradora}`;
    const g = porMesCancel.get(chave) ?? {
      mes: a.mes,
      seguradora: a.seguradora,
      apolices: 0,
      comissaoInformada: 0,
      semComissao: 0,
      premioInformado: 0,
      semPremio: 0,
      cc: 0,
      cp: 0,
    };
    g.apolices++;
    if (a.comissao === null) g.semComissao++;
    else g.cc += centavos(a.comissao);
    if (a.premio === null) g.semPremio++;
    else g.cp += centavos(a.premio);
    porMesCancel.set(chave, g);
  }

  const ordem = (x: { mes: string; seguradora: string }, y: { mes: string; seguradora: string }): number =>
    x.mes.localeCompare(y.mes) || x.seguradora.localeCompare(y.seguradora);

  return {
    estornos: {
      linhas: estornos,
      porMes: [...porMesEstorno.values()]
        .map(({ c, ...g }) => ({ ...g, valor: c / 100 }))
        .sort(ordem),
    },
    cancelamentos: {
      linhas: canceladas,
      porMes: [...porMesCancel.values()]
        .map(({ cc, cp, ...g }) => ({ ...g, comissaoInformada: cc / 100, premioInformado: cp / 100 }))
        .sort(ordem),
    },
  };
}
