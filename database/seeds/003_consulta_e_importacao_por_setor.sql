-- Seed 003 — `clientes.consultar` para todo corretor (busca e ficha de qualquer cliente; o resto
-- segue no recorte da carteira), papel Corretor — Prospecto e `importacao.parcelas` (só
-- parcelas pendentes). O administrador recebe as três.

USE `minhacorretora_bi`;

INSERT INTO `permissoes` (`chave`, `descricao`) VALUES
  ('clientes.consultar',
   'Consultar qualquer cliente (busca e ficha), sem editar fora da própria carteira'),
  ('importacao.parcelas',
   'Importar relatórios de parcelas pendentes das seguradoras'),
  ('importacao.prospectos',
   'Importar a base de prospectos')
ON DUPLICATE KEY UPDATE `descricao` = VALUES(`descricao`);

-- ─── Corretor — Prospecto: base do corretor ───
INSERT INTO `papeis` (`chave`, `nome`, `descricao`) VALUES
  ('corretor_prospecto', 'Corretor — Prospecto',
   'Prospecção. Importa a base de prospectos; consulta a base inteira, edita só a própria carteira.')
ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `descricao` = VALUES(`descricao`);

INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT novo.`id`, pp.`permissao_id`
  FROM `papeis` novo
  JOIN `papeis` base ON base.`chave` = 'corretor_corretora'
  JOIN `papel_permissoes` pp ON pp.`papel_id` = base.`id`
 WHERE novo.`chave` = 'corretor_prospecto';

-- ─── Concessões ───
INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe
    ON (pe.`chave` = 'clientes.consultar'
        AND p.`chave` IN ('corretor_corretora', 'corretor_loja',
                          'corretor_renovacao', 'corretor_prospecto'))
    OR (pe.`chave` = 'importacao.parcelas'   AND p.`chave` = 'parcelas')
    OR (pe.`chave` = 'importacao.prospectos' AND p.`chave` = 'corretor_prospecto')
    OR (pe.`chave` IN ('clientes.consultar', 'importacao.parcelas', 'importacao.prospectos')
        AND p.`chave` = 'admin');
