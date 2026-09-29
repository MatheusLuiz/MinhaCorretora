-- 043 — Tipos de seguro (cadastro), habilitados por seguradora, e o veículo segurado.
-- `formulario` é lista fechada (cada um tem tabela). Tipo efetivo = COALESCE(apólice, produto).
-- Não é o ramo: ramo é o texto da seguradora; tipo é o vocabulário da corretora.

USE `minhacorretora_bi`;

CREATE TABLE IF NOT EXISTS `tipos_seguro` (
  `id`         SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chave`      VARCHAR(40)  NOT NULL COMMENT 'Estável: é por ela que o código se refere a um tipo',
  `nome`       VARCHAR(60)  NOT NULL,
  `formulario` ENUM('veiculo','imovel','pessoas','equipamento','pet','viagem',
                    'transporte','responsabilidade','consorcio','generico')
               NOT NULL DEFAULT 'generico'
               COMMENT 'O que a tela pede do bem segurado',
  `descricao`  VARCHAR(200) NULL,
  `ativo`      TINYINT(1)   NOT NULL DEFAULT 1,
  `ordem`      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tipos_seguro_chave` (`chave`),
  UNIQUE KEY `uq_tipos_seguro_nome` (`nome`)
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Tipos de seguro que a corretora vende';

-- Lista inicial. "Portáteis" junta celular e notebook.
INSERT IGNORE INTO `tipos_seguro` (`chave`, `nome`, `formulario`, `ordem`, `descricao`) VALUES
  ('auto',               'Auto',                    'veiculo',          10,  NULL),
  ('frota',              'Frota',                   'veiculo',          20,  'Cada veículo da frota é uma apólice própria'),
  ('carta_verde',        'Carta Verde',             'veiculo',          30,  'Responsabilidade civil do veículo no Mercosul'),
  ('residencial',        'Residencial',             'imovel',           40,  NULL),
  ('empresarial',        'Empresarial',             'imovel',           50,  NULL),
  ('patrimonial',        'Patrimonial',             'imovel',           60,  NULL),
  ('fianca',             'Seguro Fiança',           'imovel',           70,  'Garantia de aluguel'),
  ('rc_obra',            'RC Obra',                 'imovel',           80,  'Responsabilidade civil de obra'),
  ('vida',               'Vida',                    'pessoas',          90,  NULL),
  ('acidentes_pessoais', 'Acidentes Pessoais',      'pessoas',          100, NULL),
  ('prestamista',        'Prestamista',             'pessoas',          110, 'Quita a dívida em caso de morte ou invalidez'),
  ('saude',              'Saúde',                   'pessoas',          120, NULL),
  ('previdencia',        'Previdência',             'pessoas',          130, 'PGBL e VGBL'),
  ('portateis',          'Portáteis',               'equipamento',      140, 'Celular, notebook, tablet'),
  ('bicicleta',          'Bicicleta',               'equipamento',      150, NULL),
  ('pet',                'Pet',                     'pet',              160, NULL),
  ('viagem',             'Seguro Viagem',           'viagem',           170, NULL),
  ('transporte',         'Transporte',              'transporte',       180, 'Carga transportada'),
  ('rc',                 'Responsabilidade Civil',  'responsabilidade', 190, NULL),
  ('consorcio',          'Consórcio',               'consorcio',        200, NULL);

-- Quais tipos cada seguradora oferece. Linha presente = habilitado.
CREATE TABLE IF NOT EXISTS `seguradora_tipos_seguro` (
  `seguradora_id`  SMALLINT UNSIGNED NOT NULL,
  `tipo_seguro_id` SMALLINT UNSIGNED NOT NULL,
  `criado_em`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`seguradora_id`, `tipo_seguro_id`),
  KEY `ix_seguradora_tipos_tipo` (`tipo_seguro_id`),
  CONSTRAINT `fk_seguradora_tipos_seguradora` FOREIGN KEY (`seguradora_id`)
    REFERENCES `seguradoras` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_seguradora_tipos_tipo` FOREIGN KEY (`tipo_seguro_id`)
    REFERENCES `tipos_seguro` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Tipos de seguro habilitados por seguradora';

ALTER TABLE `produtos`
  ADD COLUMN `tipo_seguro_id` SMALLINT UNSIGNED NULL AFTER `ramo_id`,
  ADD KEY `ix_produtos_tipo_seguro` (`tipo_seguro_id`),
  ADD CONSTRAINT `fk_produtos_tipo_seguro` FOREIGN KEY (`tipo_seguro_id`)
    REFERENCES `tipos_seguro` (`id`) ON DELETE SET NULL;

ALTER TABLE `apolices`
  ADD COLUMN `tipo_seguro_id` SMALLINT UNSIGNED NULL AFTER `produto_id`,
  ADD KEY `ix_apolices_tipo_seguro` (`tipo_seguro_id`),
  ADD CONSTRAINT `fk_apolices_tipo_seguro` FOREIGN KEY (`tipo_seguro_id`)
    REFERENCES `tipos_seguro` (`id`) ON DELETE SET NULL;

-- Classificação inicial dos produtos existentes (todos auto); o resto se classifica na tela.
UPDATE `produtos` p
  JOIN `seguradoras` s ON s.id = p.seguradora_id
   SET p.tipo_seguro_id = (SELECT id FROM `tipos_seguro` WHERE chave = 'auto')
 WHERE s.chave IN ('suhai', 'bradesco')
   AND p.tipo_seguro_id IS NULL;

-- Item de frota do Bradesco: número `apolice/item`, sem produto.
UPDATE `apolices` a
  JOIN `seguradoras` s ON s.id = a.seguradora_id
   SET a.tipo_seguro_id = (SELECT id FROM `tipos_seguro` WHERE chave = 'frota')
 WHERE s.chave = 'bradesco'
   AND a.numero LIKE '%/%'
   AND a.tipo_seguro_id IS NULL;

INSERT IGNORE INTO `seguradora_tipos_seguro` (`seguradora_id`, `tipo_seguro_id`)
SELECT s.id, t.id
  FROM `seguradoras` s
  JOIN `tipos_seguro` t ON t.chave IN ('auto', 'frota')
 WHERE s.chave = 'bradesco'
UNION ALL
SELECT s.id, t.id
  FROM `seguradoras` s
  JOIN `tipos_seguro` t ON t.chave = 'auto'
 WHERE s.chave = 'suhai';

-- Veículo segurado (formulário `veiculo`), um por apólice. `condutor_*` = principal condutor
-- declarado, não o segurado nem o proprietário.

CREATE TABLE IF NOT EXISTS `apolice_veiculos` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `apolice_id` BIGINT UNSIGNED NOT NULL,

  `placa`          VARCHAR(8)   NULL COMMENT 'Só letras e dígitos; nula no zero km sem emplacamento',
  `chassi`         VARCHAR(20)  NULL,
  `fabricante`     VARCHAR(60)  NULL,
  `modelo`         VARCHAR(120) NULL,
  `ano_fabricacao` SMALLINT UNSIGNED NULL,
  `ano_modelo`     SMALLINT UNSIGNED NULL,
  `codigo_fipe`    VARCHAR(10)  NULL,
  `combustivel`    VARCHAR(30)  NULL,
  `tipo_veiculo`   VARCHAR(40)  NULL COMMENT 'Passeio, SUV, caminhão, moto…',
  `uso`            VARCHAR(60)  NULL COMMENT 'Particular, comercial, aplicativo de transporte…',
  `zero_km`        TINYINT(1)   NULL,
  `antifurto`      VARCHAR(80)  NULL,
  `kit_gas`        TINYINT(1)   NULL,

  `cep_pernoite`     CHAR(8)    NULL,
  `pernoite_garagem` TINYINT(1) NULL,

  `condutor_nome`       VARCHAR(150) NULL,
  `condutor_documento`  VARCHAR(14)  NULL,
  `condutor_nascimento` DATE         NULL,

  `observacoes` VARCHAR(500) NULL,
  `origem`      ENUM('importacao','manual') NOT NULL,

  `criado_em`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `atualizado_em` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_apolice_veiculos_apolice` (`apolice_id`),
  KEY `ix_apolice_veiculos_placa` (`placa`),
  KEY `ix_apolice_veiculos_chassi` (`chassi`),
  CONSTRAINT `fk_apolice_veiculos_apolice` FOREIGN KEY (`apolice_id`)
    REFERENCES `apolices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='Veículo segurado — um por apólice';
