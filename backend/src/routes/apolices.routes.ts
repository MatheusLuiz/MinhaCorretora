import { Router } from 'express';

import * as controller from '../controllers/apolices.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import { listarApolicesSchema } from '../schemas/apolices.schema.js';

export const apolicesRouter: Router = Router();

apolicesRouter.use('/apolices', ...rotaProtegida, exigirPermissao('apolices.ler'));

// O resumo não aplica escopo de carteira: só quem tem `clientes.todos`.
apolicesRouter.get('/apolices/resumo', exigirPermissao('clientes.todos'), controller.resumo);

apolicesRouter.get('/apolices', validar(listarApolicesSchema, 'query'), controller.listar);
