-- 034 — Converte e-mails de cliente e segurado para CAIXA ALTA (regra: `emailEmCaixaAlta`).
-- A máscara do e-mail é detectada sem olhar caixa.

USE `minhacorretora_bi`;

UPDATE `emails`
   SET `endereco` = UPPER(TRIM(`endereco`))
 WHERE `endereco` COLLATE utf8mb4_bin <> UPPER(TRIM(`endereco`)) COLLATE utf8mb4_bin;

UPDATE `segurados`
   SET `email` = UPPER(TRIM(`email`))
 WHERE `email` IS NOT NULL
   AND `email` COLLATE utf8mb4_bin <> UPPER(TRIM(`email`)) COLLATE utf8mb4_bin;
