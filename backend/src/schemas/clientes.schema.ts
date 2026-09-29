import { z } from 'zod';

import { documentoEhValido } from '../utils/documento.js';
import { uuidEhValido } from '../utils/uuid.js';

/** Filtros da listagem de clientes. `limite` ≤ 200 para não virar caminho de extrair a base. */
export const listarClientesSchema = z
  .object({
    busca: z.string().trim().max(120).optional(),
    situacao: z.string().trim().max(30).optional(),
    uf: z
      .string()
      .trim()
      .length(2, 'UF tem 2 letras.')
      .toUpperCase()
      .optional(),
    seguradora: z.string().trim().max(60).optional(),
    produtor: z.string().trim().max(100).optional(),
    origem: z.enum(['seguradora', 'manual']).optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type ListarClientesInput = z.infer<typeof listarClientesSchema>;

export const idClienteSchema = z
  .object({
    id: z.string().refine(uuidEhValido, 'Identificador inválido.'),
  })
  .strict();

export type IdClienteInput = z.infer<typeof idClienteSchema>;

/** CPF (11) ou CNPJ (14), com ou sem máscara. */
export const documentoParamSchema = z
  .object({
    documento: z
      .string()
      .refine((v) => [11, 14].includes(v.replace(/\D/g, '').length), 'Informe um CPF (11 dígitos) ou CNPJ (14).'),
  })
  .strict();

export type DocumentoParamInput = z.infer<typeof documentoParamSchema>;

/** Responsáveis de contato de EMPRESA — a lista inteira; cada um com telefone ou e-mail. */
const responsaveisSchema = z
  .array(
    z
      .object({
        nome: z.string().trim().min(2, 'Informe o nome do responsável.').max(150),
        cargo: z.string().trim().max(80).optional(),
        telefone: z
          .string()
          .trim()
          .max(20)
          .refine(
            (v) => v === '' || [10, 11].includes(v.replace(/\D/g, '').length),
            'Telefone do responsável: DDD + número (10 ou 11 dígitos).',
          )
          .optional(),
        email: z
          .string()
          .trim()
          .max(120)
          .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail do responsável inválido.')
          .optional(),
      })
      .strict()
      .refine((r) => (r.telefone ?? '') !== '' || (r.email ?? '') !== '', {
        message: 'Cada responsável precisa de telefone ou e-mail.',
      }),
  )
  .max(10, 'No máximo 10 responsáveis.');

// Telefones e e-mails: a lista INTEIRA, o primeiro é o principal. Telefone aceita
// 8–13 dígitos porque cadastro antigo tem número sem DDD e a tela reenvia tudo.
export const TIPOS_TELEFONE = ['celular', 'whatsapp', 'residencial', 'comercial', 'recado', 'opcional'] as const;
export const TIPOS_EMAIL = ['pessoal', 'comercial', 'financeiro', 'outro'] as const;

const telefonesSchema = z
  .array(
    z
      .object({
        tipo: z.enum(TIPOS_TELEFONE),
        numero: z
          .string()
          .trim()
          .max(20)
          .refine((v) => {
            const d = v.replace(/\D/g, '').length;
            return d >= 8 && d <= 13;
          }, 'Telefone incompleto — informe DDD e número.'),
        observacao: z.string().trim().max(80).optional(),
      })
      .strict(),
  )
  .max(10, 'No máximo 10 telefones.');

const emailsSchema = z
  .array(
    z
      .object({
        tipo: z.enum(TIPOS_EMAIL),
        endereco: z
          .string()
          .trim()
          .max(120)
          .refine((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'E-mail inválido.'),
        observacao: z.string().trim().max(80).optional(),
      })
      .strict(),
  )
  .max(5, 'No máximo 5 e-mails.');

/** Cadastro manual. Documento validado no dígito: é a chave natural do cliente. */
export const criarClienteSchema = z
  .object({
    cpfCnpj: z
      .string()
      .trim()
      .min(11, 'Informe o CPF ou CNPJ.')
      .max(18, 'Documento muito longo.')
      .refine(documentoEhValido, 'CPF/CNPJ inválido — confira os dígitos.'),

    nome: z
      .string()
      .trim()
      .min(2, 'Informe o nome.')
      .max(150, 'Máximo de 150 caracteres.'),

    nomeSocial: z.string().trim().max(150).optional(),

    situacao: z.string().trim().max(30).default('prospecto'),

    dataNascimento: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
      .optional(),

    sexo: z.enum(['M', 'F']).optional(),
    estadoCivil: z.string().trim().max(40).optional(),
    profissao: z.string().trim().max(120).optional(),

    telefones: telefonesSchema.optional(),
    emails: emailsSchema.optional(),

    logradouro: z.string().trim().max(150).optional(),
    numero: z.string().trim().max(10).optional(),
    complemento: z.string().trim().max(60).optional(),
    bairro: z.string().trim().max(60).optional(),
    cidade: z.string().trim().max(80).optional(),
    uf: z.string().trim().length(2).toUpperCase().optional(),
    cep: z.string().trim().max(9).optional(),

    produtor: z.string().trim().max(120).optional(),
    origemCliente: z.string().trim().max(60).optional(),

    // O serviço só aceita seguradora ATIVA.
    seguradora: z.string().trim().max(60).optional(),
    observacao: z.string().trim().max(500).optional(),

    /** Usuário corretor (uuid); ausente = quem cadastra. Só `clientes.todos` escolhe outro. */
    corretor: z.string().refine(uuidEhValido, 'Corretor inválido.').optional(),

    tiposSeguro: z.array(z.number().int().positive()).max(30).optional(),

    autorizaContato: z.boolean().default(false),
    vip: z.boolean().default(false),

    responsaveis: responsaveisSchema.optional(),
  })
  .strict();

export type CriarClienteInput = z.infer<typeof criarClienteSchema>;

/**
 * Edição de cliente (DELTA): ausente = não mexa, string vazia = apague.
 * O documento não se edita — é a chave que liga apólices e comissões.
 */
export const editarClienteSchema = z
  .object({
    nome: z.string().trim().min(2, 'Informe o nome.').max(150).optional(),
    nomeSocial: z.string().trim().max(150).optional(),
    situacao: z.string().trim().max(30).optional(),
    grupoCliente: z.string().trim().min(1, 'Escolha o grupo.').max(40).optional(),

    dataNascimento: z
      .string()
      .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use o formato AAAA-MM-DD.')
      .optional(),

    sexo: z.enum(['M', 'F']).optional(),
    estadoCivil: z.string().trim().max(40).optional(),
    profissao: z.string().trim().max(120).optional(),

    // Listas inteiras: quem não vier é removido; ausente não mexe em nenhum.
    telefones: telefonesSchema.optional(),
    emails: emailsSchema.optional(),

    logradouro: z.string().trim().max(150).optional(),
    numero: z.string().trim().max(10).optional(),
    complemento: z.string().trim().max(60).optional(),
    bairro: z.string().trim().max(60).optional(),
    cidade: z.string().trim().max(80).optional(),
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === '' || v.length === 2, 'UF tem duas letras.')
      .optional(),
    cep: z.string().trim().max(9).optional(),

    produtor: z.string().trim().max(120).optional(),
    origemCliente: z.string().trim().max(60).optional(),
    observacao: z.string().trim().max(500).optional(),

    autorizaContato: z.boolean().optional(),
    vip: z.boolean().optional(),

    responsaveis: responsaveisSchema.optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nada para alterar.');

export type EditarClienteInput = z.infer<typeof editarClienteSchema>;
