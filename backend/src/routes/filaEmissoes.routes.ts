import { Router } from 'express';

import * as controller from '../controllers/filaEmissoes.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const filaEmissoesRouter: Router = Router();

filaEmissoesRouter.use('/filas/emissoes', ...rotaProtegida, exigirPermissao('apolices.ler'));

filaEmissoesRouter.get('/filas/emissoes/resumo', controller.resumo);
filaEmissoesRouter.get('/filas/emissoes', controller.listar);
