import { api } from '@/lib/api';

/** Histórico de atendimento da ficha (049). Espelha `atendimento.repository`. */

export type CanalAtendimento = 'whatsapp' | 'email' | 'carta' | 'ligacao';
export type MotivoAtendimento = 'inadimplencia' | 'novo_cliente' | 'renovacao' | 'outro';
export type ResultadoAtendimento = 'contato_feito' | 'sem_resposta' | 'retornar' | 'recusou' | 'enviado';

export interface Atendimento {
  id: string;
  canal: CanalAtendimento;
  motivo: MotivoAtendimento;
  resultado: ResultadoAtendimento;
  descricao: string | null;
  /** `AAAA-MM-DDTHH:MM:SS`, horário de Brasília (o gravado). */
  contatoEm: string;
  proximoContato: string | null;
  apolice: { id: string; numero: string } | null;
  /** A companhia a que o contato foi levado; null = cliente sem apólice ativa. */
  seguradora: string | null;
  registradoPor: { id: string; nome: string };
  registradoEm: string;
}

/** Apólice EM VIGOR do cliente — a que pode receber o atendimento (050). */
export interface ApoliceAtiva {
  id: string;
  numero: string;
  seguradora: string;
  vigenciaFim: string | null;
}

export interface NovoAtendimento {
  canal: CanalAtendimento;
  motivo: MotivoAtendimento;
  resultado: ResultadoAtendimento;
  descricao?: string;
  /** `AAAA-MM-DDTHH:MM`, hora local. Ausente = agora. */
  contatoEm?: string;
  proximoContato?: string;
  apolice?: string;
}

export const CANAIS: { chave: CanalAtendimento; rotulo: string; icone: string }[] = [
  { chave: 'whatsapp', rotulo: 'WhatsApp', icone: '💬' },
  { chave: 'ligacao', rotulo: 'Ligação', icone: '📞' },
  { chave: 'email', rotulo: 'E-mail', icone: '✉️' },
  { chave: 'carta', rotulo: 'Carta', icone: '📮' },
];

export const MOTIVOS: Record<MotivoAtendimento, string> = {
  inadimplencia: 'Inadimplência',
  novo_cliente: 'Boas-vindas (cliente novo)',
  renovacao: 'Renovação',
  outro: 'Outro assunto',
};

export const RESULTADOS: Record<ResultadoAtendimento, string> = {
  contato_feito: 'Falou com o cliente',
  sem_resposta: 'Não atendeu / sem resposta',
  retornar: 'Pediu retorno',
  recusou: 'Recusou / não quer',
  enviado: 'Enviado, aguardando resposta',
};

export const atendimentosApi = {
  listar: (clienteId: string) =>
    api.get<{ atendimentos: Atendimento[]; apolicesAtivas?: ApoliceAtiva[] }>(
      `/clientes/${clienteId}/atendimentos`,
    ),

  registrar: (clienteId: string, dados: NovoAtendimento) =>
    api.post<{ atendimentos: Atendimento[]; apolicesAtivas?: ApoliceAtiva[]; mensagem: string }>(
      `/clientes/${clienteId}/atendimentos`,
      dados,
    ),

  excluir: (clienteId: string, atendimentoId: string) =>
    api.delete<{ atendimentos: Atendimento[]; apolicesAtivas?: ApoliceAtiva[] }>(
      `/clientes/${clienteId}/atendimentos/${atendimentoId}`,
    ),
};
