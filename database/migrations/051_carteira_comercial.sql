-- 051 — Grupo de cliente (de quem o cliente é comercialmente; ≠ `origem_sistema`).
-- Vira cadastro na 057. DEFAULT 'corretora'.

USE `minhacorretora_bi`;

ALTER TABLE `clientes`
  ADD COLUMN `carteira_comercial` VARCHAR(40) NOT NULL DEFAULT 'corretora'
    COMMENT 'Grupo de cliente (chave; cadastro na 057)'
    AFTER `origem_sistema`,
  ADD KEY `ix_clientes_carteira_comercial` (`carteira_comercial`);
