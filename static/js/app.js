const LOG = {
  debug: (...a) => console.debug('[app]', ...a), info: (...a) => console.info('[app]', ...a),
  warn: (...a) => console.warn('[app]', ...a), error: (...a) => console.error('[app]', ...a)
};

const state = {
  idx: null,
  docs: [],
  docsByUrl: new Map(),
  lastMatches: [],
  selectedIndex: -1,
  tabs: [],
  indicesByTab: new Map(),
  selectedTabs: new Set(), // empty or contains 'all' or sections
  focusedTabIndex: 0,
  // Query worker related
  qWorker: null,
  qReady: false,
  qReqId: 0,
  qPending: new Map(), // id -> {resolve, reject}
  activeQueryId: 0,
  // Debounce
  debounceTimer: null,
  progress: {
    load: {
      timer: null,
      startTs: 0,
      totalMs: 0,
      mode: 'smooth',
      currentPct: 0,
      targetPct: 0,
      stepStartTs: 0,
      lastMessageTs: 0,
      softCeil: 0,
    },
    build: {
      timer: null,
      startTs: 0,
      totalMs: 0,
      mode: 'smooth',
      currentPct: 0,
      targetPct: 0,
      stepStartTs: 0,
      lastMessageTs: 0,
      softCeil: 0,
    },
  },
  sectionsBuilding: new Set(), // Track which sections are currently being built
  arrowNavActive: false, // results navigation with arrows only after first ArrowDown
};

const init = async () => {
  try {
    console.log('Init: start');
    // Start smooth progress for load
    ensureProgressUI();
    const row = getProgressRow('load');
    if (row) row.hidden = false;
    setProgressLabel('load', 'Initializing search…');
    setProgressPercent('load', 0);
    state.progress.load.currentPct = 0;
    state.progress.load.targetPct = 10;
    state.progress.load.stepStartTs = Date.now();
    state.progress.load.lastMessageTs = state.progress.load.stepStartTs;
    startSmoothProgress('load');

    if (!window.lunr) throw new Error('Search engine not available');

    // Step 1: Create query worker (10% -> 25%)
    state.progress.load.targetPct = 25;
    state.progress.load.stepStartTs = Date.now();
    state.progress.load.lastMessageTs = state.progress.load.stepStartTs;
    setProgressLabel('load', 'Starting search worker…');
    ensureQueryWorker();

    // Step 2: Hydrate from cache (25% -> 40%)
    state.progress.load.targetPct = 40;
    state.progress.load.stepStartTs = Date.now();
    state.progress.load.lastMessageTs = state.progress.load.stepStartTs;
    setProgressLabel('load', 'Loading cached indices…');
    hydrateQueryWorkerFromCache();

    // Step 3: Load documents (40% -> 70%)
    state.progress.load.targetPct = 70;
    state.progress.load.stepStartTs = Date.now();
    state.progress.load.lastMessageTs = state.progress.load.stepStartTs;
    setProgressLabel('load', 'Loading documents…');
    const { docs, fromCache } = await loadIndexFromCacheOrNetwork();
    state.docs = docs;
    state.docsByUrl = new Map(state.docs.map(d => [d.url, d]));

    // Step 4: Prepare UI (70% -> 85%)
    state.progress.load.targetPct = 85;
    state.progress.load.stepStartTs = Date.now();
    state.progress.load.lastMessageTs = state.progress.load.stepStartTs;
    setProgressLabel('load', 'Hydrating worker...');

    // If docs came from cache, expose the UI immediately
    if (fromCache) {
      if ($input && !$input.value.trim()) showRecent();
      clearError();
    }
    // Initialize tabs, defer index building to background worker after init
    const sections = Array.from(new Set(state.docs.map(d => d.section).filter(Boolean))).sort();
    state.tabs = ['all', ...sections];
    state.selectedTabs = new Set(['all']);
    // Keep load progress until the query worker reports ready
    if ($input && !$input.value.trim()) {
      showRecent();
    }
    clearError();
    console.log('Init: ready');
    // refreshIndexInBackground();
  } catch (err) {
    console.error(err);
    showError('Failed to initialize search: ' + err.message);
  } finally {
    // progress handler manages visibility
    console.log('Init: complete');
  }
};

