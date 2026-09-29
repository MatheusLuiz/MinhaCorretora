import type { RequestHandler } from 'express';

import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import * as repo from '../repositories/notificacao.repository.js';
import { AppError } from '../utils/AppError.js';
import { uuidEhValido } from '../utils/uuid.js';

// Toda consulta filtra pelo usuário da requisição: ninguém lê ou marca notificação alheia, nem com o id.

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const { notificacoes, naoLidas } = await repo.listarDoUsuario(usuarioDaRequisicao(req).id, 30);
    res.json({
      naoLidas,
      notificacoes: notificacoes.map((n) => ({
        id: n.uuid,
        tipo: n.tipo,
        titulo: n.titulo,
        mensagem: n.mensagem,
        criadaEm: n.criada_em,
        lida: n.lida_em !== null,
        clienteId: n.cliente_uuid,
      })),
    });
  } catch (erro) {
    next(erro);
  }
};

export const marcarLida: RequestHandler = async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!uuidEhValido(id)) throw AppError.badRequest('Notificação inválida.');
    await repo.marcarLida(usuarioDaRequisicao(req).id, id);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
};

export const marcarTodasLidas: RequestHandler = async (req, res, next) => {
  try {
    await repo.marcarTodasLidas(usuarioDaRequisicao(req).id);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
};
