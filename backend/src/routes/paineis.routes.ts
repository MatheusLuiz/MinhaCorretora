import { Router } from 'express';

import * as controller from '../controllers/paineis.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const paineisRouter: Router = Router();

// Todos os papéis têm `dashboard.ver`; o que cada um enxerga decide o escopo.
paineisRouter.use('/paineis', ...rotaProtegida, exigirPermissao('dashboard.ver'));

paineisRouter.get('/paineis', controller.carregar);
paineisRouter.get('/paineis/consultores', controller.consultores);
paineisRouter.get('/paineis/comparativo', controller.comparativo);
paineisRouter.get('/paineis/cancelamentos', controller.cancelamentos);

// As linhas de um número do painel, com o mesmo escopo da tela.
paineisRouter.get('/paineis/detalhe', controller.detalhar);
