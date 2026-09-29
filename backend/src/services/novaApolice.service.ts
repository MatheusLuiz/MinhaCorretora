import { pool } from '../database/pool.js';
import * as apoliceRepo from '../repositories/apolice.repository.js';
import * as veiculoRepo from '../repositories/apoliceVeiculo.repository.js';
import * as clienteRepo from '../repositories/cliente.repository.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import * as tipoRepo from '../repositories/tipoSeguro.repository.js';
import type { NovaApoliceInput } from '../schemas/novaApolice.schema.js';
import { AppError } from '../utils/AppError.js';
import type { Escopo } from '../utils/escopo.js';

/** Apólice digitada na ficha; só o formulário `veiculo` tem tabela própria. */
export async function criar(
  clienteUuid: string,
  dados: NovaApoliceInput,
  escopo: Escopo,
): Promise<void> {
  // Recorte ESTRITO: cadastrar apólice é mexer na carteira, não consultar.
  const cliente = await clienteRepo.buscarPorUuid(clienteUuid, escopo);
  if (!cliente) throw AppError.notFound('Cliente não encontrado.');

  const seguradora = await seguradoraRepo.buscarPorId(dados.seguradoraId);
  if (!seguradora || !seguradora.ativa) {
    throw AppError.unprocessable('Seguradora não encontrada ou inativa.');
  }

  const tipo = await tipoRepo.buscarPorId(dados.tipoSeguroId);
  if (!tipo || !tipo.ativo) throw AppError.unprocessable('Tipo de seguro não encontrado ou inativo.');

  if (!(await tipoRepo.habilitadoPara(tipo.id, seguradora.id))) {
    throw AppError.unprocessable(
      `${seguradora.nome} não está habilitada para ${tipo.nome}. Ajuste em Configurações › Tipos de seguro.`,
    );
  }

  if (tipo.formulario === 'veiculo' && !dados.veiculo) {
    throw AppError.unprocessable(`${tipo.nome} pede os dados do veículo.`);
  }

  const documento = cliente.cpf_cnpj_numeros || null;
  if (await apoliceRepo.existeNumero(seguradora.id, dados.numero, documento)) {
    throw AppError.conflict(
      `A apólice ${dados.numero} da ${seguradora.nome} já está cadastrada para este cliente.`,
    );
  }

  const conexao = await pool.getConnection();
  try {
    await conexao.beginTransaction();

    const produtoId = dados.produto
      ? await apoliceRepo.resolverProduto(dados.produto, seguradora.id, null, null, conexao)
      : null;

    const apoliceId = await apoliceRepo.criarManual(
      {
        seguradoraId: seguradora.id,
        tipoSeguroId: tipo.id,
        numero: dados.numero,
        produtoId,
        clienteId: cliente.id,
        nomeSegurado: cliente.nome,
        documentoSegurado: documento,
        emitidaEm: dados.emitidaEm ?? null,
        vigenciaInicio: dados.vigenciaInicio,
        vigenciaFim: dados.vigenciaFim,
        tipoNegocio: dados.tipoNegocio ?? null,
        premioTotal: dados.premioTotal ?? null,
        premioLiquido: dados.premioLiquido ?? null,
      },
      conexao,
    );

    if (tipo.formulario === 'veiculo' && dados.veiculo) {
      const v = dados.veiculo;
      await veiculoRepo.gravar(
        apoliceId,
        {
          placa: v.placa ?? null,
          chassi: v.chassi ?? null,
          fabricante: v.fabricante ?? null,
          modelo: v.modelo ?? null,
          anoFabricacao: v.anoFabricacao ?? null,
          anoModelo: v.anoModelo ?? null,
          codigoFipe: v.codigoFipe ?? null,
          combustivel: v.combustivel ?? null,
          tipoVeiculo: v.tipoVeiculo ?? null,
          uso: v.uso ?? null,
          zeroKm: v.zeroKm ?? null,
          antifurto: v.antifurto ?? null,
          kitGas: v.kitGas ?? null,
          cepPernoite: v.cepPernoite ?? null,
          pernoiteGaragem: v.pernoiteGaragem ?? null,
          condutorNome: v.condutorNome ?? null,
          condutorDocumento: v.condutorDocumento ?? null,
          condutorNascimento: v.condutorNascimento ?? null,
          observacoes: v.observacoes ?? null,
        },
        'manual',
        conexao,
      );
    }

    // Só se não houver vínculo: um segundo, sem ramo, contaria a companhia duas vezes.
    if (!(await clienteRepo.temVinculoComSeguradora(cliente.id, seguradora.id, conexao))) {
      await clienteRepo.inserirVinculosSeguradora(
        [{ clienteId: cliente.id, seguradoraId: seguradora.id, ramoId: null, modalidadeId: null }],
        conexao,
      );
    }

    await conexao.commit();
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }

  await clienteRepo.recalcularSituacoes();
}
