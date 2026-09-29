import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';

import * as atendimentos from '../controllers/atendimentos.controller.js';
import * as controller from '../controllers/clientes.controller.js';
import * as importacao from '../controllers/importacaoClientes.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { validar } from '../middlewares/validar.js';
import {
  criarClienteSchema,
  editarClienteSchema,
  documentoParamSchema,
  idClienteSchema,
  listarClientesSchema,
} from '../schemas/clientes.schema.js';
import { idAtendimentoSchema, novoAtendimentoSchema } from '../schemas/atendimentos.schema.js';
import { novaApoliceSchema } from '../schemas/novaApolice.schema.js';
import { AppError } from '../utils/AppError.js';

export const clientesRouter: Router = Router();

// No router inteiro, para rota nova não nascer aberta.
clientesRouter.use('/clientes', ...rotaProtegida, exigirPermissao('clientes.ler'));

// Limite de corpo próprio só na importação; o resto da API mantém o teto global baixo.
const corpoPlanilha = express.text({ type: ['text/csv', 'text/plain'], limit: '25mb' });

// Evita duas cargas concorrentes sobre as mesmas linhas.
const limiteImportacao = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(AppError.tooManyRequests('Aguarde o término da importação anterior.')),
});

// Rotas de caminho fixo vêm ANTES de `/clientes/:id`, senão casariam com `:id`.
clientesRouter.get('/clientes/filtros', controller.filtros);
clientesRouter.get('/clientes/situacoes', controller.situacoes);
clientesRouter.get('/clientes/painel', controller.resumoPainel);
clientesRouter.get('/clientes/corretores', exigirPermissao('clientes.gerenciar'), controller.corretores);

// Teto para o sistema não virar repetidor da API de CEP.
const limiteCep = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(AppError.tooManyRequests('Muitas consultas de CEP seguidas. Aguarde um instante.')),
});

clientesRouter.get(
  '/clientes/cep/:cep',
  exigirPermissao('clientes.gerenciar'),
  limiteCep,
  controller.consultarCep,
);

// Menor que o do CEP: as fontes gratuitas de CNPJ limitam por minuto.
const limiteCnpj = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(AppError.tooManyRequests('Muitas consultas de CNPJ seguidas. Aguarde um instante.')),
});

clientesRouter.get(
  '/clientes/documento/:documento',
  exigirPermissao('clientes.gerenciar'),
  validar(documentoParamSchema, 'params'),
  controller.verificarDocumento,
);

clientesRouter.get(
  '/clientes/cnpj/:cnpj',
  exigirPermissao('clientes.gerenciar'),
  limiteCnpj,
  controller.consultarCnpj,
);

clientesRouter.get('/clientes/importacao/modelos', importacao.listarModelos);

clientesRouter.get(
  '/clientes/importacao/modelos/:chave',
  exigirPermissao('importacao.gerenciar'),
  importacao.baixarModelo,
);

clientesRouter.get(
  '/clientes/exportar',
  exigirPermissao('clientes.gerenciar'),
  exigirPermissao('clientes.todos'),
  importacao.exportar,
);

clientesRouter.post(
  '/clientes/importacao/previa',
  exigirPermissao('importacao.gerenciar'),
  limiteImportacao,
  corpoPlanilha,
  importacao.previa,
);

clientesRouter.post(
  '/clientes/importacao',
  exigirPermissao('importacao.gerenciar'),
  limiteImportacao,
  corpoPlanilha,
  importacao.executar,
);

clientesRouter.post(
  '/clientes',
  exigirPermissao('clientes.gerenciar'),
  validar(criarClienteSchema),
  controller.criar,
);

clientesRouter.get('/clientes', validar(listarClientesSchema, 'query'), controller.listar);

clientesRouter.get('/clientes/:id', validar(idClienteSchema, 'params'), controller.detalhar);

// PATCH: o corpo é delta. O serviço ainda aplica o recorte de carteira.
clientesRouter.patch(
  '/clientes/:id',
  exigirPermissao('clientes.gerenciar'),
  validar(idClienteSchema, 'params'),
  validar(editarClienteSchema),
  controller.editar,
);

clientesRouter.post(
  '/clientes/:id/apolices',
  exigirPermissao('clientes.gerenciar'),
  validar(idClienteSchema, 'params'),
  validar(novaApoliceSchema),
  controller.criarApolice,
);

// Atendimentos: qualquer um que abra a ficha registra; apagar só o autor (decidido no controller).
clientesRouter.get('/clientes/:id/atendimentos', validar(idClienteSchema, 'params'), atendimentos.listar);
clientesRouter.post(
  '/clientes/:id/atendimentos',
  validar(idClienteSchema, 'params'),
  validar(novoAtendimentoSchema),
  atendimentos.criar,
);
clientesRouter.delete(
  '/clientes/:id/atendimentos/:atendimento',
  validar(idAtendimentoSchema, 'params'),
  atendimentos.excluir,
);
