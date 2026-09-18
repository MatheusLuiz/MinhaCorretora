import type { CookieOptions, RequestHandler } from 'express';

import { cookieSecure, env } from '../config/env.js';
import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import type {
  AlterarSenhaInput,
  EsqueciSenhaInput,
  LoginInput,
  RedefinirSenhaInput,
  ValidarTokenInput,
} from '../schemas/auth.schema.js';
import * as authService from '../services/auth.service.js';
import { ipDaRequisicao, userAgentDaRequisicao } from '../utils/rede.js';
import { emitirTokenCsrf, limparTokenCsrf } from '../middlewares/csrf.js';

/** Cookie de refresh: `httpOnly` contra roubo por XSS, `strict` contra CSRF, só nas rotas de auth. */
function opcoesCookieRefresh(expiraEm: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'strict',
    path: `${env.API_PREFIX}/auth`,
    expires: expiraEm,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export const login: RequestHandler = async (req, res, next) => {
  try {
    const { email, senha } = req.body as LoginInput;

    const resultado = await authService.login(email, senha, {
      ip: ipDaRequisicao(req),
      userAgent: userAgentDaRequisicao(req),
    });

    res.cookie(
      env.REFRESH_COOKIE_NAME,
      resultado.refreshToken,
      opcoesCookieRefresh(resultado.refreshExpiraEm),
    );

    // O refresh token sai só no cookie (no corpo, anularia o httpOnly); o de CSRF vai junto.
    res.json({
      usuario: resultado.usuario,
      accessToken: resultado.accessToken,
      expiraEmSegundos: env.ACCESS_TOKEN_TTL_MIN * 60,
      csrfToken: emitirTokenCsrf(res, resultado.refreshExpiraEm),
    });
  } catch (erro) {
    next(erro);
  }
};

export const renovar: RequestHandler = async (req, res, next) => {
  try {
    const refreshToken: unknown = req.cookies?.[env.REFRESH_COOKIE_NAME];

    if (typeof refreshToken !== 'string' || !refreshToken) {
      res.status(401).json({
        erro: { codigo: 'UNAUTHORIZED', mensagem: 'Sessão não encontrada. Faça login.' },
      });
      return;
    }

    const resultado = await authService.renovarSessao(refreshToken, {
      ip: ipDaRequisicao(req),
      userAgent: userAgentDaRequisicao(req),
    });

    res.cookie(
      env.REFRESH_COOKIE_NAME,
      resultado.refreshToken,
      opcoesCookieRefresh(resultado.refreshExpiraEm),
    );

    res.json({
      usuario: resultado.usuario,
      accessToken: resultado.accessToken,
      expiraEmSegundos: env.ACCESS_TOKEN_TTL_MIN * 60,
      csrfToken: emitirTokenCsrf(res, resultado.refreshExpiraEm),
    });
  } catch (erro) {
    // Sessão inválida: apaga o cookie para o navegador parar de reenviá-lo.
    res.clearCookie(env.REFRESH_COOKIE_NAME, { path: `${env.API_PREFIX}/auth` });
    limparTokenCsrf(res);
    next(erro);
  }
};

export const logout: RequestHandler = async (req, res, next) => {
  try {
    const refreshToken: unknown = req.cookies?.[env.REFRESH_COOKIE_NAME];

    await authService.logout(typeof refreshToken === 'string' ? refreshToken : undefined, {
      ip: ipDaRequisicao(req),
      userAgent: userAgentDaRequisicao(req),
    });

    res.clearCookie(env.REFRESH_COOKIE_NAME, { path: `${env.API_PREFIX}/auth` });
    limparTokenCsrf(res);
    res.status(204).send();
  } catch (erro) {
    next(erro);
  }
};

export const perfil: RequestHandler = async (req, res, next) => {
  try {
    const usuario = usuarioDaRequisicao(req);
    res.json({ usuario: await authService.obterPerfil(usuario.id) });
  } catch (erro) {
    next(erro);
  }
};

export const alterarSenha: RequestHandler = async (req, res, next) => {
  try {
    const usuario = usuarioDaRequisicao(req);
    const { senhaAtual, novaSenha } = req.body as AlterarSenhaInput;

    await authService.alterarSenha(usuario.id, senhaAtual, novaSenha, {
      ip: ipDaRequisicao(req),
      userAgent: userAgentDaRequisicao(req),
    });

    // A troca de senha revoga todas as sessões, inclusive esta.
    res.clearCookie(env.REFRESH_COOKIE_NAME, { path: `${env.API_PREFIX}/auth` });
    limparTokenCsrf(res);
    res.json({ mensagem: 'Senha alterada. Entre novamente com a nova senha.' });
  } catch (erro) {
    next(erro);
  }
};

/** Resposta SEMPRE igual, em qualquer cenário: variar revelaria quem tem conta. */
const RESPOSTA_ESQUECI_SENHA =
  'Se este e-mail estiver cadastrado, você receberá em instantes um link para redefinir a senha.';

export const esqueciSenha: RequestHandler = async (req, res, next) => {
  try {
    const { email } = req.body as EsqueciSenhaInput;

    await authService.solicitarRedefinicaoSenha(email, {
      ip: ipDaRequisicao(req),
      userAgent: userAgentDaRequisicao(req),
    });

    res.json({ mensagem: RESPOSTA_ESQUECI_SENHA });
  } catch (erro) {
    next(erro);
  }
};

/** Checagem prévia do link. POST, não GET: token na URL vaza para logs, histórico e `Referer`. */
export const validarTokenRedefinicao: RequestHandler = async (req, res, next) => {
  try {
    const { token } = req.body as ValidarTokenInput;
    res.json(await authService.validarTokenRedefinicao(token));
  } catch (erro) {
    next(erro);
  }
};

export const redefinirSenha: RequestHandler = async (req, res, next) => {
  try {
    const { token, novaSenha } = req.body as RedefinirSenhaInput;

    await authService.redefinirSenhaComToken(token, novaSenha, {
      ip: ipDaRequisicao(req),
      userAgent: userAgentDaRequisicao(req),
    });

    // A redefinição revoga todas as sessões, inclusive a deste navegador.
    res.clearCookie(env.REFRESH_COOKIE_NAME, { path: `${env.API_PREFIX}/auth` });
    limparTokenCsrf(res);
    res.json({ mensagem: 'Senha redefinida. Entre com a nova senha.' });
  } catch (erro) {
    next(erro);
  }
};
