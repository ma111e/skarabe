const getActiveDocs = () => {
  if (!state.docs || state.docs.length === 0) return [];
  if (state.selectedTabs.size === 0 || state.selectedTabs.has('all')) return state.docs;
  return state.docs.filter(d => state.selectedTabs.has(d.section));
};

const loadIndexFromCacheOrNetwork = async () => {
  LOG.info('Load index: start');
  const mem = getGlobalCache();
  if (mem && mem.docs) { LOG.info('Load index: from memory', mem.docs.length, 'docs'); return { ...mem, fromCache: true }; }
  try {
    const cached = await loadFromIDB();
    if (cached && cached.docs) {
      LOG.info('Load index: from IDB', cached.docs.length, 'docs');
      const payload = { ...cached };
      setGlobalCache(payload);
      return { ...payload, fromCache: true };
    }
  } catch (e) { LOG.warn('Load index: IDB read failed', e); }
  LOG.info('Load index: from network', INDEX_PATH);
  const resp = await fetch(INDEX_PATH, { credentials: 'same-origin' });
  if (!resp.ok) throw new Error(`Failed to load index (${resp.status})`);
  const docs = await resp.json();
  const meta = { etag: resp.headers.get('ETag') || null, lastModified: resp.headers.get('Last-Modified') || null, ts: Date.now() };
  const payload = { docs, meta };
  setGlobalCache(payload);
  await saveToIDB(docs, meta);
  LOG.info('Load index: network complete', docs.length, 'docs');
  return { ...payload, fromCache: false };
};
