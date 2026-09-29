import { Router } from 'express';

import * as controller from '../controllers/cotacoes.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import {
  novaCotacaoSchema,
  propostaSchema,
  situacaoCotacaoSchema,
} from '../schemas/cotacoes.schema.js';

export const cotacoesRouter: Router = Router();

// `clientes.gerenciar`: cotar pré-cadastra cliente.
cotacoesRouter.use('/cotacoes', ...rotaProtegida, exigirPermissao('clientes.gerenciar'));

cotacoesRouter.get('/cotacoes', controller.listar);
cotacoesRouter.post('/cotacoes', validar(novaCotacaoSchema), controller.criar);
cotacoesRouter.get('/cotacoes/:id', controller.detalhar);
cotacoesRouter.post('/cotacoes/:id/propostas', validar(propostaSchema), controller.adicionarProposta);
cotacoesRouter.delete('/cotacoes/:id/propostas/:propostaId', controller.removerProposta);
cotacoesRouter.patch('/cotacoes/:id/situacao', validar(situacaoCotacaoSchema), controller.definirSituacao);
