import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';
import { paineisApi, type DadosPaineis } from '@/lib/paineis';

/**
 * Carrega os números dos painéis uma vez por tela.
 *
 * Existe como hook, e não como chamada solta em cada página, porque a Visão
 * Geral e os sete painéis temáticos consomem o MESMO payload. Duplicar a busca
 * abriria a porta para uma tela tratar erro e a outra não — e para duas telas
 * divergirem sobre o mesmo número por terem buscado em instantes diferentes.
 */
export function usePaineis(produtor = ''): {
  dados: DadosPaineis | null;
  carregando: boolean;
  erro: string | null;
  recarregar: () => void;
} {
  const [dados, setDados] = useState<DadosPaineis | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => {
    let cancelado = false;

    setCarregando(true);
    setErro(null);

    void paineisApi
      .carregar(produtor)
      .then((d) => {
        if (!cancelado) setDados(d);
      })
      .catch((falha: unknown) => {
        if (cancelado) return;
        setErro(
          falha instanceof ApiError
            ? falha.message
            : 'Não foi possível carregar os números. Verifique sua conexão.',
        );
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [tentativa, produtor]);

  return { dados, carregando, erro, recarregar };
}
