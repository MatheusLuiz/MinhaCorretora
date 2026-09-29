import { pool } from '../database/pool.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import * as repo from '../repositories/cotacao.repository.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import * as tipoRepo from '../repositories/tipoSeguro.repository.js';
import type { NovaCotacaoInput, PropostaInput, SituacaoCotacaoInput } from '../schemas/cotacoes.schema.js';
import { AppError } from '../utils/AppError.js';
import { limparDocumento } from '../utils/documento.js';
import type { Escopo } from '../utils/escopo.js';
import { binarioParaUuid } from '../utils/uuid.js';
import * as clientesService from './clientes.service.js';
import * as corretorService from './corretor.service.js';

// Fechar cotação não cria apólice: ela entra pela importação ou pela "Nova apólice" (evita duplicata).

interface Usuario {
  id: string;
  permissoes: string[];
}

/** O cliente da cotação: o existente, ou o pré-cadastro — que pode já existir pelo CPF. */
async function clienteDaCotacao(
  dados: NovaCotacaoInput,
  escopo: Escopo,
  produtorId: number,
): Promise<number> {
  if (dados.clienteId) {
    const cliente = await clienteRepo.buscarPorUuid(dados.clienteId, escopo);
    if (!cliente) throw AppError.notFound('Cliente não encontrado na sua carteira.');
    return cliente.id;
  }

  const novo = dados.novoCliente!;
  const documento = limparDocumento(novo.cpfCnpj);
  const existente = await clienteRepo.buscarPorDocumento(documento);

  if (existente) {
    // Cliente de outra carteira é assunto do corretor dela.
    const uuid = await clienteRepo.uuidPorId(existente.id);
    const noEscopo = uuid ? await clienteRepo.buscarPorUuid(binarioParaUuid(uuid), escopo) : null;
    if (!noEscopo) {
      throw AppError.conflict(
        `Este CPF/CNPJ já está cadastrado (${existente.nome}) em outra carteira. Procure o corretor dele.`,
      );
    }
    return existente.id;
  }

  const criado = await clientesService.criar(
    {
      cpfCnpj: novo.cpfCnpj,
      nome: novo.nome,
      situacao: 'prospecto',
      autorizaContato: false,
      vip: false,
      ...(novo.telefone
        ? { telefones: [{ tipo: novo.telefone.length === 11 ? 'celular' : 'residencial', numero: novo.telefone }] }
        : {}),
      ...(novo.email ? { emails: [{ tipo: 'pessoal', endereco: novo.email }] } : {}),
    } as Parameters<typeof clientesService.criar>[0],
    { produtorId },
  );

  const cliente = await clienteRepo.buscarPorUuid(criado.id);
  if (!cliente) throw AppError.internal('O pré-cadastro foi gravado, mas não foi encontrado em seguida.');
  return cliente.id;
}

export async function criar(dados: NovaCotacaoInput, usuario: Usuario, escopoPedido: Escopo): Promise<string> {
  const corretor = await corretorService.resolver(usuario, dados.corretor);

  // O corretor pode ter sido criado agora, fora do recorte calculado antes.
  const escopo: Escopo =
    escopoPedido.produtorIds === null || escopoPedido.produtorIds.includes(corretor.produtorId)
      ? escopoPedido
      : { ...escopoPedido, produtorIds: [...escopoPedido.produtorIds, corretor.produtorId] };

  const tipos = (await tipoRepo.listar()).filter((t) => t.ativo && dados.tipos.includes(t.id));
  if (tipos.length === 0) throw AppError.unprocessable('Nenhum dos tipos escolhidos está ativo.');

  const clienteId = await clienteDaCotacao(dados, escopo, corretor.produtorId);

  const v = dados.veiculo;
  const temVeiculo =
    v && tipos.some((t) => t.formulario === 'veiculo') && Object.values(v).some((x) => x !== null && x !== undefined && x !== '');

  const conexao = await pool.getConnection();
  let id: number;
  try {
    await conexao.beginTransaction();
    id = await repo.criar(
      {
        clienteId,
        produtorId: corretor.produtorId,
        criadoPorUuid: usuario.id,
        observacoes: dados.observacoes ?? null,
        tipoIds: tipos.map((t) => t.id),
        veiculo: temVeiculo
          ? {
              placa: v!.placa ?? null, chassi: v!.chassi ?? null, fabricante: v!.fabricante ?? null,
              modelo: v!.modelo ?? null, anoFabricacao: v!.anoFabricacao ?? null,
              anoModelo: v!.anoModelo ?? null, codigoFipe: v!.codigoFipe ?? null, uso: v!.uso ?? null,
              zeroKm: v!.zeroKm ?? null, cepPernoite: v!.cepPernoite ?? null,
              condutorNome: v!.condutorNome ?? null, condutorDocumento: v!.condutorDocumento ?? null,
              condutorNascimento: v!.condutorNascimento ?? null,
            }
          : null,
      },
      conexao,
    );
    await clienteRepo.acrescentarTiposDeInteresse(clienteId, tipos.map((t) => t.id), conexao);
    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }

  return repo.uuidPorId(id);
}

