import { z } from 'zod';

import { uuidEhValido } from '../utils/uuid.js';

/** Contato registrado na ficha. Canal e resultado são enums porque as filas contam por eles. */
export const novoAtendimentoSchema = z
  .object({
    canal: z.enum(['whatsapp', 'email', 'carta', 'ligacao']),
    motivo: z.enum(['inadimplencia', 'novo_cliente', 'renovacao', 'outro']),
    resultado: z.enum(['contato_feito', 'sem_resposta', 'retornar', 'recusou', 'enviado']),
    descricao: z.string().trim().max(2000).optional(),
    /** Quando aconteceu — `AAAA-MM-DDTHH:MM`, hora local. Ausente = agora. */
    contatoEm: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Data do contato inválida.')
      .optional(),
    /** O combinado: quando falar de novo. `AAAA-MM-DD`. */
    proximoContato: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data do próximo contato inválida.')
      .optional(),
    apolice: z.string().refine(uuidEhValido, 'Apólice inválida.').optional(),
  })
  .strict();

export type NovoAtendimentoInput = z.infer<typeof novoAtendimentoSchema>;

export const idAtendimentoSchema = z
  .object({
    id: z.string().refine(uuidEhValido, 'Identificador inválido.'),
    atendimento: z.string().refine(uuidEhValido, 'Atendimento inválido.'),
  })
  .strict();

export type IdAtendimentoInput = z.infer<typeof idAtendimentoSchema>;
