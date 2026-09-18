import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';
import * as authController from '../controllers/auth.controller.js';
import { autenticar } from '../middlewares/autenticacao.js';
import { exigirCsrf } from '../middlewares/csrf.js';
import { validar } from '../middlewares/validar.js';
import {
  alterarSenhaSchema,
  esqueciSenhaSchema,
  loginSchema,
  redefinirSenhaSchema,
  validarTokenSchema,
} from '../schemas/auth.schema.js';
import { AppError } from '../utils/AppError.js';

export const authRouter: Router = Router();

/** Por IP, contra password spraying; o bloqueio por conta cobre o ataque a um usuário só. */
const limiteLogin = rateLimit({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, _res, next) =>
    next(AppError.tooManyRequests('Muitas tentativas de login. Aguarde alguns minutos.')),
});

const limiteRenovacao = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(AppError.tooManyRequests()),
});

/** Apertado: requisição anônima dispara e-mail. O limite por conta é `RESET_SENHA_MAX_POR_HORA`. */
const limiteEsqueciSenha = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(
      AppError.tooManyRequests(
        'Muitos pedidos de redefinição. Aguarde alguns minutos antes de tentar de novo.',
      ),
    ),
});

/** Validação e consumo do token: impede a varredura de tokens no chute. */
const limiteRedefinicao = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, _res, next) => next(AppError.tooManyRequests()),
});

authRouter.post('/auth/login', limiteLogin, validar(loginSchema), authController.login);
// As únicas que autenticam só pelo cookie, por isso as únicas com CSRF.
authRouter.post('/auth/refresh', limiteRenovacao, exigirCsrf, authController.renovar);
authRouter.post('/auth/logout', exigirCsrf, authController.logout);

// Públicas: quem esqueceu a senha não consegue autenticar.
authRouter.post(
  '/auth/senha/esqueci',
  limiteEsqueciSenha,
  validar(esqueciSenhaSchema),
  authController.esqueciSenha,
);
authRouter.post(
  '/auth/senha/validar-token',
  limiteRedefinicao,
  validar(validarTokenSchema),
  authController.validarTokenRedefinicao,
);
authRouter.post(
  '/auth/senha/redefinir',
  limiteRedefinicao,
  validar(redefinirSenhaSchema),
  authController.redefinirSenha,
);

authRouter.get('/auth/me', autenticar, authController.perfil);
authRouter.post(
  '/auth/senha',
  autenticar,
  validar(alterarSenhaSchema),
  authController.alterarSenha,
);
