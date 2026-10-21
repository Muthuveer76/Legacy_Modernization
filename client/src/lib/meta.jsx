import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api.js';

const MetaContext = createContext(null);

export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    api.get('/api/meta').then(setMeta).catch(() => setMeta({ languages: {}, targets: {}, samples: [], ai: { enabled: false }, limits: {} }));
  }, []);
  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}

export function useMeta() {
  return useContext(MetaContext);
}
