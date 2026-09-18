import { z } from 'zod';

import { env } from '../config/env.js';

// Teto em toda string: senha enorme faria o Argon2id travar a CPU.
export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(5, 'Informe o e-mail.')
      .max(254, 'E-mail muito longo.')
      .email('E-mail em formato inválido.'),
    senha: z
      .string()
      .min(1, 'Informe a senha.')
      .max(128, 'Senha muito longa.'),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

export const alterarSenhaSchema = z
  .object({
    senhaAtual: z.string().min(1, 'Informe a senha atual.').max(128),
    novaSenha: z
      .string()
      .min(env.SENHA_TAMANHO_MINIMO, `A nova senha precisa ter no mínimo ${env.SENHA_TAMANHO_MINIMO} caracteres.`)
      .max(128, 'Senha muito longa.'),
    confirmacaoNovaSenha: z.string().min(1, 'Confirme a nova senha.').max(128),
  })
  .strict()
  .refine((dados) => dados.novaSenha === dados.confirmacaoNovaSenha, {
    message: 'A confirmação não confere com a nova senha.',
    path: ['confirmacaoNovaSenha'],
  });

export type AlterarSenhaInput = z.infer<typeof alterarSenhaSchema>;

export const esqueciSenhaSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(5, 'Informe o e-mail.')
      .max(254, 'E-mail muito longo.')
      .email('E-mail em formato inválido.'),
  })
  .strict();

export type EsqueciSenhaInput = z.infer<typeof esqueciSenhaSchema>;

/** Só descarta lixo evidente (o token tem 43 caracteres); quem decide é o hash. */
const tokenRedefinicao = z
  .string()
  .trim()
  .min(20, 'Link inválido.')
  .max(256, 'Link inválido.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Link inválido.');

export const validarTokenSchema = z.object({ token: tokenRedefinicao }).strict();

export type ValidarTokenInput = z.infer<typeof validarTokenSchema>;

export const redefinirSenhaSchema = z
  .object({
    token: tokenRedefinicao,
    novaSenha: z
      .string()
      .min(
        env.SENHA_TAMANHO_MINIMO,
        `A nova senha precisa ter no mínimo ${env.SENHA_TAMANHO_MINIMO} caracteres.`,
      )
      .max(128, 'Senha muito longa.'),
    confirmacaoNovaSenha: z.string().min(1, 'Confirme a nova senha.').max(128),
  })
  .strict()
  .refine((dados) => dados.novaSenha === dados.confirmacaoNovaSenha, {
    message: 'A confirmação não confere com a nova senha.',
    path: ['confirmacaoNovaSenha'],
  });

export type RedefinirSenhaInput = z.infer<typeof redefinirSenhaSchema>;
