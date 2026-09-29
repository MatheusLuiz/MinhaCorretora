import { Router } from 'express';

import * as controller from '../controllers/tiposSeguro.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import {
  dadosTipoSeguroSchema,
  habilitacaoSchema,
  situacaoTipoSeguroSchema,
} from '../schemas/tiposSeguro.schema.js';

export const tiposSeguroRouter: Router = Router();

// Ler é de qualquer autenticado; mexer exige `integracao.gerenciar`.
tiposSeguroRouter.use('/tipos-seguro', ...rotaProtegida);

tiposSeguroRouter.get('/tipos-seguro', controller.listar);

tiposSeguroRouter.post(
  '/tipos-seguro',
  exigirPermissao('integracao.gerenciar'),
  validar(dadosTipoSeguroSchema),
  controller.criar,
);

tiposSeguroRouter.patch(
  '/tipos-seguro/:id',
  exigirPermissao('integracao.gerenciar'),
  validar(dadosTipoSeguroSchema),
  controller.atualizar,
);

tiposSeguroRouter.patch(
  '/tipos-seguro/:id/situacao',
  exigirPermissao('integracao.gerenciar'),
  validar(situacaoTipoSeguroSchema),
  controller.definirSituacao,
);

tiposSeguroRouter.put(
  '/tipos-seguro/:id/seguradoras/:seguradoraId',
  exigirPermissao('integracao.gerenciar'),
  validar(habilitacaoSchema),
  controller.definirHabilitacao,
);
