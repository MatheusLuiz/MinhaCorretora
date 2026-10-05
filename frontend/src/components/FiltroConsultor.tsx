import { useEffect, useState } from 'react';

import { paineisApi, type Consultor } from '@/lib/paineis';

/**
 * Filtro por consultor. A lista vem do servidor já recortada pela carteira; o
 * valor mora na URL (`?produtor=<id>`) para gaveta e fila levarem o mesmo recorte.
 */

// Uma busca só: o dashboard e a fila usam a mesma lista.
let emCache: Promise<{ consultores: Consultor[]; baseInteira: boolean }> | null = null;

export function FiltroConsultor({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (produtor: string) => void;
}): React.JSX.Element | null {
  const [lista, setLista] = useState<{ consultores: Consultor[]; baseInteira: boolean } | null>(null);

  useEffect(() => {
    let cancelado = false;
    emCache ??= paineisApi.consultores().catch((e: unknown) => {
      emCache = null;
      throw e;
    });
    emCache.then((r) => !cancelado && setLista(r)).catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, []);

  if (!lista) return null;
  // Corretor com um produtor só: o filtro não teria o que escolher.
  if (!lista.baseInteira && lista.consultores.length <= 1) return null;

  return (
    <label>
      <span>Consultor</span>
      <select value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">{lista.baseInteira ? 'Todos' : 'Toda a minha carteira'}</option>
        {lista.consultores.map((c) => (
          <option key={c.id} value={String(c.id)}>
            {c.nome}
            {c.ativo ? '' : ' (inativo)'}
          </option>
        ))}
      </select>
    </label>
  );
}
