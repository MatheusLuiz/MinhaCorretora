import { useEffect } from 'react';

import { CabecalhoPainel } from '@/components/Painel';
import { FormImportacao } from '@/components/importacao/FormImportacao';
import { useAuth } from '@/hooks/useAuth';

/** A tela única de importação: de quem veio, o que é, qual é o arquivo. */
export function ImportarArquivosPage(): React.JSX.Element {
  const { temPermissao } = useAuth();
  const podeGerenciar = temPermissao('importacao.gerenciar');
  // O servidor já manda o catálogo filtrado e recusa o resto.
  const soParcelas = !podeGerenciar && temPermissao('importacao.parcelas');

  useEffect(() => {
    document.title = 'Importar arquivos — MinhaCorretora';
  }, []);

  if (!podeGerenciar && !soParcelas) {
    return (
      <div className="painel">
        <CabecalhoPainel titulo="Importar arquivos" />
        <p className="alerta alerta--aviso">
          Seu perfil pode consultar, mas não importar. Peça a permissão{' '}
          <code>importacao.gerenciar</code> ao administrador.
        </p>
      </div>
    );
  }

  return (
    <div className="painel">
      <CabecalhoPainel
        titulo="Importar arquivos"
        descricao={
          soParcelas
            ? 'Relatórios de parcelas pendentes das seguradoras.'
            : 'Apólices, renovações, cancelamentos, parcelas, comissões e cadastros de clientes.'
        }
      />

      <FormImportacao />
    </div>
  );
}
