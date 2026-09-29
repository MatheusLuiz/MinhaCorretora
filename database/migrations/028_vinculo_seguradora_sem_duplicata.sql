-- 028 — Remove vínculos cliente↔seguradora duplicados (NULL não colide no índice único).
-- Sem coluna gerada: o MySQL não aceita STORED sobre coluna de FK com SET NULL; a inserção
-- verifica com `<=>`.

USE `minhacorretora_bi`;

-- Mantém a linha de MENOR id de cada grupo.
DELETE sc FROM `seguradoras_clientes` sc
  JOIN (
    SELECT MIN(`id`) AS manter, `cliente_id`, `seguradora_id`,
           COALESCE(`ramo_id`, 0) AS ramo, COALESCE(`modalidade_id`, 0) AS modalidade
      FROM `seguradoras_clientes`
     GROUP BY `cliente_id`, `seguradora_id`, COALESCE(`ramo_id`, 0), COALESCE(`modalidade_id`, 0)
    HAVING COUNT(*) > 1
  ) d
    ON  sc.`cliente_id`            = d.`cliente_id`
    AND sc.`seguradora_id`         = d.`seguradora_id`
    AND COALESCE(sc.`ramo_id`, 0)       = d.`ramo`
    AND COALESCE(sc.`modalidade_id`, 0) = d.`modalidade`
    AND sc.`id` <> d.`manter`;
