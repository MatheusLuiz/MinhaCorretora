-- Seed — papéis e permissões base. Idempotente. Não cria usuário: o primeiro administrador
-- vem de `npm run db:seed:admin` (hash Argon2id), nunca de senha em SQL.

USE `minhacorretora_bi`;

INSERT INTO `papeis` (`chave`, `nome`, `descricao`) VALUES
  ('admin',      'Administrador', 'Acesso total, incluindo gestão de usuários e configurações'),
  ('gestor',     'Gestor',        'Vê todos os relatórios e indicadores da corretora'),
  ('operador',   'Operador',      'Consulta operacional do dia a dia'),
  ('somente_leitura', 'Consulta', 'Apenas visualização de dashboards')
AS novo
ON DUPLICATE KEY UPDATE
  `nome`      = novo.`nome`,
  `descricao` = novo.`descricao`;

INSERT INTO `permissoes` (`chave`, `descricao`) VALUES
  ('dashboard.ver',       'Visualizar os painéis de BI'),
  ('relatorios.ler',      'Consultar relatórios detalhados'),
  ('relatorios.exportar', 'Exportar relatórios (CSV/XLSX)'),
  ('clientes.ler',        'Consultar dados de clientes'),
  ('apolices.ler',        'Consultar apólices e documentos'),
  ('sinistros.ler',       'Consultar sinistros'),
  ('comissoes.ler',       'Consultar prêmios e comissões'),
  ('usuarios.gerenciar',  'Criar, editar e desativar usuários do BI'),
  ('auditoria.ler',       'Consultar a trilha de auditoria'),
  ('integracao.gerenciar','Configurar seguradoras, integrações e cadastros de apoio')
AS nova
ON DUPLICATE KEY UPDATE
  `descricao` = nova.`descricao`;

-- Admin: tudo.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  CROSS JOIN `permissoes` pe
 WHERE p.`chave` = 'admin'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Gestor: tudo, menos administração do sistema.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe
    ON pe.`chave` IN (
      'dashboard.ver', 'relatorios.ler', 'relatorios.exportar',
      'clientes.ler', 'apolices.ler', 'sinistros.ler', 'comissoes.ler'
    )
 WHERE p.`chave` = 'gestor'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Operador: consulta operacional, sem comissões nem exportação em massa.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe
    ON pe.`chave` IN (
      'dashboard.ver', 'relatorios.ler',
      'clientes.ler', 'apolices.ler', 'sinistros.ler'
    )
 WHERE p.`chave` = 'operador'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;

-- Consulta: só o painel.
INSERT INTO `papel_permissoes` (`papel_id`, `permissao_id`)
SELECT p.`id`, pe.`id`
  FROM `papeis` p
  JOIN `permissoes` pe ON pe.`chave` = 'dashboard.ver'
 WHERE p.`chave` = 'somente_leitura'
ON DUPLICATE KEY UPDATE `papel_id` = `papel_id`;
