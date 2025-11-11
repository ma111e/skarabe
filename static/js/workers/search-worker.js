/* global importScripts, self */
// Web Worker that parses docs JSON and builds Lunr indexes off the main thread.
// Served from /js/workers/search-worker.js

const LOG = {
  debug: (...a) => console.debug('[worker]', ...a), info: (...a) => console.info('[worker]', ...a),
  warn: (...a) => console.warn('[worker]', ...a), error: (...a) => console.error('[worker]', ...a)
};

// Load lunr in the worker context
try {
  // Workers are loaded twice for some reason, this prevent the failure of the first load (outside of worker, so no importScripts defined)
  if( 'function' === typeof importScripts) {
  importScripts('/js/vendor/lunr.js');
  }
} catch (e) {
  // If lunr fails to load, report and abort build requests
  self.postMessage({ type: 'error', error: 'Failed to load lunr: ' + (e && e.message) });
}

try {
  // Workers are loaded twice for some reason, this prevent the failure of the first load (outside of worker, so no importScripts defined)
  if( 'function' === typeof importScripts) {
  importScripts('/js/lib/idb.js');
  }
} catch (e) {
  // If lunr fails to load, report and abort build requests
  self.postMessage({ type: 'error', error: 'Failed to load libs: ' + (e && e.message) });
}

// Keep hydrated indices in the worker for querying
let idxAll = null;
let idxBySection = {};
let sectionsCache = [];
let docsCache = [];
let docsByUrl = new Map();

function buildIndex(docs) {
  const start = performance.now();
  const idx = lunr(function () {
    this.pipeline.reset();
    this.searchPipeline.reset();
    this.ref('url');
    this.field('title', { boost: 10 });
    this.field('tags', { boost: 8 });
    this.field('section', { boost: 5 });
    this.field('content');
    docs.forEach(d => {
      const doc = Object.assign({}, d, { tags: (d.tags || []).join(' ') });
      this.add(doc);
    });
  });
  const end = performance.now();
  LOG.debug(`Index built in ${end - start}ms`);
  return idx;
}

