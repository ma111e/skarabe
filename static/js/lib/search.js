const setStats = (html) => {
  try {
    if (!$stats) return;
    const el = $stats;
    const next = html || "";
    const display = (typeof next === 'string' && next.trim() === '') ? '&nbsp;' : next;
    // Show loading/status messages immediately without animation to ensure visibility
    const isStatusMsg = /Loading|Preparing|Building|Error/i.test(display);
    if (isStatusMsg) {
      el.innerHTML = display;
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
      return;
    }
    if (el.innerHTML === display) return;
    
    // Check if transitioning from empty to content (first appearance)
    const wasEmpty = !el.innerHTML || el.innerHTML === '&nbsp;' || el.innerHTML.trim() === '';
    const isNowContent = display !== '&nbsp;' && display.trim() !== '';
    
    const hasMotion = (typeof Motion !== 'undefined' && Motion.animate);
    if (hasMotion) {
      try {
        if (wasEmpty && isNowContent) {
          // First appearance: fade in from below
          el.innerHTML = display;
          Motion.animate(el, { opacity: [0, 1], y: [8, 0] }, { duration: 0.25, easing: 'ease-out' });
        } else {
          // Normal transition: fade out, change, fade in
          Motion.animate(el, { opacity: [1, 0], y: [0, -4] }, { duration: 0.15 }).finished.then(() => {
            el.innerHTML = display;
            Motion.animate(el, { opacity: [0, 1], y: [4, 0] }, { duration: 0.2 });
          }).catch(() => { el.innerHTML = next; });
        }
      } catch (e) {
        try { console.warn('Stats animation failed (Motion)', e); } catch (err) {}
        el.innerHTML = next;
      }
    } else {
      try {
        if (wasEmpty && isNowContent) {
          // First appearance: fade in from below
          el.innerHTML = display;
          el.style.transition = 'opacity 250ms ease-out, transform 250ms ease-out';
          el.style.opacity = '0';
          el.style.transform = 'translateY(8px)';
          setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
          }, 10);
        } else {
          // Normal transition
          el.style.transition = 'opacity 150ms ease, transform 150ms ease';
          el.style.opacity = '0';
          el.style.transform = 'translateY(-4px)';
          setTimeout(() => {
            el.innerHTML = display;
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
          }, 160);
        }
      } catch (e) {
        try { console.warn('Stats animation failed (CSS)', e); } catch (err) {}
        el.innerHTML = next;
      }
    }
  } catch (e) {
    try { console.error('setStats failed', e); } catch (_) {}
  }
};
const showError = (msg) => { if ($error) { $error.hidden = false; $error.textContent = msg || ""; } };
const clearError = () => { if ($error) { $error.hidden = true; $error.textContent = ""; } };

const getSearchQueryFromURL = () => {
  try { return new URLSearchParams(window.location.search).get('s') || ''; } catch { return ''; }
};
const setSearchQueryInURL = (q) => {
  try {
    const url = new URL(window.location.href);
    if (q) url.searchParams.set('s', q); else url.searchParams.delete('s');
    window.history.replaceState(null, '', url.toString());
  } catch {
    LOG.error('Worker: set search query in URL failed');
  }
};
const getTabsFromURL = () => {
  try {
    const raw = new URLSearchParams(window.location.search).get('tabs');
    if (!raw) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  } catch { return []; }
};
const setTabsInURL = (tabsArr) => {
  try {
    const url = new URL(window.location.href);
    if (tabsArr && tabsArr.length) {
      url.searchParams.set('tabs', tabsArr.join(','));
    } else {
      url.searchParams.delete('tabs');
    }
    window.history.replaceState(null, '', url.toString());
  } catch {
    LOG.error('Worker: set tabs in URL failed');
  }
};

