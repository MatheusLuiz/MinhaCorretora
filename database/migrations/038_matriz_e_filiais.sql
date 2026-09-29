-- 038 — Matriz e filiais: `cnpj_raiz` (8 primeiros dígitos) GERADA do documento; `matriz_id`
-- com SET NULL, para desfazer a carga da matriz não levar as filiais.

USE `minhacorretora_bi`;

ALTER TABLE `clientes`
  ADD COLUMN `cnpj_raiz` CHAR(8)
    GENERATED ALWAYS AS (
      CASE WHEN `tipo_pessoa` = 'J' AND CHAR_LENGTH(`cpf_cnpj_numeros`) = 14
           THEN LEFT(`cpf_cnpj_numeros`, 8) END
    ) STORED
    COMMENT 'Raiz do CNPJ — a empresa, sem o estabelecimento'
    AFTER `tipo_pessoa`,
  ADD COLUMN `matriz_id` BIGINT UNSIGNED NULL
    COMMENT 'Filial → cliente da matriz (CNPJ raiz + 0001)'
    AFTER `cnpj_raiz`,
  ADD KEY `ix_clientes_cnpj_raiz` (`cnpj_raiz`),
  ADD KEY `ix_clientes_matriz` (`matriz_id`),
  ADD CONSTRAINT `fk_clientes_matriz` FOREIGN KEY (`matriz_id`)
    REFERENCES `clientes` (`id`) ON DELETE SET NULL;
