import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';
import { TAXA_DA_APOLICE } from './financeiro.repository.js';

/**
 * Previsão de entrada de comissão, em três naturezas que a tela não mistura:
 * ESTIMADO (parcela a vencer × `TAXA_DA_APOLICE`, a mesma regra de `comissaoNoPeriodo`;
 * sem taxa vai À PARTE, nunca como zero), TRAVADO em atraso (sem data: só sai
 * quando o cliente pagar) e RITMO dos recibos (referência, não projeção).
 * "Hoje" é o `CURDATE()` do banco, o mesmo de `comissaoNoPeriodo` (fuso).
 */

/** Semanas no calendário e meses no resumo mensal. */
export const SEMANAS = 12;
export const MESES = 6;
/** Meses FECHADOS que entram na média do ritmo. */
export const MESES_DA_MEDIA = 6;

export interface PendenteSeguradora {
  seguradora: string;
  parcelas: number;
  /** Parcelas com taxa conhecida — as que entram em `comissao`. */
  comTaxaParcelas: number;
  /** Comissão estimada, só das parcelas COM taxa. */
  comissao: number;
  semTaxaParcelas: number;
  /** VALOR das parcelas sem taxa (prêmio, não comissão). */
  semTaxaValor: number;
}

export interface SemanaPrevista {
  /** Segunda-feira da semana ISO, AAAA-MM-DD. */
  inicio: string;
  /** Domingo, AAAA-MM-DD. */
  fim: string;
  porSeguradora: PendenteSeguradora[];
}

export interface MesPrevisto {
  mes: string;
  porSeguradora: PendenteSeguradora[];
}

export interface JanelaPrevista {
  dias: number;
  comissao: number;
  comTaxaParcelas: number;
  semTaxaParcelas: number;
  semTaxaValor: number;
}

/**
 * Como a seguradora costuma pagar, lido dos dias com recibo.
 * - `mensal`: um ou dois pagamentos no mês, em torno de um dia;
 * - `semanal`: toda semana, em dias da semana fixos (0 = domingo);
 * - `diario`: quase todo dia útil;
 * - null: histórico curto demais para dizer.
 */
export type PadraoPagamento =
  | { tipo: 'mensal'; dia: number }
  | { tipo: 'semanal'; diasDaSemana: number[] }
  | { tipo: 'diario' }
  | null;

export interface RitmoSeguradora {
  seguradora: string;
  /** Média de `total_liquido` por mês nos meses fechados COBERTOS; null se nenhum. */
  mediaMensal: number | null;
  /** Quantos dos `MESES_DA_MEDIA` meses a média usa (os anteriores ao 1º recibo não contam). */
  mesesNaMedia: number;
  /** Os meses fechados da janela, com o líquido de cada um (0 = coberto e sem recibo). */
  meses: { mes: string; liquido: number; coberto: boolean }[];
  /** Líquido já recebido no mês corrente. */
  mesAtual: number;
  /** Dias com recibo por mês, na média dos últimos 12 meses cobertos. */
  diasDeRecibo: number | null;
  padrao: PadraoPagamento;
  primeiroRecibo: string;
  ultimoRecibo: { data: string; liquido: number; recibos: number };
}

export interface PrevisaoEntrada {
  hoje: string;
  semanas: SemanaPrevista[];
  meses: MesPrevisto[];
  janelas: JanelaPrevista[];
  travado: { total: Omit<PendenteSeguradora, 'seguradora'>; porSeguradora: PendenteSeguradora[] };
  ritmo: RitmoSeguradora[];
}

