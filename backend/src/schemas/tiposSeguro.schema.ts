import { z } from 'zod';

import { FORMULARIOS } from '../repositories/tipoSeguro.repository.js';

export const dadosTipoSeguroSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'Informe o nome do tipo.')
    .max(60, 'Máximo de 60 caracteres.'),
  formulario: z.enum(FORMULARIOS, { errorMap: () => ({ message: 'Escolha o formulário.' }) }),
  descricao: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  ordem: z.coerce.number().int().min(0).max(9999).optional(),
});

export type DadosTipoSeguroInput = z.infer<typeof dadosTipoSeguroSchema>;

export const situacaoTipoSeguroSchema = z.object({ ativo: z.boolean() });

export const habilitacaoSchema = z.object({ habilitado: z.boolean() });
