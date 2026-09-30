import { Router } from 'express';

import * as controller from '../controllers/painelSeguradoras.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const painelSeguradorasRouter: Router = Router();

// Dashboard de Seguradoras; o caminho fica em `/filas/…` por compatibilidade com a tela.
painelSeguradorasRouter.use('/filas/seguradoras', ...rotaProtegida, exigirPermissao('dashboard.ver'));

painelSeguradorasRouter.get('/filas/seguradoras/resumo', controller.resumo);
