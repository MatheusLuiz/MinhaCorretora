import { api } from '@/lib/api';

/** Espelha `notificacoes.controller.ts`. */
export interface Notificacao {
  id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  criadaEm: string;
  lida: boolean;
  /** Cliente do aviso, para abrir a ficha. */
  clienteId: string | null;
}

export const notificacoesApi = {
  listar: () => api.get<{ naoLidas: number; notificacoes: Notificacao[] }>('/notificacoes'),
  marcarLida: (id: string) => api.post<void>(`/notificacoes/${encodeURIComponent(id)}/lida`),
  marcarTodasLidas: () => api.post<void>('/notificacoes/lidas'),
};
