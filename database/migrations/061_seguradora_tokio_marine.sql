-- 061 — Cadastra a Tokio Marine com a `chave` que os layouts referenciam.

USE `minhacorretora_bi`;

INSERT INTO `seguradoras` (`nome`, `chave`, `ativa`)
VALUES ('Tokio Marine', 'tokio-marine', 1)
ON DUPLICATE KEY UPDATE
  `chave` = COALESCE(`seguradoras`.`chave`, VALUES(`chave`));
