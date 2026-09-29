import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';

import * as controller from '../controllers/importacaoArquivos.controller.js';
import * as financeiro from '../controllers/financeiro.controller.js';
import { exigirPermissao } from '../middlewares/autenticacao.js';
import { rotaProtegida } from '../middlewares/rotaProtegida.js';
import { AppError } from '../utils/AppError.js';

export const importacaoRouter: Router = Router();

// `raw`, não `text`: .xlsx é zip e lê-lo como UTF-8 corromperia os bytes.
// O controller decide o formato pela assinatura do arquivo.
const corpoBinario = express.raw({
  type: ['application/octet-stream', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  limit: '25mb',
});

// 60/min: o Bradesco entrega um PDF por apólice e a tela envia simular + gravar de cada um.
const limite = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(AppError.tooManyRequests('Aguarde o término da importação anterior.')),
});

importacaoRouter.use('/importacao', ...rotaProtegida);

importacaoRouter.get(
  '/importacao/layouts',
  exigirPermissao('clientes.ler'),
  controller.listarLayouts,
);

importacaoRouter.post(
  '/importacao/apolices',
  exigirPermissao('importacao.gerenciar'),
  limite,
  corpoBinario,
  controller.importarApolicesPelaTela,
);

importacaoRouter.post(
  '/importacao/correcoes',
  ...rotaProtegida,
  exigirPermissao('importacao.gerenciar'),
  express.json({ limit: '256kb' }),
  controller.guardarCorrecoesDaTela,
);

// Carteira CRIA cliente: exige também `clientes.gerenciar`.
importacaoRouter.post(
  '/importacao/carteira',
  ...rotaProtegida,
  exigirPermissao('importacao.gerenciar'),
  exigirPermissao('clientes.gerenciar'),
  limite,
  corpoBinario,
  controller.importarCarteiraPelaTela,
);

// Com só `importacao.parcelas`, o controller recusa layout que não seja de parcelas.
importacaoRouter.post(
  '/importacao/financeiro',
  exigirPermissao('importacao.gerenciar', 'importacao.parcelas'),
  limite,
  corpoBinario,
  controller.importarFinanceiroPelaTela,
);

// Quem audita enxerga sem poder desfazer.
importacaoRouter.get(
  '/importacao/arquivos',
  exigirPermissao('auditoria.ler'),
  controller.listarArquivos,
);

importacaoRouter.get(
  '/importacao/arquivos/:lote',
  exigirPermissao('auditoria.ler'),
  controller.baixarArquivo,
);

importacaoRouter.post(
  '/importacao/arquivos/:lote/desfazer',
  exigirPermissao('importacao.gerenciar'),
  express.json({ limit: '10kb' }),
  controller.desfazerImportacao,
);

export const financeiroRouter: Router = Router();

// O router exige UMA das duas; cada rota a sua. O papel Parcelas cobra atraso sem ver comissão.
financeiroRouter.use('/financeiro', ...rotaProtegida, exigirPermissao('comissoes.ler', 'inadimplencia.ler'));

financeiroRouter.get('/financeiro/resumo', financeiro.resumo);
financeiroRouter.get('/financeiro/inadimplencia', exigirPermissao('inadimplencia.ler'), financeiro.inadimplencia);
financeiroRouter.get('/financeiro/comissoes', exigirPermissao('comissoes.ler'), financeiro.comissoes);
financeiroRouter.get('/financeiro/comissoes/periodo', exigirPermissao('comissoes.ler'), financeiro.comissaoPeriodo);
financeiroRouter.get('/financeiro/comissoes/parcelas', exigirPermissao('comissoes.ler'), financeiro.parcelasAReceber);
financeiroRouter.get(
  '/financeiro/comissoes/por-cliente',
  exigirPermissao('comissoes.ler'),
  financeiro.comissaoPorCliente,
);
