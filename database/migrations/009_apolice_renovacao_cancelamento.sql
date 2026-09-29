-- 009 — Renovação e cancelamento: colunas do formato "carteira" (uma linha por APÓLICE),
-- que não são emissões e não podem virar movimentos.

USE `minhacorretora_bi`;

ALTER TABLE `apolices`
  -- A apólice que renovou esta. NÚMERO, não FK: a nova pode ainda não ter sido importada.
  ADD COLUMN `numero_renovacao` VARCHAR(40) NULL
    COMMENT 'Número da apólice que renovou esta' AFTER `vigencia_fim`,

  ADD COLUMN `cancelada_em` DATE NULL AFTER `numero_renovacao`,
  ADD COLUMN `motivo_cancelamento` VARCHAR(120) NULL AFTER `cancelada_em`,

  ADD KEY `ix_apolices_renovacao` (`numero_renovacao`),
  ADD KEY `ix_apolices_cancelada` (`cancelada_em`);

-- Carteira a renovar: o que vence, quando, e o que já foi renovado (pelo par do relatório).
CREATE OR REPLACE VIEW `vw_apolices_a_renovar` AS
SELECT
  a.`id`,
  a.`uuid`,
  a.`numero`,
  a.`nome_segurado`,
  a.`cliente_id`,
  s.`nome` AS `seguradora`,
  p.`nome` AS `produto`,
  a.`vigencia_inicio`,
  a.`vigencia_fim`,
  a.`premio_total`,
  a.`numero_renovacao`,
  (a.`numero_renovacao` IS NOT NULL) AS `renovada`,
  a.`cancelada_em`,
  DATEDIFF(a.`vigencia_fim`, CURDATE()) AS `dias_para_vencer`
FROM `apolices` a
JOIN `seguradoras` s ON s.`id` = a.`seguradora_id`
LEFT JOIN `produtos` p ON p.`id` = a.`produto_id`
WHERE a.`vigencia_fim` IS NOT NULL
  AND a.`cancelada_em` IS NULL;
