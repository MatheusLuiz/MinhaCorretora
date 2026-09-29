import { Router } from 'express';

import * as controller from '../controllers/estornos.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const estornosRouter: Router = Router();

// O controller ainda exige `comissoes.todas`: estorno é dinheiro da corretora.
estornosRouter.use('/financeiro/estornos', ...rotaProtegida, exigirPermissao('comissoes.ler'));

estornosRouter.get('/financeiro/estornos', controller.listar);
