import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { verificarAccessToken } from '../services/token.service.js';
import { AppError } from '../utils/AppError.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';

export interface UsuarioAutenticado {
  id: string;
  email: string;
  nome: string;
  papel: string;
  permissoes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

/** Exige `Authorization: Bearer <token>` válido. Header, não cookie, para não abrir CSRF. */
export const autenticar: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.get('authorization');

    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized('Token de acesso não informado.');
    }

    const token = header.slice(7).trim();

    if (!token) {
      throw AppError.unauthorized('Token de acesso não informado.');
    }

    const payload = await verificarAccessToken(token);

    // A assinatura não basta: a conta precisa seguir ativa e a sessão não revogada.
    const usuarioAtual = await usuarioRepo.buscarPorUuid(payload.sub);
    if (!usuarioAtual || !usuarioAtual.ativo) {
      throw AppError.unauthorized('Sessão encerrada. Faça login novamente.');
    }

    if (
      payload.sessaoVersao !== undefined &&
      payload.sessaoVersao !== (await usuarioRepo.versaoSessao(usuarioAtual.id))
    ) {
      throw AppError.unauthorized('Sessão encerrada. Faça login novamente.');
    }

    req.usuario = {
      id: payload.sub,
      email: payload.email,
      nome: payload.nome,
      papel: payload.papel,
      permissoes: Array.isArray(payload.permissoes) ? payload.permissoes : [],
    };

    next();
  } catch (erro) {
    next(erro);
  }
};

/** Garante que o handler só rode com `req.usuario` preenchido. */
export function usuarioDaRequisicao(req: Request): UsuarioAutenticado {
  if (!req.usuario) {
    throw AppError.unauthorized();
  }
  return req.usuario;
}

/** Id interno de quem fez a requisição, para auditoria; `null` em vez de lançar. */
export async function idDoUsuarioDaRequisicao(req: Request): Promise<number | null> {
  try {
    const usuario = await usuarioRepo.buscarPorUuid(usuarioDaRequisicao(req).id);
    return usuario?.id ?? null;
  } catch {
    return null;
  }
}

/** Exige uma das permissões informadas (permissão, nunca papel). */
export function exigirPermissao(...permissoesNecessarias: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const usuario = req.usuario;

    if (!usuario) {
      next(AppError.unauthorized());
      return;
    }

    const temPermissao = permissoesNecessarias.some((permissao) =>
      usuario.permissoes.includes(permissao),
    );

    if (!temPermissao) {
      next(AppError.forbidden('Você não tem permissão para esta operação.'));
      return;
    }

    next();
  };
}
