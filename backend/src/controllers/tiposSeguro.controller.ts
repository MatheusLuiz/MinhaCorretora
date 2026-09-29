import type { Request, RequestHandler } from 'express';

import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import * as repo from '../repositories/tipoSeguro.repository.js';
import type { DadosTipoSeguroInput } from '../schemas/tiposSeguro.schema.js';
import { AppError } from '../utils/AppError.js';

// Não há apagar: a apólice cita o tipo; `ativo = 0` só o tira das telas de escolha.

function id(req: Request, nome = 'id'): number {
  const n = Number(req.params[nome]);
  if (!Number.isInteger(n) || n <= 0) throw AppError.unprocessable('Identificador inválido.');
  return n;
}

/** "Seguro Celular" → `seguro_celular`. Só para tipos criados pela tela. */
function chaveDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

function dados(corpo: DadosTipoSeguroInput, ordemPadrao: number): repo.DadosTipoSeguro {
  return {
    nome: corpo.nome,
    formulario: corpo.formulario,
    descricao: corpo.descricao ?? null,
    ordem: corpo.ordem ?? ordemPadrao,
  };
}

export const listar: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ tipos: await repo.listar() });
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const corpo = req.body as DadosTipoSeguroInput;
    if (await repo.nomeEmUso(corpo.nome)) {
      throw AppError.conflict(`Já existe um tipo chamado "${corpo.nome}".`);
    }

    // Tipo novo vai para o fim da lista, salvo ordem explícita.
    const todos = await repo.listar();
    const ordem = Math.max(0, ...todos.map((t) => t.ordem)) + 10;

    let chave = chaveDoNome(corpo.nome) || 'tipo';
    for (let n = 2; await repo.chaveEmUso(chave); n++) {
      chave = `${chaveDoNome(corpo.nome).slice(0, 36)}_${n}`;
    }

    const novo = await repo.criar(chave, dados(corpo, ordem));
    res.status(201).json({ tipo: await repo.buscarPorId(novo) });
  } catch (erro) {
    next(erro);
  }
};

export const atualizar: RequestHandler = async (req, res, next) => {
  try {
    const tipoId = id(req);
    const atual = await repo.buscarPorId(tipoId);
    if (!atual) throw AppError.notFound('Tipo de seguro não encontrado.');

    const corpo = req.body as DadosTipoSeguroInput;
    if (await repo.nomeEmUso(corpo.nome, tipoId)) {
      throw AppError.conflict(`Já existe um tipo chamado "${corpo.nome}".`);
    }

    await repo.atualizar(tipoId, dados(corpo, atual.ordem));
    res.json({ tipo: await repo.buscarPorId(tipoId) });
  } catch (erro) {
    next(erro);
  }
};

export const definirSituacao: RequestHandler = async (req, res, next) => {
  try {
    const tipoId = id(req);
    if (!(await repo.buscarPorId(tipoId))) throw AppError.notFound('Tipo de seguro não encontrado.');

    await repo.definirAtivo(tipoId, (req.body as { ativo: boolean }).ativo);
    res.json({ tipo: await repo.buscarPorId(tipoId) });
  } catch (erro) {
    next(erro);
  }
};

export const definirHabilitacao: RequestHandler = async (req, res, next) => {
  try {
    const tipoId = id(req);
    const seguradoraId = id(req, 'seguradoraId');

    if (!(await repo.buscarPorId(tipoId))) throw AppError.notFound('Tipo de seguro não encontrado.');
    if (!(await seguradoraRepo.buscarPorId(seguradoraId))) {
      throw AppError.notFound('Seguradora não encontrada.');
    }

    await repo.definirHabilitado(tipoId, seguradoraId, (req.body as { habilitado: boolean }).habilitado);
    res.json({ tipo: await repo.buscarPorId(tipoId) });
  } catch (erro) {
    next(erro);
  }
};
