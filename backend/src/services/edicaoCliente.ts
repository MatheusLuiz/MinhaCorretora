import { pool } from '../database/pool.js';
import * as repo from '../repositories/cliente.repository.js';
import * as grupoRepo from '../repositories/grupoCliente.repository.js';
import type { EditarClienteInput } from '../schemas/clientes.schema.js';
import { AppError } from '../utils/AppError.js';
import type { Escopo } from '../utils/escopo.js';
import { uuidParaBinario } from '../utils/uuid.js';

// Edição de cliente pela tela. PATCH é delta: campo ausente = não mexa, vazio = apague.
// Mexer na situação marca `situacao_origem = 'manual'`, que recalcularSituacoes respeita.

export interface ResultadoEdicao {
  uuid: string;
  nome: string;
  camposAlterados: string[];
}

/** Só quem existe E está na carteira de quem edita. */
async function localizar(uuid: string, escopo: Escopo): Promise<{ id: number; nome: string }> {
  const cliente = await repo.buscarPorUuid(uuid, escopo);

  if (!cliente) {
    throw AppError.notFound(
      'Cliente não encontrado. Ele pode ter saído da base — ou estar fora da sua carteira.',
    );
  }

  return { id: Number(cliente.id), nome: String(cliente.nome) };
}

export async function editar(
  uuid: string,
  dados: EditarClienteInput,
  escopo: Escopo,
): Promise<ResultadoEdicao> {
  uuidParaBinario(uuid);

  const cliente = await localizar(uuid, escopo);
  const alterados: string[] = [];

  const conexao = await pool.getConnection();

  try {
    await conexao.beginTransaction();

    const dimensao = async (
      tabela: 'estados_civis' | 'profissoes' | 'produtores' | 'origens_clientes',
      valor: string | undefined,
    ): Promise<number | null | undefined> => {
      if (valor === undefined) return undefined;
      if (valor === '') return null;
      return repo.resolverDimensao(tabela, valor, conexao);
    };

    const [estadoCivilId, profissaoId, produtorId, origemClienteId] = await Promise.all([
      dimensao('estados_civis', dados.estadoCivil),
      dimensao('profissoes', dados.profissao),
      dimensao('produtores', dados.produtor),
      dimensao('origens_clientes', dados.origemCliente),
    ]);

    let situacaoId: number | null | undefined;
    let situacaoOrigem: 'manual' | undefined;

    if (dados.situacao !== undefined) {
      const situacoes = await repo.listarSituacoes();
      const achada = situacoes.find((s) => s.chave === dados.situacao);

      if (!achada) {
        throw AppError.unprocessable(
          `Situação desconhecida: "${dados.situacao}". As válidas estão em /clientes/situacoes.`,
        );
      }

      situacaoId = achada.id;
      situacaoOrigem = 'manual';
    }

    // Grupo desativado continua valendo para quem já está nele, mas não recebe ninguém novo.
    let grupoCliente: string | undefined;
    if (dados.grupoCliente !== undefined) {
      const grupo = await grupoRepo.ativoPorChave(dados.grupoCliente);
      if (!grupo) {
        throw AppError.unprocessable(
          `Grupo de cliente desconhecido ou inativo: "${dados.grupoCliente}". Os válidos estão em /grupos-cliente.`,
        );
      }
      grupoCliente = grupo.chave;
    }

    const campos: repo.EdicaoDeCliente = {
      ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
      ...(grupoCliente !== undefined ? { carteira_comercial: grupoCliente } : {}),
      ...(dados.nomeSocial !== undefined ? { nome_social: dados.nomeSocial || null } : {}),
      ...(situacaoId !== undefined ? { situacao_id: situacaoId } : {}),
      ...(situacaoOrigem ? { situacao_origem: situacaoOrigem } : {}),
      ...(dados.dataNascimento !== undefined
        ? { data_nascimento: dados.dataNascimento || null }
        : {}),
      ...(dados.sexo !== undefined ? { sexo: dados.sexo } : {}),
      ...(estadoCivilId !== undefined ? { estado_civil_id: estadoCivilId } : {}),
      ...(profissaoId !== undefined ? { profissao_id: profissaoId } : {}),
      ...(produtorId !== undefined ? { produtor_id: produtorId } : {}),
      ...(origemClienteId !== undefined ? { origem_cliente_id: origemClienteId } : {}),
      ...(dados.autorizaContato !== undefined
        ? { autoriza_contato: dados.autorizaContato ? (1 as const) : (0 as const) }
        : {}),
      ...(dados.vip !== undefined ? { vip: dados.vip ? (1 as const) : (0 as const) } : {}),
    };

    if (Object.keys(campos).length > 0) {
      await repo.atualizarManual(cliente.id, campos, conexao);
      alterados.push(...Object.keys(campos).filter((c) => c !== 'situacao_origem'));
    }

    // Listas inteiras: o que ficou de fora foi removido na tela.
    if (dados.telefones !== undefined) {
      await repo.substituirTelefones(
        cliente.id,
        dados.telefones.map((t) => ({ ...t, observacao: t.observacao || null })),
        conexao,
      );
      alterados.push('telefones');
    }
    if (dados.emails !== undefined) {
      await repo.substituirEmails(
        cliente.id,
        dados.emails.map((e) => ({ ...e, observacao: e.observacao || null })),
        conexao,
      );
      alterados.push('emails');
    }

    if (dados.responsaveis !== undefined) {
      await repo.substituirResponsaveis(
        cliente.id,
        dados.responsaveis.map((r) => ({
          nome: r.nome,
          cargo: r.cargo || null,
          telefone: r.telefone || null,
          email: r.email || null,
        })),
        conexao,
      );
      alterados.push('responsaveis');
    }

    const mexeuNoEndereco = [
      dados.logradouro, dados.numero, dados.complemento,
      dados.bairro, dados.cidade, dados.uf, dados.cep,
    ].some((v) => v !== undefined);

    if (mexeuNoEndereco) {
      // Endereço grava INTEIRO: trocar a rua e manter o número antigo inventa um endereço.
      const municipioId =
        dados.cidade && dados.uf
          ? await repo.resolverMunicipio(dados.cidade, dados.uf, conexao)
          : null;

      await repo.definirEndereco(
        {
          clienteId: cliente.id,
          tipo: 'principal',
          logradouro: dados.logradouro || null,
          numero: dados.numero || null,
          complemento: dados.complemento || null,
          bairro: dados.bairro || null,
          municipioId,
          cep: (dados.cep ?? '').replace(/\D/g, '').slice(0, 8) || null,
        },
        conexao,
      );
      alterados.push('endereco');
    }

    await conexao.commit();

    return { uuid, nome: dados.nome ?? cliente.nome, camposAlterados: alterados };
  } catch (erro) {
    await conexao.rollback();
    throw erro;
  } finally {
    conexao.release();
  }
}
