/**
 * Quanto da corretora um usuário enxerga; todo repositório aplica o mesmo filtro.
 * Mora em `utils` porque os repositórios dependem dele; quem o monta é `services/escopo.ts`.
 */
export interface Escopo {
  /** `null` = base inteira. Lista vazia = não vê nada (nunca vira "tudo"). */
  produtorIds: number[] | null;

  /** Vê todas as parcelas em atraso; sem isso, só o cliente com UM atraso. */
  inadimplenciaCompleta: boolean;

  /** Vê a comissão da corretora. */
  comissoesTodas: boolean;
}

/** Sem restrição. Para scripts de linha de comando e cargas, que não têm sessão. */
export const ESCOPO_TOTAL: Escopo = {
  produtorIds: null,
  inadimplenciaCompleta: true,
  comissoesTodas: true,
};

/** Condição SQL do recorte (sem `AND`); `null` sem restrição, `1 = 0` com carteira vazia. */
export function condicaoDeCarteira(
  escopo: Escopo | undefined,
  coluna: string,
): { condicao: string | null; valores: number[] } {
  const ids = (escopo ?? ESCOPO_TOTAL).produtorIds;

  if (ids === null) return { condicao: null, valores: [] };
  if (ids.length === 0) return { condicao: '1 = 0', valores: [] };

  return { condicao: `${coluna} IN (${ids.map(() => '?').join(', ')})`, valores: ids };
}
