-- ============================================================================
-- Usuários de banco — privilégio mínimo. Rode UMA vez por ambiente, como root/DBA.
-- A aplicação nunca conecta como root.
-- Antes: troque 'TROQUE_POR_UMA_SENHA_FORTE' por senha aleatória de 32+ caracteres
-- (`openssl rand -base64 32`) e use a mesma em backend/.env (DB_PASSWORD).
-- ============================================================================

-- 1. Usuário da aplicação (caching_sha2_password, padrão do MySQL 8.4).
CREATE USER IF NOT EXISTS 'minhacorretora_bi_app'@'%'
  IDENTIFIED WITH caching_sha2_password BY 'TROQUE_POR_UMA_SENHA_FORTE'
  -- REQUIRE SSL: obrigatório com rede no meio; dispensável só por socket local.
  REQUIRE SSL
  -- Limita o estrago de credencial vazada. Ordem obrigatória das cláusulas:
  -- IDENTIFIED → REQUIRE → WITH <recursos> → <opções de senha>.
  WITH MAX_USER_CONNECTIONS 30
  -- Contenção de força bruta na própria porta do banco.
  FAILED_LOGIN_ATTEMPTS 5 PASSWORD_LOCK_TIME 1;

-- 2. Só DML, só no schema do BI. Ausentes de propósito: CREATE/ALTER/DROP (migration usa
-- outro usuário), GRANT OPTION, FILE (SQLi → arquivo), SUPER/PROCESS, EXECUTE.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `minhacorretora_bi`.*
  TO 'minhacorretora_bi_app'@'%';

-- 3. Usuário de migration (só no deploy). REQUIRE SSL obrigatório em produção; sem ele
-- apenas no ambiente local com DB_SSL=false.
CREATE USER IF NOT EXISTS 'minhacorretora_bi_migrator'@'localhost'
  IDENTIFIED WITH caching_sha2_password BY 'TROQUE_POR_OUTRA_SENHA_FORTE'
  REQUIRE SSL
  WITH MAX_USER_CONNECTIONS 3;

GRANT SELECT, INSERT, UPDATE, DELETE,
      CREATE, ALTER, DROP, INDEX, REFERENCES
  ON `minhacorretora_bi`.*
  TO 'minhacorretora_bi_migrator'@'localhost';

FLUSH PRIVILEGES;

-- 4. Conferência:
-- SHOW GRANTS FOR 'minhacorretora_bi_app'@'%';
-- SHOW GRANTS FOR 'minhacorretora_bi_migrator'@'localhost';
-- O app deve ter só USAGE em *.* e SELECT, INSERT, UPDATE, DELETE em `minhacorretora_bi`.*.
-- ALL PRIVILEGES, GRANT OPTION ou qualquer outra coisa em *.*: revise.

-- 5. Em produção, restrinja o host do app ao IP/faixa do servidor de aplicação:
--   RENAME USER 'minhacorretora_bi_app'@'%' TO 'minhacorretora_bi_app'@'10.0.1.%';