const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const normalizeTerms = (terms, caseSensitive = false) => {
  // If terms is a string, split by whitespace (legacy behavior)
  // If terms is already an array, use it directly (for quoted phrase support)
  const parts = Array.isArray(terms) ? terms : terms.split(/\s+/).map(t => t.trim()).filter(Boolean);
  return caseSensitive ? parts : parts.map(t => t.toLowerCase());
};
const parseQuery = (q, caseSensitive = false) => {
  const tags = [];
  const plain = [];
  const phrases = []; // Track which terms are quoted phrases
  
  // Match quoted phrases or individual words/tags
  // This regex captures: "quoted phrases" or unquoted words
  const regex = /"([^"]*)"|(\S+)/g;
  let match;
  
  while ((match = regex.exec(q)) !== null) {
    const quotedPhrase = match[1]; // Content inside quotes
    const unquotedWord = match[2];  // Unquoted word
    
    const part = quotedPhrase !== undefined ? quotedPhrase : unquotedWord;
    if (!part) continue;
    
    // Check if it's a tag
    const tagMatch = part.match(/^\/tag:(.+)$/i);
    if (tagMatch) {
      tagMatch[1].split(',').map(s => s.trim()).filter(Boolean).forEach(v => tags.push(v.toLowerCase()));
    } else {
      const isQuoted = quotedPhrase !== undefined;
      plain.push(part);
      phrases.push(isQuoted); // Track if this term was a quoted phrase
    }
  }
  
  const normalizedTerms = normalizeTerms(plain, caseSensitive);
  return { terms: normalizedTerms, tags, phrases };
};

const findSnippetStart = (text, terms) => {
  const cs = !!(typeof state !== 'undefined' && state && state.highlightCaseSensitive);
  const hay = cs ? text : text.toLowerCase();
  const needles = cs ? terms : terms.map(t => t.toLowerCase());
  let pos = -1;
  for (const t of needles) {
    const p = hay.indexOf(t);
    if (p !== -1 && (pos === -1 || p < pos)) pos = p;
  }
  return pos > SNIPPET_CONTEXT ? pos - SNIPPET_CONTEXT : 0;
};
const buildSnippet = (text, start, maxLen) => {
  let raw = text.substring(start, start + maxLen);
  if (start > 0) raw = "…" + raw;
  if (start + maxLen < text.length) raw += "…";
  return raw;
};
const markTerms = (escaped, terms, caseSensitive = false) => {
  let out = escaped;
  for (const t of terms) {
    if (!t) continue;
    const flags = caseSensitive ? 'g' : 'gi';
    const escapedTerm = t.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
    
    // Split by HTML tags to avoid matching inside them
    const parts = out.split(/(<[^>]+>)/);
    out = parts.map((part, idx) => {
      // Only process text parts (even indices), skip HTML tags (odd indices)
      if (idx % 2 === 1) return part;
      const re = new RegExp("(" + escapedTerm + ")", flags);
      return part.replace(re, '<mark>$1</mark>');
    }).join('');
  }
  return out;
};

// Find all positions where terms match in the text
const findAllMatches = (text, terms) => {
  if (!text || !terms || terms.length === 0) return [];
  const cs = !!(typeof state !== 'undefined' && state && state.highlightCaseSensitive);
  const hay = cs ? text : text.toLowerCase();
  const needles = cs ? terms : terms.map(t => t.toLowerCase());
  const positions = [];
  for (const term of needles) {
    if (!term) continue;
    let pos = 0;
    while ((pos = hay.indexOf(term, pos)) !== -1) {
      positions.push(pos);
      pos += term.length;
    }
  }
  return [...new Set(positions)].sort((a, b) => a - b);
};

// Group nearby matches to avoid overlapping snippets
const groupMatchPositions = (positions, maxLen = SNIPPET_LEN) => {
  if (positions.length === 0) return [];
  const groups = [];
  let currentGroup = [positions[0]];
  
  for (let i = 1; i < positions.length; i++) {
    const prev = currentGroup[currentGroup.length - 1];
    const curr = positions[i];
    // If positions are close enough to be in same snippet, group them
    if (curr - prev < maxLen - SNIPPET_CONTEXT * 2) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);
  return groups;
};

// Generate multiple snippets for all match groups
const highlightAll = (text, terms, maxLen = SNIPPET_LEN) => {
  if (!text) return [];
  const positions = findAllMatches(text, terms);
  if (positions.length === 0) return [];
  
  const groups = groupMatchPositions(positions, maxLen);
  const cs = !!(typeof state !== 'undefined' && state && state.highlightCaseSensitive);
  const snippets = [];
  
  for (const group of groups) {
    const firstPos = group[0];
    const start = firstPos > SNIPPET_CONTEXT ? firstPos - SNIPPET_CONTEXT : 0;
    const raw = buildSnippet(text, start, maxLen);
    const escaped = escapeHTML(raw);
    const marked = markTerms(escaped, terms, cs);
    snippets.push(marked);
  }
  
  return snippets;
};

