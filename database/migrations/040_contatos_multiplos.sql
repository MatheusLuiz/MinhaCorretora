-- 040 — Vários telefones e e-mails por cliente: a chave passa a ser o número/endereço no cliente.
-- A importação continua acrescentando só o tipo que falta (regra no repositório).

USE `minhacorretora_bi`;

-- Remove o mesmo número gravado em dois tipos; fica o de menor id.
DELETE t1 FROM `telefones` t1
  JOIN `telefones` t2
    ON t2.`cliente_id` = t1.`cliente_id`
   AND t2.`completo`   = t1.`completo`
   AND t2.`id`         < t1.`id`;

DELETE e1 FROM `emails` e1
  JOIN `emails` e2
    ON e2.`cliente_id` = e1.`cliente_id`
   AND e2.`endereco`   = e1.`endereco`
   AND e2.`id`         < e1.`id`;

-- A chave nova entra ANTES de a antiga sair: a FK de `cliente_id` precisa de um índice.
ALTER TABLE `telefones`
  MODIFY `tipo` ENUM('celular','residencial','comercial','opcional','whatsapp','recado') NOT NULL,
  ADD COLUMN `observacao` VARCHAR(80) NULL COMMENT 'Anotação do operador: com quem falar, horário' AFTER `completo`,
  ADD UNIQUE KEY `uq_telefones_cliente_numero` (`cliente_id`, `completo`);

ALTER TABLE `telefones` DROP INDEX `uq_telefones_cliente_tipo`;

ALTER TABLE `emails`
  MODIFY `tipo` ENUM('pessoal','comercial','financeiro','outro') NOT NULL,
  ADD COLUMN `observacao` VARCHAR(80) NULL COMMENT 'Anotação do operador' AFTER `endereco`,
  ADD UNIQUE KEY `uq_emails_cliente_endereco` (`cliente_id`, `endereco`);

ALTER TABLE `emails` DROP INDEX `uq_emails_cliente_tipo`;
