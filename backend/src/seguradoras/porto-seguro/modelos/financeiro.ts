import type { LayoutFinanceiro } from '../../../services/modelosFinanceiro.js';

export const PORTO_COMISSAO_ANALITICA: LayoutFinanceiro = {
  chave: 'porto-comissao-analitica',
  nome: 'Porto Seguro — Analítico dos pagamentos de comissões',
  seguradoraChave: 'porto-seguro',
  seguradora: 'Porto Seguro',
  entidade: 'comissoes',
  descricao:
    'Uma ordem de pagamento por arquivo, com a comissão paga LINHA A LINHA — número de apólice, segurado, ramo e alíquota.',
  // Sem aliases: não há cabeçalho a mapear; `importacaoComissaoAnalitica` lê por posição.
  aliases: {},
  observacoes: [
    'Sai do portal da Porto com extensão .do e é uma tabela HTML, não planilha. Pode importar como está.',
    'UM arquivo por ordem de pagamento. Um mês pode ter uma ordem quase todo dia — uma importação para cada, e a tela avisa quando uma já entrou.',
    'A soma das linhas é conferida contra a "Comissão Bruta" do rodapé. Diferença de um centavo recusa a carga inteira.',
    'Cancelamento e restituição vêm NEGATIVOS e entram como estão — é o que faz a soma bater.',
    'A comissão é ligada à apólice pelo número. Apólice que ainda não está na base entra sem vínculo: o valor é contado, o cliente fica em branco até a apólice ser importada.',
    'NÃO preenche prêmio de apólice. A coluna "Premio Liq." é da PARCELA quando o tipo é fracionado, e misturá-la com prêmio emitido daria um total sem significado.',
  ],
};

export const PORTO_COMISSAO_EXTRATO: LayoutFinanceiro = {
  chave: 'porto-comissao-extrato',
  nome: 'Porto Seguro — Extrato de pagamentos (conferência)',
  seguradoraChave: 'porto-seguro',
  seguradora: 'Porto Seguro',
  entidade: 'comissoes',
  descricao:
    'Não cria comissão. Compara a lista de ordens do portal com o que já foi importado, diz o que falta e guarda o extrato para Financeiro › Conciliação.',
  aliases: {},
  observacoes: [
    'É a tela do portal que lista uma ordem por linha — exporte pelo botão "Gerar planilha no formato XLS".',
    'Nenhum recibo é gravado em comissões. As ordens ficam num extrato à parte (Financeiro › Conciliação), e a resposta é um veredito: conferidas, faltando, divergentes.',
    'Serve porque o analítico vem UM ARQUIVO POR ORDEM: se um download falhar, todo arquivo que chegou continua íntegro e nada denuncia a falta.',
    'Depois de importar um mês de comissões, passe o extrato aqui.',
  ],
};

export const PORTO_PARCELAS_VENCIDAS: LayoutFinanceiro = {
  chave: 'porto-parcelas-vencidas',
  nome: 'Porto Seguro — Relatório de parcelas vencidas',
  seguradoraChave: 'porto-seguro',
  seguradora: 'Porto Seguro',
  entidade: 'parcelas',
  descricao:
    'Parcelas em atraso até a data da extração. Traz segurado e telefone SEM máscara — é a origem de cadastro que o relatório de apólices não dá.',
  // Sem coluna de situação: toda linha do relatório está vencida.
  statusPadrao: 'atrasado',
  aliases: {
    // Vida Individual e Empresarial grafam as mesmas colunas de jeitos diferentes.
    apolice: 'numero_apolice',
    segurado: 'nome_segurado',
    produto: 'produto',
    parcela: 'numero_parcela',
    parc: 'numero_parcela',
    vencimento: 'vencimento',
    // "Novo Vencimento" (renegociado) fica fora: disputaria o campo com "Vencimento".
    valor: 'valor',
    valor_r: 'valor',
    forma_de_pagamento: 'forma_pagamento',
    forma_de: 'forma_pagamento',
    endosso: 'sequencia_emissao',
    telefone: 'telefone',
    responsavel_financeiro: 'responsavel_financeiro',
  },
  observacoes: [
    'Sai do portal como .xls ANTIGO (BIFF), não xlsx nem HTML. Importe como veio — reabrir no Excel para converter destrói número de apólice longo.',
    'O cabeçalho não está na primeira linha: vem depois do título e dos filtros. A leitura procura a linha pelo conteúdo.',
    'Toda linha entra como ATRASADA — é o recorte do próprio relatório.',
    'Segurado e telefone vêm SEM máscara, ao contrário do relatório de apólices. É por aqui que nome e contato entram.',
    'Existe uma versão por produto (Vida Individual, Vida Empresarial). O mesmo layout lê as duas.',
  ],
};
