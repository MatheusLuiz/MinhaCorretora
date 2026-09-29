-- 014 — Carteira por corretor. `clientes.todos` (positiva) libera a base inteira; sem ela, só
-- os produtores vinculados ao usuário (N:N). Na inadimplência, cliente com 2+ atrasos sai
-- da lista do corretor (vira cobrança); `inadimplencia.completa` vê tudo.

USE `minhacorretora_bi`;

-- Papéis novos
INSERT INTO `papeis` (`chave`, `nome`, `descricao`) VALUES
  ('financeiro', 'Financeiro / Cobrança',
   'Toda a inadimplência e a comissão da corretora, sem gestão do sistema'),
  ('corretor',   'Corretor',
   'Só os clientes dos produtores vinculados a ele')
AS novo
ON DUPLICATE KEY UPDATE
  `nome`      = novo.`nome`,
  `descricao` = novo.`descricao`;

-- Permissões novas
INSERT INTO `permissoes` (`chave`, `descricao`) VALUES
  ('clientes.todos',
   'Ver a base inteira de clientes, e não só a própria carteira'),
  ('inadimplencia.completa',
   'Ver todas as parcelas em atraso, e não só o cliente com um único atraso'),
  ('comissoes.todas',
   'Ver a comissão da corretora inteira'),
  -- Separada de `clientes.gerenciar`: importar espelha o arquivo sobre milhares de cadastros.
  ('importacao.gerenciar',
   'Importar planilhas e desfazer cargas')
AS nova
ON DUPLICATE KEY UPDATE
  `descricao` = nova.`descricao`;

-- Admin: o CROSS JOIN do seed já cobre o que for novo.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  CROSS JOIN `permissoes` pe
 WHERE p.`chave` = 'admin'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Gestor: enxerga a corretora inteira, mas não configura o sistema.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe
    ON pe.`chave` IN ('clientes.todos', 'inadimplencia.completa', 'comissoes.todas')
 WHERE p.`chave` = 'gestor'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Operador já via a base inteira: `clientes.todos` preserva isso.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe ON pe.`chave` = 'clientes.todos'
 WHERE p.`chave` = 'operador'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Financeiro / cobrança: a dívida inteira, de todo mundo.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe
    ON pe.`chave` IN (
      'dashboard.ver', 'relatorios.ler', 'relatorios.exportar',
      'clientes.ler', 'clientes.todos', 'apolices.ler',
      'comissoes.ler', 'comissoes.todas', 'inadimplencia.completa'
    )
 WHERE p.`chave` = 'financeiro'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Corretor: sem `clientes.todos`, `comissoes.todas`, `inadimplencia.completa` e `importacao.gerenciar`.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe
    ON pe.`chave` IN (
      'dashboard.ver', 'relatorios.ler',
      'clientes.ler', 'clientes.gerenciar', 'apolices.ler', 'comissoes.ler'
    )
 WHERE p.`chave` = 'corretor'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Quem já importava continua podendo (a permissão foi separada de `clientes.gerenciar`).
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT pp.`papel_id`, novo.`id`
  FROM `papel_permissoes` pp
  JOIN `permissoes` antiga ON antiga.`id` = pp.`permissao_id`
  JOIN `permissoes` novo   ON novo.`chave` = 'importacao.gerenciar'
  JOIN `papeis` p          ON p.`id` = pp.`papel_id`
 WHERE antiga.`chave` = 'clientes.gerenciar'
   AND p.`chave` <> 'corretor'
ON DUPLICATE KEY UPDATE `papel_permissoes`.`papel_id` = `papel_permissoes`.`papel_id`;

-- O mesmo para as exceções por usuário.
INSERT INTO `usuario_permissoes` (`usuario_id`, `permissao_id`, `concedida`, `motivo`)
SELECT up.`usuario_id`, novo.`id`, 1,
       'Herdado de clientes.gerenciar na separação da permissão de importação'
  FROM `usuario_permissoes` up
  JOIN `permissoes` antiga ON antiga.`id` = up.`permissao_id`
  JOIN `permissoes` novo   ON novo.`chave` = 'importacao.gerenciar'
 WHERE antiga.`chave` = 'clientes.gerenciar'
   AND up.`concedida` = 1
