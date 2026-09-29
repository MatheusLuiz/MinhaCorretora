import { Router } from 'express';

import * as controller from '../controllers/conciliacao.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const conciliacaoRouter: Router = Router();

// Os handlers exigem ainda `comissoes.todas`: o demonstrativo não recorta por carteira.
conciliacaoRouter.use('/financeiro/conciliacao', ...rotaProtegida, exigirPermissao('comissoes.ler'));

conciliacaoRouter.get('/financeiro/conciliacao', controller.grade);
conciliacaoRouter.get('/financeiro/conciliacao/ordens', controller.ordens);
conciliacaoRouter.get('/financeiro/conciliacao/retencoes', controller.retencoes);
conciliacaoRouter.get('/financeiro/conciliacao/retencoes.xlsx', controller.retencoesXlsx);
