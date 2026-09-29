import type { RequestHandler } from 'express';

import * as repo from '../repositories/previsaoEntrada.repository.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { AppError } from '../utils/AppError.js';

/** Exige `comissoes.todas`: metade da resposta são recibos da corretora, que não se recortam por carteira. */
export const previsao: RequestHandler = async (req, res, next) => {
  try {
    const escopo = await escopoDaRequisicao(req);
    if (!escopo.comissoesTodas) throw AppError.forbidden('Comissão da corretora exige comissoes.todas.');

    res.json(await repo.previsaoEntrada(escopo));
  } catch (erro) {
    next(erro);
  }
};
