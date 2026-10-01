import { TOKIO_EMITIDAS, TOKIO_CANCELADAS } from './modelos/carteira.js';
import { TOKIO_COMISSOES_EXTRATO } from './modelos/financeiro.js';
import type { LayoutsDaSeguradora } from '../comum/layouts.js';

/** Os layouts de importação desta pasta — ver `seguradoras/LEIA-ME.md`. Layout novo entra aqui. */
export const layouts: LayoutsDaSeguradora = {
  carteira: [TOKIO_EMITIDAS, TOKIO_CANCELADAS],
  financeiro: [TOKIO_COMISSOES_EXTRATO],
};
