import { Router } from 'express';

import * as controller from '../controllers/tarefas.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import { dadosTarefaSchema, situacaoTarefaSchema, uuidTarefaSchema } from '../schemas/tarefas.schema.js';

export const tarefasRouter: Router = Router();

// `integracao.gerenciar`: as rotinas falam com a API das seguradoras.
tarefasRouter.use('/tarefas', ...rotaProtegida, exigirPermissao('integracao.gerenciar'));

tarefasRouter.get('/tarefas', controller.listar);
tarefasRouter.get('/tarefas/execucoes', controller.execucoesGerais);
tarefasRouter.get('/tarefas/execucoes/:execucao/log', controller.logDaExecucao);
tarefasRouter.post('/tarefas', validar(dadosTarefaSchema), controller.criar);
tarefasRouter.patch(
  '/tarefas/:id',
  validar(uuidTarefaSchema, 'params'),
  validar(dadosTarefaSchema),
  controller.atualizar,
);
tarefasRouter.patch(
  '/tarefas/:id/situacao',
  validar(uuidTarefaSchema, 'params'),
  validar(situacaoTarefaSchema),
  controller.definirSituacao,
);
tarefasRouter.delete('/tarefas/:id', validar(uuidTarefaSchema, 'params'), controller.excluir);
tarefasRouter.post('/tarefas/:id/executar', validar(uuidTarefaSchema, 'params'), controller.executarAgora);
tarefasRouter.get('/tarefas/:id/execucoes', validar(uuidTarefaSchema, 'params'), controller.execucoes);
