-- 019 — Produtor na apólice. `clientes.produtor_id` = dono da CARTEIRA (acesso);
-- `apolices.produtor_id` = quem VENDEU (produção). Divergem de propósito.

USE `minhacorretora_bi`;

ALTER TABLE `apolices`
  ADD COLUMN `produtor_id` INT UNSIGNED NULL
    COMMENT 'Quem VENDEU esta apólice; diferente do produtor da carteira do cliente'
    AFTER `cliente_id`,
  ADD CONSTRAINT `fk_apolices_produtor`
    FOREIGN KEY (`produtor_id`) REFERENCES `produtores` (`id`) ON DELETE SET NULL;

-- Produção e comissão por vendedor num período.
ALTER TABLE `apolices`
  ADD KEY `ix_apolices_produtor_vigencia` (`produtor_id`, `vigencia_inicio`);
