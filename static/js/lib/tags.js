(() => {
  'use strict';

  // State
  const tagState = {
    selectedTags: new Set(),
    container: null
  };

  // Get tags from URL
  const getTagsFromURL = () => {
    try {
      const raw = new URLSearchParams(window.location.search).get('tags');
      if (!raw) return [];
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };

  // Set tags in URL
  const setTagsInURL = (tagsArr) => {
    try {
      const url = new URL(window.location.href);
      if (tagsArr && tagsArr.length) {
        url.searchParams.set('tags', tagsArr.join(','));
      } else {
        url.searchParams.delete('tags');
      }
      window.history.replaceState(null, '', url.toString());
    } catch (e) {
      try { console.warn('Tags: set tags in URL failed', e); } catch (_) {}
    }
  };

  // Initialize container
  const initContainer = () => {
    if (tagState.container && document.body.contains(tagState.container)) {
      return tagState.container;
    }
    
    const el = document.getElementById('tag-filters');
    if (!el) {
      // Create container if it doesn't exist
      const tagCloud = document.getElementById('tag-cloud');
      if (tagCloud) {
        const wrapper = document.createElement('div');
        wrapper.id = 'search-tags';
        wrapper.className = 'tags-filter-container';
        
        const label = document.createElement('div');
        label.className = 'tags-filter-label';
        label.textContent = 'Tags:';
        wrapper.appendChild(label);
        
        const container = document.createElement('div');
        container.id = 'tag-filters';
        container.className = 'tag-filters';
        container.setAttribute('role', 'group');
        container.setAttribute('aria-label', 'Active tag filters');
        wrapper.appendChild(container);
        
        tagCloud.parentNode.insertBefore(wrapper, tagCloud.nextSibling);
        tagState.container = container;
      }
    } else {
      tagState.container = el;
    }
    
    return tagState.container;
  };

  // Add a tag
  const addTag = (tag) => {
    if (!tag || tagState.selectedTags.has(tag)) return;
    tagState.selectedTags.add(tag);
    setTagsInURL(Array.from(tagState.selectedTags));
    render();
    triggerSearch();
  };

  // Remove a tag
  const removeTag = (tag) => {
    tagState.selectedTags.delete(tag);
    setTagsInURL(Array.from(tagState.selectedTags));
    render();
    triggerSearch();
  };

  // Toggle a tag
  const toggleTag = (tag) => {
    if (tagState.selectedTags.has(tag)) {
      removeTag(tag);
    } else {
      addTag(tag);
    }
  };

  // Clear all tags
  const clearAll = () => {
    tagState.selectedTags.clear();
    setTagsInURL([]);
    render();
    triggerSearch();
  };

  // Get selected tags
  const getSelectedTags = () => {
    return Array.from(tagState.selectedTags);
  };

  // Trigger search with current query
  const triggerSearch = () => {
    try {
      const input = document.getElementById('search-input');
      if (input && typeof onSearch === 'function') {
        setTimeout(() => onSearch({ target: { value: input.value } }), 0);
      }
    } catch (e) {
      try { console.warn('Tags: trigger search failed', e); } catch (_) {}
    }
  };

  // Render tag chips
  const render = () => {
    const container = initContainer();
    if (!container) return;

    const wrapper = container.closest('.tags-filter-container');
    
    if (tagState.selectedTags.size === 0) {
      // Hide entire container when no tags
      if (wrapper) wrapper.hidden = true;
      container.innerHTML = '';
      return;
    }

    // Show container
    if (wrapper) wrapper.hidden = false;
    
    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    tagState.selectedTags.forEach(tag => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag-chip';
      chip.dataset.tag = tag;
      chip.setAttribute('aria-label', `Remove ${tag} filter`);
      
      const label = document.createElement('span');
      label.className = 'tag-chip-label';
      label.textContent = tag;
      
      const closeBtn = document.createElement('span');
      closeBtn.className = 'tag-chip-close';
      closeBtn.setAttribute('aria-hidden', 'true');
      closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      
      chip.appendChild(label);
      chip.appendChild(closeBtn);
      
      chip.addEventListener('click', () => removeTag(tag));
      
      frag.appendChild(chip);
    });

    // Add clear all button if multiple tags
    if (tagState.selectedTags.size > 1) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'tag-chip tag-chip-clear-all';
      clearBtn.textContent = 'Clear all';
      clearBtn.setAttribute('aria-label', 'Clear all tag filters');
      clearBtn.addEventListener('click', clearAll);
      frag.appendChild(clearBtn);
    }

    container.appendChild(frag);

    // Animate chips with fade only
    if (typeof Motion !== 'undefined' && Motion.animate && Motion.stagger) {
      try {
        const chips = container.querySelectorAll('.tag-chip');
        if (chips.length) {
          // Set initial state
          chips.forEach(chip => {
            chip.style.opacity = '0';
          });
          
          requestAnimationFrame(() => {
            Motion.animate(
              chips,
              { opacity: [0, 1] },
              { 
                duration: 0.15,
                delay: Motion.stagger(0.02),
                easing: [0.22, 0.61, 0.36, 1]
              }
            );
          });
        }
      } catch (e) {
        try { console.warn('Tags: animation failed', e); } catch (_) {}
      }
    }
  };

  // Initialize from URL on load
  const init = () => {
    const urlTags = getTagsFromURL();
    urlTags.forEach(tag => tagState.selectedTags.add(tag));
    if (tagState.selectedTags.size > 0) {
      render();
    }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API
  window.tagFilters = {
    add: addTag,
    remove: removeTag,
    toggle: toggleTag,
    clear: clearAll,
    get: getSelectedTags,
    render: render
  };
  
  // Also expose getSelectedTags globally for use in other modules
  window.getSelectedTags = getSelectedTags;
})();