async function daCarteira(uuid: string, escopo: Escopo): Promise<repo.CotacaoDetalhe> {
  const cotacao = await repo.buscar(uuid, escopo);
  if (!cotacao) throw AppError.notFound('Cotação não encontrada.');
  return cotacao;
}

export async function adicionarProposta(uuid: string, dados: PropostaInput, escopo: Escopo): Promise<void> {
  const cotacao = await daCarteira(uuid, escopo);
  if (cotacao.situacao === 'fechada' || cotacao.situacao === 'perdida') {
    throw AppError.unprocessable('Cotação encerrada: reabra antes de incluir proposta.');
  }
  if (!cotacao.tiposDetalhe.some((t) => t.id === dados.tipoSeguroId)) {
    throw AppError.unprocessable('Este tipo de seguro não faz parte da cotação.');
  }
  const seguradora = await seguradoraRepo.buscarPorId(dados.seguradoraId);
  if (!seguradora?.ativa) throw AppError.unprocessable('Seguradora não encontrada ou inativa.');
  if (!(await tipoRepo.habilitadoPara(dados.tipoSeguroId, dados.seguradoraId))) {
    throw AppError.unprocessable(
      `${seguradora.nome} não está habilitada para este tipo. Ajuste em Configurações › Tipos de seguro.`,
    );
  }

  await repo.adicionarProposta(cotacao.idInterno, {
    seguradoraId: dados.seguradoraId,
    tipoSeguroId: dados.tipoSeguroId,
    premio: dados.premio,
    franquia: dados.franquia ?? null,
    formaPagamento: dados.formaPagamento ?? null,
    observacao: dados.observacao ?? null,
  });
}

export async function removerProposta(uuid: string, propostaId: number, escopo: Escopo): Promise<void> {
  const cotacao = await daCarteira(uuid, escopo);
  if (cotacao.situacao === 'fechada' || cotacao.situacao === 'perdida') {
    throw AppError.unprocessable('Cotação encerrada: reabra antes de remover proposta.');
  }
  if (!(await repo.removerProposta(cotacao.idInterno, propostaId))) {
    throw AppError.notFound('Proposta não encontrada nesta cotação.');
  }
}

export async function definirSituacao(uuid: string, dados: SituacaoCotacaoInput, escopo: Escopo): Promise<void> {
  const cotacao = await daCarteira(uuid, escopo);
  const escolhida = dados.situacao === 'fechada' ? (dados.propostaEscolhidaId ?? null) : null;
  if (escolhida !== null && !cotacao.propostas_.some((p) => p.id === escolhida)) {
    throw AppError.unprocessable('A proposta escolhida não é desta cotação.');
  }
  await repo.definirSituacao(cotacao.idInterno, dados.situacao, dados.motivoPerda ?? null, escolhida);
}

/** Detalhe da cotação com as seguradoras habilitadas para cada tipo. */
export async function detalhar(uuid: string, escopo: Escopo) {
  const { idInterno: _interno, propostas_, ...cotacao } = await daCarteira(uuid, escopo);
  const [tipos, seguradoras] = await Promise.all([tipoRepo.listar(), seguradoraRepo.listar(false)]);

  return {
    ...cotacao,
    propostas: propostas_,
    seguradorasPorTipo: cotacao.tiposDetalhe.map((t) => ({
      tipoSeguroId: t.id,
      seguradoras: seguradoras
        .filter((s) => s.ativa && (tipos.find((x) => x.id === t.id)?.seguradoras ?? []).includes(s.id))
        .map((s) => ({ id: s.id, nome: s.nome })),
    })),
  };
}

export const listar = repo.listar;
