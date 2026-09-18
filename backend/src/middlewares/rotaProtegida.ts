import type { RequestHandler } from 'express';

import { autenticar } from './autenticacao.js';
import { exigirTrocaDeSenha } from './senhaProvisoria.js';

/** Par de toda rota interna. A ordem importa: invertida, a trava de senha provisória deixa tudo passar. */
export const rotaProtegida: RequestHandler[] = [autenticar, exigirTrocaDeSenha];
