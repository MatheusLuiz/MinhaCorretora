import { z } from 'zod';

// Sem campo de senha de propósito: o servidor gera a temporária, o administrador não a escolhe.

const nome = z
  .string()
  .trim()
  .min(2, 'Informe ao menos 2 caracteres.')
  .max(150, 'Máximo de 150 caracteres.')
  .regex(/^[\p{L}\p{M}\s'-]+$/u, 'Use apenas letras, espaços, apóstrofo e hífen.');

/** Nascimento: nem futura nem mais de 120 anos (erro de digitação). */
const dataNascimento = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((valor) => {
    const data = new Date(`${valor}T12:00:00`);
    if (Number.isNaN(data.getTime())) return false;

    const hoje = new Date();
    const limiteAntigo = new Date();
    limiteAntigo.setFullYear(hoje.getFullYear() - 120);

    return data <= hoje && data >= limiteAntigo;
  }, 'Data de nascimento inválida.');

/** Só o formato: papel é dado, o serviço confere se existe em `papeis`. */
const chavePapel = z
  .string({ required_error: 'Escolha um papel.' })
  .trim()
  .regex(/^[a-z][a-z_]{1,49}$/, 'Escolha um papel válido.');

export const criarUsuarioSchema = z
  .object({
    nome,
    sobrenome: nome.optional(),
    dataNascimento: dataNascimento.optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(5)
      .max(254, 'E-mail muito longo.')
      .email('E-mail em formato inválido.'),
    papel: chavePapel,
  })
  .strict();

export type CriarUsuarioInput = z.infer<typeof criarUsuarioSchema>;

export const editarUsuarioSchema = z
  .object({
    nome: nome.optional(),
    // null = limpar; ausente = não mexer.
    sobrenome: nome.nullable().optional(),
    dataNascimento: dataNascimento.nullable().optional(),
    papel: chavePapel.optional(),
  })
  .strict()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: 'Informe ao menos um campo para alterar.',
  });

export type EditarUsuarioInput = z.infer<typeof editarUsuarioSchema>;

export const situacaoUsuarioSchema = z.object({ ativo: z.boolean() }).strict();

export const idUsuarioSchema = z.object({
  id: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'Identificador inválido.',
    ),
});

/** Permissões de um usuário: o conjunto FINAL; o servidor calcula a diferença contra o papel. */
export const permissoesUsuarioSchema = z
  .object({
    permissoes: z
      .array(z.string().trim().min(1).max(80))
      .max(50, 'Lista de permissões longa demais.'),
    motivo: z.string().trim().max(255).optional(),
  })
  .strict();

export type PermissoesUsuarioInput = z.infer<typeof permissoesUsuarioSchema>;

/** Produtores pelos quais o usuário responde (ids, não nomes). Vazia = nenhum cliente. */
export const produtoresUsuarioSchema = z
  .object({
    produtores: z
      .array(z.number().int().positive())
      .max(200, 'Vincule no máximo 200 produtores a um usuário.'),
  })
  .strict();

export type ProdutoresUsuarioInput = z.infer<typeof produtoresUsuarioSchema>;

/** A chave do papel na URL — enum fechado não serve: papel novo entra no banco. */
export const chavePapelSchema = z.object({
  chave: z.string().trim().regex(/^[a-z_]{2,50}$/, 'Chave de papel inválida.'),
});

/** Papel criado pela tela; `copiarDe` = chave do papel cujas permissões ele herda. */
export const novoPapelSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do papel.').max(100, 'Máximo de 100 caracteres.'),
  descricao: z
    .string()
    .trim()
    .max(255)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  copiarDe: z
    .string()
    .trim()
    .regex(/^([a-z_]{2,50})?$/, 'Papel de origem inválido.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});

export type NovoPapelInput = z.infer<typeof novoPapelSchema>;

/** Nome e descrição; a chave não se edita. */
export const edicaoPapelSchema = novoPapelSchema.pick({ nome: true, descricao: true });

export type EdicaoPapelInput = z.infer<typeof edicaoPapelSchema>;

export const situacaoPapelSchema = z.object({ ativo: z.boolean() });

/** Permissões do papel: o conjunto FINAL, não um delta. */
export const permissoesDoPapelSchema = z.object({
  permissoes: z.array(z.string().trim().max(80)).max(100),
});

export type PermissoesDoPapelInput = z.infer<typeof permissoesDoPapelSchema>;
