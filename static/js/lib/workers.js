const buildIndicesWithWorker = async () => {
  if (typeof Worker === 'undefined') { LOG.debug('Worker: not supported'); return false; }
  try {
    const worker = new Worker('/js/workers/search-worker.js');
    LOG.info('Worker: start building indices');
    // Prefer size from msgpack cache for ETA (1s per MiB). Do not fall back to docs length for ETA.
    let estBytes = 0;
    const docsPayload = await (async () => {
      try {
        LOG.info('Worker: fetching fresh index', INDEX_PATH);
        const resp = await fetch(INDEX_PATH, { credentials: 'same-origin', cache: 'no-store' });
        if (!resp.ok) throw new Error(`Failed to load index (${resp.status})`);
        const text = await resp.text();
        
        // Check fingerprint to see if we need to rebuild
        const newFingerprint = await computeFingerprint(text);
        const storedFingerprint = getStoredFingerprint();
        
        if (storedFingerprint && storedFingerprint === newFingerprint) {
          LOG.info('Worker: index unchanged (fingerprint match), skipping rebuild');
          // Return empty to signal no rebuild needed
          return null;
        }
        
        LOG.info('Worker: index changed or first load, will rebuild');
        setStoredFingerprint(newFingerprint);
        
        const cl = resp.headers && resp.headers.get ? resp.headers.get('Content-Length') : null;
        if (cl) {
          const n = parseInt(cl, 10);
          if (!isNaN(n) && isFinite(n)) estBytes = n >>> 0;
        }
        const docs = JSON.parse(text);
        if (!estBytes) {
          try { estBytes = JSON.stringify(docs).length >>> 0; } catch { }
        }
        const meta = { etag: resp.headers.get('ETag') || null, lastModified: resp.headers.get('Last-Modified') || null, ts: Date.now() };
        // Update in-memory and IDB caches with the freshest docs
        try { setGlobalCache({ docs, meta }); } catch { }
        try { await saveToIDB(docs, meta); } catch (e) { LOG.warn('IDB save failed', e); }
        return docs;
      } catch (e) {
        LOG.warn('Worker: fresh fetch failed, falling back to existing docs', e);
        // Fall back to already-loaded docs array
        return state.docs;
      }
    })();
    
    // If docsPayload is null, index hasn't changed - skip rebuild
    if (!docsPayload) {
      LOG.info('Worker: Using cached indices, no rebuild needed');
      worker.terminate();
      return true;
    }
    
    // Keep the in-memory docs in sync with what the worker will index
    if (Array.isArray(docsPayload) && docsPayload.length) {
      state.docs = docsPayload;
      state.docsByUrl = new Map(state.docs.map(d => [d.url, d]));
    }
    // Show progress bar starting at 0% with smooth animation
    if (!($loading && $loading.hidden)) {
      ensureProgressUI();
      const row = getProgressRow('build');
      if (row) row.hidden = false;
      setProgressLabel('build', 'Preparing to build indices…');
      setProgressPercent('build', 0);
      state.progress.build.currentPct = 0;
      state.progress.build.targetPct = 0;
      state.progress.build.stepStartTs = Date.now();
      // Start smooth progress animation
      startSmoothProgress('build');
    }
    // Mark all sections as building and render tabs with spinners
    state.sectionsBuilding = new Set(['all', ...state.tabs.filter(t => t !== 'all')]);
    renderTabs();

    return await new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const data = ev && ev.data;
        if (!data) return;
        if (data.type === 'build_step') {
          // Update label with step message
          if (data.message) {
            setProgressLabel('build', data.message);
          }
        } else if (data.type === 'section_built') {
          // Remove this section from building set and re-render tabs
          if (data.message) {
            setProgressLabel('build', data.message);
          }

          state.sectionsBuilding.delete(data.section);
          renderTabs();
          // Update progress bar with actual completion
          if (data.progress) {
            const targetPct = (data.progress.completed / data.progress.total) * 100;
            state.progress.build.targetPct = targetPct;
            state.progress.build.stepStartTs = Date.now();

            // Detailed status messages
            let statusMsg = '';
            if (data.section === 'all') {
              setTimeout(() => {
                setProgressLabel('build', 'Building child indices');
              }, 1500);
              statusMsg = `Built global index (${data.progress.completed}/${data.progress.total})`;
            } else {
              if (data.progress.completed === data.progress.total) {
                setTimeout(() => {
                  setProgressLabel('build', 'Hydrating query worker');
                }, 1500);
              }
              statusMsg = `Built ${data.section} (${data.progress.completed}/${data.progress.total})`;
            }
            setProgressLabel('build', statusMsg);
          }
          LOG.info('Worker: section built', data.section);
        } else if (data.type === 'built') {
          try {
            const { sections, indices } = data;
            state.tabs = ['all', ...sections];
            // Hydrate the query worker only; do not load indexes on main thread
            try { hydrateQueryWorker(indices, sections); } catch {
              LOG.error('Worker: query worker hydrate failed');
            }
            LOG.info('Worker: build complete');
            // Clear any remaining sections from building state
            state.sectionsBuilding.clear();
            renderTabs();
            // Complete build bar now; load bar will finish on worker ready
            setProgressPercent('build', 100);
            setProgressLabel('build', 'Build complete');
            completeProgress('build');
            // Re-run active query so the new results show up immediately
            try {
              const q = ($input && $input.value || '').trim();
              if (q.length >= MIN_LEN) performSearch(q);
            } catch { }
            resolve(true);
          } finally {
            worker.terminate();
          }
        } else if (data.type === 'error') {
          LOG.warn('Worker: error', data.error);
          worker.terminate();
          completeProgress('build');
          reject(new Error(data.error || 'Worker error'));
        }
      };
      worker.onerror = (e) => {
        LOG.warn('Worker: onerror', e && e.message ? e.message : e);
        try { worker.terminate(); } catch {
          LOG.error('Worker: worker terminate failed');
        }
        completeProgress('build');
        reject(e);
      };
      worker.postMessage({ type: 'build', docs: docsPayload });
    });
  } catch (e) {
    LOG.warn('Worker: build failed', e);
    completeProgress('build');
    return false;
  }
};

