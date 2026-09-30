import { PORTO_AB123C, PORTO_CONSULTA, PORTO_CONSULTA_PORTAL } from './modelos/carteira.js';
import { PORTO_COMISSAO_ANALITICA, PORTO_COMISSAO_EXTRATO, PORTO_PARCELAS_VENCIDAS } from './modelos/financeiro.js';
import type { LayoutsDaSeguradora } from '../comum/layouts.js';

/** Os layouts de importação desta pasta — ver `seguradoras/LEIA-ME.md`. Layout novo entra aqui. */
export const layouts: LayoutsDaSeguradora = {
  carteira: [PORTO_AB123C, PORTO_CONSULTA, PORTO_CONSULTA_PORTAL],
  financeiro: [PORTO_COMISSAO_ANALITICA, PORTO_COMISSAO_EXTRATO, PORTO_PARCELAS_VENCIDAS],
};
