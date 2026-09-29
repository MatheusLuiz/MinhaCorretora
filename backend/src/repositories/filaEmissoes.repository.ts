import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, type Escopo } from '../utils/escopo.js';

/**
 * Produção pelo mês do INÍCIO DE VIGÊNCIA (toda origem traz; `emitida_em` falta em parte), a mesma
 * régua da gaveta. Recortado não vê apólice sem cliente (o `IN` não casa com NULL).
 */

/** Teto da fila: acima disso a tela pede um filtro de ano, em vez de travar. */
export const TETO_LINHAS = 2000;

/** Doze meses terminando no atual — a mesma janela dos painéis. */
const INICIO_JANELA = "DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 11 MONTH), '%Y-%m-01')";
const FIM_DO_MES_ATUAL = 'LAST_DAY(CURDATE())';

const JUNCOES = `
  JOIN seguradoras s ON s.id = a.seguradora_id
  LEFT JOIN produtos p ON p.id = a.produto_id
  LEFT JOIN tipos_seguro ts ON ts.id = COALESCE(a.tipo_seguro_id, p.tipo_seguro_id)
  LEFT JOIN clientes c ON c.id = a.cliente_id
  LEFT JOIN produtores prod ON prod.id = c.produtor_id`;

export interface LinhaEmissao {
  uuid: string;
  numero: string;
  seguradora: string;
  tipoSeguro: string | null;
  segurado: string;
  clienteUuid: string | null;
  /** Dono da CARTEIRA do cliente, não o vendedor. */
  corretor: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  premio: number | null;
  /** `null` = a origem não informa. Nunca ler como "novo". */
  tipoNegocio: 'novo' | 'renovacao' | null;
}

export interface ResultadoFila {
  /** Quantas apólices o período tem, mesmo acima do teto. */
  total: number;
  /** Soma do prêmio do período inteiro, também acima do teto. */
  premio: number;
  limitado: boolean;
  linhas: LinhaEmissao[];
}

function intervalo(de?: string, ate?: string): { condicoes: string[]; valores: string[] } {
  const condicoes: string[] = [];
  const valores: string[] = [];
  if (de) {
    condicoes.push('a.vigencia_inicio >= ?');
    valores.push(`${de}-01`);
  }
  if (ate) {
    condicoes.push('a.vigencia_inicio <= LAST_DAY(?)');
    valores.push(`${ate}-01`);
  }
  return { condicoes, valores };
}

export async function listarEmissoes(
  filtro: { de?: string; ate?: string },
  escopo: Escopo,
): Promise<ResultadoFila> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const periodo = intervalo(filtro.de, filtro.ate);

  // Ordem dos valores = ordem das condições: período primeiro, carteira depois.
  const condicoes = ['a.vigencia_inicio IS NOT NULL', ...periodo.condicoes];
  if (carteira.condicao) condicoes.push(carteira.condicao);
  const onde = `WHERE ${condicoes.join(' AND ')}`;
  const valores = [...periodo.valores, ...carteira.valores];

  const [totais] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(a.premio_total), 0) AS premio
       FROM apolices a ${JUNCOES} ${onde}`,
    valores,
  );

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT BIN_TO_UUID(a.uuid, 1) AS uuid, a.numero, s.nome AS seguradora, ts.nome AS tipo_seguro,
            a.nome_segurado, BIN_TO_UUID(c.uuid, 1) AS cliente_uuid, prod.nome AS corretor,
            a.vigencia_inicio, a.vigencia_fim, a.premio_total, a.tipo_negocio
       FROM apolices a ${JUNCOES} ${onde}
      ORDER BY a.vigencia_inicio DESC, a.id DESC
      LIMIT ${TETO_LINHAS}`,
    valores,
  );

  const total = Number(totais[0]?.total ?? 0);

  return {
    total,
    premio: Math.round(Number(totais[0]?.premio ?? 0) * 100) / 100,
    limitado: total > linhas.length,
    linhas: linhas.map((l) => ({
      uuid: String(l.uuid),
      numero: String(l.numero),
      seguradora: String(l.seguradora),
      tipoSeguro: l.tipo_seguro === null ? null : String(l.tipo_seguro),
      segurado: String(l.nome_segurado ?? ''),
      clienteUuid: l.cliente_uuid === null ? null : String(l.cliente_uuid),
      corretor: l.corretor === null ? null : String(l.corretor),
      vigenciaInicio: String(l.vigencia_inicio).slice(0, 10),
      vigenciaFim: l.vigencia_fim === null ? null : String(l.vigencia_fim).slice(0, 10),
      premio: l.premio_total === null ? null : Number(l.premio_total),
      tipoNegocio: l.tipo_negocio === 'novo' || l.tipo_negocio === 'renovacao' ? l.tipo_negocio : null,
    })),
  };
}

export interface MesSeguradora {
  mes: string;
  seguradora: string;
  apolices: number;
  /** Quantas têm prêmio: o ticket médio divide por estas, não por todas. */
  comPremio: number;
  premio: number;
}

