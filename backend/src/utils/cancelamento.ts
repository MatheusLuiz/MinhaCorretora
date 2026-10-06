import { condicaoEmVigor } from './vigencia.js';

/**
 * Cancelada = declarada pela companhia ou com data de cancelamento. Regra única
 * para resumo e gaveta; apelidos vêm do código, nunca da requisição.
 */
export function condicaoCancelada(alias: string): string {
  return `(${alias}.situacao_cia = 'cancelada' OR ${alias}.cancelada_em IS NOT NULL)`;
}

/** `AAAA-MM` do cancelamento (`cancelada_mes` quando a origem só dá o mês, como a Porto), ou NULL. */
export function mesDoCancelamento(alias: string): string {
  return `DATE_FORMAT(COALESCE(${alias}.cancelada_em, ${alias}.cancelada_mes), '%Y-%m')`;
}

/**
 * O cliente `c` teve apólice cancelada com mês entre `de` e `ate` (inclusive).
 * `de`/`ate` são expressões constantes do código com `?`; o valor entra sempre por `?`.
 */
export function clienteCancelouEntre(de: string, ate: string): string {
  return `EXISTS (
    SELECT 1 FROM apolices ac
     WHERE ac.cliente_id = c.id
       AND ${condicaoCancelada('ac')}
       AND ${mesDoCancelamento('ac')} BETWEEN ${de} AND ${ate})`;
}

/** "Perdido": além do cancelamento, nenhuma apólice em vigor HOJE, em nenhuma companhia. */
export const CLIENTE_SEM_APOLICE_EM_VIGOR = `NOT EXISTS (
  SELECT 1 FROM apolices av WHERE av.cliente_id = c.id AND ${condicaoEmVigor('av')})`;
