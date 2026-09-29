import * as modeloRepo from '../repositories/modeloRelatorio.repository.js';
import * as seguradoraRepo from '../repositories/seguradora.repository.js';
import { AppError } from '../utils/AppError.js';

// Resolve a chave de layout (de código, em seguradoras/<chave>/modelos/, ou cadastrado
// em `modelos_relatorio`) numa forma única. A companhia tem de existir e estar ativa.

export interface LayoutResolvido {
  chave: string;
  nome: string;
  /** Nome da companhia, como o cadastro a grafa. */
  seguradora: string;
  seguradoraId: number | null;
  aliases: Record<string, string>;
  entidade: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas' | null;
  origem: 'codigo' | 'cadastro';
}

/** Campo do sistema que uma coluna pode alimentar, por família. */
export interface LayoutDeCodigo {
  chave: string;
  nome: string;
  aliases: Record<string, string>;
  seguradoraChave?: string;
  entidade?: 'parcelas' | 'comissoes' | 'sinistros' | 'renovacoes' | 'encerradas';
}

/** Código antes do cadastro: o layout de código foi validado contra arquivo real. */
export async function resolver(
  chave: string,
  doCodigo: LayoutDeCodigo | undefined,
  familia: modeloRepo.Familia,
): Promise<LayoutResolvido> {
  if (doCodigo) {
    const cadastro = doCodigo.seguradoraChave
      ? await seguradoraRepo.porChave(doCodigo.seguradoraChave)
      : null;

    if (doCodigo.seguradoraChave) {
      if (!cadastro) {
        throw AppError.unprocessable(
          `A seguradora do layout "${doCodigo.nome}" não está cadastrada. ` +
            'Cadastre-a em Configurações → Seguradoras antes de importar.',
        );
      }
      if (!cadastro.ativa) {
        throw AppError.unprocessable(
          `A seguradora "${cadastro.nome}" está inativa. ` +
            'Reative-a em Configurações → Seguradoras para importar arquivos dela.',
        );
      }
    }

    return {
      chave: doCodigo.chave,
      nome: doCodigo.nome,
      seguradora: cadastro?.nome ?? '',
      seguradoraId: cadastro?.id ?? null,
      aliases: doCodigo.aliases,
      entidade: doCodigo.entidade ?? null,
      origem: 'codigo',
    };
  }

  const modelo = (await modeloRepo.listar()).find((m) => m.chave === chave);

  if (!modelo) {
    throw AppError.unprocessable(
      `Modelo de relatório desconhecido: ${chave}. ` +
        'Se o relatório é novo, cadastre o modelo antes de importar.',
    );
  }

  if (modelo.familia !== familia) {
    // O importador errado não falharia: gravaria coisa sem sentido.
    throw AppError.unprocessable(
      `O modelo "${modelo.nome}" é da família ${modelo.familia}, e este envio é de ${familia}.`,
    );
  }

  if (modelo.seguradoraId !== null) {
    const cadastro = await seguradoraRepo.buscarPorId(modelo.seguradoraId);

    if (!cadastro) {
      throw AppError.unprocessable(
        `A seguradora do modelo "${modelo.nome}" não existe mais no cadastro.`,
      );
    }

    if (!cadastro.ativa) {
      throw AppError.unprocessable(
        `A seguradora "${cadastro.nome}" está inativa. ` +
          'Reative-a em Configurações → Seguradoras para importar arquivos dela.',
      );
    }
  }

  return {
    chave: modelo.chave,
    nome: modelo.nome,
    seguradora: modelo.seguradoraNome ?? '',
    seguradoraId: modelo.seguradoraId,
    aliases: modelo.colunas,
    entidade: modelo.entidade,
    origem: 'cadastro',
  };
}
