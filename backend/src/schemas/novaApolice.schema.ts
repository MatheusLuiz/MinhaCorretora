import { z } from 'zod';

import { documentoEhValido } from '../utils/documento.js';

/** Texto opcional: vazio vira null. */
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const dataOpcional = data.or(z.literal('').transform(() => null)).nullable().optional();

const valor = z
  .number()
  .nonnegative('Valor não pode ser negativo.')
  .max(99_999_999)
  .nullable()
  .optional();

const ano = z.number().int().min(1950).max(new Date().getFullYear() + 2).nullable().optional();

/** Placa antiga ou Mercosul, com ou sem hífen. Chassi: 17 caracteres sem I, O e Q (ISO 3779). */
export const veiculoSchema = z
  .object({
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
    anoFabricacao: ano,
    anoModelo: ano,
    codigoFipe: texto(10),
    combustivel: texto(30),
    tipoVeiculo: texto(40),
    uso: texto(60),
    zeroKm: z.boolean().nullable().optional(),
    antifurto: texto(80),
    kitGas: z.boolean().nullable().optional(),
    cepPernoite: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v === '' || v.length === 8, 'CEP deve ter 8 dígitos.')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    pernoiteGaragem: z.boolean().nullable().optional(),
    condutorNome: texto(150),
    condutorDocumento: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ''))
      .refine((v) => v === '' || documentoEhValido(v), 'CPF do condutor inválido.')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    condutorNascimento: dataOpcional,
    observacoes: texto(500),
  })
  .refine((v) => v.placa || v.chassi, {
    message: 'Informe a placa ou o chassi.',
    path: ['placa'],
  });

export type VeiculoInput = z.infer<typeof veiculoSchema>;

export const novaApoliceSchema = z
  .object({
    seguradoraId: z.number().int().positive('Escolha a seguradora.'),
    tipoSeguroId: z.number().int().positive('Escolha o tipo de seguro.'),
    numero: z
      .string()
      .trim()
      .min(1, 'Informe o número da apólice.')
      .max(40)
      .transform((v) => v.toUpperCase()),
    produto: texto(120),
    emitidaEm: dataOpcional,
    vigenciaInicio: data,
    vigenciaFim: data,
    tipoNegocio: z.enum(['novo', 'renovacao']).nullable().optional(),
    premioTotal: valor,
    premioLiquido: valor,
    veiculo: veiculoSchema.optional(),
  })
  .strict()
  .refine((a) => a.vigenciaFim > a.vigenciaInicio, {
    message: 'O fim da vigência precisa ser depois do início.',
    path: ['vigenciaFim'],
  })
  .refine((a) => a.premioLiquido == null || a.premioTotal == null || a.premioLiquido <= a.premioTotal, {
    message: 'O prêmio líquido não pode passar do total.',
    path: ['premioLiquido'],
  });

export type NovaApoliceInput = z.infer<typeof novaApoliceSchema>;