/** Soma dias a uma data AAAA-MM-DD em UTC — sem fuso, sem horário de verão. */
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function diaDaSemana(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

const centavos = (n: number): number => Math.round(n * 100) / 100;

/** Arredonda POR PARCELA com o ROUND do MySQL, como `comissaoNoPeriodo` (senão um centavo de diferença). */
const COLUNAS_PENDENTES = `
  COUNT(*) AS parcelas,
  SUM(${TAXA_DA_APOLICE} IS NOT NULL) AS com_taxa_parcelas,
  SUM(CASE WHEN ${TAXA_DA_APOLICE} IS NOT NULL THEN ROUND(p.valor * ${TAXA_DA_APOLICE}, 2) ELSE 0 END) AS comissao,
  SUM(${TAXA_DA_APOLICE} IS NULL) AS sem_taxa_parcelas,
  SUM(CASE WHEN ${TAXA_DA_APOLICE} IS NULL THEN p.valor ELSE 0 END) AS sem_taxa_valor`;

/** Parcela em ABERTO como em `comissaoNoPeriodo`; o complemento é o travado. */
const SITUACAO_ABERTO = `p.status = 'aberto' AND p.vencimento >= CURDATE()`;
const SITUACAO_ATRASO = `p.status IN ('aberto', 'atrasado') AND (p.status = 'atrasado' OR p.vencimento < CURDATE())`;

const JUNCAO_PARCELAS = `
  FROM parcelas p
  JOIN apolices a ON a.id = p.apolice_id
  JOIN seguradoras s ON s.id = a.seguradora_id
  LEFT JOIN clientes c ON c.id = a.cliente_id`;

function pendente(l: RowDataPacket): PendenteSeguradora {
  return {
    seguradora: String(l.seguradora ?? ''),
    parcelas: Number(l.parcelas ?? 0),
    comTaxaParcelas: Number(l.com_taxa_parcelas ?? 0),
    comissao: centavos(Number(l.comissao ?? 0)),
    semTaxaParcelas: Number(l.sem_taxa_parcelas ?? 0),
    semTaxaValor: centavos(Number(l.sem_taxa_valor ?? 0)),
  };
}

export async function previsaoEntrada(escopo?: Escopo): Promise<PrevisaoEntrada> {
  // O recorte vale para as PARCELAS; os recibos não têm dono, por isso a rota exige `comissoes.todas`.
  const carteira = condicaoDeCarteira(escopo ?? ESCOPO_TOTAL, 'c.produtor_id');
  const filtroCarteira = carteira.condicao ? `AND ${carteira.condicao}` : '';

  const [[hojeLinha]] = await pool.query<RowDataPacket[]>(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje`);
  const hoje = String(hojeLinha!.hoje);

  // Semana ISO (segunda). A primeira é a CORRENTE, de hoje em diante (antes de hoje já é atraso).
  const segunda = somarDias(hoje, -((diaDaSemana(hoje) + 6) % 7));
  const fimSemanas = somarDias(segunda, SEMANAS * 7);
  const mesHoje = hoje.slice(0, 7);
  const fimMeses = `${somarMeses(mesHoje, MESES)}-01`;
  const inicioMedia = `${somarMeses(mesHoje, -MESES_DA_MEDIA)}-01`;
  const inicioPadrao = `${somarMeses(mesHoje, -12)}-01`;

  const [[porSemana], [porMes], [janelas], [travado], [recibosPorDia], [limites]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(DATE_SUB(p.vencimento, INTERVAL WEEKDAY(p.vencimento) DAY), '%Y-%m-%d') AS semana,
              s.nome AS seguradora, ${COLUNAS_PENDENTES}
         ${JUNCAO_PARCELAS}
        WHERE ${SITUACAO_ABERTO} AND p.vencimento < ?
          ${filtroCarteira}
        GROUP BY semana, s.nome
        ORDER BY semana, s.nome`,
      [fimSemanas, ...carteira.valores],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(p.vencimento, '%Y-%m') AS mes, s.nome AS seguradora, ${COLUNAS_PENDENTES}
         ${JUNCAO_PARCELAS}
        WHERE ${SITUACAO_ABERTO} AND p.vencimento < ?
          ${filtroCarteira}
        GROUP BY mes, s.nome
        ORDER BY mes, s.nome`,
      [fimMeses, ...carteira.valores],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT j.dias, ${COLUNAS_PENDENTES}
         ${JUNCAO_PARCELAS}
         JOIN (SELECT 30 AS dias UNION ALL SELECT 90) j
           ON p.vencimento < DATE_ADD(CURDATE(), INTERVAL j.dias DAY)
        WHERE ${SITUACAO_ABERTO}
          ${filtroCarteira}
        GROUP BY j.dias`,
      [...carteira.valores],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT s.nome AS seguradora, ${COLUNAS_PENDENTES}
         ${JUNCAO_PARCELAS}
        WHERE ${SITUACAO_ATRASO}
          ${filtroCarteira}
        GROUP BY s.nome
        ORDER BY s.nome`,
      [...carteira.valores],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT s.nome AS seguradora, DATE_FORMAT(cm.pago_em, '%Y-%m-%d') AS dia,
              COUNT(*) AS recibos, SUM(cm.total_liquido) AS liquido
         FROM comissoes cm
         JOIN seguradoras s ON s.id = cm.seguradora_id
        WHERE cm.pago_em >= ?
        GROUP BY s.nome, dia
        ORDER BY s.nome, dia`,
      [inicioPadrao],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT s.nome AS seguradora,
              DATE_FORMAT(u.primeiro, '%Y-%m-%d') AS primeiro,
              DATE_FORMAT(u.ultimo, '%Y-%m-%d') AS ultimo,
              COUNT(*) AS recibos, SUM(cm.total_liquido) AS liquido
         FROM (SELECT seguradora_id, MIN(pago_em) AS primeiro, MAX(pago_em) AS ultimo
                 FROM comissoes WHERE pago_em IS NOT NULL
                GROUP BY seguradora_id) u
         JOIN comissoes cm ON cm.seguradora_id = u.seguradora_id AND cm.pago_em = u.ultimo
         JOIN seguradoras s ON s.id = u.seguradora_id
        GROUP BY s.nome, u.primeiro, u.ultimo
        ORDER BY s.nome`,
    ),
  ]);

  // Calendário FIXO: período sem parcela aparece vazio, em vez de sumir.
  const semanas: SemanaPrevista[] = Array.from({ length: SEMANAS }, (_, i) => {
    const inicio = somarDias(segunda, i * 7);
    return {
      inicio,
      fim: somarDias(inicio, 6),
      porSeguradora: porSemana.filter((l) => String(l.semana) === inicio).map(pendente),
    };
  });
  const meses: MesPrevisto[] = Array.from({ length: MESES }, (_, i) => {
    const mes = somarMeses(mesHoje, i);
    return { mes, porSeguradora: porMes.filter((l) => String(l.mes) === mes).map(pendente) };
  });

  const janela = (dias: number): JanelaPrevista => {
    const l = janelas.find((x) => Number(x.dias) === dias);
    const p = l ? pendente(l) : null;
    return {
      dias,
      comissao: p?.comissao ?? 0,
      comTaxaParcelas: p?.comTaxaParcelas ?? 0,
      semTaxaParcelas: p?.semTaxaParcelas ?? 0,
      semTaxaValor: p?.semTaxaValor ?? 0,
    };
  };

  const travadoPor = travado.map(pendente);
  const somar = (campo: keyof Omit<PendenteSeguradora, 'seguradora'>): number =>
    centavos(travadoPor.reduce((t, l) => t + l[campo], 0));

  return {
    hoje,
    semanas,
    meses,
    janelas: [janela(30), janela(90)],
    travado: {
      total: {
        parcelas: somar('parcelas'),
        comTaxaParcelas: somar('comTaxaParcelas'),
        comissao: somar('comissao'),
        semTaxaParcelas: somar('semTaxaParcelas'),
        semTaxaValor: somar('semTaxaValor'),
      },
      porSeguradora: travadoPor,
    },
    ritmo: limites.map((l) =>
      ritmoDaSeguradora(
        String(l.seguradora),
        recibosPorDia.filter((d) => d.seguradora === l.seguradora),
        { primeiro: String(l.primeiro), ultimo: String(l.ultimo), recibos: Number(l.recibos), liquido: Number(l.liquido ?? 0) },
        mesHoje,
        inicioMedia,
      ),
    ),
  };
}

/** Média, cadência e padrão de pagamento; a média divide pelos meses COBERTOS (o extrato pode começar no meio). */
function ritmoDaSeguradora(
  seguradora: string,
  dias: RowDataPacket[],
  limite: { primeiro: string; ultimo: string; recibos: number; liquido: number },
  mesHoje: string,
  inicioMedia: string,
): RitmoSeguradora {
  const mesPrimeiro = limite.primeiro.slice(0, 7);
  const porMes = new Map<string, number>();
  for (const d of dias) {
    const mes = String(d.dia).slice(0, 7);
    porMes.set(mes, (porMes.get(mes) ?? 0) + Number(d.liquido ?? 0));
  }

  const meses = Array.from({ length: MESES_DA_MEDIA }, (_, i) => {
    const mes = somarMeses(inicioMedia.slice(0, 7), i);
    return { mes, liquido: centavos(porMes.get(mes) ?? 0), coberto: mes >= mesPrimeiro };
  });
  const cobertos = meses.filter((m) => m.coberto);
  const mediaMensal = cobertos.length
    ? centavos(cobertos.reduce((t, m) => t + m.liquido, 0) / cobertos.length)
    : null;

  // Só meses FECHADOS e cobertos: o corrente pela metade puxaria a contagem para baixo.
  const fechados = dias.filter((d) => {
    const mes = String(d.dia).slice(0, 7);
    return mes < mesHoje && mes >= mesPrimeiro;
  });
  const mesesFechados = new Set(fechados.map((d) => String(d.dia).slice(0, 7))).size;
  const diasDeRecibo = mesesFechados ? Math.round((fechados.length / mesesFechados) * 10) / 10 : null;

  return {
    seguradora,
    mediaMensal,
    mesesNaMedia: cobertos.length,
    meses,
    mesAtual: centavos(porMes.get(mesHoje) ?? 0),
    diasDeRecibo,
    padrao: padraoDePagamento(fechados.map((d) => String(d.dia)), diasDeRecibo),
    primeiroRecibo: limite.primeiro,
    ultimoRecibo: { data: limite.ultimo, liquido: centavos(limite.liquido), recibos: limite.recibos },
  };
}

/**
 * Até dois dias por mês é pagamento MENSAL (mediana do dia); acima disso, o dia da
 * SEMANA com ao menos 15% dos recibos (a Suhai paga às terças e quintas); mais de três = diário.
 */
function padraoDePagamento(dias: string[], diasDeRecibo: number | null): PadraoPagamento {
  if (dias.length < 3 || diasDeRecibo === null) return null;

  if (diasDeRecibo <= 2) {
    const ordenados = dias.map((d) => Number(d.slice(8, 10))).sort((a, b) => a - b);
    return { tipo: 'mensal', dia: ordenados[Math.floor(ordenados.length / 2)]! };
  }

  const contagem = new Array<number>(7).fill(0);
  for (const d of dias) {
    const i = diaDaSemana(d);
    contagem[i] = (contagem[i] ?? 0) + 1;
  }
  const fortes = contagem
    .map((n, dia) => ({ dia, n }))
    .filter((x) => x.n / dias.length >= 0.15)
    .sort((a, b) => a.dia - b.dia)
    .map((x) => x.dia);

  if (fortes.length > 3) return { tipo: 'diario' };
  return fortes.length ? { tipo: 'semanal', diasDaSemana: fortes } : null;
}
