-- 006 — Situação do cliente (tabela, não ENUM). `conta_como_carteira` guarda a regra de
-- negócio junto da situação, em vez de repeti-la em cada consulta.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `situacoes_cliente` (
  `id`    TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chave` VARCHAR(30) NOT NULL COMMENT 'Identificador estável usado no código',
  `nome`  VARCHAR(40) NOT NULL COMMENT 'Como aparece na tela',
  `descricao` VARCHAR(160) NULL,

  -- Entra na contagem de carteira ativa (inadimplente conta).
  `conta_como_carteira` TINYINT(1) NOT NULL DEFAULT 0,

  -- Saída da carteira; alimenta "perdidos no ano".
  `e_saida` TINYINT(1) NOT NULL DEFAULT 0,

  `ordem`     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `criado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_situacoes_cliente_chave` (`chave`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Em que ponto da relação com a corretora o cliente está';

INSERT INTO `situacoes_cliente` (`chave`, `nome`, `descricao`, `conta_como_carteira`, `e_saida`, `ordem`) VALUES
  ('prospecto',    'Prospecto',    'Ainda não é cliente — contato, indicação ou cotação em andamento', 0, 0, 1),
  ('ativo',        'Ativo',        'Tem seguro vigente pela corretora',                                 1, 0, 2),
  ('inadimplente', 'Inadimplente', 'Cliente com parcela em atraso — segue na carteira',                 1, 0, 3),
  ('inativo',      'Inativo',      'Já foi cliente e não tem mais seguro vigente',                      0, 1, 4)
AS nova
ON DUPLICATE KEY UPDATE
  `nome`                = nova.`nome`,
  `descricao`           = nova.`descricao`,
  `conta_como_carteira` = nova.`conta_como_carteira`,
  `e_saida`             = nova.`e_saida`,
  `ordem`               = nova.`ordem`;

-- `situacao_em`: desde quando está na situação. `saida_em`: quando saiu (perdidos no ano).
ALTER TABLE `clientes`
  ADD COLUMN `situacao_id` TINYINT UNSIGNED NULL AFTER `autoriza_contato`,
  ADD COLUMN `situacao_em` DATE NULL COMMENT 'Desde quando está na situação atual' AFTER `situacao_id`,
  ADD COLUMN `saida_em`    DATE NULL COMMENT 'Quando deixou a carteira' AFTER `situacao_em`,
  ADD KEY `ix_clientes_situacao` (`situacao_id`),
  ADD CONSTRAINT `fk_clientes_situacao` FOREIGN KEY (`situacao_id`)
    REFERENCES `situacoes_cliente` (`id`) ON DELETE SET NULL;

-- Os já existentes são carteira ativa; `situacao_em` = quando viraram clientes.
UPDATE `clientes` c
   JOIN `situacoes_cliente` s ON s.`chave` = 'ativo'
    SET c.`situacao_id` = s.`id`,
        c.`situacao_em` = COALESCE(c.`cliente_desde`, DATE(c.`criado_em`))
  WHERE c.`situacao_id` IS NULL;

-- A view da listagem passa a expor a situação.
CREATE OR REPLACE VIEW `vw_clientes_listagem` AS
SELECT
  c.`id`,
  c.`uuid`,
  c.`origem_sistema`,
  c.`cpf_cnpj`,
  c.`cpf_cnpj_numeros`,
  c.`tipo_pessoa`,
  c.`nome`,
  c.`nome_social`,
  c.`vip`,
  sit.`chave` AS `situacao_chave`,
  sit.`nome`  AS `situacao`,
  e.`endereco`   AS `email`,
  t.`completo`   AS `celular`,
  m.`nome`       AS `cidade`,
  m.`uf`         AS `uf`,
  s.`nome`       AS `seguradora`,
  p.`nome`       AS `produtor`
FROM `clientes` c
LEFT JOIN `situacoes_cliente` sit ON sit.`id` = c.`situacao_id`
LEFT JOIN `emails`    e  ON e.`cliente_id` = c.`id` AND e.`tipo` = 'pessoal'
LEFT JOIN `telefones` t  ON t.`cliente_id` = c.`id` AND t.`tipo` = 'celular'
LEFT JOIN `enderecos` en ON en.`cliente_id` = c.`id` AND en.`tipo` = 'principal'
LEFT JOIN `municipios` m ON m.`id` = en.`municipio_id`
LEFT JOIN `produtores` p ON p.`id` = c.`produtor_id`
-- Várias seguradoras por cliente: o MIN(id) torna a escolha estável.
LEFT JOIN `seguradoras_clientes` sc
       ON sc.`id` = (
            SELECT MIN(sc2.`id`) FROM `seguradoras_clientes` sc2
             WHERE sc2.`cliente_id` = c.`id`
          )
LEFT JOIN `seguradoras` s ON s.`id` = sc.`seguradora_id`;
