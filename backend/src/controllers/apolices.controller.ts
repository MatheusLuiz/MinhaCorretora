import type { RequestHandler } from 'express';

import type { ListarApolicesInput } from '../schemas/apolices.schema.js';
import { escopoDaRequisicao } from '../services/escopo.js';
import * as service from '../services/apolices.service.js';

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const filtro = req.query as unknown as ListarApolicesInput;

    res.json(
      await service.listar({
        busca: filtro.busca,
        seguradora: filtro.seguradora,
        // O schema entrega 'sim'/'nao'; ausente significa "todas".
        semCliente:
          filtro.semCliente === undefined ? undefined : filtro.semCliente === 'sim',
        pagina: filtro.pagina,
        limite: filtro.limite,
        escopo: await escopoDaRequisicao(req),
      }),
    );
  } catch (erro) {
    next(erro);
  }
};

export const resumo: RequestHandler = async (_req, res, next) => {
  try {
    res.json(await service.resumo());
  } catch (erro) {
    next(erro);
  }
};

