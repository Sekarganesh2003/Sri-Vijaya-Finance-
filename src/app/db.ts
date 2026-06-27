export interface FinanceDatabaseState {
  settings?: unknown;
  customers?: unknown[];
  collections?: unknown[];
  expenses?: unknown[];
  employees?: unknown[];
  collectionGroups?: unknown[];
  usersList?: unknown[];
  backupsList?: unknown[];
  [key: string]: unknown;
}

const STORAGE_KEY = 'smart_finance_db_v1.0';

function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readState(): FinanceDatabaseState {
  if (!isStorageAvailable()) {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as FinanceDatabaseState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state: FinanceDatabaseState): void {
  if (!isStorageAvailable()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const FinanceDB = {
  async loadAll(): Promise<FinanceDatabaseState> {
    return readState();
  },

  async saveAllData(state: FinanceDatabaseState): Promise<void> {
    writeState(state);
  },

  async clearStore(storeName: string): Promise<void> {
    const state = readState();
    if (Object.prototype.hasOwnProperty.call(state, storeName)) {
      delete state[storeName];
      writeState(state);
    }
  }
};
