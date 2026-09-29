import { z } from 'zod';

/** Caixas de saída e layouts de e-mail, como a tela manda. */

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const email = z.string().trim().toLowerCase().email('E-mail em formato inválido.').max(254);

const emailOpcional = z
  .union([email, z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const uuid = z.string().uuid('Identificador inválido.');

export const uuidParamSchema = z.object({ id: uuid });

const camposCaixa = {
  host: z
    .string()
    .trim()
    .min(3, 'Informe o servidor SMTP.')
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Só o nome do servidor, sem "https://" (ex.: smtp.gmail.com).'),
  porta: z.coerce.number().int().min(1).max(65535),
  seguranca: z.enum(['starttls', 'tls']),
  usuario: textoOpcional(254),
  /** Ausente ou vazia = manter a gravada: a tela nunca a recebe. */
  senha: z.string().max(500).optional(),
  remetenteNome: textoOpcional(120),
  remetenteEmail: email,
  responderPara: emailOpcional,
};

export const caixaSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome à caixa (ex.: Sistema, Cobrança).').max(80),
  ...camposCaixa,
  ativo: z.boolean(),
  padrao: z.boolean(),
  removerSenha: z.boolean().optional(),
});

export type CaixaInput = z.infer<typeof caixaSchema>;

/**
 * O teste usa o que está no formulário, salvo ou não. `id` = a caixa gravada
 * de onde vem a senha quando o campo está vazio. `para` vazio = quem testa.
 */
export const testeCaixaSchema = z.object({
  id: uuid.optional(),
  ...camposCaixa,
  para: emailOpcional,
});

export type TesteCaixaInput = z.infer<typeof testeCaixaSchema>;

export const modeloSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome ao layout.').max(120),
  finalidade: z.string().trim().regex(/^[a-z_]{2,40}$/, 'Finalidade inválida.'),
  /** Vazio = a caixa padrão. */
  caixa: z.union([uuid, z.literal('')]).nullable().optional(),
  assunto: z.string().trim().min(2, 'Informe o assunto.').max(255),
  corpoHtml: z.string().trim().min(1, 'Escreva o corpo do e-mail.').max(200_000),
  corpoTexto: textoOpcional(50_000),
  usarMoldura: z.boolean(),
  ativo: z.boolean(),
});

export type ModeloInput = z.infer<typeof modeloSchema>;

/** Pré-visualização e teste: o layout do formulário, salvo ou não. */
export const previaModeloSchema = modeloSchema.pick({
  finalidade: true,
  assunto: true,
  corpoHtml: true,
  corpoTexto: true,
  usarMoldura: true,
}).extend({
  caixa: z.union([uuid, z.literal('')]).nullable().optional(),
  para: emailOpcional,
});

export type PreviaModeloInput = z.infer<typeof previaModeloSchema>;
