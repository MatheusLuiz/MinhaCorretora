import { useContext } from 'react';

import { AuthContext, type AuthContextValor } from '@/contexts/AuthContext';

export function useAuth(): AuthContextValor {
  const contexto = useContext(AuthContext);

  if (!contexto) {
    throw new Error('useAuth precisa estar dentro de <AuthProvider>.');
  }

  return contexto;
}
