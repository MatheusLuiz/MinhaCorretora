import { Router } from 'express';

import * as controller from '../controllers/previsaoEntrada.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const previsaoEntradaRouter: Router = Router();

// `comissoes.todas` é conferida no controller.
previsaoEntradaRouter.use('/financeiro/previsao', ...rotaProtegida, exigirPermissao('comissoes.ler'));

previsaoEntradaRouter.get('/financeiro/previsao', controller.previsao);
