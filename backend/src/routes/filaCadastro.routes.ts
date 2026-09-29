import { Router } from 'express';

import * as controller from '../controllers/filaCadastro.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const filaCadastroRouter: Router = Router();

// Ler basta: a fila só aponta o que falta; corrigir é na ficha.
filaCadastroRouter.use('/filas/cadastro', ...rotaProtegida, exigirPermissao('clientes.ler'));

filaCadastroRouter.get('/filas/cadastro/resumo', controller.resumo);
filaCadastroRouter.get('/filas/cadastro', controller.listar);
