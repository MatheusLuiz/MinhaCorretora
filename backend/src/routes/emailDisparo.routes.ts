import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import * as controller from '../controllers/emailDisparo.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import {
  caixaSchema,
  modeloSchema,
  previaModeloSchema,
  testeCaixaSchema,
  uuidParamSchema,
} from '../schemas/emailDisparo.schema.js';
import { AppError } from '../utils/AppError.js';

export const emailDisparoRouter: Router = Router();

// Teste envia e-mail de verdade: teto baixo, para a tela não virar disparador.
const limiteTeste = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(AppError.tooManyRequests('Muitos testes seguidos. Aguarde um minuto.')),
});

// `usuarios.gerenciar`: a caixa padrão é a que manda a redefinição de senha.
emailDisparoRouter.use('/configuracoes/email', ...rotaProtegida, exigirPermissao('usuarios.gerenciar'));

emailDisparoRouter.get('/configuracoes/email/caixas', controller.listarCaixas);
emailDisparoRouter.post('/configuracoes/email/caixas', validar(caixaSchema), controller.criarCaixa);
emailDisparoRouter.post('/configuracoes/email/caixas/teste', limiteTeste, validar(testeCaixaSchema), controller.testarCaixa);
emailDisparoRouter.put(
  '/configuracoes/email/caixas/:id',
  validar(uuidParamSchema, 'params'),
  validar(caixaSchema),
  controller.atualizarCaixa,
);
emailDisparoRouter.delete('/configuracoes/email/caixas/:id', validar(uuidParamSchema, 'params'), controller.excluirCaixa);

emailDisparoRouter.get('/configuracoes/email/modelos', controller.listarModelos);
emailDisparoRouter.post('/configuracoes/email/modelos', validar(modeloSchema), controller.criarModelo);
emailDisparoRouter.post('/configuracoes/email/modelos/previa', validar(previaModeloSchema), controller.previaModelo);
emailDisparoRouter.post(
  '/configuracoes/email/modelos/teste',
  limiteTeste,
  validar(previaModeloSchema),
  controller.testarModelo,
);
emailDisparoRouter.put(
  '/configuracoes/email/modelos/:id',
  validar(uuidParamSchema, 'params'),
  validar(modeloSchema),
  controller.atualizarModelo,
);
emailDisparoRouter.delete('/configuracoes/email/modelos/:id', validar(uuidParamSchema, 'params'), controller.excluirModelo);
