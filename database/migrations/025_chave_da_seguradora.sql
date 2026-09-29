-- 025 — `seguradoras.chave`: identificador estável que o layout referencia (o nome vira só
-- rótulo). NULL para companhia criada por coluna de arquivo.

USE `minhacorretora_bi`;

ALTER TABLE `seguradoras`
  ADD COLUMN `chave` VARCHAR(40) NULL
    COMMENT 'Identificador estável que os layouts de importação referenciam'
    AFTER `nome`,
  ADD UNIQUE KEY `uq_seguradoras_chave` (`chave`);

-- As companhias que têm layout, como cadastro (demais dados ficam para a tela).
INSERT INTO `seguradoras` (`nome`, `chave`, `codigo_susep`, `ativa`)
VALUES
  ('Porto Seguro', 'porto-seguro', 'AB123C', 1),
  ('Yelum',        'yelum',        NULL,     1),
  ('Allianz',      'allianz',      NULL,     1)
ON DUPLICATE KEY UPDATE
  `chave` = COALESCE(`seguradoras`.`chave`, VALUES(`chave`)),
  `codigo_susep` = COALESCE(`seguradoras`.`codigo_susep`, VALUES(`codigo_susep`));
