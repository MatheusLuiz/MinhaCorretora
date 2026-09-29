import { z } from 'zod';

export const listarApolicesSchema = z
  .object({
    busca: z.string().trim().max(120).optional(),
    seguradora: z.string().trim().max(60).optional(),
    /** 'sim' = só as sem cliente; 'nao' = só as vinculadas; ausente = todas. */
    semCliente: z.enum(['sim', 'nao']).optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).default(1),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export type ListarApolicesInput = z.infer<typeof listarApolicesSchema>;
