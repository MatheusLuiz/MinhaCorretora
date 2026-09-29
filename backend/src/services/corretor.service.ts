import * as repo from '../repositories/corretor.repository.js';
import { AppError } from '../utils/AppError.js';

/** Corretor de um cadastro novo: quem está logado; só com `clientes.todos` escolhe outro. */
export async function resolver(
  usuario: { id: string; permissoes: string[] },
  corretorEscolhido?: string | null,
): Promise<{ produtorId: number; nome: string }> {
  const alvo = corretorEscolhido && corretorEscolhido !== usuario.id ? corretorEscolhido : usuario.id;

  if (alvo !== usuario.id) {
    if (!usuario.permissoes.includes('clientes.todos')) {
      throw AppError.forbidden('Seu perfil não escolhe corretor: o cadastro fica na sua carteira.');
    }
    const permitidos = await repo.listar();
    if (!permitidos.some((c) => c.id === alvo)) {
      throw AppError.unprocessable('Corretor inválido: escolha um usuário ativo que cadastra clientes.');
    }
  }

  const produtor = await repo.produtorDoUsuario(alvo);
  if (!produtor) throw AppError.unprocessable('Corretor não encontrado ou inativo.');
  return produtor;
}

export const listar = repo.listar;