// Query worker plumbing
const ensureQueryWorker = () => {
  if (state.qWorker) return state.qWorker;
  try {
    const w = new Worker('/js/workers/search-worker.js');
    w.onmessage = (ev) => {
      const data = ev && ev.data;
      if (!data) return;
      if (data.type === 'ready') {
        LOG.info('Query worker ready');
        state.qReady = true;
        if (Array.isArray(data.sections) && data.sections.length && state.tabs.length === 0) {
          state.tabs = ['all', ...data.sections];
        }
        // Finish load progress when the query worker is ready
        try {
          setProgressLabel('load', 'Search ready');
          setProgressPercent('load', 100);
          completeProgress('load');
        } catch { }
        // Re-run active query to refresh results if user already typed
        try {
          const q = ($input && $input.value || '').trim();
          if (q.length >= MIN_LEN) performSearch(q);
        } catch { }
      } else if (data.type === 'query_result') {
        // Ignore stale results if a newer query is active
        if (data.id !== state.activeQueryId) return;
        const pend = state.qPending.get(data.id);
        if (pend) {
          state.qPending.delete(data.id);
          try { setSpinnerVisible(false); } catch { }
          pend.resolve(data.results || []);
        }
      } else if (data.type === 'error') {
        const pend = state.qPending.get(data.id);
        if (pend) {
          state.qPending.delete(data.id);
          // Ignore errors from stale requests
          if (data.id === state.activeQueryId) {
            try { setSpinnerVisible(false); } catch { }
            pend.reject(new Error(data.error || 'Worker error'));
          }
        } else {
          LOG.warn('Query worker error (no pending request)', data.error);
        }
      }
    };
    w.onerror = (e) => {
      LOG.error('Query worker crashed', e && e.message ? e.message : e);
      state.qReady = false;
    };
    state.qWorker = w;
  } catch (e) {
    LOG.warn('Query worker creation failed', e);
  }
  return state.qWorker;
};

const hydrateQueryWorker = (indices, sections) => {
  const w = ensureQueryWorker();
  if (!w) return;
  console.log(w);

  state.qReady = false;
  try {
    const id = ++state.qReqId;
    LOG.info('Hydrating query worker');
    // Provide docs so the worker can immediately perform case-sensitive post-filtering
    w.postMessage({ type: 'hydrate', indices, sections, id, docs: state.docs });
    // Timeout to detect if worker hangs
    setTimeout(() => {
      if (!state.qReady) {
        LOG.warn('Query worker hydrate timeout - worker may have crashed or is still loading lunr.js');
      }
    }, 300000);
  } catch (e) { LOG.info('Hydrate query worker failed'); }
};

const hydrateQueryWorkerFromCache = () => {
  const w = ensureQueryWorker();
  if (!w) return;
  state.qReady = false;
  try {
    const id = ++state.qReqId;
    LOG.info('Requesting worker to load cached indices');
    w.postMessage({ type: 'load_cached_indices', id });
    setTimeout(() => {
      if (!state.qReady) LOG.warn('Query worker cached load timeout');
    }, 300000);
  } catch (e) { LOG.warn('Query worker cached load failed', e); }
};


const queryViaWorker = (terms, tags, options = {}) => new Promise((resolve, reject) => {
  const w = ensureQueryWorker();
  if (!w || !state.qReady) return reject(new Error('Query worker not ready'));
  
  // Cancel previous pending query, if any
  if (state.activeQueryId) {
    const prev = state.qPending.get(state.activeQueryId);
    if (prev) {
      state.qPending.delete(state.activeQueryId);
      try { prev.reject(new Error('canceled')); } catch {
        LOG.error('Worker: hydrate failed');
      }
    }
  }
  
  const id = ++state.qReqId;
  state.activeQueryId = id;
  const tabs = (state.selectedTabs.size === 0) ? ['all'] : Array.from(state.selectedTabs);
  const cacheKey = typeof window.QueryCache !== 'undefined' 
    ? window.QueryCache.createWorkerKey(terms, tags, tabs, options)
    : JSON.stringify({ terms, tags, tabs: tabs.sort(), options });
  
  // Track whether we've resolved from cache or worker
  let resolved = false;
  const handleResolve = (results, source) => {
    if (resolved) return;
    resolved = true;
    state.qPending.delete(id);
    LOG.debug(`Query resolved from ${source}`);
    try { setSpinnerVisible(false); } catch { }
    resolve(results);
  };
  
  // Start worker query
  state.qPending.set(id, { 
    resolve: (res) => {
      handleResolve(res, 'worker');
      // Cache the result asynchronously (don't wait)
      if (typeof window.QueryCache !== 'undefined') {
        window.QueryCache.set(cacheKey, res).catch(e => LOG.warn('Query cache store failed', e));
      }
    },
    reject 
  });
  
  try { setSpinnerVisible(true); } catch { }
  w.postMessage({ type: 'query', terms, tags, tabs, limit: RESULT_LIMIT, id, options, phrases: options.phrases || [] });
  
  // Check cache in parallel
  if (typeof window.QueryCache !== 'undefined') {
    window.QueryCache.get(cacheKey).then(cachedResults => {
      if (cachedResults) {
        // Cache hit - resolve immediately
        handleResolve(cachedResults, 'cache');
      }
    }).catch(e => {
      LOG.warn('Query cache read failed', e);
    });
  }
});
