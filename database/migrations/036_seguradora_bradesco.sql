-- 036 — Cadastra o Bradesco com `chave` (lido por PDF, um por apólice).
-- CNPJ e SUSEP em branco: o PDF traz os da corretora, não os da companhia.

USE `minhacorretora_bi`;

INSERT INTO `seguradoras` (`nome`, `chave`, `ativa`)
VALUES ('Bradesco', 'bradesco', 1)
ON DUPLICATE KEY UPDATE
  `chave` = COALESCE(`seguradoras`.`chave`, VALUES(`chave`));
