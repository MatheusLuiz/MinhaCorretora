import { z } from 'zod';

export const uuidTarefaSchema = z.object({
  id: z.string().uuid('Identificador inválido.'),
});

export const dadosTarefaSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da tarefa.').max(100, 'Máximo de 100 caracteres.'),
  descricao: z
    .string()
    .trim()
    .max(255)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  /** Rotina: "<chave>/<rotina>" (em `seguradoras/<chave>/tarefas`) ou "<rotina>" (em `comum/tarefas`). */
  arquivo: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/, 'Escolha o arquivo de integração.'),
  seguradoraId: z.coerce.number({ invalid_type_error: 'Escolha a seguradora.' }).int().positive('Escolha a seguradora.'),
  /** Bits: 1 = domingo … 64 = sábado. */
  diasSemana: z.coerce.number().int().min(1, 'Marque ao menos um dia.').max(127),
  horario: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM.'),
});

export type DadosTarefaInput = z.infer<typeof dadosTarefaSchema>;

export const situacaoTarefaSchema = z.object({ ativa: z.boolean() });
