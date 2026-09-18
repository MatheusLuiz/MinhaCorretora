import type { RequestHandler } from 'express';

import {
  idDoUsuarioDaRequisicao,
  usuarioDaRequisicao,
} from '../middlewares/autenticacao.js';
import type {
  CriarUsuarioInput,
  EditarUsuarioInput,
  EdicaoPapelInput,
  NovoPapelInput,
} from '../schemas/usuarios.schema.js';
import * as servico from '../services/gestaoUsuarios.service.js';
import { ipDaRequisicao, userAgentDaRequisicao } from '../utils/rede.js';
import * as usuarioRepo from '../repositories/usuario.repository.js';
import { AppError } from '../utils/AppError.js';

function contexto(req: Parameters<RequestHandler>[0]) {
  return { ip: ipDaRequisicao(req), userAgent: userAgentDaRequisicao(req) };
}

/** Lê :id da rota (no Express 5 o tipo é `string | string[]`; o schema já validou o formato). */
function idDaRota(req: Parameters<RequestHandler>[0]): string {
  const valor = req.params.id;
  return Array.isArray(valor) ? (valor[0] ?? '') : (valor ?? '');
}

export const listar: RequestHandler = async (_req, res, next) => {
  try {
    const usuarios = await servico.listar();
    res.json({ total: usuarios.length, usuarios });
  } catch (erro) {
    next(erro);
  }
};

export const detalhar: RequestHandler = async (req, res, next) => {
  try {
    res.json({ usuario: await servico.detalhar(idDaRota(req)) });
  } catch (erro) {
    next(erro);
  }
};

export const papeis: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ papeis: await servico.listarPapeis(), politicaSenha: servico.politicaDeSenha() });
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const autor = usuarioDaRequisicao(req);
    const dados = req.body as CriarUsuarioInput;

    const resultado = await servico.criar(dados, contexto(req), autor.id);

    // A senha temporária sai UMA vez, aqui; não vai a log nem ao banco (só o hash).
    res.status(201).json({
      usuario: resultado.usuario,
      senhaTemporaria: resultado.senhaTemporaria,
      aviso:
        'Esta senha aparece uma única vez. Entregue-a à pessoa por um canal seguro; ' +
        'ela será obrigada a trocá-la no primeiro acesso.',
    });
  } catch (erro) {
    next(erro);
  }
};

export const editar: RequestHandler = async (req, res, next) => {
  try {
    const autor = usuarioDaRequisicao(req);
    const dados = req.body as EditarUsuarioInput;

    const usuario = await servico.editar(
      idDaRota(req),
      {
        nome: dados.nome,
        sobrenome: dados.sobrenome,
        dataNascimento: dados.dataNascimento,
        papelChave: dados.papel,
      },
      contexto(req),
      autor.id,
    );

    res.json({ usuario });
  } catch (erro) {
    next(erro);
  }
};

export const alterarSituacao: RequestHandler = async (req, res, next) => {
  try {
    const autor = usuarioDaRequisicao(req);
    const { ativo } = req.body as { ativo: boolean };

    res.json({
      usuario: await servico.definirAtivo(idDaRota(req), ativo, contexto(req), autor.id),
    });
  } catch (erro) {
    next(erro);
  }
};

export const redefinirSenha: RequestHandler = async (req, res, next) => {
  try {
    const autor = usuarioDaRequisicao(req);
    const { senhaTemporaria } = await servico.redefinirSenha(
      idDaRota(req),
      contexto(req),
      autor.id,
    );

    res.json({
      senhaTemporaria,
      aviso:
        'Esta senha aparece uma única vez. Todas as sessões da pessoa foram encerradas ' +
        'e ela terá de trocar a senha no próximo acesso.',
    });
  } catch (erro) {
    next(erro);
  }
};

export const permissoes: RequestHandler = async (req, res, next) => {
  try {
    res.json({ permissoes: await servico.quadroDePermissoes(idDaRota(req)) });
  } catch (erro) {
    next(erro);
  }
};

export const definirPermissoes: RequestHandler = async (req, res, next) => {
  try {
    const autor = usuarioDaRequisicao(req);
    const dados = req.body as { permissoes: string[]; motivo?: string };

    res.json({
      permissoes: await servico.definirPermissoes(
        idDaRota(req),
        { permissoes: dados.permissoes, motivo: dados.motivo ?? null },
        contexto(req),
        autor.id,
      ),
      aviso: 'As sessões da pessoa foram encerradas para que as permissões novas valham já.',
    });
  } catch (erro) {
    next(erro);
  }
};

