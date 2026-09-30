import { z } from 'zod';

export const dadosGrupoClienteSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'Informe o nome do grupo.')
    .max(60, 'Máximo de 60 caracteres.'),
  descricao: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  ordem: z.coerce.number().int().min(0).max(9999).optional(),
});

export type DadosGrupoClienteInput = z.infer<typeof dadosGrupoClienteSchema>;

export const situacaoGrupoClienteSchema = z.object({ ativo: z.boolean() });
