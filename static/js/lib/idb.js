const DB_NAME = 'search_index_db';
const DB_VERSION = 1;
const STORE_NAME = 'indexes';
const GLOBAL_KEY = '__SEARCH_CACHE__';

const idbOpen = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => { LOG.debug('IDB open success'); resolve(req.result); };
    req.onerror = () => { LOG.warn('IDB open error', req.error); reject(req.error); };
});

const idbGet = (key) => idbOpen().then(db => new Promise((resolve, reject) => {
    LOG.debug('IDB get', key);
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    LOG.debug("IDB get: store.get(key)")
    const r = store.get(key);
    r.onsuccess = () => { LOG.debug('IDB get success', key, r.result ? 'hit' : 'miss'); resolve(r.result || null); };
    r.onerror = () => { LOG.warn('IDB get error', key, r.error); reject(r.error); };
    tx.oncomplete = () => db.close();
}));

const idbSet = (key, value) => idbOpen().then(db => new Promise((resolve, reject) => {
    LOG.debug('IDB set', key);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const r = store.put(value, key);
    r.onsuccess = () => { LOG.debug('IDB set success', key); resolve(true); };
    r.onerror = () => { LOG.warn('IDB set error', key, r.error); reject(r.error); };
    tx.oncomplete = () => db.close();
}));

// Note: Index caching is handled inside the worker (load_cached_indices/build persistence).

const getGlobalCache = () => window[GLOBAL_KEY];
const setGlobalCache = (data) => { window[GLOBAL_KEY] = data; };

const loadFromIDB = async () => {
    try {
        const bin = await idbGet('index_msgpack');
        if (bin && (bin instanceof Uint8Array || (bin && bin.buffer))) {
            LOG.info('IDB load: msgpack format');
            if (!window.MessagePack) { LOG.warn('MessagePack missing'); return null; }
            const bytes = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
            const docs = window.MessagePack.decode(bytes);
            const meta = (await idbGet('index_meta')) || {};
            return { docs, meta };
        }
    } catch (e) { LOG.warn('IDB load msgpack failed', e); }
    return null;
};

const saveToIDB = async (docs, meta) => {
    if (!window.MessagePack) { LOG.warn('MessagePack unavailable; skipping cache save'); return; }
    const m = meta || {};
    const bytes = window.MessagePack.encode(docs);
    await idbSet('index_msgpack', bytes);
    await idbSet('index_meta', m);
    LOG.debug('IDB save: msgpack format complete');
};