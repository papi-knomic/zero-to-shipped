import { createContext, useContext } from 'react';
import type { User } from './types';

/** Who the app is showing documents for: a signed-in user, or this browser's demo workspace. */
export type Session = { mode: 'user'; user: User } | { mode: 'demo' };

export const SessionContext = createContext<Session>({ mode: 'demo' });

export const useSession = () => useContext(SessionContext);
