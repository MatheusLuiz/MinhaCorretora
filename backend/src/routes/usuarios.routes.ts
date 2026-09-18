import { Router } from 'express';

import * as controller from '../controllers/usuarios.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import {
  chavePapelSchema,
  edicaoPapelSchema,
  novoPapelSchema,
  situacaoPapelSchema,
  criarUsuarioSchema,
  permissoesDoPapelSchema,
  produtoresUsuarioSchema,
  editarUsuarioSchema,
  idUsuarioSchema,
  permissoesUsuarioSchema,
  situacaoUsuarioSchema,
} from '../schemas/usuarios.schema.js';

export const usuariosRouter: Router = Router();

// No router inteiro, para rota nova não nascer aberta.
usuariosRouter.use('/usuarios', ...rotaProtegida, exigirPermissao('usuarios.gerenciar'));

usuariosRouter.get('/usuarios', controller.listar);
usuariosRouter.get('/usuarios/papeis', controller.papeis);

// Papéis sob `/usuarios`: editar papel é a mesma autoridade de gerenciar usuários.
// Rotas de caminho fixo vêm ANTES de `/usuarios/:id`, senão casariam com `:id`.
usuariosRouter.get(
  '/usuarios/papeis/:chave',
  validar(chavePapelSchema, 'params'),
  controller.detalharPapel,
);

usuariosRouter.post('/usuarios/papeis', validar(novoPapelSchema), controller.criarPapel);

usuariosRouter.patch(
  '/usuarios/papeis/:chave',
  validar(chavePapelSchema, 'params'),
  validar(edicaoPapelSchema),
  controller.editarPapel,
);

usuariosRouter.delete('/usuarios/papeis/:chave', validar(chavePapelSchema, 'params'), controller.excluirPapel);

usuariosRouter.patch(
  '/usuarios/papeis/:chave/situacao',
  validar(chavePapelSchema, 'params'),
  validar(situacaoPapelSchema),
  controller.definirSituacaoPapel,
);

usuariosRouter.put(
  '/usuarios/papeis/:chave/permissoes',
  validar(chavePapelSchema, 'params'),
  validar(permissoesDoPapelSchema),
  controller.definirPermissoesDoPapel,
);

usuariosRouter.get('/usuarios/produtores', controller.produtores);

usuariosRouter.post('/usuarios', validar(criarUsuarioSchema), controller.criar);

usuariosRouter.get('/usuarios/:id', validar(idUsuarioSchema, 'params'), controller.detalhar);

usuariosRouter.patch(
  '/usuarios/:id',
  validar(idUsuarioSchema, 'params'),
  validar(editarUsuarioSchema),
  controller.editar,
);

usuariosRouter.patch(
  '/usuarios/:id/situacao',
  validar(idUsuarioSchema, 'params'),
  validar(situacaoUsuarioSchema),
  controller.alterarSituacao,
);

usuariosRouter.post(
  '/usuarios/:id/redefinir-senha',
  validar(idUsuarioSchema, 'params'),
  controller.redefinirSenha,
);

usuariosRouter.get(
  '/usuarios/:id/permissoes',
  validar(idUsuarioSchema, 'params'),
  controller.permissoes,
);

usuariosRouter.put(
  '/usuarios/:id/permissoes',
  validar(idUsuarioSchema, 'params'),
  validar(permissoesUsuarioSchema),
  controller.definirPermissoes,
);

usuariosRouter.get(
  '/usuarios/:id/carteira',
  validar(idUsuarioSchema, 'params'),
  controller.carteira,
);

usuariosRouter.put(
  '/usuarios/:id/carteira',
  validar(idUsuarioSchema, 'params'),
  validar(produtoresUsuarioSchema),
  controller.definirCarteira,
);