// Highlight by inserting <mark> AFTER HTML-escaping, so markup remains valid and safe.
const highlight = (text, terms, maxLen = SNIPPET_LEN) => {
  if (!text) return "";
  const start = findSnippetStart(text, terms);
  const raw = buildSnippet(text, start, maxLen);
  const escaped = escapeHTML(raw);
  const cs = !!(typeof state !== 'undefined' && state && state.highlightCaseSensitive);
  return markTerms(escaped, terms, cs);
};

const setSelectedIndex = (i) => { console.log('selected', i) ; state.selectedIndex = i; };
const setLastMatches = (m) => { state.lastMatches = Array.isArray(m) ? m : []; };

const setSpinnerVisible = (show) => {
  try {
    const el = document.getElementById('search-spinner');
    if (!el) return;
    el.hidden = !show;
  } catch {}
};

const renderItem = (doc, terms, i) => {
  if (!$tpl || !$tpl.content || !$tpl.content.firstElementChild) return null;
  const node = $tpl.content.firstElementChild.cloneNode(true);
  node.setAttribute('role', 'option');
  node.setAttribute('tabindex', '-1');
  node.dataset.index = String(i);

  const $title = node.querySelector('.result-title');
  if ($title) {
    $title.innerHTML = highlight(doc.title || '', terms);
    $title.setAttribute('href', doc.url);
  }
  const $section = node.querySelector('.result-section');
  if ($section) {
    if (doc.section) {
      const viewMode = $results ? $results.getAttribute('data-view-mode') || 'standard' : 'standard';
      $section.textContent = viewMode === 'standard' ? doc.section : `\u2022 ${doc.section}`;
    } else {
      $section.textContent = '';
    }
  }
  const $meta = node.querySelector('.result-meta');
  if ($meta) {
    const items = [];
    if (doc.tags && doc.tags.length > 0) {
      doc.tags.forEach(tag => {
        items.push(`<span class="tag-badge">${escapeHTML(tag)}</span>`);
      });
    }
    $meta.innerHTML = items.join('');
  }
  const $snippet = node.querySelector('.result-snippet');
  if ($snippet) {
    const snippets = highlightAll(doc.content || doc.summary || '', terms);
    if (snippets.length > 0) {
      const shown = snippets.slice(0, 4);
      $snippet.innerHTML = shown.map(s => `<div class="snippet-item">${s}</div>`).join('');

      // Add snippet count indicator to show remaining matches beyond the first 4
      const remaining = snippets.length - shown.length;
      if (remaining > 0) {
        const countBadge = document.createElement('span');
        countBadge.className = 'snippet-count';
        countBadge.textContent = `${remaining} more matches`;
        $snippet.appendChild(countBadge);
      }
    } else {
      $snippet.innerHTML = highlight(doc.content || doc.summary || '', terms);
    }
  }

  return node;
};

// Get column count based on screen width and view mode
const getColumnCount = () => {
  const viewMode = $results ? $results.getAttribute('data-view-mode') : 'standard';
  const width = window.innerWidth;
  
  if (viewMode === 'list') {
    // List mode: always 1 column
    return 1;
  } else if (viewMode === 'detailed') {
    // Large mode: 1 / 1 / 2 columns
    return width >= 1280 ? 2 : 1;
  } else if (viewMode === 'compact') {
    // Compact mode: 1 / 2 / 3 / 4 columns
    if (width >= 1600) return 4;
    if (width >= 1280) return 3;
    if (width >= 768) return 2;
    return 1;
  } else {
    // Standard mode: 1 / 2 / 3 columns
    if (width >= 1280) return 3;
    if (width >= 768) return 2;
    return 1;
  }
};

