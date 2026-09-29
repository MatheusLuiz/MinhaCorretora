import { api } from '@/lib/api';

/** Tipos de seguro e as seguradoras em que cada um está habilitado. */

export type Formulario =
  | 'veiculo'
  | 'imovel'
  | 'pessoas'
  | 'equipamento'
  | 'pet'
  | 'viagem'
  | 'transporte'
  | 'responsabilidade'
  | 'consorcio'
  | 'generico';

/** `pronto = false`: a apólice se cadastra, mas os dados do bem ainda não têm onde ficar. */
export const FORMULARIOS: Record<Formulario, { rotulo: string; pede: string; pronto: boolean }> = {
  veiculo: { rotulo: 'Veículo', pede: 'placa, chassi, modelo, ano, FIPE, uso, condutor', pronto: true },
  imovel: { rotulo: 'Imóvel', pede: 'endereço, tipo e uso do imóvel', pronto: false },
  pessoas: { rotulo: 'Pessoas', pede: 'capital segurado e beneficiários', pronto: false },
  equipamento: { rotulo: 'Equipamento', pede: 'aparelho, marca, modelo, IMEI ou nº de série, nota fiscal', pronto: false },
  pet: { rotulo: 'Pet', pede: 'nome, espécie, raça, nascimento, microchip', pronto: false },
  viagem: { rotulo: 'Viagem', pede: 'destino, ida, volta, viajantes', pronto: false },
  transporte: { rotulo: 'Transporte', pede: 'mercadoria, origem, destino, averbação', pronto: false },
  responsabilidade: { rotulo: 'Responsabilidade civil', pede: 'atividade coberta e limite', pronto: false },
  consorcio: { rotulo: 'Consórcio', pede: 'grupo, cota, valor da carta', pronto: false },
  generico: { rotulo: 'Genérico', pede: 'só os dados da apólice', pronto: true },
};

export interface TipoSeguro {
  id: number;
  chave: string;
  nome: string;
  formulario: Formulario;
  descricao: string | null;
  ativo: boolean;
  ordem: number;
  /** Ids das seguradoras que oferecem o tipo. */
  seguradoras: number[];
  apolices: number;
}

export interface DadosTipoSeguro {
  nome: string;
  formulario: Formulario;
  descricao?: string | null;
  ordem?: number;
}

export const tiposSeguroApi = {
  listar: () => api.get<{ tipos: TipoSeguro[] }>('/tipos-seguro'),

  criar: (dados: DadosTipoSeguro) => api.post<{ tipo: TipoSeguro }>('/tipos-seguro', dados),

  atualizar: (id: number, dados: DadosTipoSeguro) =>
    api.patch<{ tipo: TipoSeguro }>(`/tipos-seguro/${id}`, dados),

  definirSituacao: (id: number, ativo: boolean) =>
    api.patch<{ tipo: TipoSeguro }>(`/tipos-seguro/${id}/situacao`, { ativo }),

  definirHabilitacao: (id: number, seguradoraId: number, habilitado: boolean) =>
    api.put<{ tipo: TipoSeguro }>(`/tipos-seguro/${id}/seguradoras/${seguradoraId}`, { habilitado }),
};
