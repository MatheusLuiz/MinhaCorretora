-- Seed 011 — Papéis por função (Pós-venda, Pendências, Sinistros, Financeiro, Endosso), todos
-- com a base inteira (`clientes.todos`). Nenhum gerencia usuário, importa ou configura.

USE `minhacorretora_bi`;

INSERT INTO `papeis` (`chave`, `nome`, `descricao`) VALUES
  ('pos_venda',  'Pós-venda',  'Atende o cliente depois da venda: ficha, apólices, sinistros e atraso da base inteira.'),
  ('pendencias', 'Pendências', 'Cobra documento e cadastro pendente: ficha e apólices da base inteira.'),
  ('sinistros',  'Sinistros',  'Acompanha sinistros e assistências da base inteira.'),
  ('financeiro', 'Financeiro', 'Comissão da corretora inteira e parcelas em atraso.'),
  ('endosso',    'Endosso',    'Alterações em apólice vigente: ficha e apólices da base inteira.')
ON DUPLICATE KEY UPDATE `nome` = VALUES(`nome`), `descricao` = VALUES(`descricao`);

-- A base comum: consultar qualquer cliente e as apólices dele.
INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe ON pe.`chave` IN (
    'dashboard.ver', 'clientes.ler', 'clientes.consultar', 'clientes.todos',
    'apolices.ler', 'relatorios.ler'
  )
 WHERE p.`chave` IN ('pos_venda', 'pendencias', 'sinistros', 'financeiro', 'endosso');

-- O que cada função tem a mais.
INSERT IGNORE INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe
 WHERE (p.`chave` = 'pos_venda'  AND pe.`chave` IN ('sinistros.ler', 'inadimplencia.ler'))
    OR (p.`chave` = 'sinistros'  AND pe.`chave` IN ('sinistros.ler'))
    OR (p.`chave` = 'financeiro' AND pe.`chave` IN (
         'comissoes.ler', 'comissoes.todas', 'inadimplencia.ler', 'inadimplencia.completa',
         'importacao.parcelas', 'relatorios.exportar'));

-- Visão geral de cada um (ids de `frontend/src/widgets/catalogo.ts`).
UPDATE `papeis` SET `visao_geral` = JSON_ARRAY('renov.resumo', 'cli.resumo')  WHERE `chave` = 'pos_venda';
UPDATE `papeis` SET `visao_geral` = JSON_ARRAY('cli.resumo')                  WHERE `chave` = 'pendencias';
UPDATE `papeis` SET `visao_geral` = JSON_ARRAY('ramo.sinistralidade', 'cli.resumo') WHERE `chave` = 'sinistros';
UPDATE `papeis` SET `visao_geral` = JSON_ARRAY('rec.comissao', 'rec.seguradora', 'fin.inadimplencia') WHERE `chave` = 'financeiro';
UPDATE `papeis` SET `visao_geral` = JSON_ARRAY('cli.resumo', 'renov.resumo')  WHERE `chave` = 'endosso';
