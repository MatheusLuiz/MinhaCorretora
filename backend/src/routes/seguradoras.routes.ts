import { Router } from 'express';

import * as controller from '../controllers/seguradoras.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import {
  dadosSeguradoraSchema,
  integracaoSchema,
  situacaoSeguradoraSchema,
} from '../schemas/seguradoras.schema.js';

export const seguradorasRouter: Router = Router();

// Ler é para todo autenticado (alimenta os <select>); escrever guarda credencial: `integracao.gerenciar`.
seguradorasRouter.use('/seguradoras', ...rotaProtegida);

seguradorasRouter.get('/seguradoras', controller.listar);

seguradorasRouter.post(
  '/seguradoras',
  exigirPermissao('integracao.gerenciar'),
  validar(dadosSeguradoraSchema),
  controller.criar,
);

seguradorasRouter.patch(
  '/seguradoras/:id',
  exigirPermissao('integracao.gerenciar'),
  validar(dadosSeguradoraSchema),
  controller.atualizar,
);

seguradorasRouter.patch(
  '/seguradoras/:id/situacao',
  exigirPermissao('integracao.gerenciar'),
  validar(situacaoSeguradoraSchema),
  controller.definirSituacao,
);

seguradorasRouter.put(
  '/seguradoras/:id/integracao',
  exigirPermissao('integracao.gerenciar'),
  validar(integracaoSchema),
  controller.salvarIntegracao,
);
