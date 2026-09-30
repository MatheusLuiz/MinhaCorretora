import type { Request, RequestHandler } from 'express';

import * as repo from '../repositories/grupoCliente.repository.js';
import type { DadosGrupoClienteInput } from '../schemas/gruposCliente.schema.js';
import { AppError } from '../utils/AppError.js';

// Não há apagar: o cliente cita o grupo pela chave; `ativo = 0` só o tira da escolha.

function id(req: Request): number {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw AppError.unprocessable('Identificador inválido.');
  return n;
}

/** "Parceiro Banco" → `parceiro_banco`. Só para grupos criados pela tela. */
function chaveDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u{300}-\u{36f}]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

function dados(corpo: DadosGrupoClienteInput, ordemPadrao: number): repo.DadosGrupoCliente {
  return {
    nome: corpo.nome,
    descricao: corpo.descricao ?? null,
    ordem: corpo.ordem ?? ordemPadrao,
  };
}

export const listar: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ grupos: await repo.listar() });
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const corpo = req.body as DadosGrupoClienteInput;
    if (await repo.nomeEmUso(corpo.nome)) {
      throw AppError.conflict(`Já existe um grupo chamado "${corpo.nome}".`);
    }

    // Grupo novo vai para o fim da lista, salvo ordem explícita.
    const todos = await repo.listar();
    const ordem = Math.max(0, ...todos.map((g) => g.ordem)) + 10;

    let chave = chaveDoNome(corpo.nome) || 'grupo';
    for (let n = 2; await repo.chaveEmUso(chave); n++) {
      chave = `${chaveDoNome(corpo.nome).slice(0, 36)}_${n}`;
    }

    const novo = await repo.criar(chave, dados(corpo, ordem));
    res.status(201).json({ grupo: await repo.buscarPorId(novo) });
  } catch (erro) {
    next(erro);
  }
};

export const atualizar: RequestHandler = async (req, res, next) => {
  try {
    const grupoId = id(req);
    const atual = await repo.buscarPorId(grupoId);
    if (!atual) throw AppError.notFound('Grupo de cliente não encontrado.');

    const corpo = req.body as DadosGrupoClienteInput;
    if (await repo.nomeEmUso(corpo.nome, grupoId)) {
      throw AppError.conflict(`Já existe um grupo chamado "${corpo.nome}".`);
    }

    await repo.atualizar(grupoId, dados(corpo, atual.ordem));
    res.json({ grupo: await repo.buscarPorId(grupoId) });
  } catch (erro) {
    next(erro);
  }
};

export const definirSituacao: RequestHandler = async (req, res, next) => {
  try {
    const grupoId = id(req);
    if (!(await repo.buscarPorId(grupoId))) throw AppError.notFound('Grupo de cliente não encontrado.');

    await repo.definirAtivo(grupoId, (req.body as { ativo: boolean }).ativo);
    res.json({ grupo: await repo.buscarPorId(grupoId) });
  } catch (erro) {
    next(erro);
  }
};