/** O id numérico por trás do uuid da rota. 404 quando não existe. */
async function idInternoDaRota(req: Parameters<RequestHandler>[0]): Promise<number> {
  const usuario = await usuarioRepo.buscarPorUuid(idDaRota(req));

  if (!usuario) throw AppError.notFound('Usuário não encontrado.');

  return usuario.id;
}

/** Produtores com a contagem de clientes (que separa o real da grafia duplicada sem cadastro). */
export const produtores: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ produtores: await usuarioRepo.listarProdutores() });
  } catch (erro) {
    next(erro);
  }
};

export const carteira: RequestHandler = async (req, res, next) => {
  try {
    const id = await idInternoDaRota(req);

    res.json({
      produtores: await usuarioRepo.produtoresVinculados(id),
      historico: await usuarioRepo.historicoDeCarteira(id, 10),
    });
  } catch (erro) {
    next(erro);
  }
};

export const definirCarteira: RequestHandler = async (req, res, next) => {
  try {
    const id = await idInternoDaRota(req);
    const { produtores: ids } = req.body as { produtores: number[] };

    // Quem mudou fica registrado: a carteira concede acesso a dado pessoal.
    await usuarioRepo.definirProdutores(id, ids, await idDoUsuarioDaRequisicao(req));

    res.json({
      produtores: await usuarioRepo.produtoresVinculados(id),
      historico: await usuarioRepo.historicoDeCarteira(id, 10),
      // O escopo é lido a cada requisição, não do token.
      aviso: 'A carteira passa a valer na próxima tela que a pessoa abrir.',
    });
  } catch (erro) {
    next(erro);
  }
};

export const detalharPapel: RequestHandler = async (req, res, next) => {
  try {
    const papel = await servico.detalharPapel(String(req.params.chave));
    if (!papel) {
      res.status(404).json({ erro: 'Papel não encontrado.' });
      return;
    }
    res.json({ papel });
  } catch (erro) {
    next(erro);
  }
};

export const criarPapel: RequestHandler = async (req, res, next) => {
  try {
    const dados = req.body as NovoPapelInput;
    const papel = await servico.criarPapel(
      { nome: dados.nome, descricao: dados.descricao ?? null, copiarDe: dados.copiarDe ?? null },
      contexto(req),
      usuarioDaRequisicao(req).id,
    );
    res.status(201).json({ papel });
  } catch (erro) {
    next(erro);
  }
};

export const editarPapel: RequestHandler = async (req, res, next) => {
  try {
    const dados = req.body as EdicaoPapelInput;
    res.json({
      papel: await servico.editarPapel(
        String(req.params.chave),
        { nome: dados.nome, descricao: dados.descricao ?? null },
        contexto(req),
        usuarioDaRequisicao(req).id,
      ),
    });
  } catch (erro) {
    next(erro);
  }
};

export const excluirPapel: RequestHandler = async (req, res, next) => {
  try {
    await servico.excluirPapel(String(req.params.chave), contexto(req), usuarioDaRequisicao(req).id);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
};

export const definirSituacaoPapel: RequestHandler = async (req, res, next) => {
  try {
    const { ativo } = req.body as { ativo: boolean };
    res.json({
      papel: await servico.definirSituacaoPapel(
        String(req.params.chave),
        ativo,
        contexto(req),
        usuarioDaRequisicao(req).id,
      ),
    });
  } catch (erro) {
    next(erro);
  }
};

export const definirPermissoesDoPapel: RequestHandler = async (req, res, next) => {
  try {
    const { permissoes } = req.body as { permissoes: string[] };
    res.json({ papel: await servico.definirPermissoesDoPapel(String(req.params.chave), permissoes) });
  } catch (erro) {
    // A trava contra ficar sem administrador é decisão de negócio, não falha
    // do servidor: vira 409 para a tela poder explicar em vez de dizer "erro".
    if (erro instanceof servico.SemAdministradorError) {
      res.status(409).json({ erro: erro.message });
      return;
    }
    next(erro);
  }
};
