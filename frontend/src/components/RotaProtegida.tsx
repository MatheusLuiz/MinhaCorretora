import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { TrocaSenhaObrigatoriaPage } from '@/pages/TrocaSenhaObrigatoriaPage';

interface Props {
  children: React.JSX.Element;
  /** Se informado, exige ao menos uma destas permissões. */
  permissoes?: string[];
}

/** Guarda de rota — usabilidade, não segurança (quem protege é `exigirPermissao` no backend). */
export function RotaProtegida({ children, permissoes }: Props): React.JSX.Element {
  const { usuario, carregando, temPermissao } = useAuth();
  const local = useLocation();

  if (carregando) {
    return (
      <div className="carregando-tela" role="status" aria-live="polite">
        Carregando…
      </div>
    );
  }

  if (!usuario) {
    // `state` guarda de onde a pessoa veio, para voltar ao destino após o login.
    return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  }

  // Contraparte de exigirTrocaDeSenha no servidor: senão toda tela receberia 403.
  if (usuario.precisaTrocarSenha) {
    return <TrocaSenhaObrigatoriaPage />;
  }

  if (permissoes?.length && !temPermissao(...permissoes)) {
    return <Navigate to="/sem-acesso" replace />;
  }

  return children;
}