ON DUPLICATE KEY UPDATE `usuario_permissoes`.`usuario_id` = `usuario_permissoes`.`usuario_id`;

-- Quais produtores cada usuário responde
CREATE TABLE IF NOT EXISTS `usuario_produtores` (
  `usuario_id`  BIGINT UNSIGNED   NOT NULL,
  `produtor_id` INT UNSIGNED      NOT NULL,
  `criado_em`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`usuario_id`, `produtor_id`),
  KEY `ix_usuario_produtores_produtor` (`produtor_id`),

  CONSTRAINT `fk_usuprod_usuario`
    FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_usuprod_produtor`
    FOREIGN KEY (`produtor_id`) REFERENCES `produtores` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC
  COMMENT='Por quais códigos de produtor cada usuário responde';

-- A listagem passa a expor `produtor_id`: o recorte compara ID, não nome.
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
  p.`nome`       AS `produtor`,
  c.`produtor_id`
FROM `clientes` c
LEFT JOIN `situacoes_cliente` sit ON sit.`id` = c.`situacao_id`
LEFT JOIN `emails`    e  ON e.`cliente_id` = c.`id` AND e.`tipo` = 'pessoal'
LEFT JOIN `telefones` t  ON t.`cliente_id` = c.`id` AND t.`tipo` = 'celular'
LEFT JOIN `enderecos` en ON en.`cliente_id` = c.`id` AND en.`tipo` = 'principal'
LEFT JOIN `municipios` m ON m.`id` = en.`municipio_id`
LEFT JOIN `produtores` p ON p.`id` = c.`produtor_id`
LEFT JOIN `seguradoras_clientes` sc
       ON sc.`id` = (
            SELECT MIN(sc2.`id`) FROM `seguradoras_clientes` sc2
             WHERE sc2.`cliente_id` = c.`id`
          )
LEFT JOIN `seguradoras` s ON s.`id` = sc.`seguradora_id`;

-- Inadimplência com o produtor e `atrasos_do_cliente` (decide se a linha some para o corretor).
CREATE OR REPLACE VIEW `vw_inadimplencia` AS
SELECT
  a.`cliente_id`,
  c.`produtor_id`,
  a.`id`     AS `apolice_id`,
  a.`numero` AS `apolice`,
  a.`nome_segurado`,
  s.`nome` AS `seguradora`,
  pr.`nome` AS `produto`,
  pa.`numero` AS `parcela`,
  pa.`vencimento`,
  pa.`valor`,
  pa.`forma_pagamento`,
  pa.`motivo_rejeicao`,
  DATEDIFF(CURDATE(), pa.`vencimento`) AS `dias_em_atraso`,
  -- Atrasos do CLIENTE, em todas as apólices. Apólice sem cliente conta só os dela
  -- (com `<=>` as órfãs virariam um único "cliente").
  (SELECT COUNT(*)
     FROM `parcelas` pa2
     JOIN `apolices` a2 ON a2.`id` = pa2.`apolice_id`
    WHERE pa2.`status` = 'atrasado'
      AND (
        (a.`cliente_id` IS NOT NULL AND a2.`cliente_id` = a.`cliente_id`)
        OR (a.`cliente_id` IS NULL AND a2.`id` = a.`id`)
      )) AS `atrasos_do_cliente`
FROM `parcelas` pa
JOIN `apolices` a    ON a.`id` = pa.`apolice_id`
JOIN `seguradoras` s ON s.`id` = a.`seguradora_id`
LEFT JOIN `clientes` c ON c.`id` = a.`cliente_id`
LEFT JOIN `produtos` pr ON pr.`id` = a.`produto_id`
WHERE pa.`status` = 'atrasado';
