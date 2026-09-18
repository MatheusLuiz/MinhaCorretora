import { Router } from 'express';

import { apolicesRouter } from './apolices.routes.js';
import { authRouter } from './auth.routes.js';
import { clientesRouter } from './clientes.routes.js';
import { conciliacaoRouter } from './conciliacao.routes.js';
import { emailDisparoRouter } from './emailDisparo.routes.js';
import { cotacoesRouter } from './cotacoes.routes.js';
import { estornosRouter } from './estornos.routes.js';
import { filaCadastroRouter } from './filaCadastro.routes.js';
import { filaEmissoesRouter } from './filaEmissoes.routes.js';
import { filaSinistrosRouter } from './filaSinistros.routes.js';
import { gruposClienteRouter } from './gruposCliente.routes.js';
import { healthRouter } from './health.routes.js';
import { financeiroRouter, importacaoRouter } from './importacao.routes.js';
import { notificacoesRouter } from './notificacoes.routes.js';
import { previsaoEntradaRouter } from './previsaoEntrada.routes.js';
import { paineisRouter } from './paineis.routes.js';
import { painelSeguradorasRouter } from './painelSeguradoras.routes.js';
import { seguradorasRouter } from './seguradoras.routes.js';
import { tarefasRouter } from './tarefas.routes.js';
import { tiposSeguroRouter } from './tiposSeguro.routes.js';
import { usuariosRouter } from './usuarios.routes.js';

export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use(authRouter);

// A trava de senha provisória vai em `rotaProtegida`, dentro de cada router (depende de req.usuario).

apiRouter.use(usuariosRouter);
apiRouter.use(emailDisparoRouter);
apiRouter.use(clientesRouter);
apiRouter.use(cotacoesRouter);
apiRouter.use(paineisRouter);
apiRouter.use(seguradorasRouter);
apiRouter.use(tiposSeguroRouter);
apiRouter.use(gruposClienteRouter);
apiRouter.use(tarefasRouter);
apiRouter.use(apolicesRouter);
apiRouter.use(importacaoRouter);
apiRouter.use(financeiroRouter);
apiRouter.use(conciliacaoRouter);
apiRouter.use(previsaoEntradaRouter);
apiRouter.use(estornosRouter);
apiRouter.use(notificacoesRouter);
apiRouter.use(filaEmissoesRouter);
apiRouter.use(filaCadastroRouter);
apiRouter.use(filaSinistrosRouter);
apiRouter.use(painelSeguradorasRouter);
