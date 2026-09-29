-- 023 — Situação "sem apólice conhecida": cliente sem apólice importada não é inativo.
-- Conta como carteira.

USE `minhacorretora_bi`;

INSERT INTO `situacoes_cliente` (`chave`, `nome`, `descricao`, `conta_como_carteira`, `e_saida`, `ordem`)
VALUES (
  'sem_apolice_conhecida',
  'Sem apólice conhecida',
  'É cliente, mas nenhuma apólice dele foi importada — não dá para afirmar se está vigente',
  1,
  0,
  5
)
ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `descricao` = VALUES(`descricao`);
