import { Router } from 'express';

import * as controller from '../controllers/notificacoes.controller.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';

export const notificacoesRouter: Router = Router();

// Sem permissão: o controller filtra pelo usuário da requisição.
notificacoesRouter.use('/notificacoes', ...rotaProtegida);

notificacoesRouter.get('/notificacoes', controller.listar);
notificacoesRouter.post('/notificacoes/lidas', controller.marcarTodasLidas);
notificacoesRouter.post('/notificacoes/:id/lida', controller.marcarLida);
