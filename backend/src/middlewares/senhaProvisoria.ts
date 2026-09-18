import type { RequestHandler } from 'express';

import * as usuarioRepo from '../repositories/usuario.repository.js';
import { AppError } from '../utils/AppError.js';

/**
 * Bloqueia a API (não só a tela) enquanto a senha provisória não for trocada.
 * Só funciona DEPOIS do `autenticar` — por isso os dois andam juntos em `rotaProtegida`.
 */
export const exigirTrocaDeSenha: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.usuario) {
      next();
      return;
    }

    // Do banco, não do token: a senha pode ter mudado no meio da sessão.
    const usuario = await usuarioRepo.buscarPorUuid(req.usuario.id);

    if (usuario?.precisaTrocarSenha) {
      next(
        new AppError(
          'Troque a senha provisória antes de usar o sistema.',
          403,
          'SENHA_PROVISORIA',
        ),
      );
      return;
    }

    next();
  } catch (erro) {
    next(erro);
  }
};