const focusAndSelectInput = () => { $input.focus(); if (typeof $input.select === 'function') $input.select(); };

const onInputKeyDown = (e) => {
  // If a slash command just consumed the key (Enter/Tab/Arrow), ignore here
  if (window.__slashConsume && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    return;
  }
  
  if (e.key === 'Escape') {
    try { state.arrowNavActive = false; } catch (err) { console.log('Disable arrow nav failed', err); }
    try { setSelectedIndex(-1); } catch (err) { console.log('Unselect failed', err); }
    // Do not clear the input or results on Escape; keep focus behavior unchanged
    if (!$input) return;
    return;
  }
  
  if (e.key === 'Enter') {
    e.preventDefault();
    const opts = getSearchOptions();
    // In single-shot mode, Enter triggers search
    if (!opts.liveQuery) {
      if (typeof triggerSearch === 'function') triggerSearch();
      return;
    }
    // In live mode, Enter navigates to selected result
    if (state.lastMatches && state.lastMatches.length > 0) {
      gotoMatch(state.selectedIndex >= 0 ? state.selectedIndex : 0);
    }
    return;
  }
  
  if (!state.lastMatches || state.lastMatches.length === 0) return;
  
  // Get column count for navigation
  const getColCount = () => {
    const viewMode = $results ? $results.getAttribute('data-view-mode') : 'standard';
    const width = window.innerWidth;
    if (viewMode === 'list') return 1;
    if (viewMode === 'detailed') return width >= 1280 ? 2 : 1;
    if (viewMode === 'compact') {
      if (width >= 1600) return 4;
      if (width >= 1280) return 3;
      if (width >= 768) return 2;
      return 1;
    }
    // standard
    if (width >= 1280) return 3;
    if (width >= 768) return 2;
    return 1;
  };
  
  const cols = getColCount();
  const currentIndex = state.selectedIndex >= 0 ? state.selectedIndex : -1;
  
  const isArrowKey = (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight');
  if (!isArrowKey) return;

  if (!state.arrowNavActive) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.arrowNavActive = true;
      if (state.selectedIndex < 0) {
        updateSelection(0);
      } else {
        updateSelection(currentIndex + cols);
      }
    }
    // If not active and not ArrowDown, allow native caret movement
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.selectedIndex < 0) {
      updateSelection(0);
    } else {
      updateSelection(currentIndex + cols);
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    updateSelection(currentIndex - cols);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    updateSelection(currentIndex + 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    updateSelection(currentIndex - 1);
  }
};