// Apply masonry layout to results with height-based balancing
const applyMasonryLayout = () => {
  if (!$results) return;
  
  const items = Array.from($results.querySelectorAll('.result'));
  if (items.length === 0) return;
  
  const cols = items.length === 1 ? 1 : getColumnCount();
  
  
  // Apply a class to restrict width to 80ch when there's only one result
  if (items.length === 1) {
    $results.parentElement.classList.add('restrict-width');
    $results.classList.add('restrict-width');
  } else {
    $results.parentElement.classList.remove('restrict-width');
    $results.classList.remove('restrict-width');
  }


  // Clear existing columns
  $results.innerHTML = '';
  
  // Create column containers
  const columns = [];
  const columnHeights = [];
  for (let i = 0; i < cols; i++) {
    const col = document.createElement('div');
    col.className = 'masonry-column';
    columns.push(col);
    columnHeights.push(0);
    $results.appendChild(col);
  }
  
  // Track the new visual order
  const orderedItems = [];
  
  // Distribute items to shortest column (height-based balancing)
  items.forEach((item) => {
    // Find shortest column
    let shortestIndex = 0;
    let shortestHeight = columnHeights[0];
    for (let i = 1; i < cols; i++) {
      if (columnHeights[i] < shortestHeight) {
        shortestHeight = columnHeights[i];
        shortestIndex = i;
      }
    }
    
    // Add item to shortest column
    columns[shortestIndex].appendChild(item);
    
    // Update column height using offsetHeight
    columnHeights[shortestIndex] += item.offsetHeight;
  });
  
  // Reassign data-index based on visual order (top to bottom, left to right)
  // Read items column by column, row by row
  let newIndex = 0;
  let hasMore = true;
  while (hasMore) {
    hasMore = false;
    for (let colIndex = 0; colIndex < cols; colIndex++) {
      const colItems = columns[colIndex].querySelectorAll('.result');
      const rowIndex = Math.floor(newIndex / cols);
      if (rowIndex < colItems.length) {
        colItems[rowIndex].dataset.index = String(newIndex);
        newIndex++;
        hasMore = true;
      }
    }
  }
};

const renderResults = (matches, terms) => {
  $results.innerHTML = "";
  if (!matches || matches.length === 0) {
    setStats("No results");
    setSelectedIndex(-1);
    return;
  }
  let rendered = 0;
  const frag = document.createDocumentFragment();
  matches.slice(0, RESULT_LIMIT).forEach((m, i) => {
    const d = state.docsByUrl.get(m.ref);
    if (!d) { LOG.warn('Missing doc for ref in results', m && m.ref); return; }
    const node = renderItem(d, terms, i);
    if (!node) return;
    // Don't select first result by default
    node.setAttribute('aria-selected', 'false');
    frag.appendChild(node);
    rendered++;
  });
  $results.appendChild(frag);
  setStats(`${rendered} result${rendered === 1 ? "" : "s"}`);
  setSelectedIndex(-1);

  // Defer layout to next frame to let DOM settle, then animate in a subsequent frame
  requestAnimationFrame(() => {
    applyMasonryLayout();
    requestAnimationFrame(() => {
      // Animate cards with stagger effect, but skip if too many items to avoid jank
      if (!document.documentElement.classList.contains('no-animations')) {
          const nodeList = $results ? $results.querySelectorAll('.result') : null;
          if (nodeList && nodeList.length) {
            const nodes = Array.from(nodeList);
            // Compute visual order after masonry: row-by-row (top to bottom), then left-to-right
            const ordered = nodes
              .map(el => ({ el, rect: el.getBoundingClientRect() }))
              .sort((a, b) => {
                const dy = a.rect.top - b.rect.top;
                if (Math.abs(dy) > 2) return dy; // different rows
                return a.rect.left - b.rect.left; // same row, left-to-right
              })
              .map(x => x.el);

            const baseDelay = 0.05;
            const step = 0.04;

            ordered.forEach((el, idx) => {
              try { el.style.opacity = '0'; } catch {}
              Motion.animate(
                el,
                { opacity: [0, 1], y: [20, 0] },
                {
                  duration: 0.35,
                  delay: baseDelay + idx * step,
                  easing: [0.22, 0.61, 0.36, 1]
                }
              );
            });
          }
      } else {
        // When skipping animation (too many items, Motion unavailable, or animations disabled), force visibility
          const nodes = $results ? $results.querySelectorAll('.result') : null;
          if (nodes) nodes.forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
      }
    });
  });

  // Bind a delegated hover-out handler once to clear selection when mouse leaves a card
  if (!state._hoverHandlersBound) {
    $results.addEventListener('mouseout', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('li.result') : null;
      if (!target) return;
      const toEl = e.relatedTarget;
      if (toEl && target.contains(toEl)) return; // still inside the same card
      // Clear selection state on hover out
      const items = Array.from($results.querySelectorAll('.result'));
      items.forEach(el => { el.classList.remove('selected'); el.setAttribute('aria-selected', 'false'); });
      setSelectedIndex(-1);
    });
    state._hoverHandlersBound = true;
  }
};