export interface MesNegocio {
  mes: string;
  /** `nao_informado` = a origem não disse; nunca somado a "novo". */
  negocio: 'novo' | 'renovacao' | 'nao_informado';
  apolices: number;
  premio: number;
}

export interface ResumoEmissoes {
  meses: MesSeguradora[];
  /** A mesma janela e o mesmo total de `meses`, separados por novo × renovação. */
  negocios: MesNegocio[];
  /** O mês anterior ATÉ O MESMO DIA de hoje: compara intervalos do mesmo tamanho. */
  anteriorAteHoje: { apolices: number; comPremio: number; premio: number };
  /** Anos com alguma apólice (início de vigência), do mais novo ao mais antigo. */
  anos: number[];
  /** Início de vigência depois do fim da janela: fica fora da série, mas é dito. */
  futuras: number;
  /** Sem início de vigência não há mês onde contar: fora da série e da fila, e dito. */
  semInicio: number;
}

/** Últimos 12 meses (padrão) ou os 12 meses de um ANO escolhido (por placeholder). */
function janelaDaSerie(ano?: number): { inicio: string; fim: string; valores: string[] } {
  return ano
    ? { inicio: '?', fim: '?', valores: [`${ano}-01-01`, `${ano}-12-31`] }
    : { inicio: INICIO_JANELA, fim: FIM_DO_MES_ATUAL, valores: [] };
}

export async function resumoEmissoes(escopo: Escopo, ano?: number): Promise<ResumoEmissoes> {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  const recorte = carteira.condicao ? `AND ${carteira.condicao}` : '';
  const janela = janelaDaSerie(ano);
  // Ordem dos valores = ordem dos `?`: janela primeiro, carteira depois.
  const valoresDaJanela = [...janela.valores, ...carteira.valores];

  const [meses] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(a.vigencia_inicio, '%Y-%m') AS mes, s.nome AS seguradora,
            COUNT(*) AS apolices, COUNT(a.premio_total) AS com_premio,
            COALESCE(SUM(a.premio_total), 0) AS premio
       FROM apolices a ${JUNCOES}
      WHERE a.vigencia_inicio >= ${janela.inicio}
        AND a.vigencia_inicio <= ${janela.fim} ${recorte}
      GROUP BY mes, s.nome
      ORDER BY mes, s.nome`,
    valoresDaJanela,
  );

  // Mesma janela e mesmas condições de `meses`: as duas séries somam igual.
  const [negocios] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(a.vigencia_inicio, '%Y-%m') AS mes,
            COALESCE(a.tipo_negocio, 'nao_informado') AS negocio,
            COUNT(*) AS apolices, COALESCE(SUM(a.premio_total), 0) AS premio
       FROM apolices a ${JUNCOES}
      WHERE a.vigencia_inicio >= ${janela.inicio}
        AND a.vigencia_inicio <= ${janela.fim} ${recorte}
      GROUP BY mes, negocio
      ORDER BY mes, negocio`,
    valoresDaJanela,
  );

  const [anterior] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS apolices, COUNT(a.premio_total) AS com_premio,
            COALESCE(SUM(a.premio_total), 0) AS premio
       FROM apolices a ${JUNCOES}
      WHERE a.vigencia_inicio >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')
        AND a.vigencia_inicio <= DATE_SUB(CURDATE(), INTERVAL 1 MONTH) ${recorte}`,
    carteira.valores,
  );

  const [futuras] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS futuras
       FROM apolices a ${JUNCOES}
      WHERE a.vigencia_inicio > ${janela.fim} ${recorte}`,
    [...janela.valores.slice(1), ...carteira.valores],
  );

  const [anos] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT YEAR(a.vigencia_inicio) AS ano
       FROM apolices a ${JUNCOES}
      WHERE a.vigencia_inicio IS NOT NULL ${recorte}
      ORDER BY ano DESC`,
    carteira.valores,
  );

  const [semInicio] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS sem_inicio
       FROM apolices a ${JUNCOES}
      WHERE a.vigencia_inicio IS NULL ${recorte}`,
    carteira.valores,
  );

  const redondo = (x: unknown): number => Math.round(Number(x ?? 0) * 100) / 100;

  return {
    meses: meses.map((m) => ({
      mes: String(m.mes),
      seguradora: String(m.seguradora),
      apolices: Number(m.apolices),
      comPremio: Number(m.com_premio),
      premio: redondo(m.premio),
    })),
    negocios: negocios.map((m) => ({
      mes: String(m.mes),
      negocio: m.negocio === 'novo' || m.negocio === 'renovacao' ? m.negocio : 'nao_informado',
      apolices: Number(m.apolices),
      premio: redondo(m.premio),
    })),
    anteriorAteHoje: {
      apolices: Number(anterior[0]?.apolices ?? 0),
      comPremio: Number(anterior[0]?.com_premio ?? 0),
      premio: redondo(anterior[0]?.premio),
    },
    futuras: Number(futuras[0]?.futuras ?? 0),
    semInicio: Number(semInicio[0]?.sem_inicio ?? 0),
    anos: anos.map((l) => Number(l.ano)),
  };
}
