import { CabecalhoPainel } from '@/components/Painel';
import { useAuth } from '@/hooks/useAuth';

/**
 * Fecha uma ROTA por permissão (quem digita o endereço chega nela). Não protege
 * o dado — a API faz isso —, evita uma tela de zeros sem explicação.
 */
export function ExigePermissao({
  permissao,
  children,
}: {
  permissao?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const { temPermissao } = useAuth();

  if (!permissao || temPermissao(permissao)) {
    return <>{children}</>;
  }

  return (
    <div className="painel">
      <CabecalhoPainel titulo="Sem acesso" />
      <p className="alerta alerta--aviso" role="note">
        Seu perfil não tem acesso a esta análise. Ela exige a permissão{' '}
        <code>{permissao}</code> — peça a um administrador se precisar dela.
      </p>
    </div>
  );
}