const updateSelection = (nextIndex) => {
  const items = Array.from($results.querySelectorAll('.result'));
  if (!items.length) { setSelectedIndex(-1); return; }
  if (nextIndex < 0) nextIndex = 0;
  if (nextIndex >= items.length) nextIndex = items.length - 1;
  
  // Clear all selections
  items.forEach(el => { el.classList.remove('selected'); el.setAttribute('aria-selected', 'false'); });
  
  // Find element by data-index attribute (matches visual order after masonry)
  const el = $results ? $results.querySelector(`.result[data-index="${nextIndex}"]`) : null;
  if (el) {
    el.classList.add('selected');
    el.setAttribute('aria-selected', 'true');
    // el.scrollIntoView({ block: 'nearest' });
    setSelectedIndex(nextIndex);
  }
};

const clearSearch = () => {
  if ($input) $input.value = '';
  $results.innerHTML = '';
  setStats('');
  setLastMatches([]);
  setSelectedIndex(-1);
  setSearchQueryInURL('');
};

const renderRecent = () => {
  $results.innerHTML = '';
  setStats('');
  setLastMatches([]);
  setSelectedIndex(-1);
};

const showRecent = () => { renderRecent(); };

const gotoMatch = (i) => {
  const idxMatch = i >= 0 ? i : 0;
  // Find the result element by data-index (matches visual order after masonry layout)
  const resultEl = $results ? $results.querySelector(`.result[data-index="${idxMatch}"]`) : null;
  if (!resultEl) return;
  
  // Get the URL from the title link
  const titleLink = resultEl.querySelector('.result-title');
  if (titleLink && titleLink.href) {
    window.location.href = titleLink.href;
  }
};

const getSearchOptions = () => {
  const root = document.getElementById('search');
  const q = (n) => {
    const btn = root ? root.querySelector(`.si-toggles .toggle:nth-child(${n})`) : null;
    return !!(btn && btn.getAttribute('aria-pressed') === 'true');
  };
  const liveQuery = q(1); // pressed => live query mode (search as you type)
  const wholeWord = q(2); // pressed => require whole-word boundaries (exact match)
  const caseSensitive = q(3);
  const useRegex = q(4);
  // exactMatch means require whole-word boundaries
  const exactMatch = wholeWord;
  return { exactMatch, caseSensitive, useRegex, liveQuery };
};

// Check if doc matches all selected tag filters
const matchesTagFilters = (doc) => {
  try {
    if (typeof window.tagFilters === 'undefined' || typeof window.tagFilters.get !== 'function') return true;
    const selectedTags = window.tagFilters.get();
    if (!selectedTags || selectedTags.length === 0) return true;
    if (!doc || !Array.isArray(doc.tags)) return false;
    const docTags = doc.tags.map(t => String(t).toLowerCase());
    return selectedTags.every(filterTag => docTags.includes(String(filterTag).toLowerCase()));
  } catch (e) {
    try { console.warn('matchesTagFilters failed', e); } catch (_) {}
    return true;
  }
};

// Query cache implementation
// (Cache key creation is handled by QueryCache.createSearchKey)

