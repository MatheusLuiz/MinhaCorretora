import type { Request } from 'express';

import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import { AppError } from '../utils/AppError.js';
import { type Escopo } from '../utils/escopo.js';

export { ESCOPO_TOTAL, type Escopo } from '../utils/escopo.js';

/** Recorte da busca e da ficha: `clientes.consultar` abre a base inteira só aqui. */
export async function escopoDeConsulta(req: Request): Promise<Escopo> {
  const escopo = await escopoDaRequisicao(req);
  const usuario = usuarioDaRequisicao(req);
  return usuario.permissoes.includes('clientes.consultar')
    ? { ...escopo, produtorIds: null }
    : escopo;
}

// `clientes.todos` é permissão POSITIVA: esquecer de concedê-la dá tela vazia, não vazamento.
export async function escopoDaRequisicao(req: Request): Promise<Escopo> {
  const usuario = usuarioDaRequisicao(req);
  const tem = (chave: string): boolean => usuario.permissoes.includes(chave);

  let produtorIds = tem('clientes.todos') ? null : await usuarioRepo.produtoresDoUsuario(usuario.id);

  // `?produtor=<id>` ESTREITA a carteira, nunca a alarga (consultor alheio = 403).
  const filtro = produtorDoFiltro(req);
  if (filtro !== null) {
    if (produtorIds !== null && !produtorIds.includes(filtro)) {
      throw AppError.forbidden('Este consultor não é da sua carteira.');
    }
    produtorIds = [filtro];
  }

  return {
    produtorIds,
    inadimplenciaCompleta: tem('inadimplencia.completa'),
    comissoesTodas: tem('comissoes.todas'),
  };
}

function produtorDoFiltro(req: Request): number | null {
  const bruto = (req.query as Record<string, unknown> | undefined)?.produtor;
  if (bruto === undefined || bruto === '') return null;
  const id = Number(bruto);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('Consultor inválido.');
  return id;
}

/** Consultores que este usuário pode escolher no filtro. */
export async function consultoresDoFiltro(req: Request): Promise<{ id: number; nome: string; ativo: boolean; clientes: number }[]> {
  const usuario = usuarioDaRequisicao(req);
  const ids = usuario.permissoes.includes('clientes.todos') ? null : await usuarioRepo.produtoresDoUsuario(usuario.id);
  return usuarioRepo.produtoresComCarteira(ids);
}
