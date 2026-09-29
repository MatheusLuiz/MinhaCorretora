-- 047 — Visão geral padrão POR PAPEL (dado do papel, não `if` no código).
-- Só a coluna: os valores vêm no seed 007.

USE `minhacorretora_bi`;

ALTER TABLE `papeis`
  ADD COLUMN `visao_geral` JSON NULL
    COMMENT 'Ids do catálogo de widgets, em ordem — o padrão da visão geral de quem tem este papel';
