/*
 * A ÚNICA definição de "apólice em vigor": toda consulta usa estas funções.
 * `situacao_cia` NULL = a origem não informa, conta como ativa (senão a carteira esvazia).
 */

/** "A companhia não a declarou fora do ar", sem `AND`; `alias` vem do código, nunca da requisição. */
export function condicaoSituacaoAtiva(alias: string): string {
  return `${alias}.cancelada_em IS NULL AND (${alias}.situacao_cia IS NULL OR ${alias}.situacao_cia = 'ativa')`;
}

/** A anterior mais "a vigência ainda não terminou". */
export function condicaoEmVigor(alias: string): string {
  return `${condicaoSituacaoAtiva(alias)} AND ${alias}.vigencia_fim >= CURDATE()`;
}
