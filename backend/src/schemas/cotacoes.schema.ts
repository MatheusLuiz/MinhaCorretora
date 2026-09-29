import { z } from 'zod';

import { documentoEhValido } from '../utils/documento.js';
import { uuidEhValido } from '../utils/uuid.js';

const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const valor = z.number().nonnegative('Valor não pode ser negativo.').max(99_999_999);

/** Veículo da cotação: mais solto que o da apólice (pode não ter placa nem chassi ainda). */
const veiculoCotacaoSchema = z.object({
  placa: z
    .string()
    .trim()
    .transform((v) => v.replace(/[^a-z0-9]/gi, '').toUpperCase())
    .refine((v) => v === '' || /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(v), 'Placa inválida.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  chassi: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, '').toUpperCase())
    .refine((v) => v === '' || /^[A-HJ-NPR-Z0-9]{17}$/.test(v), 'Chassi deve ter 17 caracteres, sem I, O ou Q.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  fabricante: texto(60),
  modelo: texto(120),
  anoFabricacao: z.number().int().min(1950).max(2100).nullable().optional(),
  anoModelo: z.number().int().min(1950).max(2100).nullable().optional(),
  codigoFipe: texto(10),
  uso: texto(60),
  zeroKm: z.boolean().nullable().optional(),
  cepPernoite: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || v.length === 8, 'CEP deve ter 8 dígitos.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  condutorNome: texto(150),
  condutorDocumento: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v === '' || documentoEhValido(v), 'CPF do condutor inválido.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  condutorNascimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal('').transform(() => null))
    .nullable()
    .optional(),
});

export type VeiculoCotacaoInput = z.infer<typeof veiculoCotacaoSchema>;

/** Cliente existente (`clienteId`) OU pré-cadastro (`novoCliente`, vira prospecto) — nunca os dois. */
export const novaCotacaoSchema = z
  .object({
    clienteId: z.string().refine(uuidEhValido, 'Cliente inválido.').optional(),
    novoCliente: z
      .object({
        cpfCnpj: z.string().trim().refine(documentoEhValido, 'CPF/CNPJ inválido — confira os dígitos.'),
        nome: z.string().trim().min(2, 'Informe o nome.').max(150),
        telefone: z
          .string()
          .trim()
          .transform((v) => v.replace(/\D/g, ''))
          .refine((v) => v === '' || (v.length >= 10 && v.length <= 11), 'Telefone com DDD: 10 ou 11 dígitos.')
          .optional(),
        email: z
          .string()
          .trim()
          .refine((v) => v === '' || z.string().email().safeParse(v).success, 'E-mail inválido.')
          .optional(),
      })
      .optional(),
    corretor: z.string().refine(uuidEhValido, 'Corretor inválido.').optional(),
    tipos: z.array(z.number().int().positive()).min(1, 'Escolha ao menos um tipo de seguro.').max(20),
    veiculo: veiculoCotacaoSchema.optional(),
    observacoes: texto(1000),
  })
  .strict()
  .refine((d) => Boolean(d.clienteId) !== Boolean(d.novoCliente), {
    message: 'Escolha um cliente existente ou preencha o pré-cadastro.',
    path: ['clienteId'],
  });

export type NovaCotacaoInput = z.infer<typeof novaCotacaoSchema>;

export const propostaSchema = z
  .object({
    seguradoraId: z.number().int().positive('Escolha a seguradora.'),
    tipoSeguroId: z.number().int().positive('Escolha o tipo de seguro.'),
    premio: valor.refine((v) => v > 0, 'Informe o prêmio.'),
    franquia: valor.nullable().optional(),
    formaPagamento: texto(80),
    observacao: texto(300),
  })
  .strict();

export type PropostaInput = z.infer<typeof propostaSchema>;

export const situacaoCotacaoSchema = z
  .object({
    situacao: z.enum(['em_cotacao', 'enviada', 'fechada', 'perdida']),
    motivoPerda: texto(200),
    propostaEscolhidaId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((d) => d.situacao !== 'perdida' || Boolean(d.motivoPerda), {
    message: 'Diga por que a cotação foi perdida.',
    path: ['motivoPerda'],
  })
  .refine((d) => d.situacao !== 'fechada' || Boolean(d.propostaEscolhidaId), {
    message: 'Escolha a proposta que fechou.',
    path: ['propostaEscolhidaId'],
  });

export type SituacaoCotacaoInput = z.infer<typeof situacaoCotacaoSchema>;
