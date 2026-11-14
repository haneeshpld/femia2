import { createContext, useContext } from 'react';

export interface Me { id: string; email: string; name: string; role: string; permissions: string[] }
export const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const useCan = () => { const me = useMe(); return (p: string) => me.permissions.includes(p); };
