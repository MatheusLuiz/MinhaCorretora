import type { Request, RequestHandler } from 'express';

import { idDoUsuarioDaRequisicao } from '../middlewares/autenticacao.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import * as repo from '../repositories/tarefa.repository.js';
import type { DadosTarefaInput } from '../schemas/tarefas.schema.js';
import { rotinas, type RotinaCatalogada } from '../seguradoras/comum/catalogo.js';
import { executar, proximaDe } from '../services/tarefas/agendador.js';
import { AppError } from '../utils/AppError.js';

// A tarefa é cadastro; o que ela executa é uma ROTINA, listada junto para a tela oferecer só o que existe.

/** DATETIME vai à tela SEM o "Z", senão o navegador subtrai 3 h. */
const semFuso = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 19) : null);

function paraTela(t: repo.Tarefa, catalogo: Map<string, RotinaCatalogada>) {
  return {
    id: t.uuid,
    nome: t.nome,
    descricao: t.descricao,
    arquivo: t.arquivo,
    arquivoNome: catalogo.get(t.arquivo)?.nome ?? `${t.arquivo} (arquivo não existe mais)`,
    seguradoraId: t.seguradoraId,
    seguradora: t.seguradora,
    diasSemana: t.diasSemana,
    horario: t.horario,
    ativa: t.ativa,
    proximaExecucao: semFuso(t.proximaExecucao),
    executando: t.emExecucaoDesde !== null,
    ultimaExecucao: t.ultimaExecucao
      ? {
          situacao: t.ultimaExecucao.situacao,
          iniciadaEm: semFuso(t.ultimaExecucao.iniciadaEm),
          finalizadaEm: semFuso(t.ultimaExecucao.finalizadaEm),
          mensagem: t.ultimaExecucao.mensagem,
        }
      : null,
  };
}

async function tarefaDaRota(req: Request): Promise<repo.Tarefa> {
  const t = await repo.buscarPorUuid(String(req.params.id));
  if (!t) throw AppError.notFound('Tarefa não encontrada.');
  return t;
}

/** Confere arquivo e seguradora: rotina da pasta de uma seguradora só serve àquela seguradora. */
async function validar(corpo: DadosTarefaInput): Promise<repo.DadosTarefa> {
  const rotina = (await rotinas()).get(corpo.arquivo);
  if (!rotina) throw AppError.unprocessable(`Arquivo de integração desconhecido: "${corpo.arquivo}".`);

  const seguradora = await seguradoraRepo.buscarPorId(corpo.seguradoraId);
  if (!seguradora) throw AppError.unprocessable('Seguradora não encontrada.');
  if (rotina.seguradoraChave && rotina.seguradoraChave !== seguradora.chave) {
    throw AppError.unprocessable(
      `O arquivo "${rotina.arquivo}" é da integração de outra seguradora (${rotina.seguradoraChave}), não da ${seguradora.nome}.`,
    );
  }

  return {
    nome: corpo.nome,
    descricao: corpo.descricao ?? null,
    arquivo: rotina.arquivo,
    seguradoraId: seguradora.id,
    diasSemana: corpo.diasSemana,
    horario: corpo.horario,
  };
}

/** A tarefa como está no banco, no formato da tela. */
async function tarefaParaTela(id: number) {
  return paraTela((await repo.buscarPorId(id))!, await rotinas());
}

export const listar: RequestHandler = async (_req, res, next) => {
  try {
    const catalogo = await rotinas();
    res.json({
      tarefas: (await repo.listar()).map((t) => paraTela(t, catalogo)),
      arquivos: [...catalogo.values()].map((r) => ({
        arquivo: r.arquivo,
        nome: r.nome,
        descricao: r.descricao,
        seguradoraChave: r.seguradoraChave,
      })),
    });
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const dados = await validar(req.body as DadosTarefaInput);
    if (await repo.nomeEmUso(dados.nome)) throw AppError.conflict(`Já existe uma tarefa chamada "${dados.nome}".`);

    const id = await repo.criar(dados, proximaDe({ ...dados, ativa: true }));
    res.status(201).json({ tarefa: await tarefaParaTela(id) });
  } catch (erro) {
    next(erro);
  }
};

