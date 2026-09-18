-- 002 — Nome e sobrenome separados (ordenação por sobrenome) e data de nascimento do usuário.

USE `minhacorretora_bi`;

ALTER TABLE `usuarios`
  ADD COLUMN `sobrenome` VARCHAR(150) NULL AFTER `nome`,
  ADD COLUMN `data_nascimento` DATE NULL AFTER `sobrenome`;

-- DATE, não DATETIME: conversão de fuso poderia mudar o dia.

-- Registros existentes ficam com sobrenome NULL: dividir o `nome` automaticamente erraria.

ALTER TABLE `usuarios`
  ADD INDEX `ix_usuarios_sobrenome` (`sobrenome`);
