import type { RequestHandler } from 'express';

import * as repo from '../repositories/filaEmissoes.repository.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import { AppError } from '../utils/AppError.js';

// Recorte de CARTEIRA, nunca o de consulta: a fila soma prêmio.

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `AAAA-MM` opcional; qualquer outra coisa é recusada, não ignorada. */
function mesDaQuery(valor: unknown, nome: string): string | undefined {
  if (valor === undefined || valor === '') return undefined;
  if (typeof valor !== 'string' || !MES.test(valor)) {
    throw AppError.badRequest(`Parâmetro "${nome}" inválido: use AAAA-MM.`);
  }
  return valor;
}

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const de = mesDaQuery(req.query.de, 'de');
    const ate = mesDaQuery(req.query.ate, 'ate');
    if (de && ate && de > ate) throw AppError.badRequest('"de" depois de "ate".');

    res.json(await repo.listarEmissoes({ de, ate }, await escopoDaRequisicao(req)));
  } catch (erro) {
    next(erro);
  }
};

export const resumo: RequestHandler = async (req, res, next) => {
  try {
    // `?ano=AAAA`: a série vira os 12 meses daquele ano. Sem ele, os últimos 12.
    const bruto = req.query.ano;
    if (bruto !== undefined && bruto !== '' && (typeof bruto !== 'string' || !/^\d{4}$/.test(bruto))) {
      throw AppError.badRequest('Parâmetro "ano" inválido: use AAAA.');
    }
    const ano = typeof bruto === 'string' && bruto !== '' ? Number(bruto) : undefined;
    res.json(await repo.resumoEmissoes(await escopoDaRequisicao(req), ano));
  } catch (erro) {
    next(erro);
  }
};