export const atualizar: RequestHandler = async (req, res, next) => {
  try {
    const atual = await tarefaDaRota(req);
    const dados = await validar(req.body as DadosTarefaInput);
    if (await repo.nomeEmUso(dados.nome, atual.id)) {
      throw AppError.conflict(`Já existe uma tarefa chamada "${dados.nome}".`);
    }

    // Mudou dia ou horário: a próxima vez se recalcula.
    await repo.atualizar(atual.id, dados, proximaDe({ ...dados, ativa: atual.ativa }));
    res.json({ tarefa: await tarefaParaTela(atual.id) });
  } catch (erro) {
    next(erro);
  }
};

export const definirSituacao: RequestHandler = async (req, res, next) => {
  try {
    const atual = await tarefaDaRota(req);
    const { ativa } = req.body as { ativa: boolean };
    await repo.definirAtiva(atual.id, ativa, proximaDe({ ...atual, ativa }));
    res.json({ tarefa: await tarefaParaTela(atual.id) });
  } catch (erro) {
    next(erro);
  }
};

export const excluir: RequestHandler = async (req, res, next) => {
  try {
    const atual = await tarefaDaRota(req);
    if (atual.emExecucaoDesde) throw AppError.conflict('A tarefa está executando agora. Tente de novo em instantes.');
    await repo.excluir(atual.id);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
};

/** Responde 202 na hora e roda em segundo plano: puxar um relatório pode levar minutos. */
export const executarAgora: RequestHandler = async (req, res, next) => {
  try {
    const atual = await tarefaDaRota(req);
    if (atual.emExecucaoDesde) throw AppError.conflict('A tarefa já está executando.');
    const usuarioId = await idDoUsuarioDaRequisicao(req);
    void executar(atual.id, 'manual', usuarioId);
    res.status(202).json({ mensagem: 'Execução iniciada. Acompanhe no log.' });
  } catch (erro) {
    next(erro);
  }
};

export const execucoes: RequestHandler = async (req, res, next) => {
  try {
    const atual = await tarefaDaRota(req);
    const lista = await repo.listarExecucoes(atual.id, 20);
    res.json({
      execucoes: lista.map((e) => ({
        ...e,
        iniciadaEm: semFuso(e.iniciadaEm),
        finalizadaEm: semFuso(e.finalizadaEm),
      })),
    });
  } catch (erro) {
    next(erro);
  }
};

/** As execuções de todas as tarefas, paginadas — a aba Execuções. */
export const execucoesGerais: RequestHandler = async (req, res, next) => {
  try {
    const q = req.query as { tarefa?: string; situacao?: string; pagina?: string; porPagina?: string };
    const situacoes = ['executando', 'sucesso', 'erro', 'interrompida'] as const;
    const situacao = situacoes.find((x) => x === q.situacao);
    const tarefaUuid = q.tarefa && /^[0-9a-f-]{36}$/i.test(q.tarefa) ? q.tarefa : undefined;
    const r = await repo.listarExecucoesGerais({
      tarefaUuid,
      situacao,
      pagina: Number(q.pagina) || 1,
      porPagina: Number(q.porPagina) || 10,
    });
    res.json({
      total: r.total,
      execucoes: r.execucoes.map((e) => ({
        ...e,
        iniciadaEm: semFuso(e.iniciadaEm),
        finalizadaEm: semFuso(e.finalizadaEm),
      })),
    });
  } catch (erro) {
    next(erro);
  }
};

/** O log de uma execução; `?depois=<id>` devolve só as linhas novas (acompanhamento ao vivo). */
export const logDaExecucao: RequestHandler = async (req, res, next) => {
  try {
    const id = Number(req.params.execucao);
    if (!Number.isInteger(id) || id <= 0) throw AppError.unprocessable('Execução inválida.');
    const execucao = await repo.buscarExecucao(id);
    if (!execucao) throw AppError.notFound('Execução não encontrada.');
    const linhas = await repo.logDaExecucao(id, Number(req.query.depois) || 0);
    res.json({
      execucao: { ...execucao, iniciadaEm: semFuso(execucao.iniciadaEm), finalizadaEm: semFuso(execucao.finalizadaEm) },
      linhas: linhas.map((l) => ({ ...l, em: semFuso(l.em) })),
    });
  } catch (erro) {
    next(erro);
  }
};
