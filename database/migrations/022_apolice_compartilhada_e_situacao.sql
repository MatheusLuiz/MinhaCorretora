-- 022 — Apólice com mais de um segurado e situação do cliente derivada.

USE `minhacorretora_bi`;

-- 1. Número de apólice não identifica UMA pessoa: a chave passa a incluir o documento.
-- A coluna gerada usa COALESCE(...,'') porque vários NULL não colidem num índice único.
ALTER TABLE `apolices`
  ADD COLUMN `documento_chave` VARCHAR(14)
    AS (COALESCE(`documento_segurado`, '')) STORED
    COMMENT 'Só existe para a chave única aceitar segurado ausente sem abrir duplicata';

ALTER TABLE `apolices`
  DROP INDEX `uq_apolices_seguradora_numero`,
  ADD UNIQUE KEY `uq_apolices_seguradora_numero_segurado`
    (`seguradora_id`, `numero`, `documento_chave`);

-- 2. Situação derivada (nenhum arquivo a traz): ativo/inativo pela apólice vigente.
-- `saida_em` fica NULL: marcar hoje inventaria saídas em massa neste mês.
ALTER TABLE `clientes`
  ADD COLUMN `situacao_origem` ENUM('derivada', 'manual') NOT NULL DEFAULT 'derivada'
    COMMENT 'manual = alguém definiu na tela; o recálculo automático não sobrescreve'
    AFTER `situacao_em`;

-- O recálculo varre a base por situação.
ALTER TABLE `clientes`
  ADD KEY `ix_clientes_situacao_origem` (`situacao_origem`, `situacao_id`);
