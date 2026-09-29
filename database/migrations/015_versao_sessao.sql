-- 015 — Versão da sessão no JWT: invalida na hora os access tokens já emitidos.
ALTER TABLE usuarios
  ADD COLUMN sessao_versao INT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Incrementada ao revogar acessos; invalida JWTs anteriores';
