-- 016 — Comissão na apólice (o que o contrato gera). Não soma com `comissoes` (o que a
-- seguradora pagou no mês). DECIMAL(7,4) no percentual: há casos de 0,01%.

USE `minhacorretora_bi`;

ALTER TABLE `apolices`
  ADD COLUMN `comissao` DECIMAL(15,2) NULL
    COMMENT 'Comissão esperada da corretora nesta apólice' AFTER `premio_liquido`,
  ADD COLUMN `percentual_comissao` DECIMAL(7,4) NULL
    COMMENT 'Percentual aplicado sobre o prêmio' AFTER `comissao`;

-- Soma de comissão por cliente.
ALTER TABLE `apolices`
  ADD KEY `ix_apolices_cliente_comissao` (`cliente_id`, `comissao`);
