import type { RowDataPacket } from 'mysql2/promise';

import { pool } from '../database/pool.js';
import {
  CLIENTE_SEM_APOLICE_EM_VIGOR,
  clienteCancelouEntre,
  condicaoCancelada,
  mesDoCancelamento,
} from '../utils/cancelamento.js';
import { condicaoDeCarteira, type Escopo } from '../utils/escopo.js';

// Condições em `utils/cancelamento.ts` (as da gaveta). Conta CLIENTES distintos: a janela de 4 meses não é a soma dos meses.

export interface Contagem {
  clientes: number;
  /** Destes, sem nenhuma apólice em vigor hoje. */
  perdidos: number;
  apolices: number;
}

function recorte(escopo: Escopo): { condicao: string; valores: number[] } {
  const carteira = condicaoDeCarteira(escopo, 'c.produtor_id');
  return { condicao: carteira.condicao ?? '1 = 1', valores: carteira.valores };
}

/** Clientes (e perdidos) que cancelaram com mês em [de, ate]. */
export async function entre(escopo: Escopo, de: string, ate: string): Promise<Contagem> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS clientes,
            COALESCE(SUM(${CLIENTE_SEM_APOLICE_EM_VIGOR}), 0) AS perdidos,
            COALESCE(SUM((SELECT COUNT(*) FROM apolices ax
                           WHERE ax.cliente_id = c.id AND ${condicaoCancelada('ax')}
                             AND ${mesDoCancelamento('ax')} BETWEEN ? AND ?)), 0) AS apolices
       FROM clientes c
      WHERE ${clienteCancelouEntre('?', '?')} AND ${r.condicao}`,
    [de, ate, de, ate, ...r.valores],
  );
  return {
    clientes: Number(linhas[0]?.clientes ?? 0),
    perdidos: Number(linhas[0]?.perdidos ?? 0),
    apolices: Number(linhas[0]?.apolices ?? 0),
  };
}

/** Um ponto por mês de cancelamento em [de, ate]. Meses sem cancelamento não vêm. */
export async function porMes(
  escopo: Escopo,
  de: string,
  ate: string,
): Promise<{ mes: string; clientes: number; perdidos: number }[]> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT x.mes, COUNT(*) AS clientes, COALESCE(SUM(x.perdido), 0) AS perdidos
       FROM (SELECT DISTINCT ${mesDoCancelamento('a')} AS mes, c.id, ${CLIENTE_SEM_APOLICE_EM_VIGOR} AS perdido
               FROM apolices a JOIN clientes c ON c.id = a.cliente_id
              WHERE ${condicaoCancelada('a')} AND ${mesDoCancelamento('a')} BETWEEN ? AND ?
                AND ${r.condicao}) x
      GROUP BY x.mes
      ORDER BY x.mes`,
    [de, ate, ...r.valores],
  );
  return linhas.map((l) => ({ mes: String(l.mes), clientes: Number(l.clientes), perdidos: Number(l.perdidos) }));
}

/** Por seguradora da apólice cancelada, em [de, ate]: de onde vêm os cancelamentos. */
export async function porSeguradora(
  escopo: Escopo,
  de: string,
  ate: string,
): Promise<{ seguradora: string; clientes: number; apolices: number }[]> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT s.nome AS seguradora, COUNT(DISTINCT c.id) AS clientes, COUNT(*) AS apolices
       FROM apolices a
       JOIN clientes c ON c.id = a.cliente_id
       JOIN seguradoras s ON s.id = a.seguradora_id
      WHERE ${condicaoCancelada('a')} AND ${mesDoCancelamento('a')} BETWEEN ? AND ?
        AND ${r.condicao}
      GROUP BY s.nome
      ORDER BY clientes DESC, s.nome`,
    [de, ate, ...r.valores],
  );
  return linhas.map((l) => ({ seguradora: String(l.seguradora), clientes: Number(l.clientes), apolices: Number(l.apolices) }));
}

/** Canceladas sem mês nenhum: ficam fora das janelas e o painel as declara. */
export async function semData(escopo: Escopo): Promise<{ apolices: number; clientes: number }> {
  const r = recorte(escopo);
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS apolices, COUNT(DISTINCT c.id) AS clientes
       FROM apolices a JOIN clientes c ON c.id = a.cliente_id
      WHERE ${condicaoCancelada('a')} AND ${mesDoCancelamento('a')} IS NULL AND ${r.condicao}`,
    r.valores,
  );
  return { apolices: Number(linhas[0]?.apolices ?? 0), clientes: Number(linhas[0]?.clientes ?? 0) };
}