const onDocumentKeyDown = (e) => {
  const target = e.target;
  // If a slash command just consumed the key, block here too
  if (window.__slashConsume && (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    return;
  }
  if ((e.key && e.key.toLowerCase() === 'k') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    focusAndSelectInput();
    return;
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    const doc = getSelectedDoc();
    if (doc && doc.url) window.open(doc.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (e.key === '/' && !e.metaKey && !e.altKey) {
    if (!(target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName)))) {
      e.preventDefault();
      focusAndSelectInput();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // Apply persisted animation preference early
  const NO_ANIM_KEY = 'si:noAnimations';
  const animationsDisabled = (() => {
    try { return localStorage.getItem(NO_ANIM_KEY) === '1'; } catch { return false; }
  })();
  if (animationsDisabled) {
    try { document.documentElement.classList.add('no-animations'); } catch (e) { }
  }
  const canAnimate = () => {
    return !document.documentElement.classList.contains('no-animations');
  };
  // Animate main search block on page load - only fade, no slide
  const searchBlock = document.getElementById('search');
  if (searchBlock && typeof Motion !== 'undefined' && Motion.animate && canAnimate()) {
    Motion.animate(
      searchBlock,
      { opacity: [0, 1] },
      { 
        duration: 0.5,
        delay: 0.15,
        easing: [0.22, 0.61, 0.36, 1]
      }
    );
  }

    const searchTitle = document.getElementById('search-title');
  if (searchTitle && typeof Motion !== 'undefined' && Motion.animate && canAnimate()) {
    Motion.animate(
      searchTitle,
      { opacity: [0, 1] },
      { 
        duration: 0.5,
        delay: 0.15,
        easing: [0.22, 0.61, 0.36, 1]
      }
    );
  }

  
  // Bind to the main search input only
  $input = document.getElementById('search-input');
  $results = document.getElementById('search-results');
  $stats = document.getElementById('search-stats');
  $loading = document.getElementById('search-loading');
  $error = document.getElementById('search-error');
  $tpl = document.getElementById('result-item');

  // Initialize view mode selector
  const viewModeButtons = document.querySelectorAll('.view-mode-btn');
  const applyViewMode = (mode) => {
    const m = mode || 'standard';
    viewModeButtons.forEach(b => {
      if (b && b.dataset && b.dataset.mode) {
        b.classList.toggle('active', b.dataset.mode === m);
      }
    });
    if ($results) $results.setAttribute('data-view-mode', m);
    if (window.applyMasonryLayout) {
      window.applyMasonryLayout();
    }
  };
  viewModeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn && btn.dataset ? btn.dataset.mode : 'standard';
      applyViewMode(mode);
      try {
        localStorage.setItem('si:viewMode', mode);
      } catch (e) { console.log('Persist view mode failed', e); }
    });
  });
  // Restore initial mode from storage (fallback to standard)
  try {
    const savedMode = localStorage.getItem('si:viewMode') || 'standard';
    applyViewMode(savedMode);
  } catch (e) {
    console.log('Restore view mode failed', e);
    if ($results) $results.setAttribute('data-view-mode', 'standard');
  }
  
  // Handle window resize with debounce to re-layout masonry
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (window.applyMasonryLayout) {
        window.applyMasonryLayout();
      }
    }, 150);
  });

  init().then(() => {
    // Apply initial tabs from URL
    const initialTabs = getTabsFromURL();
    if (initialTabs.length) selectTabs(initialTabs);
    else renderTabs();
    // Apply initial query
    const initialQ = getSearchQueryFromURL();
    if (initialQ && $input) {
      $input.value = initialQ;
      onSearch({ target: { value: initialQ } });
    }
    // Check if we need to rebuild indices based on fingerprint
    const INDEX_FP_KEY = 'index_fingerprint';
    const buildFingerprint = typeof window.INDEX_FINGERPRINT !== 'undefined' ? window.INDEX_FINGERPRINT : null;
    const storedFingerprint = (() => {
      try { return localStorage.getItem(INDEX_FP_KEY); } catch { return null; }
    })();
    
    const needsRebuild = !buildFingerprint || !storedFingerprint || buildFingerprint !== storedFingerprint;
    
    if (needsRebuild) {
      console.log('Index fingerprint changed or first load, rebuilding indices', { 
        stored: storedFingerprint, 
        build: buildFingerprint 
      });
      // Clear query cache since index content has changed
      try {
        if (typeof window.QueryCache !== 'undefined') {
          window.QueryCache.clear().then(() => {
            console.log('Cleared query cache due to index change');
          }).catch(e => {
            console.log('Failed to clear query cache', e);
          });
        }
      } catch (e) {
        console.log('Query cache clear failed', e);
      }
      // Start background worker build after init completes
      buildIndicesWithWorker().then(() => {
        state.selectedTabs = new Set(['all']);
        // Store the new fingerprint after successful build
        const fp = buildFingerprint;
        if (typeof buildFingerprint === 'string' && buildFingerprint.length > 0) {
          try {
            localStorage.setItem(INDEX_FP_KEY, buildFingerprint);
            console.log('Stored new index fingerprint', buildFingerprint);
          } catch (e) {
            console.log('Failed to store fingerprint', e);
          }
        }
      }).catch(() => { });
    } else {
      console.log('Index fingerprint unchanged, using cached indices', { fingerprint: buildFingerprint });
      state.selectedTabs = new Set(['all']);
    }
  });

  if ($input) {
    if (!$input.placeholder) {
      $input.placeholder = 'Search (Ctrl+k)';
    } else if (!/Ctrl\/Cmd\+K/.test($input.placeholder)) {
      $input.placeholder += ' (Ctrl+k)';
    }
    $input.focus();
    $input.addEventListener('input', onSearch);
    $input.addEventListener('keydown', onInputKeyDown);
    $input.addEventListener('click', () => {
      try { state.arrowNavActive = false; } catch (e) { console.log('Disable arrow nav failed', e); }
      try { setSelectedIndex(-1); } catch (e) { console.log('Reset selection failed', e); }
    });
  }

  // No bottom bar; search runs on typing only.

  document.addEventListener('keydown', onDocumentKeyDown);

  // Update search button state based on live toggle
  const updateSearchButtonState = () => {
    const searchButton = document.getElementById('search-button');
    if (!searchButton) return;
    const opts = getSearchOptions();
    searchButton.disabled = opts.liveQuery;
  };

  // Re-run search when toggle buttons change and persist states
  const toggles = document.querySelector('#search .si-toggles');
  if (toggles) {
    const toggleButtons = toggles.querySelectorAll('.toggle');
    // Restore saved toggle states (fallback to DOM defaults)
    try {
      const saved = JSON.parse(localStorage.getItem('si:searchToggles') || '{}');
      const keys = ['wholeWord', 'caseSensitive', 'useRegex', 'liveQuery'];
      toggleButtons.forEach((btn, idx) => {
        const savedVal = Object.prototype.hasOwnProperty.call(saved, keys[idx]) ? !!saved[keys[idx]] : null;
        const initial = btn.getAttribute('aria-pressed') === 'true';
        const next = (savedVal === null) ? initial : savedVal;
        btn.setAttribute('aria-pressed', String(next));
        btn.classList.toggle('is-active', next);
      });
    } catch (e) { console.log('Restore toggle states failed', e); }

    if ($input) {
      toggles.addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle');
        if (!btn) return;
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', String(!pressed));
        btn.classList.toggle('is-active', !pressed);
        updateSearchButtonState();
        // Persist all toggle states after any change
        try {
          const keys = ['wholeWord', 'caseSensitive', 'useRegex', 'liveQuery'];
          const states = {};
          toggleButtons.forEach((b, idx) => { states[keys[idx]] = (b.getAttribute('aria-pressed') === 'true'); });
          localStorage.setItem('si:searchToggles', JSON.stringify(states));
        } catch (e2) { console.log('Persist toggle states failed', e2); }
        onSearch({ target: { value: ($input.value || '').trim() } });
      });
    }
  }

  // Set initial button state
  updateSearchButtonState();

  // Wire up search button
  const searchButton = document.getElementById('search-button');
  if (searchButton) {
    searchButton.addEventListener('click', () => {
      if (typeof triggerSearch === 'function') triggerSearch();
    });
  }

  $results.addEventListener('click', (e) => {
    const li = e.target.closest('li.result');
    if (!li || !li.dataset.index) return;
    // Alt+click opens preview popup
    if (e.altKey) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      const titleLink = li.querySelector('.result-title');
      if (titleLink && titleLink.href && typeof window.preview !== 'undefined') {
        try {
          window.preview.open(titleLink.href);
        } catch (err) {
          console.log('Preview open failed', err);
        }
      }
      return;
    }
    const i = parseInt(li.dataset.index, 10);
    gotoMatch(i);
  });
});