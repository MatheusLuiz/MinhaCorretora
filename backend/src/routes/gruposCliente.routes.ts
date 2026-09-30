import { Router } from 'express';

import * as controller from '../controllers/gruposCliente.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import { dadosGrupoClienteSchema, situacaoGrupoClienteSchema } from '../schemas/gruposCliente.schema.js';

export const gruposClienteRouter: Router = Router();

// Ler é de qualquer autenticado; mexer exige `integracao.gerenciar`.
gruposClienteRouter.use('/grupos-cliente', ...rotaProtegida);

gruposClienteRouter.get('/grupos-cliente', controller.listar);

gruposClienteRouter.post(
  '/grupos-cliente',
  exigirPermissao('integracao.gerenciar'),
  validar(dadosGrupoClienteSchema),
  controller.criar,
);

gruposClienteRouter.patch(
  '/grupos-cliente/:id',
  exigirPermissao('integracao.gerenciar'),
  validar(dadosGrupoClienteSchema),
  controller.atualizar,
);

gruposClienteRouter.patch(
  '/grupos-cliente/:id/situacao',
  exigirPermissao('integracao.gerenciar'),
  validar(situacaoGrupoClienteSchema),
  controller.definirSituacao,
);
