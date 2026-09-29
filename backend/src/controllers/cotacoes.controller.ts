import type { Request, RequestHandler } from 'express';

import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import type { SituacaoCotacao } from '../repositories/cotacao.repository.js';
import type {
  NovaCotacaoInput,
  PropostaInput,
  SituacaoCotacaoInput,
} from '../schemas/cotacoes.schema.js';
import * as service from '../services/cotacao.service.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { AppError } from '../utils/AppError.js';
import { uuidEhValido } from '../utils/uuid.js';

// Recorte ESTRITO de carteira em tudo: cotar é mexer na carteira, não só consultar.

const SITUACOES: SituacaoCotacao[] = ['em_cotacao', 'enviada', 'fechada', 'perdida'];

function idDaRota(req: Request): string {
  const id = String(req.params.id ?? '');
  if (!uuidEhValido(id)) throw AppError.unprocessable('Cotação inválida.');
  return id;
}

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const situacao = SITUACOES.find((s) => s === req.query.situacao);
    res.json({ cotacoes: await service.listar(await escopoDaRequisicao(req), situacao) });
  } catch (erro) {
    next(erro);
  }
};

export const detalhar: RequestHandler = async (req, res, next) => {
  try {
    res.json({ cotacao: await service.detalhar(idDaRota(req), await escopoDaRequisicao(req)) });
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const id = await service.criar(req.body as NovaCotacaoInput, usuarioDaRequisicao(req), await escopoDaRequisicao(req));
    // Escopo recalculado: a primeira cotação pode ter criado o corretor.
    res.status(201).json({ cotacao: await service.detalhar(id, await escopoDaRequisicao(req)) });
  } catch (erro) {
    next(erro);
  }
};

export const adicionarProposta: RequestHandler = async (req, res, next) => {
  try {
    const id = idDaRota(req);
    const escopo = await escopoDaRequisicao(req);
    await service.adicionarProposta(id, req.body as PropostaInput, escopo);
    res.status(201).json({ cotacao: await service.detalhar(id, escopo) });
  } catch (erro) {
    next(erro);
  }
};

export const removerProposta: RequestHandler = async (req, res, next) => {
  try {
    const id = idDaRota(req);
    const propostaId = Number(req.params.propostaId);
    if (!Number.isInteger(propostaId) || propostaId <= 0) throw AppError.unprocessable('Proposta inválida.');
    const escopo = await escopoDaRequisicao(req);
    await service.removerProposta(id, propostaId, escopo);
    res.json({ cotacao: await service.detalhar(id, escopo) });
  } catch (erro) {
    next(erro);
  }
};

export const definirSituacao: RequestHandler = async (req, res, next) => {
  try {
    const id = idDaRota(req);
    const escopo = await escopoDaRequisicao(req);
    await service.definirSituacao(id, req.body as SituacaoCotacaoInput, escopo);
    res.json({ cotacao: await service.detalhar(id, escopo) });
  } catch (erro) {
    next(erro);
  }
};
