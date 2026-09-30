import type { LayoutFinanceiro } from '../../../services/modelosFinanceiro.js';

export const BRADESCO_COMISSOES_EXTRATO: LayoutFinanceiro = {
  chave: 'bradesco-comissoes-extrato',
  nome: 'Bradesco — Últimos lançamentos (extrato de comissão)',
  seguradoraChave: 'bradesco',
  seguradora: 'Bradesco',
  entidade: 'comissoes',
  descricao:
    'O extrato de créditos de comissão do portal: um lançamento por empresa do grupo (Auto/RE, Vida e Previdência, Saúde) por dia, com bruto e líquido.',
  // Sai como .xls e é .xlsx por dentro.
  aceita: '.xls,.xlsx',
  competenciaPeloPagamento: true,
  numeroPelaDataEFilial: true,
  impostosPelaDiferenca: true,
  recusarValorZero: true,
  estabelecimentoSoDigitos: true,
  aliases: {
    data_de_lancamento: 'pago_em',
    // A empresa do grupo vira a "filial" (separa Auto/RE, Vida e Saúde).
    empresa: 'filial',
    agencia_conta: 'codigo_estabelecimento',
    credito_bruto_r: 'total_bruto',
    credito_liquido_r: 'total_liquido',
  },
  observacoes: [
    'Importe o arquivo como veio do portal. Não abra no Excel para salvar de novo.',
    'Não traz número de lançamento: cada crédito é identificado pela data e pela empresa do grupo. Reimportar o mesmo período não duplica.',
    'Não traz os impostos em coluna: a retenção é a diferença entre o bruto e o líquido.',
    'Dias com crédito zerado são recusados — não houve pagamento.',
    'Os valores chegam com resíduo de ponto flutuante (2562.610107…) e são arredondados ao centavo.',
    'É o total do crédito, sem apólice nem segurado: não dá para dizer de quem é cada comissão.',
  ],
};

export const BRADESCO_COMISSOES_AUTORE: LayoutFinanceiro = {
  chave: 'bradesco-comissoes-autore',
  nome: 'Bradesco — Detalhe das comissões Auto/RE',
  seguradoraChave: 'bradesco',
  seguradora: 'Bradesco',
  entidade: 'comissoes',
  descricao:
    'O "AUTORE" do portal: a comissão linha a linha — apólice, segurado, ramo, parcela e valor. Pendura cada linha no crédito do extrato em que foi paga.',
  aceita: '.xls,.xlsx',
  // Sem aliases: lido por `importacaoComissaoBradesco`, pelo nome exato das colunas.
  aliases: {},
  observacoes: [
    'Importe ANTES o extrato "Últimos lançamentos" do mesmo período: os créditos vêm dele, e este arquivo só traz o detalhe.',
    'Cada crédito do extrato tem de bater ao centavo com a soma das suas linhas. Se um não bater, nada é gravado.',
    'O lançamento 404 é estorno: entra negativo, mesmo vindo positivo no arquivo.',
    'Linha "COM.PG" com valor zero (comissão paga antes) não entra.',
    'A apólice se liga pelo número quando ele é único na base; item de frota fica sem vínculo, porque o arquivo não diz o veículo.',
  ],
};

export const BRADESCO_COMISSOES_VIDA: LayoutFinanceiro = {
  chave: 'bradesco-comissoes-vida',
  nome: 'Bradesco — Detalhe das comissões Vida e Previdência',
  seguradoraChave: 'bradesco',
  seguradora: 'Bradesco',
  entidade: 'comissoes',
  descricao:
    'O "VIDA" do portal: o mesmo layout do AUTORE, com a comissão de Vida e Previdência linha a linha. Pendura cada linha no crédito VIDA do extrato.',
  aceita: '.xls,.xlsx',
  aliases: {},
  observacoes: [
    'Importe ANTES o extrato "Últimos lançamentos" do mesmo período: os créditos vêm dele, e este arquivo só traz o detalhe.',
    'Cada crédito VIDA do extrato tem de bater ao centavo com a soma das suas linhas. Se um não bater, nada é gravado.',
    'Conferido contra o extrato: com o detalhe e o extrato do mesmo período, todos os créditos VIDA fecham ao centavo.',
  ],
};

export const BRADESCO_COMISSOES_SAUDE: LayoutFinanceiro = {
  chave: 'bradesco-comissoes-saude',
  nome: 'Bradesco — Detalhe das comissões Saúde',
  seguradoraChave: 'bradesco',
  seguradora: 'Bradesco',
  entidade: 'comissoes',
  descricao:
    'O "SAUDESA" do portal: o mesmo layout do AUTORE, com a comissão de Saúde linha a linha. Pendura cada linha no crédito SAUDE do extrato.',
  aceita: '.xls,.xlsx',
  aliases: {},
  observacoes: [
    'Importe ANTES o extrato "Últimos lançamentos" do mesmo período: os créditos vêm dele, e este arquivo só traz o detalhe.',
    'Cada crédito SAUDE do extrato tem de bater ao centavo com a soma das suas linhas. Se um não bater, nada é gravado.',
  ],
};

