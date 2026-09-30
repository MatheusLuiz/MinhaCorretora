import { SUHAI_EMITIDAS, SUHAI_A_RENOVAR, SUHAI_CANCELADAS_INADIMPLENCIA } from './modelos/carteira.js';
import {
  SUHAI_PARCELAS_PENDENTES,
  SUHAI_COMISSOES_DEMONSTRATIVO,
  SUHAI_COMISSOES_RECIBOS,
  SUHAI_SINISTROS,
} from './modelos/financeiro.js';
import type { LayoutsDaSeguradora } from '../comum/layouts.js';

/** Os layouts de importação desta pasta — ver `seguradoras/LEIA-ME.md`. Layout novo entra aqui. */
export const layouts: LayoutsDaSeguradora = {
  carteira: [SUHAI_EMITIDAS, SUHAI_A_RENOVAR, SUHAI_CANCELADAS_INADIMPLENCIA],
  financeiro: [SUHAI_PARCELAS_PENDENTES, SUHAI_COMISSOES_DEMONSTRATIVO, SUHAI_COMISSOES_RECIBOS, SUHAI_SINISTROS],
};
