import type { RequestHandler } from 'express';

import * as repo from '../repositories/atendimento.repository.js';
import * as clientesRepo from '../repositories/cliente.repository.js';
import type { IdClienteInput } from '../schemas/clientes.schema.js';
import type { IdAtendimentoInput, NovoAtendimentoInput } from '../schemas/atendimentos.schema.js';
import { escopoDeConsulta } from '../services/escopo.js';
import { usuarioDaRequisicao } from '../middlewares/autenticacao.js';
import { AppError } from '../utils/AppError.js';

/**
 * Atendimentos usam o recorte de CONSULTA (ler e registrar): quem atende pode ser de outra carteira.
 * O contato vai para a seguradora de uma apólice ATIVA; com mais de uma, quem registra escolhe.
 */

/** Resposta de listar/registrar/apagar: o histórico e as apólices que podem recebê-lo. */
async function historico(clienteId: number): Promise<{
  atendimentos: repo.Atendimento[];
  apolicesAtivas: repo.ApoliceAtiva[];
}> {
  const [atendimentos, ativas] = await Promise.all([
    repo.listarDoCliente(clienteId),
    repo.apolicesAtivas(clienteId),
  ]);
  return {
    atendimentos,
    apolicesAtivas: ativas.map(({ id, numero, seguradora, vigenciaFim }) => ({
      id,
      numero,
      seguradora,
      vigenciaFim,
    })),
  };
}

async function clienteDaFicha(req: Parameters<RequestHandler>[0], uuid: string): Promise<number> {
  const linha = await clientesRepo.buscarPorUuid(uuid, await escopoDeConsulta(req));
  if (!linha) throw AppError.notFound('Cliente não encontrado.');
  return linha.id;
}

export const listar: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params as unknown as IdClienteInput;
    res.json(await historico(await clienteDaFicha(req, id)));
  } catch (erro) {
    next(erro);
  }
};

export const criar: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params as unknown as IdClienteInput;
    const dados = req.body as NovoAtendimentoInput;
    const clienteId = await clienteDaFicha(req, id);

    // Futuro é `proximoContato`. Sem fuso, `new Date` lê hora LOCAL (servidor em Brasília, como o banco).
    if (dados.contatoEm && new Date(dados.contatoEm) > new Date(Date.now() + 5 * 60_000)) {
      throw AppError.unprocessable(
        'A data do contato não pode ser no futuro. Use "próximo contato" para agendar.',
      );
    }

    const ativas = await repo.apolicesAtivas(clienteId);
    let escolhida: (typeof ativas)[number] | null = null;
    if (dados.apolice) {
      escolhida = ativas.find((a) => a.id === dados.apolice) ?? null;
      if (!escolhida) {
        throw AppError.unprocessable('A apólice escolhida não é uma apólice ativa deste cliente.');
      }
    } else if (ativas.length === 1) {
      escolhida = ativas[0]!;
    } else if (ativas.length > 1) {
      throw AppError.unprocessable(
        `O cliente tem ${ativas.length} apólices ativas: escolha para qual seguradora vai este atendimento.`,
      );
    }

    await repo.criar({
      clienteId,
      usuarioUuid: usuarioDaRequisicao(req).id,
      canal: dados.canal,
      motivo: dados.motivo,
      resultado: dados.resultado,
      descricao: dados.descricao || null,
      // `AAAA-MM-DDTHH:MM` local → DATETIME; o MySQL aceita com o T trocado.
      contatoEm: dados.contatoEm ? `${dados.contatoEm.replace('T', ' ')}:00` : null,
      proximoContato: dados.proximoContato ?? null,
      apoliceId: escolhida?.idInterno ?? null,
      seguradoraId: escolhida?.seguradoraId ?? null,
    });

    res.status(201).json({
      ...(await historico(clienteId)),
      mensagem: escolhida
        ? `Atendimento registrado para a ${escolhida.seguradora} (apólice ${escolhida.numero}).`
        : 'Atendimento registrado.',
    });
  } catch (erro) {
    next(erro);
  }
};

export const excluir: RequestHandler = async (req, res, next) => {
  try {
    const { id, atendimento } = req.params as unknown as IdAtendimentoInput;
    const clienteId = await clienteDaFicha(req, id);

    const apagou = await repo.excluirDoAutor(clienteId, atendimento, usuarioDaRequisicao(req).id);
    if (!apagou) throw AppError.forbidden('Só quem registrou o atendimento pode apagá-lo.');

    res.json(await historico(clienteId));
  } catch (erro) {
    next(erro);
  }
};
