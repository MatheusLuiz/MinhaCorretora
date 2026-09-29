-- 033 — Converte nomes de cliente, segurado e cidade para CAIXA ALTA (regra: `nomeEmCaixaAlta`).
-- Nome MASCARADO fica como está: em caixa alta sairia da detecção (por isso `utf8mb4_bin`).

USE `minhacorretora_bi`;

UPDATE `clientes`
   SET `nome` = UPPER(`nome`)
 WHERE `nome` COLLATE utf8mb4_bin <> UPPER(`nome`) COLLATE utf8mb4_bin
   AND `nome` COLLATE utf8mb4_bin NOT REGEXP '(^|[^[:alpha:]])X{2,}[a-z]';

UPDATE `clientes`
   SET `nome_social` = UPPER(`nome_social`)
 WHERE `nome_social` IS NOT NULL
   AND `nome_social` COLLATE utf8mb4_bin <> UPPER(`nome_social`) COLLATE utf8mb4_bin
   AND `nome_social` COLLATE utf8mb4_bin NOT REGEXP '(^|[^[:alpha:]])X{2,}[a-z]';

UPDATE `apolices`
   SET `nome_segurado` = UPPER(`nome_segurado`)
 WHERE `nome_segurado` COLLATE utf8mb4_bin <> UPPER(`nome_segurado`) COLLATE utf8mb4_bin
   AND `nome_segurado` COLLATE utf8mb4_bin NOT REGEXP '(^|[^[:alpha:]])X{2,}[a-z]';

UPDATE `segurados`
   SET `nome` = UPPER(`nome`)
 WHERE `nome` IS NOT NULL
   AND `nome` COLLATE utf8mb4_bin <> UPPER(`nome`) COLLATE utf8mb4_bin
   AND `nome` COLLATE utf8mb4_bin NOT REGEXP '(^|[^[:alpha:]])X{2,}[a-z]';

UPDATE `municipios`
   SET `nome` = UPPER(`nome`), `uf` = UPPER(`uf`)
 WHERE `nome` COLLATE utf8mb4_bin <> UPPER(`nome`) COLLATE utf8mb4_bin
    OR `uf` COLLATE utf8mb4_bin <> UPPER(`uf`) COLLATE utf8mb4_bin;
