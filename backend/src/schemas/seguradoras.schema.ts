import { z } from 'zod';

import { cnpjEhValido } from '../utils/documento.js';

/** Campo de texto opcional em que string vazia significa "sem valor". */
function textoOpcional(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
}

/** Cadastro de seguradora: só o nome é obrigatório (as importadas vieram só com nome). */
export const dadosSeguradoraSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, 'Informe o nome da seguradora.')
      .max(60, 'Máximo de 60 caracteres.'),

    cnpj: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v === '' || cnpjEhValido(v), 'CNPJ inválido — confira os dígitos.')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),

    codigoSusep: textoOpcional(20),
    site: textoOpcional(200),
    telefone: textoOpcional(20),

    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(120)
      .refine((v) => v === '' || z.string().email().safeParse(v).success, 'E-mail inválido.')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),

    observacoes: textoOpcional(500),
  })
  .strict();

export const situacaoSeguradoraSchema = z.object({ ativa: z.boolean() }).strict();

/**
 * Integração da companhia. `segredo`: ausente mantém (a tela nunca recebe o atual),
 * `null` apaga, texto substitui.
 */
export const integracaoSchema = z
  .object({
    tipo: z.enum(['nenhuma', 'api', 'sftp', 'portal']).default('nenhuma'),
    ambiente: z.enum(['producao', 'homologacao']).default('producao'),
    ativa: z.boolean().default(false),

    baseUrl: z
      .string()
      .trim()
      .max(255)
      .refine(
        (v) => v === '' || /^https:\/\//i.test(v),
        'Use https:// — a credencial não pode viajar em claro.',
      )
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),

    usuario: textoOpcional(120),
    observacoes: textoOpcional(500),

    segredo: z.string().trim().max(500).nullable().optional(),

    documentacaoUrl: z
      .string()
      .trim()
      .max(255)
      .refine((v) => v === '' || /^https:\/\//i.test(v), 'O link da documentação precisa começar com https://')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    documentacao: textoOpcional(20000),

    // Ausente não mexe; presente é a lista COMPLETA. `valor` vazio mantém o gravado com aquele nome.
    credenciais: z
      .array(
        z
          .object({
            nome: z.string().trim().min(1, 'Dê um nome à credencial.').max(60),
            valor: z.string().trim().max(2000).optional(),
          })
          .strict(),
      )
      .max(20, 'No máximo 20 credenciais por integração.')
      .refine(
        (lista) => new Set(lista.map((c) => c.nome.toLowerCase())).size === lista.length,
        'Há duas credenciais com o mesmo nome.',
      )
      .optional(),
  })
  .strict();

export type DadosSeguradoraInput = z.infer<typeof dadosSeguradoraSchema>;
export type IntegracaoInput = z.infer<typeof integracaoSchema>;
