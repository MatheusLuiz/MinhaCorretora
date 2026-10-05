import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import { condicaoDeCarteira, type Escopo } from '../utils/escopo.js';

// Período [de, ate] contra o mesmo período do ano anterior; o servidor já cortou o mês em andamento.

export interface Periodo {
  de: string;
  ate: string;
}

function recorte(escopo: Escopo): { condicao: string; valores: number[] } {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  return { condicao: carteira.condicao ?? '1 = 1', valores: carteira.valores };
}

/** Apólices de RENOVAÇÃO com início no período. */
export async function renovadas(escopo: Escopo, p: Periodo): Promise<{ apolices: number; premio: number; comPremio: number }> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS apolices, COALESCE(SUM(a.premio_total), 0) AS premio, COUNT(a.premio_total) AS com_premio
       FROM apolices a JOIN clientes c ON c.id = a.cliente_id
      WHERE a.tipo_negocio = 'renovacao' AND a.vigencia_inicio BETWEEN ? AND ? AND ${r.condicao}`,
    [p.de, p.ate, ...r.valores],
  );
  return { apolices: Number(linhas[0]?.apolices ?? 0), premio: Math.round(Number(linhas[0]?.premio ?? 0) * 100) / 100, comPremio: Number(linhas[0]?.com_premio ?? 0) };
}

/** Vencidas no período que renovaram: outra apólice do cliente começando ±45 dias do vencimento, em qualquer seguradora. */
export async function vencidasERenovadas(escopo: Escopo, p: Periodo): Promise<{ venceram: number; renovaram: number }> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS venceram,
            COALESCE(SUM(EXISTS (
              SELECT 1 FROM apolices b
               WHERE b.cliente_id = a.cliente_id AND b.id <> a.id
                 AND b.vigencia_inicio BETWEEN DATE_SUB(a.vigencia_fim, INTERVAL 45 DAY) AND DATE_ADD(a.vigencia_fim, INTERVAL 45 DAY))), 0) AS renovaram
       FROM apolices a JOIN clientes c ON c.id = a.cliente_id
      WHERE a.vigencia_fim BETWEEN ? AND ?
        AND (a.cancelada_em IS NULL OR a.cancelada_em > a.vigencia_fim)
        AND ${r.condicao}`,
    [p.de, p.ate, ...r.valores],
  );
  return { venceram: Number(linhas[0]?.venceram ?? 0), renovaram: Number(linhas[0]?.renovaram ?? 0) };
}

/** Antes disto o cadastro só tem quem ainda tem apólice: "novos clientes" contaria sobreviventes. */
export const CADASTRO_COMPLETO_DESDE = '2024-08';

/** Clientes cujo "cliente desde" cai no período. */
export async function novosClientes(escopo: Escopo, p: Periodo): Promise<number> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM clientes c WHERE c.cliente_desde BETWEEN ? AND ? AND ${r.condicao}`,
    [p.de, p.ate, ...r.valores],
  );
  return Number(linhas[0]?.n ?? 0);
}

/** Clientes com apólice em vigor NA DATA (não cancelada até ela). */
export async function carteiraAtivaEm(escopo: Escopo, data: string): Promise<number> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT a.cliente_id) AS n
       FROM apolices a JOIN clientes c ON c.id = a.cliente_id
      WHERE a.vigencia_inicio <= ? AND a.vigencia_fim >= ?
        AND (a.cancelada_em IS NULL OR a.cancelada_em > ?)
        AND ${r.condicao}`,
    [data, data, data, ...r.valores],
  );
  return Number(linhas[0]?.n ?? 0);
}

/** Primeiro mês com ≥30% da média mensal de inícios; antes há só sobras de relatório de vigentes. */
export async function coberturaDesde(): Promise<string | null> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(vigencia_inicio, '%Y-%m') AS mes, COUNT(*) AS n
       FROM apolices WHERE vigencia_inicio IS NOT NULL AND vigencia_inicio <= CURDATE()
      GROUP BY mes ORDER BY mes`,
  );
  if (linhas.length === 0) return null;
  const media = linhas.reduce((t, l) => t + Number(l.n), 0) / linhas.length;
  return String(linhas.find((l) => Number(l.n) >= media * 0.3)?.mes ?? linhas[0]!.mes);
}
