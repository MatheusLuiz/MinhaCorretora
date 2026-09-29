-- 032 — Cadastra a Suhai com `chave` (o importador recusa layout de companhia não cadastrada).
-- ON DUPLICATE KEY: se já foi cadastrada pela tela, só ganha a chave.

USE `minhacorretora_bi`;

INSERT INTO `seguradoras` (`nome`, `chave`, `ativa`)
VALUES ('Suhai', 'suhai', 1)
ON DUPLICATE KEY UPDATE
  `chave` = COALESCE(`seguradoras`.`chave`, VALUES(`chave`));
