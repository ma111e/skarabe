// Slash command menu for search input
// Provides GitLab-style command palette with keyboard navigation

(() => {
  'use strict';

  // Command registry (static commands)
  const STATIC_COMMANDS = [
    {
      cmd: '/live',
      desc: 'Toggle live query mode',
      type: 'toggle',
      toggleIndex: 1
    },
    {
      cmd: '/whole',
      desc: 'Toggle whole word (exact match)',
      type: 'toggle',
      toggleIndex: 2
    },
    {
      cmd: '/case',
      desc: 'Toggle case sensitive search',
      type: 'toggle',
      toggleIndex: 3
    },
    {
      cmd: '/regex',
      desc: 'Toggle regex mode',
      type: 'toggle',
      toggleIndex: 4
    },
    {
      cmd: '/tag',
      desc: 'Filter by tag',
      type: 'value-picker',
      needsValue: true,
      getValues: () => {
        // Get unique tags from all docs
        if (typeof state === 'undefined' || !Array.isArray(state.docs)) return [];
        const tagSet = new Set();
        state.docs.forEach(doc => {
          if (Array.isArray(doc.tags)) {
            doc.tags.forEach(tag => {
              if (tag) tagSet.add(tag);
            });
          }
        });
        return Array.from(tagSet).sort();
      }
    },
    {
      cmd: '/section',
      desc: 'Toggle section filter',
      type: 'value-picker',
      needsValue: true,
      getValues: () => {
        // Get available sections, including 'all'
        if (typeof state === 'undefined' || !Array.isArray(state.tabs)) return ['all'];
        return state.tabs.filter(t => t);
      }
    },
    {
      cmd: '/reset',
      desc: 'Reset filters',
      type: 'value-picker',
      needsValue: true,
      getValues: () => ['all', 'tags', 'section']
    },
    {
      cmd: '/clear',
      desc: 'Clear filters (alias for reset)',
      type: 'value-picker',
      needsValue: true,
      getValues: () => ['all', 'tags', 'section']
    },
    {
      cmd: '/help',
      desc: 'Show help and keyboard shortcuts',
      type: 'action'
    }
  ];

  // Get all commands
  const getAllCommands = () => {
    return STATIC_COMMANDS;
  };

  // State
  const slashState = {
    menu: null,
    input: null,
    selectedIndex: 0,
    filteredCommands: [],
    isOpen: false,
    slashStartPos: -1,
    mode: 'command', // 'command' or 'value'
    activeCommand: null, // The command we're picking a value for
    availableValues: [] // Values to choose from
  };

  // Initialize menu element
  const initMenu = () => {
    if (slashState.menu) return;
    const wrap = document.querySelector('.search-input-wrap');
    if (!wrap) return;
    
    const menu = document.createElement('div');
    menu.id = 'slash-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'listbox');
    wrap.style.position = 'relative';
    wrap.appendChild(menu);
    slashState.menu = menu;
  };

  // Fuzzy match helper
  const fuzzyMatch = (str, pattern) => {
    const strLower = str.toLowerCase();
    const patternLower = pattern.toLowerCase();
    
    let patternIdx = 0;
    let strIdx = 0;
    let score = 0;
    let consecutiveMatches = 0;
    
    while (patternIdx < patternLower.length && strIdx < strLower.length) {
      if (patternLower[patternIdx] === strLower[strIdx]) {
        score += 1 + consecutiveMatches;
        consecutiveMatches++;
        patternIdx++;
      } else {
        consecutiveMatches = 0;
      }
      strIdx++;
    }
    
    // Return null if not all pattern chars matched, otherwise return score
    return patternIdx === patternLower.length ? score : null;
  };

  // Filter commands based on query with fuzzy matching
  const filterCommands = (query) => {
    const q = String(query || '').trim().toLowerCase();
    const commands = getAllCommands();
    
    // Score each command
    const scored = commands.map(c => {
      const cmdScore = fuzzyMatch(c.cmd, q);
      const descScore = fuzzyMatch(c.desc, q);
      const bestScore = Math.max(cmdScore ?? -1, descScore ?? -1);
      return { cmd: c, score: bestScore };
    }).filter(item => item.score >= 0);
    
    // Sort by score (higher is better)
    scored.sort((a, b) => b.score - a.score);
    
    return scored.map(item => item.cmd);
  };

  // Render menu items for commands
  const renderCommandMenu = (commands) => {
    if (!slashState.menu) return;
    slashState.menu.innerHTML = '';
    
    if (!commands || commands.length === 0) {
      hideMenu();
      return;
    }

    commands.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.className = 'slash-item';
      item.setAttribute('role', 'option');
      item.dataset.index = idx;
      
      if (idx === slashState.selectedIndex) {
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
      }

      const cmdSpan = document.createElement('span');
      cmdSpan.className = 'slash-cmd';
      cmdSpan.textContent = cmd.cmd;

      const descSpan = document.createElement('span');
      descSpan.className = 'slash-desc';
      descSpan.textContent = cmd.desc;

      item.appendChild(cmdSpan);
      item.appendChild(descSpan);

      // Click handler
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { window.__slashConsume = true; } catch (err) { try { console.warn('slash consume flag set failed', err); } catch (_) {} }
        executeCommand(cmd);
        setTimeout(() => { try { window.__slashConsume = false; } catch (err) { try { console.warn('slash consume flag reset failed', err); } catch (_) {} } }, 0);
      });

      slashState.menu.appendChild(item);
    });
  };

  // Render menu items for values
  const renderValueMenu = (values) => {
    if (!slashState.menu) return;
    slashState.menu.innerHTML = '';
    
    if (!values || values.length === 0) {
      hideMenu();
      return;
    }

    values.forEach((value, idx) => {
      const item = document.createElement('div');
      item.className = 'slash-item';
      item.setAttribute('role', 'option');
      item.dataset.index = idx;
      
      if (idx === slashState.selectedIndex) {
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
      }

      const cmdSpan = document.createElement('span');
      cmdSpan.className = 'slash-cmd';
      cmdSpan.textContent = value;

      item.appendChild(cmdSpan);

      // Click handler
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { window.__slashConsume = true; } catch (err) { try { console.warn('slash consume flag set failed', err); } catch (_) {} }
        executeValue(value);
        setTimeout(() => { try { window.__slashConsume = false; } catch (err) { try { console.warn('slash consume flag reset failed', err); } catch (_) {} } }, 0);
      });

      slashState.menu.appendChild(item);
    });
  };

  // Show command menu
  const showCommandMenu = (commands) => {
    if (!slashState.menu) initMenu();
    if (!slashState.menu) return;
    
    slashState.mode = 'command';
    slashState.filteredCommands = commands;
    slashState.selectedIndex = 0;
    renderCommandMenu(commands);
    slashState.menu.hidden = false;
    slashState.isOpen = true;
    
    // Set z-index -1 to result cards
    const resultCards = document.querySelectorAll('.result-card');
    resultCards.forEach(card => {
      card.style.zIndex = '-1';
    });
  };

  // Show value menu
  const showValueMenu = (values) => {
    if (!slashState.menu) initMenu();
    if (!slashState.menu) return;
    
    slashState.mode = 'value';
    slashState.availableValues = values;
    slashState.selectedIndex = 0;
    renderValueMenu(values);
    slashState.menu.hidden = false;
    slashState.isOpen = true;
    
    // Set z-index -1 to result cards
    const resultCards = document.querySelectorAll('.result-card');
    resultCards.forEach(card => {
      card.style.zIndex = '-1';
    });
  };

  // Hide menu
  const hideMenu = () => {
    if (!slashState.menu) return;
    slashState.menu.hidden = true;
    slashState.isOpen = false;
    slashState.selectedIndex = 0;
    slashState.filteredCommands = [];
    slashState.availableValues = [];
    slashState.slashStartPos = -1;
    slashState.mode = 'command';
    slashState.activeCommand = null;
    
    // Restore z-index for result cards
    const resultCards = document.querySelectorAll('.result-card');
    resultCards.forEach(card => {
      card.style.zIndex = '';
    });
  };

  // Update selection
  const updateSelection = (newIndex) => {
    const maxLength = slashState.mode === 'command' 
      ? slashState.filteredCommands.length 
      : slashState.availableValues.length;
    
    if (!maxLength) return;
    
    slashState.selectedIndex = Math.max(0, Math.min(newIndex, maxLength - 1));
    
    const items = slashState.menu.querySelectorAll('.slash-item');
    items.forEach((item, idx) => {
      if (idx === slashState.selectedIndex) {
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      }
    });
  };

  // Show help popup
  const showHelpPopup = () => {
    const existingPopup = document.getElementById('slash-help-popup');
    if (existingPopup) {
      existingPopup.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = 'slash-help-popup';
    overlay.className = 'slash-help-overlay';
    
    const popup = document.createElement('div');
    popup.className = 'slash-help-popup';
    
    const header = document.createElement('div');
    header.className = 'slash-help-header';
    header.innerHTML = '<h3>Command Cheatsheet</h3>';
    
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'slash-help-close';
    closeBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    closeBtn.setAttribute('aria-label', 'Close help');
    closeBtn.addEventListener('click', () => overlay.remove());
    header.appendChild(closeBtn);
    
    const content = document.createElement('div');
    content.className = 'slash-help-content';
    
    // Two-column grid layout
    const grid = document.createElement('div');
    grid.className = 'slash-help-grid';
    
    // Left column: Slash Commands
    const commandsSection = document.createElement('div');
    commandsSection.className = 'slash-help-section';
    commandsSection.innerHTML = '<h4>Slash Commands</h4>';
    
    const commandsList = document.createElement('ul');
    commandsList.className = 'slash-help-list';
    
    const commandExamples = {
      '/tag': 'e.g., /tag:security',
      '/section': 'e.g., /section:playbooks',
      '/reset': 'e.g., /reset:all',
      '/clear': 'e.g., /clear:tags'
    };
    
    getAllCommands().forEach(cmd => {
      const li = document.createElement('li');
      let example = commandExamples[cmd.cmd] || '';
      
      // Add hardcoded values if they exist
      if (cmd.getValues && typeof cmd.getValues === 'function') {
        try {
          const values = cmd.getValues();
          if (values && values.length > 0) {
            const valueList = values.slice(0, 3).join(', ');
            const more = values.length > 3 ? `, +${values.length - 3} more` : '';
            example = `<span class="slash-help-example">Values: ${valueList}${more}</span>`;
          }
        } catch (e) {}
      }
      
      const exampleHtml = example ? example : '';
      li.innerHTML = `<code>${cmd.cmd}</code><span>${cmd.desc}${exampleHtml}</span>`;
      commandsList.appendChild(li);
    });
    
    commandsSection.appendChild(commandsList);
    
    // Right column: Keyboard Shortcuts
    const shortcutsSection = document.createElement('div');
    shortcutsSection.className = 'slash-help-section';
    shortcutsSection.innerHTML = `
      <h4>Keyboard Shortcuts</h4>
      <ul class="slash-help-list">
        <li><div class="slash-help-keys"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></div><span>Navigate results</span></li>
        <li><div class="slash-help-keys"><kbd>Enter</kbd></div><span>Open selected result</span></li>
        <li><div class="slash-help-keys"><kbd>Alt</kbd><kbd>Click</kbd></div><span>Preview result</span></li>
        <li><div class="slash-help-keys"><kbd>Esc</kbd></div><span>Close menus</span></li>
      </ul>
    `;
    
    grid.appendChild(commandsSection);
    grid.appendChild(shortcutsSection);
    content.appendChild(grid);
    
    popup.appendChild(header);
    popup.appendChild(content);
    overlay.appendChild(popup);
    
    document.body.appendChild(overlay);
    
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    
    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  };

  // Execute selected command
  const executeCommand = (cmd) => {
    if (!cmd) return;
    
    const input = slashState.input;
    if (!input) return;

    const value = input.value;
    const beforeSlash = value.substring(0, slashState.slashStartPos);
    
    if (cmd.type === 'action') {
      // Execute action commands
      if (cmd.cmd === '/help') {
        showHelpPopup();
        input.value = beforeSlash;
        hideMenu();
        input.focus();
      }
      return;
    }
    
    if (cmd.type === 'toggle') {
      // Toggle the corresponding button
      const root = document.getElementById('search');
      if (!root) return;
      const btn = root.querySelector(`.si-toggles .toggle:nth-child(${cmd.toggleIndex})`);
      if (btn) {
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        const next = !pressed;
        btn.setAttribute('aria-pressed', next ? 'true' : 'false');
        // Reflect visual state like toggle click handler
        try { btn.classList.toggle('is-active', next); } catch (e) { try { console.warn('Slash toggle class sync failed', e); } catch(_) {} }
        // Persist all toggle states to storage
        try {
          const root = document.getElementById('search');
          const toggleButtons = root ? root.querySelectorAll('.si-toggles .toggle') : [];
          const keys = ['wholeWord', 'caseSensitive', 'useRegex', 'liveQuery'];
          const states = {};
          toggleButtons.forEach((b, idx) => { states[keys[idx]] = (b.getAttribute('aria-pressed') === 'true'); });
          localStorage.setItem('si:searchToggles', JSON.stringify(states));
        } catch (e) { try { console.warn('Slash persist toggle states failed', e); } catch(_) {} }
        // Update search button disabled state based on current live toggle
        try {
          const searchBtn = document.getElementById('search-button');
          if (searchBtn && typeof getSearchOptions === 'function') {
            const opts = getSearchOptions();
            searchBtn.disabled = !!opts.liveQuery;
          }
        } catch (e) { try { console.warn('Slash update search button failed', e); } catch(_) {} }
        // Trigger search update (respect live mode via onSearch)
        if (typeof onSearch === 'function') {
          setTimeout(() => onSearch({ target: { value: beforeSlash.trim() } }), 0);
        }
      }
      // Remove slash command from input
      input.value = beforeSlash;
      hideMenu();
      input.focus();
    } else if (cmd.type === 'value-picker') {
      // Show value picker menu
      slashState.activeCommand = cmd;
      // Replace the typed command with the full command name + ':'
      input.value = beforeSlash + cmd.cmd + ':';
      input.setSelectionRange(input.value.length, input.value.length);
      
      const values = typeof cmd.getValues === 'function' ? cmd.getValues() : [];
      if (values.length > 0) {
        showValueMenu(values);
      } else {
        hideMenu();
      }
    }
  };

  // Execute selected value (second step)
  const executeValue = (value) => {
    if (!value || !slashState.activeCommand) return;
    
    const input = slashState.input;
    if (!input) return;

    const inputValue = input.value;
    const beforeSlash = inputValue.substring(0, slashState.slashStartPos);
    const cmd = slashState.activeCommand;
    
    if (cmd.cmd === '/tag') {
      // Toggle tag in filter system instead of keeping in query
      if (typeof window.tagFilters !== 'undefined' && typeof window.tagFilters.toggle === 'function') {
        window.tagFilters.toggle(value);
      }
      // Remove /tag:value from input (keep beforeSlash text only)
      input.value = beforeSlash.trim() + (beforeSlash.trim() ? ' ' : '');
      hideMenu();
      input.focus();
      // Search is triggered by tagFilters.toggle
    } else if (cmd.cmd === '/section') {
      // Toggle section
      if (typeof toggleTab === 'function') {
        toggleTab(value);
        // Trigger search update
        if (typeof performSearch === 'function') {
          setTimeout(() => performSearch(beforeSlash.trim()), 0);
        }
      }
      // Remove slash command from input (including the ':' we added)
      input.value = beforeSlash;
      hideMenu();
      input.focus();
    } else if (cmd.cmd === '/reset' || cmd.cmd === '/clear') {
      // Reset/clear tags, section, or all
      if (value === 'all') {
        // Clear all: tags, input, and reset section
        if (typeof window.tagFilters !== 'undefined' && typeof window.tagFilters.clear === 'function') {
          window.tagFilters.clear();
        }
        if (typeof toggleTab === 'function') {
          toggleTab('all');
        }
        input.value = '';
      } else if (value === 'tags') {
        if (typeof window.tagFilters !== 'undefined' && typeof window.tagFilters.clear === 'function') {
          window.tagFilters.clear();
        }
        input.value = beforeSlash;
      } else if (value === 'section') {
        if (typeof toggleTab === 'function') {
          toggleTab('all');
        }
        input.value = beforeSlash;
      }
      hideMenu();
      input.focus();
    }
  };

  // Filter values based on query
  const filterValues = (values, query) => {
    const qraw = String(query || '').trim();
    if (!qraw) return values;
    const q = qraw.toLowerCase();
    
    // Score each value
    const scored = values.map(v => {
      const score = fuzzyMatch(v, q);
      return { value: v, score: score ?? -1 };
    }).filter(item => item.score >= 0);
    
    // Sort by score (higher is better)
    scored.sort((a, b) => b.score - a.score);
    
    return scored.map(item => item.value);
  };

  // Handle input changes
  const onInputChange = (e) => {
    const input = e.target;
    if (!input) return;
    
    const value = input.value;
    const cursorPos = input.selectionStart;
    
    // If we're in value-picking mode, filter values based on text after ':'
    if (slashState.mode === 'value' && slashState.activeCommand) {
      const colonPos = value.indexOf(':', slashState.slashStartPos);
      if (colonPos !== -1 && cursorPos > colonPos) {
        const query = value.substring(colonPos + 1, cursorPos).trim();
        const allValues = typeof slashState.activeCommand.getValues === 'function' 
          ? slashState.activeCommand.getValues() 
          : [];
        const filtered = filterValues(allValues, query);
        if (filtered.length > 0) {
          showValueMenu(filtered);
        } else {
          // No matches, but keep menu open with all values
          showValueMenu(allValues);
        }
      }
      return;
    }
    
    // Command mode: find last slash before cursor
    let slashPos = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (value[i] === '/') {
        // Check if it's at start or preceded by whitespace
        if (i === 0 || /\s/.test(value[i - 1])) {
          slashPos = i;
          break;
        }
      }
      // Stop if we hit whitespace (slash command must be continuous)
      if (/\s/.test(value[i])) break;
    }

    if (slashPos === -1) {
      hideMenu();
      return;
    }

    slashState.slashStartPos = slashPos;
    const query = value.substring(slashPos, cursorPos).trim();
    
    if (query === '/') {
      // Show all commands
      showCommandMenu(getAllCommands());
    } else {
      // Filter commands
      const filtered = filterCommands(query);
      if (filtered.length > 0) {
        showCommandMenu(filtered);
      } else {
        hideMenu();
      }
    }
  };

  // Handle keyboard navigation
  const onKeyDown = (e) => {
    if (!slashState.isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        updateSelection(slashState.selectedIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        updateSelection(slashState.selectedIndex - 1);
        break;
      case 'Enter':
      case 'Tab':
        // Only prevent default if there are items to select
        const hasItems = (slashState.mode === 'command' && slashState.filteredCommands.length > 0) ||
                        (slashState.mode === 'value' && slashState.availableValues.length > 0);
        if (!hasItems) {
          // No matches, allow default Tab behavior
          if (e.key === 'Tab') return;
          // For Enter with no matches, just hide menu
          e.preventDefault();
          hideMenu();
          break;
        }
        
        e.preventDefault();
        try { window.__slashConsume = true; } catch (err) { try { console.warn('slash consume flag set failed', err); } catch (_) {} }
        if (slashState.mode === 'command') {
          if (slashState.filteredCommands.length > 0) {
            const cmd = slashState.filteredCommands[slashState.selectedIndex];
            if (cmd) executeCommand(cmd);
          }
        } else if (slashState.mode === 'value') {
          if (slashState.availableValues.length > 0) {
            const value = slashState.availableValues[slashState.selectedIndex];
            if (value) executeValue(value);
          }
        }
        setTimeout(() => { try { window.__slashConsume = false; } catch (err) { try { console.warn('slash consume flag reset failed', err); } catch (_) {} } }, 0);
        break;
      case 'Escape':
        e.preventDefault();
        hideMenu();
        break;
    }
  };

  // Initialize
  const init = () => {
    const input = document.getElementById('search-input');
    if (!input) {
      console.warn('Slash menu: search input not found');
      return;
    }
    
    slashState.input = input;
    initMenu();
    
    // Attach event listeners
    input.addEventListener('input', onInputChange);
    input.addEventListener('keydown', onKeyDown);
    
    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (slashState.isOpen && !slashState.menu.contains(e.target) && e.target !== input) {
        hideMenu();
      }
    });
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for external use if needed
  window.slashMenu = {
    show: showCommandMenu,
    hide: hideMenu,
    isOpen: () => slashState.isOpen,
    addCommand: (cmd) => STATIC_COMMANDS.push(cmd),
    refresh: () => {
      // Refresh menu if open to show updated data
      if (slashState.isOpen && slashState.input) {
        if (slashState.mode === 'command') {
          const value = slashState.input.value;
          const cursorPos = slashState.input.selectionStart;
          const query = value.substring(slashState.slashStartPos, cursorPos);
          if (query === '/') {
            showCommandMenu(getAllCommands());
          } else {
            const filtered = filterCommands(query);
            if (filtered.length > 0) showCommandMenu(filtered);
          }
        } else if (slashState.mode === 'value' && slashState.activeCommand) {
          const values = typeof slashState.activeCommand.getValues === 'function' 
            ? slashState.activeCommand.getValues() 
            : [];
          if (values.length > 0) showValueMenu(values);
        }
      }
    }
  };
})();