self.onmessage = async function (ev) {
  const msg = ev && ev.data;
  LOG.debug("received msg in worker", msg);
  if (!msg || !msg.type) return;
  LOG.debug("msg type", msg.type);
  if (msg.type === 'build') {
    LOG.debug("msg type is build");
    try {
      if (!Array.isArray(msg.docs)) {
        throw new Error('Invalid or missing docs array in build request');
      }
      const docs = msg.docs;
      
      // Send initial parsing step
      self.postMessage({ 
        type: 'build_step', 
        step: 'parsing',
        message: 'Analyzing documents…'
      });
      
      const sections = Array.from(new Set(docs.map(d => d.section).filter(Boolean))).sort();
      // Keep docs in memory for query-time post-filtering
      docsCache = Array.isArray(docs) ? docs : [];
      try { docsByUrl = new Map(docsCache.map(d => [d.url, d])); } catch (e) { docsByUrl = new Map(); }
      LOG.debug("building sections");
      
      // Send preparation step
      self.postMessage({ 
        type: 'build_step', 
        step: 'preparing',
        message: `Preparing ${sections.length} sections…`
      });
      
      // Total steps: 1 for 'all' + number of sections
      const totalSteps = 1 + sections.length;
      let completedSteps = 0;

      // Build indexes
      self.postMessage({ 
        type: 'build_step', 
        step: 'building_all',
        message: 'Building global index…'
      });
      
      const allIdx = buildIndex(docs);
      
      // Notify that 'all' index is built
      completedSteps++;
      self.postMessage({ 
        type: 'section_built', 
        section: 'all',
        progress: { completed: completedSteps, total: totalSteps },
        message: 'Global index built'
      });
      
      const bySection = {};
      sections.forEach((sec, idx) => {
        const subset = docs.filter(d => d.section === sec);
        LOG.debug("building section", sec);
        bySection[sec] = buildIndex(subset).toJSON();
        // Notify that this section is built
        completedSteps++;
        self.postMessage({ 
          type: 'section_built', 
          section: sec,
          progress: { completed: completedSteps, total: totalSteps },
          message: `Section ${sec} built`
        });
      });
      LOG.debug("built sections");

      // Serialize the 'all' index too
      const payload = {
        type: 'built',
        docs,
        sections,
        indices: {
          all: allIdx.toJSON(),
          bySection,
        }
      };
      // Persist Lunr serialized indices in IDB for fast boot
      try {
        await idbSet('lunr_all', payload.indices.all);
        await idbSet('lunr_bySection', payload.indices.bySection || {});
        await idbSet('lunr_sections', sections || []);
        await idbSet('lunr_docs', docsCache || []);
      } catch (e) {
        // non-fatal
      }
      self.postMessage(payload);
    } catch (e) {
      self.postMessage({ type: 'error', error: e && e.message ? e.message : String(e) });
    }
    return;
  }

  if (msg.type === 'hydrate') {
    try {
      const { indices, sections, id, docs } = msg;
      idxAll = lunr.Index.load(indices && indices.all ? indices.all : indices);
      LOG.debug("hydrated all index", idxAll);
      idxBySection = {};
      const bySec = indices.bySection || {};
      Object.keys(bySec).forEach(sec => {
        idxBySection[sec] = lunr.Index.load(bySec[sec]);
      });
      sectionsCache = Array.isArray(sections) ? sections : Object.keys(bySec);
      // Optionally hydrate docs for post-filtering
      if (Array.isArray(docs) && docs.length) {
        docsCache = docs;
        try { docsByUrl = new Map(docsCache.map(d => [d.url, d])); } catch (e) { docsByUrl = new Map(); }
      }
      self.postMessage({ type: 'ready', sections: sectionsCache, id });
    } catch (e) {
      self.postMessage({ type: 'error', error: e && e.message ? e.message : String(e), id: msg.id });
    }
    return;
  }

  if (msg.type === 'load_cached_indices') {
    (async () => {
      try {
        const all = await idbGet('lunr_all');
        const bySection = (await idbGet('lunr_bySection')) || {};
        const sections = (await idbGet('lunr_sections')) || [];
        const docs = (await idbGet('lunr_docs')) || [];
        if (!all) {
          self.postMessage({ type: 'error', error: 'No cached indices' , id: msg.id });
          return;
        }
        idxAll = lunr.Index.load(all);
        idxBySection = {};
        Object.keys(bySection).forEach(sec => { idxBySection[sec] = lunr.Index.load(bySection[sec]); });
        sectionsCache = Array.isArray(sections) ? sections : Object.keys(bySection);
        LOG.info("loaded cached indices", all, bySection, sections);
        // Hydrate docs for post-filtering
        docsCache = Array.isArray(docs) ? docs : [];
        try { docsByUrl = new Map(docsCache.map(d => [d.url, d])); } catch (e) { docsByUrl = new Map(); }
        self.postMessage({ type: 'ready', sections: sectionsCache, id: msg.id });
      } catch (e) {
        self.postMessage({ type: 'error', error: e && e.message ? e.message : String(e), id: msg.id });
      }
    })();
    return;
  }

  if (msg.type === 'query') {
    try {
      const { terms = [], tags = [], tabs = [], limit = 50, id, options = {}, phrases = [] } = msg;
      // Options from main thread (may be ignored if unsupported)
      const exactMatch = !!options.exactMatch;
      const caseSensitive = !!options.caseSensitive;
      try { LOG.debug('[worker] options', { exactMatch, caseSensitive }); } catch (e) { /* no-op logging */ }
      const useAll = tabs.length === 0 || tabs.includes('all');
      
      // Process terms: split quoted phrases into words for lunr, but keep track of original phrases
      // phrases[i] = true if terms[i] was a quoted phrase
      const searchTerms = [];
      const quotedPhrases = []; // Store the original quoted phrases for post-filtering
      terms.forEach((t, idx) => {
        const isQuoted = phrases[idx] === true;
        if (isQuoted) {
          // This is a quoted phrase - split into words for lunr search, but keep original for post-filter
          const words = String(t).split(/\s+/).filter(Boolean);
          searchTerms.push(...words);
          quotedPhrases.push(caseSensitive ? t : String(t).toLowerCase());
        } else {
          // Regular term - just add it
          const words = String(t).split(/\s+/).filter(Boolean);
          searchTerms.push(...words);
        }
      });
      
      const runQuery = (index) => index.query(b => {
        const wildcardMode = exactMatch ? lunr.Query.wildcard.NONE : (lunr.Query.wildcard.LEADING | lunr.Query.wildcard.TRAILING);
        searchTerms.forEach(t => b.term(t, {
          presence: lunr.Query.presence.REQUIRED,
          wildcard: wildcardMode,
          usePipeline: true,
        }));
        (tags || []).forEach(tag => b.term(tag, {
          fields: ['tags'],
          presence: lunr.Query.presence.REQUIRED,
          wildcard: wildcardMode,
          usePipeline: true,
        }));
      });

      let results = [];
      if (useAll) {
        if (!idxAll) throw new Error('Index not ready');
        results = runQuery(idxAll);
      } else {
        const merged = [];
        tabs.forEach(tab => {
          const i = idxBySection[tab];
          if (!i) return;
          const r = runQuery(i);
          merged.push(r);
        });
        // Flatten, sort by score desc, dedupe by ref
        const flat = merged.flat();
        flat.sort((a, b) => (b.score || 0) - (a.score || 0));
        const seen = new Set();
        const out = [];
        for (const m of flat) {
          if (m && !seen.has(m.ref)) {
            seen.add(m.ref);
            out.push(m);
          }
          if (out.length >= limit) break;
        }
        results = out;
      }

      // Case-sensitive post-filtering using original docs content
      if (caseSensitive && Array.isArray(results) && results.length && docsByUrl && docsByUrl.size) {
        const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const checks = terms.map(t => ({
          term: t,
          re: new RegExp(exactMatch ? `\\b${escapeReg(t)}\\b` : escapeReg(t))
        }));
        results = results.filter(m => {
          const d = docsByUrl.get(m.ref);
          if (!d) return false;
          const hay = `${d.title || ''}\n${(d.tags || []).join(' ')}\n${d.content || d.summary || ''}`;
          return checks.every(c => c.re.test(hay));
        });
      }

      // Post-filter for quoted phrases: ensure exact phrase appears in document
      if (quotedPhrases.length > 0 && Array.isArray(results) && results.length && docsByUrl && docsByUrl.size) {
        const escapeReg = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        results = results.filter(m => {
          const d = docsByUrl.get(m.ref);
          if (!d) return false;
          const hay = caseSensitive 
            ? `${d.title || ''}\n${(d.tags || []).join(' ')}\n${d.content || d.summary || ''}`
            : `${d.title || ''}\n${(d.tags || []).join(' ')}\n${d.content || d.summary || ''}`.toLowerCase();
          // All quoted phrases must appear exactly in the document
          return quotedPhrases.every(phrase => {
            const escaped = escapeReg(phrase);
            // Use word boundary if exactMatch is on
            const pattern = exactMatch ? `\\b${escaped}\\b` : escaped;
            const re = new RegExp(pattern, caseSensitive ? '' : 'i');
            return re.test(hay);
          });
        });
      }

      self.postMessage({ type: 'query_result', results: Array.isArray(results) ? results.slice(0, limit) : [], id });
    } catch (e) {
      self.postMessage({ type: 'error', error: e && e.message ? e.message : String(e), id: msg.id });
    }
    return;
  }
};
