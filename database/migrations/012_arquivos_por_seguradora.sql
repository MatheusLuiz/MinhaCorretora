-- 012 — Arquivo importado guarda a seguradora (caminho: <seguradora>/<AAAA-MM-DD>/...).
-- Nome como TEXTO, não FK: a auditoria não pode mudar se o cadastro mudar.

USE `minhacorretora_bi`;

ALTER TABLE `arquivos_importados`
  ADD COLUMN `seguradora` VARCHAR(60) NULL
    COMMENT 'Companhia de origem do arquivo, como texto fixo' AFTER `entidade`,
  ADD KEY `ix_arquivos_seguradora_data` (`seguradora`, `importado_em`);
