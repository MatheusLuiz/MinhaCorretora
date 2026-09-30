import { YELUM_BUSCA_APOLICES, YELUM_RENOVACOES, YELUM_CANCELADAS } from './modelos/apolices.js';
import { YELUM_PARCELAS_ATRASADAS, YELUM_COMISSAO_MENSAL } from './modelos/financeiro.js';
import type { LayoutsDaSeguradora } from '../comum/layouts.js';

/** Os layouts de importação desta pasta — ver `seguradoras/LEIA-ME.md`. Layout novo entra aqui. */
export const layouts: LayoutsDaSeguradora = {
  apolices: [YELUM_BUSCA_APOLICES, YELUM_RENOVACOES, YELUM_CANCELADAS],
  financeiro: [YELUM_PARCELAS_ATRASADAS, YELUM_COMISSAO_MENSAL],
};
