import { create } from 'zustand';
import type { DbConnection, DbDriver, DbTableSchema } from '@fireeyeaud/shared';
import {
  createDbConnection,
  deleteDbConnection,
  listDbConnections,
  reflectDbConnection,
  setDbAuthorization,
  testDbConnection,
  type DbConnectionInput,
} from '../lib/api';

interface DatabaseState {
  items: DbConnection[];
  loading: boolean;
  errorKey: string | null;
  reflectByConn: Record<string, DbTableSchema[]>;
  authByConn: Record<string, Record<string, string[]>>;
  load: () => Promise<void>;
  create: (input: DbConnectionInput) => Promise<boolean>;
  remove: (id: string, scope: DbConnection['scope']) => Promise<void>;
  test: (id: string, scope: DbConnection['scope']) => Promise<boolean>;
  reflect: (id: string, scope: DbConnection['scope']) => Promise<void>;
  setAuthDraft: (id: string, tables: Record<string, string[]>) => void;
  saveAuthorization: (
    id: string,
    tables: Record<string, string[]>,
  ) => Promise<void>;
  reset: () => void;
}

export const useDatabaseStore = create<DatabaseState>((set, get) => ({
  items: [],
  loading: false,
  errorKey: null,
  reflectByConn: {},
  authByConn: {},

  load: async () => {
    set({ loading: true, errorKey: null });
    try {
      const page = await listDbConnections();
      set({ items: page.items, loading: false });
    } catch (err) {
      set({
        loading: false,
        errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal',
      });
    }
  },

  create: async (input) => {
    set({ errorKey: null });
    try {
      await createDbConnection(input);
      await get().load();
      return true;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  remove: async (id, scope) => {
    await deleteDbConnection(id, scope);
    await get().load();
  },

  test: async (id, scope) => {
    set({ errorKey: null });
    try {
      const res = await testDbConnection(id, scope);
      return res.ok;
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
      return false;
    }
  },

  reflect: async (id, scope) => {
    set({ errorKey: null });
    try {
      const res = await reflectDbConnection(id, scope);
      set((s) => ({
        reflectByConn: { ...s.reflectByConn, [id]: res.schema ?? [] },
        authByConn: { ...s.authByConn, [id]: res.authorization ?? {} },
      }));
    } catch (err) {
      set({ errorKey: (err as { messageKey?: string }).messageKey ?? 'error.internal' });
    }
  },

  setAuthDraft: (id, tables) =>
    set((s) => ({ authByConn: { ...s.authByConn, [id]: tables } })),

  saveAuthorization: async (id, tables) => {
    await setDbAuthorization(id, tables);
    set((s) => ({ authByConn: { ...s.authByConn, [id]: tables } }));
  },

  reset: () =>
    set({ items: [], loading: false, errorKey: null, reflectByConn: {}, authByConn: {} }),
}));

export type { DbDriver };
