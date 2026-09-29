import { z } from 'zod';

/** Detalhe pedido pela tela. Dimensão é enum fechado: no repositório ela escolhe SQL constante. */
export const detalheSchema = z.object({
  dimensao: z.enum([
    'seguradora',
    'ramo',
    'produto',
    'vendedor',
    'canal',
    'tipoNegocio',
    'celula',
    'mes',
    'semPremio',
    'comSinistro',
    'sinistroRamo',
    'assistenciaRamo',
    'provisoria',
    'vencimento',
    'vencimentoMes',
    'aRenovar',
    'todasApolices',
    'situacaoCliente',
    'entradaMes',
    'crossSellRamo',
    'quantidadeApolices',
    'carteiraDoVendedor',
    'situacaoPorNome',
    'uf',
    'tipoPessoa',
    'faixaRenda',
    'seguradoraDoCliente',
    'cancelados',
    'canceladosPerdidos',
  ]),
  valor: z.string().trim().max(200).default(''),
  /** `AAAA-MM`, quando o clique foi numa coluna da série. */
  periodo: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, 'Período precisa ser AAAA-MM.')
    .optional(),
  naJanela: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export type EntradaDetalhe = z.infer<typeof detalheSchema>;