const performSearch = (q) => {
  // Don't search if slash menu is open (user is entering a command)
  if (typeof window.slashMenu !== 'undefined' && window.slashMenu.isOpen && window.slashMenu.isOpen()) {
    return;
  }
  
  setSearchQueryInURL(q);
  if (q.length < MIN_LEN) {
    if (q.length === 0) {
      showRecent();
    } else {
      $results.innerHTML = "";
      setStats(`Type at least ${MIN_LEN} characters`);
      setLastMatches([]);
    }
    return;
  }
  try {
    const opts = getSearchOptions();
    const { terms, tags, phrases } = parseQuery(q, opts.caseSensitive);
    // Expose case-sensitivity for the highlighter and log toggle states
    try { state.highlightCaseSensitive = !!opts.caseSensitive; } catch (e) { try { console.warn('Set caseSensitive flag failed', e); } catch(_) {} }
    console.log('[search] options', opts);

    // Regex mode: perform a direct regex scan over docs on the main thread
    if (opts.useRegex) {
      try {
        const flags = opts.caseSensitive ? '' : 'i';
        const re = new RegExp(q, flags);
        const matches = [];
        for (const doc of state.docs) {
          // Apply tag filter first
          if (!matchesTagFilters(doc)) continue;
          const hay = `${doc.title || ''}\n${doc.tags ? doc.tags.join(' ') : ''}\n${doc.content || doc.summary || ''}`;
          if (re.test(hay)) {
            matches.push({ ref: doc.url, score: 1 });
            if (matches.length >= RESULT_LIMIT) break;
          }
        }
        renderResults(matches, terms);
        setLastMatches(matches);
        clearError();
        return;
      } catch (e) { 
        showError('Invalid regex');
        setStats('');
        return;
      }
    }
    
      setStats(`
        <div class="flex items-center align-center gap-2">
          Loading search...
          <div role="status">
              <svg aria-hidden="true" class="inline w-4 h-4 text-gray-200 animate-spin dark:text-gray-600 fill-gray-600 dark:fill-gray-300" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/>
                  <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/>
              </svg>
              <span class="sr-only">Loading...</span>
          </div>        
        </div>
      `);

    // Check cache first if worker isn't ready
    if (!state.qReady) {
      if (typeof window.QueryCache !== 'undefined') {
        const cacheKey = window.QueryCache.createSearchKey(q, opts, window.getSelectedTags);
        window.QueryCache.get(cacheKey).then(cachedResults => {
          if (cachedResults && Array.isArray(cachedResults)) {
            // Serve results from cache
            renderResults(cachedResults, terms);
            setLastMatches(cachedResults);
            clearError();
          }
          // If no cache hit, do nothing (don't show loading state)
        }).catch(e => {
          console.warn('Cache lookup failed', e);
        });
      }
      return;
    }
    // Pass options to query worker; rely entirely on worker results (no main-thread filtering)
    queryViaWorker(terms, tags, { exactMatch: opts.exactMatch, caseSensitive: opts.caseSensitive, phrases }).then(res => {
      let out = Array.isArray(res) ? res.slice() : [];
      // Apply tag filters
      try {
        out = out.filter(m => {
          const d = state.docsByUrl.get(m.ref);
          if (!d) return false;
          return matchesTagFilters(d);
        });
      } catch (e) { try { console.warn('Tag filter failed', e); } catch(_) {} }
      // Fallback post-filter for case sensitivity and whole-word when worker doesn't enforce
      try {
        if (opts.caseSensitive && terms && terms.length) {
          const reList = terms.map(t => {
            try {
              return opts.exactMatch ? new RegExp(`\\b${t.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`) : new RegExp(t.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"));
            } catch (e) { return null; }
          }).filter(Boolean);
          out = out.filter(m => {
            const d = state.docsByUrl.get(m.ref);
            if (!d) return false;
            const hay = `${d.title || ''} ${d.tags ? d.tags.join(' ') : ''} ${d.content || d.summary || ''}`;
            return reList.some(re => re.test(hay));
          });
        }
      } catch (e) { try { console.warn('Case-sensitive post-filter failed', e); } catch(_) {} }
      
      // Cache the results for future use
      if (typeof window.QueryCache !== 'undefined') {
        const cacheKey = window.QueryCache.createSearchKey(q, opts, window.getSelectedTags);
        window.QueryCache.set(cacheKey, out).catch(e => console.warn('Cache save failed', e));
      }
      
      renderResults(out, terms);
      setLastMatches(out);
      clearError();
    }).catch(err => {
      if (err.message === 'canceled') return;

      LOG.warn('Worker query failed', err);
      setStats(`Search worker error: ${err.message}`);
    });
    clearError();
  } catch (err) {
    console.error(err);
    showError('Search error: ' + err.message);
  }
};

const onSearch = (e) => {
  const q = (e.target && e.target.value ? e.target.value : '').trim();
  const opts = getSearchOptions();
  
  // Only search on typing if live query is enabled
  if (!opts.liveQuery) {
    // In single-shot mode, just update URL but don't search
    setSearchQueryInURL(q);
    return;
  }
  
  // Live mode: debounce and search
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    performSearch(q);
  }, 300);
};

// Trigger search immediately (for button click or Enter key)
const triggerSearch = () => {
  const input = document.getElementById('search-input');
  if (!input) return;
  const q = input.value.trim();
  clearTimeout(state.debounceTimer);
  performSearch(q);
};

// Expose applyMasonryLayout globally for resize handler
if (typeof window !== 'undefined') {
  window.applyMasonryLayout = applyMasonryLayout;
}
