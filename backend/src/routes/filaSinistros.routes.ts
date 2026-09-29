import { Router } from 'express';

import * as controller from '../controllers/filaSinistros.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const filaSinistrosRouter: Router = Router();

filaSinistrosRouter.use('/filas/sinistros', ...rotaProtegida, exigirPermissao('sinistros.ler'));

filaSinistrosRouter.get('/filas/sinistros/resumo', controller.resumo);
filaSinistrosRouter.get('/filas/sinistros', controller.listar);
