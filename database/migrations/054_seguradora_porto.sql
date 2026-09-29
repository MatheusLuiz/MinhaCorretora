-- 054 — Recadastra a Porto Seguro com a chave `porto-seguro` (os layouts dela a exigem).
-- Idempotente; não troca a chave de uma linha que já exista com outro nome.

USE `minhacorretora_bi`;

INSERT INTO `seguradoras` (`nome`, `chave`, `ativa`)
VALUES ('Porto Seguro', 'porto-seguro', 1)
ON DUPLICATE KEY UPDATE
  `chave` = COALESCE(`seguradoras`.`chave`, VALUES(`chave`));
