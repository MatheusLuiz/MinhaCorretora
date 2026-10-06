-- 062 — `cancelada_mes`: mês do cancelamento quando a origem não dá o dia (Porto). Sempre dia 1;
-- só vale com `cancelada_em` nulo (`utils/cancelamento.ts` junta os dois).

USE `minhacorretora_bi`;

ALTER TABLE `apolices`
  ADD COLUMN `cancelada_mes` DATE NULL AFTER `cancelada_em`;