export const BRADESCO_PARCELAS_PDF: LayoutFinanceiro = {
  chave: 'bradesco-parcelas-pdf',
  nome: 'Bradesco — Parcelas do histórico da apólice (PDF)',
  seguradoraChave: 'bradesco',
  seguradora: 'Bradesco',
  entidade: 'parcelas',
  interno: true,
  descricao: 'Parcelas extraídas do PDF "Histórico da Apólice". Entra junto com a apólice.',
  aliases: {},
  observacoes: [
    'Não é oferecido na tela: entra pelo layout "Bradesco — Histórico da apólice (PDF)".',
    'Parcela "Aberto" com vencimento passado entra como ATRASADA — o portal não distingue.',
  ],
};

export const BRADESCO_APOLICES_A_RENOVAR: LayoutFinanceiro = {
  chave: 'bradesco-apolices-a-renovar',
  nome: 'Bradesco — Apólices a renovar',
  seguradoraChave: 'bradesco',
  seguradora: 'Bradesco',
  entidade: 'renovacoes',
  descricao:
    'A "Lista de Apólices" a renovar do portal (.xls): vencimento, segurado, % de comissão, veículo, placa, sinistros, bônus e prêmio da renovação.',
  // Células mescladas: o valor fica uma ou duas colunas depois do cabeçalho.
  colunasDeslocadas: true,
  aceita: '.xls,.xlsx',
  aliases: {
    fim_vig: 'vigencia_fim',
    segurado: 'nome_segurado',
    sucur: 'sucursal',
    apolice: 'numero_apolice',
    resid: 'tem_residencial',
    ind: 'cotado_outro_corretor',
    agencia: 'agencia',
    comiss: 'percentual_comissao',
    veiculo: 'veiculo',
    placa: 'placa',
    sinistro: 'sinistros',
    bonus: 'classe_bonus',
    premio: 'premio_renovacao',
  },
  observacoes: [
    'Importe o .xls como veio do portal. Não abra no Excel para salvar de novo.',
    'O arquivo não traz CPF: nada é cadastrado. A renovação se liga à apólice quando ela estiver na base (pelo número) ou ao cliente pelo nome, quando só um cliente tiver aquele nome.',
    'É a única fonte do PERCENTUAL DE COMISSÃO do Bradesco. Ligada à apólice, o percentual passa a valer no "a receber" da comissão.',
    'Prêmio "-" é renovação que o portal ainda não calculou.',
    'Reimportar a lista atualiza a mesma renovação (mesma apólice e vencimento), sem duplicar.',
  ],
};

export const BRADESCO_APOLICES_ENCERRADAS: LayoutFinanceiro = {
  chave: 'bradesco-apolices-encerradas',
  nome: 'Bradesco — Apólices encerradas',
  seguradoraChave: 'bradesco',
  seguradora: 'Bradesco',
  entidade: 'encerradas',
  descricao:
    'O "Apólices Individuais - Auto" das encerradas: segurado, apólice, placa, endosso e vigência. Mostra quais voltaram e quais não.',
  // Sai como .xls e é .xlsx por dentro.
  aceita: '.xls,.xlsx',
  aliases: {
    segurado: 'nome_segurado',
    // "639-0 / 251167": sucursal-agência e apólice na mesma célula.
    suc_ag_apolice: 'numero_apolice',
    placa_do_veiculo: 'placa',
    endosso: 'teve_endosso',
    data_da_emissao: 'emitida_em',
    inicio_da_vigencia: 'vigencia_inicio',
    fim_da_vigencia: 'vigencia_fim',
  },
  observacoes: [
    'Importe o arquivo como veio do portal. Não abra no Excel para salvar de novo.',
    'Não traz CPF nem o motivo: nada é cadastrado. A encerrada se liga à apólice pelo número, ou ao cliente pela apólice nova do mesmo veículo, ou pelo nome quando só um cliente o tiver.',
    'RENOVADA = existe na base uma apólice nova do mesmo veículo (placa) começando perto do fim desta. Achada, a nova passa a contar como renovação.',
    'Vigência menor que um ano = encerrada ANTES do prazo (cancelamento ou endosso).',
    'Prazo cheio sem apólice nova na base NÃO quer dizer perdida: a renovação pode só não ter sido importada ainda.',
  ],
};
