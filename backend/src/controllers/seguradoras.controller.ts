import type { RequestHandler } from 'express';

import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import * as repo from '../repositories/seguradora.repository.js';
import type {
  DadosSeguradoraInput,
  IntegracaoInput,
} from '../schemas/seguradoras.schema.js';
import { AppError } from '../utils/AppError.js';
import { cifrar, decifrar, dica } from '../utils/cifra.js';

// Não há rota de apagar: a seguradora é citada pelo histórico; `ativa = 0` só a tira das telas de escolha.

function dadosDoCorpo(corpo: DadosSeguradoraInput): repo.DadosSeguradora {
  return {
    nome: corpo.nome,
    cnpj: corpo.cnpj ?? null,
    codigoSusep: corpo.codigoSusep ?? null,
    site: corpo.site ?? null,
    telefone: corpo.telefone ?? null,
    email: corpo.email ?? null,
    observacoes: corpo.observacoes ?? null,
  };
}

function idDaRota(req: Parameters<RequestHandler>[0]): number {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    throw AppError.unprocessable('Identificador de seguradora inválido.');
  }

  return id;
}

/** Sem `todas`, só as ativas (para os selects); `todas=true` é para Configurações. */
export const listar: RequestHandler = async (req, res, next) => {
  try {
    const usuario = usuarioDaRequisicao(req);
    const podeVerIntegracao = usuario.permissoes.includes('integracao.gerenciar');

    const seguradoras = await repo.listar(req.query.todas === 'true');

    // A rota é aberta (alimenta os selects), mas a integração (URL, login, dica da senha)
    // só desce para quem tem `integracao.gerenciar`.
    res.json({
      seguradoras: podeVerIntegracao
        ? seguradoras
        : seguradoras.map(({ integracao: _integracao, ...resto }) => ({
            ...resto,
            // `null` e não omitido: o tipo do payload continua o mesmo.
            integracao: null,
          })),
    });
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const dados = dadosDoCorpo(req.body as DadosSeguradoraInput);

    const conflito = await repo.conflito(dados.nome, dados.cnpj);
    if (conflito) throw AppError.conflict(conflito);

    const id = await repo.criar(dados);

    res.status(201).json({ seguradora: await repo.buscarPorId(id) });
  } catch (erro) {
    next(erro);
  }
};

export const atualizar: RequestHandler = async (req, res, next) => {
  try {
    const id = idDaRota(req);
    const dados = dadosDoCorpo(req.body as DadosSeguradoraInput);

    if (!(await repo.buscarPorId(id))) throw AppError.notFound('Seguradora não encontrada.');

    const conflito = await repo.conflito(dados.nome, dados.cnpj, id);
    if (conflito) throw AppError.conflict(conflito);

    await repo.atualizar(id, dados);

    res.json({ seguradora: await repo.buscarPorId(id) });
  } catch (erro) {
    next(erro);
  }
};

export const definirSituacao: RequestHandler = async (req, res, next) => {
  try {
    const id = idDaRota(req);
    const { ativa } = req.body as { ativa: boolean };

    if (!(await repo.buscarPorId(id))) throw AppError.notFound('Seguradora não encontrada.');

    await repo.definirAtiva(id, ativa);

    res.json({ seguradora: await repo.buscarPorId(id) });
  } catch (erro) {
    next(erro);
  }
};

/** Salva a integração cifrando o segredo. Segredo `undefined` = não mexa; `null` = descadastrar. */
export const salvarIntegracao: RequestHandler = async (req, res, next) => {
  try {
    const id = idDaRota(req);
    const corpo = req.body as IntegracaoInput;

    const seguradora = await repo.buscarPorId(id);
    if (!seguradora) throw AppError.notFound('Seguradora não encontrada.');

    if (corpo.ativa && !seguradora.ativa) {
      throw AppError.unprocessable(
        'Reative a seguradora antes de ligar a integração dela.',
      );
    }

    if (corpo.ativa && corpo.tipo === 'nenhuma') {
      throw AppError.unprocessable(
        'Escolha o tipo de integração antes de ligá-la.',
      );
    }

    const segredo =
      corpo.segredo === undefined
        ? undefined
        : corpo.segredo === null || corpo.segredo === ''
          ? null
          : { cifrado: cifrar(corpo.segredo), dica: dica(corpo.segredo) };

    // A lista vem completa mas sem os valores que não mudaram (a tela nunca os recebe):
    // sem valor = mantém o gravado com o mesmo nome; nome ausente sai.
    let credenciais: { cifrado: Buffer; resumo: string } | null | undefined;
    if (corpo.credenciais !== undefined) {
      const pacote = await repo.credenciaisDe(id);
      const gravadas = new Map<string, string>();
      if (pacote) {
        const aberto = decifrar(pacote);
        if (aberto) {
          for (const c of JSON.parse(aberto) as { nome: string; valor: string }[]) {
            gravadas.set(c.nome.toLowerCase(), c.valor);
          }
        }
      }

      const finais = corpo.credenciais.map((c) => {
        const valor = c.valor?.trim() || gravadas.get(c.nome.toLowerCase());
        if (!valor) {
          throw AppError.unprocessable(`Informe o valor da credencial "${c.nome}".`);
        }
        return { nome: c.nome.trim(), valor };
      });

      // A coluna guarda 4096 bytes cifrados (28 de nonce e tag).
      if (Buffer.byteLength(JSON.stringify(finais), 'utf8') > 4000) {
        throw AppError.unprocessable(
          'As credenciais somadas passam do espaço reservado (4 mil caracteres). Guarde tokens muito longos fora do sistema.',
        );
      }

      credenciais =
        finais.length === 0
          ? null
          : {
              cifrado: cifrar(JSON.stringify(finais)),
              resumo: JSON.stringify(finais.map((c) => ({ nome: c.nome, dica: dica(c.valor) }))),
            };
    }

    await repo.salvarIntegracao(id, {
      tipo: corpo.tipo,
      ambiente: corpo.ambiente,
      ativa: corpo.ativa,
      baseUrl: corpo.baseUrl ?? null,
      usuario: corpo.usuario ?? null,
      observacoes: corpo.observacoes ?? null,
      segredo,
      documentacaoUrl: corpo.documentacaoUrl ?? null,
      documentacao: corpo.documentacao ?? null,
      credenciais,
    });

    res.json({ seguradora: await repo.buscarPorId(id) });
  } catch (erro) {
    next(erro);
  }
};
