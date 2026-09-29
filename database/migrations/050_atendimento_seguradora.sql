-- 050 — O atendimento grava a seguradora da apólice ativa: a apólice pode ser desfeita
-- por uma carga (SET NULL) sem o contato perder a companhia.

USE `minhacorretora_bi`;

ALTER TABLE `atendimentos`
  ADD COLUMN `seguradora_id` SMALLINT UNSIGNED NULL
    COMMENT 'Companhia da apólice ativa do assunto; NULL = cliente sem apólice ativa'
    AFTER `apolice_id`,
  ADD KEY `ix_atendimentos_seguradora` (`seguradora_id`),
  ADD CONSTRAINT `fk_atendimentos_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`);
