import type { LayoutApolices } from '../../services/modelosApolices.js';
import type { LayoutCarteira } from '../../services/modelosCarteira.js';
import type { LayoutFinanceiro } from '../../services/modelosFinanceiro.js';

/** Layouts que o `index.ts` de uma seguradora exporta; a ordem é a da tela (o primeiro é o sugerido). */
export interface LayoutsDaSeguradora {
  carteira?: LayoutCarteira[];
  apolices?: LayoutApolices[];
  financeiro?: LayoutFinanceiro[];
}
