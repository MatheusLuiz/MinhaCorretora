-- 041 — A listagem mostra o contato PRINCIPAL (subconsulta, não join por tipo, que duplicaria
-- o cliente). A coluna segue `celular` para não mudar o contrato.

USE `minhacorretora_bi`;

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
  (SELECT e.`endereco` FROM `emails` e
    WHERE e.`cliente_id` = c.`id`
    ORDER BY e.`principal` DESC, e.`id` LIMIT 1) AS `email`,
  (SELECT t.`completo` FROM `telefones` t
    WHERE t.`cliente_id` = c.`id`
    ORDER BY t.`principal` DESC, t.`id` LIMIT 1) AS `celular`,
  m.`nome`       AS `cidade`,
  m.`uf`         AS `uf`,
  s.`nome`       AS `seguradora`,
  p.`nome`       AS `produtor`,
  c.`produtor_id`
FROM `clientes` c
LEFT JOIN `situacoes_cliente` sit ON sit.`id` = c.`situacao_id`
LEFT JOIN `enderecos` en ON en.`cliente_id` = c.`id` AND en.`tipo` = 'principal'
LEFT JOIN `municipios` m ON m.`id` = en.`municipio_id`
LEFT JOIN `produtores` p ON p.`id` = c.`produtor_id`
LEFT JOIN `seguradoras_clientes` sc
       ON sc.`id` = (
            SELECT MIN(sc2.`id`) FROM `seguradoras_clientes` sc2
             WHERE sc2.`cliente_id` = c.`id`
          )
LEFT JOIN `seguradoras` s ON s.`id` = sc.`seguradora_id`;
