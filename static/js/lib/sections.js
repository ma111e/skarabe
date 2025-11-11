const selectTabs = (tabsArr) => {
    const valid = new Set(state.tabs);
    const selected = new Set((tabsArr || []).filter(t => valid.has(t)));
    if (selected.size === 0) {
        state.selectedTabs = new Set(['all']);
    } else if (selected.has('all')) {
        state.selectedTabs = new Set(['all']);
    } else {
        state.selectedTabs = selected;
    }
    setTabsInURL(Array.from(state.selectedTabs.has('all') ? [] : state.selectedTabs));
    renderTabs();
};

const toggleTab = (tab) => {
    if (tab === 'all') {
        selectTabs(['all']);
    } else {
        const next = new Set(state.selectedTabs);
        next.delete('all');
        if (next.has(tab)) next.delete(tab); else next.add(tab);
        if (next.size === 0) next.add('all');
        selectTabs(Array.from(next));
    }
    // Re-run search or show recents
    const q = ($input && $input.value || '').trim();
    if (q.length >= MIN_LEN) {
        onSearch({ target: { value: q } });
    } else if (q.length === 0) {
        showRecent();
    } else {
        $results.innerHTML = "";
        setStats(`Type at least ${MIN_LEN} characters`);
        setLastMatches([]);
    }
};

const renderTabs = () => {
    // Render into the tag cloud above the search bar. Keep sidebar intact but unused.
    let $tabs = document.getElementById('tag-cloud');
    if (!$tabs) {
        const root = document.getElementById('search');
        if (root) {
            $tabs = document.createElement('div');
            $tabs.id = 'tag-cloud';
            $tabs.className = 'tabs-container';
            root.insertBefore($tabs, root.firstChild);
        } else {
            // Fallback: create a local container before results if search root is not found
            $tabs = document.createElement('div');
            $tabs.id = 'tag-cloud';
            $tabs.className = 'tabs-container';
            if ($results && $results.parentNode) {
                $results.parentNode.insertBefore($tabs, $results);
            }
        }
    }
    $tabs.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'tabs';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Filter by section');
    const currentFocus = Math.min(Math.max(state.focusedTabIndex || 0, 0), state.tabs.length - 1);
    state.tabs.forEach((tab, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tab';
        btn.dataset.section = tab;
        btn.textContent = (tab === 'all' ? 'All' : tab);

        const pressed = state.selectedTabs.has('all') ? (tab === 'all') : state.selectedTabs.has(tab);
        btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        if (pressed) btn.classList.add('active'); else btn.classList.remove('active');
        btn.setAttribute('tabindex', i === currentFocus ? '0' : '-1');
        btn.addEventListener('click', () => toggleTab(tab));
        list.appendChild(btn);
    });

    $tabs.appendChild(list);

    // Animate tabs with stagger effect only on first render with 300ms delay
    if (typeof Motion !== 'undefined' && Motion.animate && Motion.stagger && !state.tabsAnimated) {
        state.tabsAnimated = true;
        setTimeout(() => {
            Motion.animate(
                '.tab',
                { opacity: [0, 1] },
                {
                    duration: 0.2,
                    delay: Motion.stagger(0.05, { start: 0 }),
                    easing: [0.22, 0.61, 0.36, 1]
                }
            );
        }, 100);
    } else if (state.tabsAnimated) {
        // Set opacity to 1 immediately for subsequent renders
        document.querySelectorAll('.tab').forEach(tab => {
            tab.style.opacity = '1';
        });
    }
};