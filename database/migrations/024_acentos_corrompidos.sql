-- 024 — Conserta acentos corrompidos em papéis e permissões (a 014 foi aplicada pelo
-- cliente `mysql` sem utf8mb4). Migration nova porque migration aplicada não se edita.

USE `minhacorretora_bi`;

UPDATE `papeis`
   SET `nome` = 'Financeiro / Cobrança',
       `descricao` = 'Toda a inadimplência e a comissão da corretora, sem gestão do sistema'
 WHERE `chave` = 'financeiro';

UPDATE `papeis`
   SET `descricao` = 'Só os clientes dos produtores vinculados a ele'
 WHERE `chave` = 'corretor';

UPDATE `permissoes`
   SET `descricao` = 'Ver a base inteira de clientes, e não só a própria carteira'
 WHERE `chave` = 'clientes.todos';

UPDATE `permissoes`
   SET `descricao` = 'Ver todas as parcelas em atraso, e não só o cliente com um único atraso'
 WHERE `chave` = 'inadimplencia.completa';

UPDATE `permissoes`
   SET `descricao` = 'Ver a comissão da corretora inteira'
 WHERE `chave` = 'comissoes.todas';
