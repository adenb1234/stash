// Stash Web App (Single-user mode - no auth required)
class StashApp {
  constructor() {
    this.supabase = null;
    this.user = { id: CONFIG.USER_ID }; // Hardcoded single user
    this.currentView = 'all';
    this.currentSave = null;
    this.currentFolder = null;
    this.currentTag = null;
    this.highlightTagFilter = null; // Tag filter for highlights view
    this.saves = [];
    this.tags = [];
    this.folders = [];
    this.pendingKindleImport = null; // Stores parsed highlights before import

    // Audio player state
    this.audio = null;
    this.isPlaying = false;

    // Feed state
    this.feeds = [];
    this.feedCategories = [];
    this.feedItems = [];
    this.feedViewTab = 'unseen'; // 'unseen' or 'seen'
    this.currentFeedCategory = null;
    this.discoveredFeed = null; // Stores discovered feed info before subscribing

    this.init();
  }

  async init() {
    // Initialize Supabase
    this.supabase = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_ANON_KEY
    );

    // Load theme preference
    this.loadTheme();

    // Skip auth - go straight to main screen
    this.showMainScreen();
    this.loadData();

    this.bindEvents();
  }

  // Theme Management
  loadTheme() {
    const savedTheme = localStorage.getItem('stash-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.updateThemeToggle(savedTheme);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('stash-theme', newTheme);
    this.updateThemeToggle(newTheme);
  }

  updateThemeToggle(theme) {
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    const label = document.querySelector('.theme-label');

    if (theme === 'dark') {
      sunIcon?.classList.add('hidden');
      moonIcon?.classList.remove('hidden');
      if (label) label.textContent = 'Light Mode';
    } else {
      sunIcon?.classList.remove('hidden');
      moonIcon?.classList.add('hidden');
      if (label) label.textContent = 'Dark Mode';
    }
  }

  bindEvents() {
    // Auth form
    document.getElementById('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.signIn();
    });

    document.getElementById('signup-btn').addEventListener('click', () => {
      this.signUp();
    });

    document.getElementById('signout-btn').addEventListener('click', () => {
      this.signOut();
    });

    // Navigation
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        this.setView(view);
      });
    });

    // Search
    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this.search(e.target.value);
      }, 300);
    });

    // Sort
    document.getElementById('sort-select').addEventListener('change', (e) => {
      this.loadSaves();
    });

    // Tag filter for highlights view
    document.getElementById('tag-filter-select').addEventListener('change', (e) => {
      this.highlightTagFilter = e.target.value || null;
      this.loadSaves();
    });

    // Reading pane
    document.getElementById('close-reading-btn').addEventListener('click', () => {
      this.closeReadingPane();
    });

    document.getElementById('archive-btn').addEventListener('click', () => {
      this.toggleArchive();
    });

    document.getElementById('favorite-btn').addEventListener('click', () => {
      this.toggleFavorite();
    });

    document.getElementById('delete-btn').addEventListener('click', () => {
      this.deleteSave();
    });

    document.getElementById('add-tag-btn').addEventListener('click', () => {
      this.addTagToSave();
    });

    // Mobile menu
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    document.getElementById('mobile-menu-btn').addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('open');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });

    // Close sidebar when nav item clicked on mobile
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('open');
          overlay.classList.remove('open');
        }
      });
    });

    // Add folder
    document.getElementById('add-folder-btn').addEventListener('click', () => {
      this.addFolder();
    });

    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', () => {
      this.toggleTheme();
    });

    // Reading progress bar
    const readingContent = document.getElementById('reading-content');
    if (readingContent) {
      readingContent.addEventListener('scroll', () => {
        this.updateReadingProgress();
      });
    }

    // Audio player controls
    document.getElementById('audio-play-btn').addEventListener('click', () => {
      this.toggleAudioPlayback();
    });

    document.getElementById('audio-speed').addEventListener('change', (e) => {
      if (this.audio) {
        this.audio.playbackRate = parseFloat(e.target.value);
      }
    });

    document.getElementById('audio-progress-bar').addEventListener('click', (e) => {
      if (this.audio && this.audio.duration) {
        const rect = e.target.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        this.audio.currentTime = percent * this.audio.duration;
      }
    });

    // Kindle Import
    document.getElementById('kindle-import-btn').addEventListener('click', () => {
      this.showKindleImportModal();
    });

    const kindleModal = document.getElementById('kindle-import-modal');
    const kindleDropzone = document.getElementById('kindle-dropzone');
    const kindleFileInput = document.getElementById('kindle-file-input');

    // Modal close handlers
    kindleModal.querySelector('.modal-overlay').addEventListener('click', () => {
      this.hideKindleImportModal();
    });
    kindleModal.querySelector('.modal-close-btn').addEventListener('click', () => {
      this.hideKindleImportModal();
    });
    document.getElementById('kindle-cancel-btn').addEventListener('click', () => {
      this.hideKindleImportModal();
    });
    document.getElementById('kindle-confirm-btn').addEventListener('click', () => {
      this.confirmKindleImport();
    });

    // Dropzone interactions
    kindleDropzone.addEventListener('click', () => {
      kindleFileInput.click();
    });

    kindleFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleKindleFile(e.target.files[0]);
      }
    });

    // Drag and drop
    kindleDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      kindleDropzone.classList.add('dragover');
    });

    kindleDropzone.addEventListener('dragleave', () => {
      kindleDropzone.classList.remove('dragover');
    });

    kindleDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      kindleDropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        this.handleKindleFile(e.dataTransfer.files[0]);
      }
    });

    // Digest Settings Modal
    const digestModal = document.getElementById('digest-modal');

    document.getElementById('digest-settings-btn').addEventListener('click', () => {
      this.showDigestModal();
    });

    digestModal.querySelector('.modal-overlay').addEventListener('click', () => {
      this.hideDigestModal();
    });
    digestModal.querySelector('.modal-close-btn').addEventListener('click', () => {
      this.hideDigestModal();
    });
    document.getElementById('digest-cancel-btn').addEventListener('click', () => {
      this.hideDigestModal();
    });
    document.getElementById('digest-save-btn').addEventListener('click', () => {
      this.saveDigestPreferences();
    });

    // Toggle enabled/disabled state of options
    document.getElementById('digest-enabled').addEventListener('change', () => {
      this.updateDigestOptionsState();
    });

    // Add Feed Modal
    const addFeedModal = document.getElementById('add-feed-modal');

    document.getElementById('add-feed-btn').addEventListener('click', () => {
      this.showAddFeedModal();
    });

    addFeedModal.querySelector('.modal-overlay').addEventListener('click', () => {
      this.hideAddFeedModal();
    });
    addFeedModal.querySelector('.modal-close-btn').addEventListener('click', () => {
      this.hideAddFeedModal();
    });
    document.getElementById('feed-cancel-btn').addEventListener('click', () => {
      this.hideAddFeedModal();
    });
    document.getElementById('feed-subscribe-btn').addEventListener('click', () => {
      this.subscribeFeed();
    });

    // Feed URL input with debounced discovery
    let feedUrlTimeout;
    document.getElementById('feed-url-input').addEventListener('input', (e) => {
      clearTimeout(feedUrlTimeout);
      feedUrlTimeout = setTimeout(() => {
        const url = e.target.value.trim();
        if (url && url.startsWith('http')) {
          this.discoverFeed(url);
        }
      }, 500);
    });

    // Add category in modal
    document.getElementById('add-category-btn').addEventListener('click', () => {
      this.addCategoryInModal();
    });
    document.getElementById('new-category-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addCategoryInModal();
      }
    });

    // Global keyboard shortcuts for feeds
    document.addEventListener('keydown', (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Feed reader shortcuts
      if (this.currentView === 'feed-reader') {
        // Esc to go back
        if (e.key === 'Escape') {
          e.preventDefault();
          this.currentFeedItem = null;
          this.setView('feeds');
          return;
        }
        // 'o' to open original URL
        if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          if (this.currentFeedItem?.url) {
            window.open(this.currentFeedItem.url, '_blank');
          }
          return;
        }
      }

      // Feed inbox keyboard shortcuts
      if (this.currentView === 'feeds' && this.feedItems.length > 0) {
        // Arrow keys to navigate
        if (e.key === 'ArrowDown' || e.key === 'j') {
          e.preventDefault();
          this.selectFeedItem((this.selectedFeedIndex ?? -1) + 1);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'k') {
          e.preventDefault();
          this.selectFeedItem((this.selectedFeedIndex ?? 1) - 1);
          return;
        }

        // Actions on selected item
        if (this.selectedFeedIndex !== null && this.selectedFeedIndex >= 0) {
          const item = this.feedItems[this.selectedFeedIndex];
          if (!item) return;

          // 'e' to mark as seen
          if (e.key === 'e' || e.key === 'E') {
            e.preventDefault();
            this.markFeedItemSeen(item);
            return;
          }

          // 'o' or Enter to open
          if (e.key === 'o' || e.key === 'O' || e.key === 'Enter') {
            e.preventDefault();
            this.openFeedItem(item);
            return;
          }
        }
      }
    });
  }

  selectFeedItem(index) {
    // Clamp index to valid range
    if (index < 0) index = 0;
    if (index >= this.feedItems.length) index = this.feedItems.length - 1;

    this.selectedFeedIndex = index;

    // Update visual selection
    document.querySelectorAll('.feed-item-row').forEach((row, i) => {
      row.classList.toggle('selected', i === index);
    });

    // Scroll into view if needed
    const selectedRow = document.querySelector('.feed-item-row.selected');
    if (selectedRow) {
      selectedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('main-screen').classList.add('hidden');
  }

  showMainScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
  }

  async signIn() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');
    const btn = document.getElementById('signin-btn');

    btn.disabled = true;
    btn.textContent = 'Signing in...';
    errorEl.textContent = '';

    const { error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      errorEl.textContent = error.message;
    }

    btn.disabled = false;
    btn.textContent = 'Sign In';
  }

  async signUp() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');
    const messageEl = document.getElementById('auth-message');
    const btn = document.getElementById('signup-btn');

    if (!email || !password) {
      errorEl.textContent = 'Please enter email and password';
      return;
    }

    if (password.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';
    errorEl.textContent = '';
    messageEl.textContent = '';

    const { error } = await this.supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      errorEl.textContent = error.message;
    } else {
      messageEl.textContent = 'Check your email to confirm your account!';
    }

    btn.disabled = false;
    btn.textContent = 'Create Account';
  }

  async signOut() {
    await this.supabase.auth.signOut();
  }

  async loadData() {
    await Promise.all([
      this.loadSaves(),
      this.loadTags(),
      this.loadFolders(),
      this.loadFeeds(),
      this.loadFeedCategories(),
    ]);
    this.updateFeedUnreadBadge();
  }

  async loadSaves() {
    const container = document.getElementById('saves-container');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');

    loading.classList.remove('hidden');
    container.innerHTML = '';

    const sortValue = document.getElementById('sort-select').value;
    const [column, direction] = sortValue.split('.');

    let query = this.supabase
      .from('saves')
      .select('*, save_tags(tags(id, name, color))')
      .order(column, { ascending: direction === 'asc' });

    // Apply view filters
    if (this.currentView === 'highlights') {
      query = query.not('highlight', 'is', null);
    } else if (this.currentView === 'articles') {
      query = query.is('highlight', null);
    } else if (this.currentView === 'archived') {
      query = query.eq('is_archived', true);
    } else if (this.currentView === 'weekly') {
      // Weekly review - get this week's saves
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte('created_at', weekAgo.toISOString());
    } else {
      query = query.eq('is_archived', false);
    }

    // Apply folder filter
    if (this.currentFolder) {
      query = query.eq('folder_id', this.currentFolder);
    }

    // Apply tag filter for highlights view
    if (this.currentView === 'highlights' && this.highlightTagFilter) {
      // Get save IDs that have this tag
      const { data: taggedSaves } = await this.supabase
        .from('save_tags')
        .select('save_id')
        .eq('tag_id', this.highlightTagFilter);

      if (!taggedSaves || taggedSaves.length === 0) {
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
        this.saves = [];
        return;
      }

      const saveIds = taggedSaves.map(ts => ts.save_id);
      query = query.in('id', saveIds);
    }

    const { data, error } = await query;

    loading.classList.add('hidden');

    if (error) {
      console.error('Error loading saves:', error);
      return;
    }

    this.saves = data || [];

    if (this.saves.length === 0) {
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      // Use special rendering for weekly view
      if (this.currentView === 'weekly') {
        this.renderWeeklyReview();
      } else {
        this.renderSaves();
      }
    }
  }

  // Helper to extract tags from nested save_tags structure
  getTagsForSave(save) {
    if (!save.save_tags || !Array.isArray(save.save_tags)) return [];
    return save.save_tags
      .map(st => st.tags)
      .filter(t => t != null);
  }

  // Render tags HTML for a save
  renderTagsHtml(save) {
    const tags = this.getTagsForSave(save);
    if (tags.length === 0) return '';
    return `
      <div class="save-card-tags">
        ${tags.map(tag => `<span class="save-card-tag" style="background: ${tag.color || '#6366f1'}20; color: ${tag.color || '#6366f1'}">${this.escapeHtml(tag.name)}</span>`).join('')}
      </div>
    `;
  }

  // Populate the tag filter dropdown for highlights view
  async populateHighlightTagFilter() {
    const select = document.getElementById('tag-filter-select');
    const currentValue = select.value;

    // Get tags that are used by highlights
    const { data: highlightTags } = await this.supabase
      .from('save_tags')
      .select('tag_id, tags(id, name), saves!inner(highlight)')
      .not('saves.highlight', 'is', null);

    // Get unique tags
    const tagMap = new Map();
    if (highlightTags) {
      for (const ht of highlightTags) {
        if (ht.tags && !tagMap.has(ht.tags.id)) {
          tagMap.set(ht.tags.id, ht.tags.name);
        }
      }
    }

    // Sort tags alphabetically
    const sortedTags = [...tagMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

    // Build options
    select.innerHTML = `<option value="">All Tags (${sortedTags.length})</option>` +
      sortedTags.map(([id, name]) => `<option value="${id}">${this.escapeHtml(name)}</option>`).join('');

    // Restore selection if still valid
    if (currentValue && tagMap.has(currentValue)) {
      select.value = currentValue;
    }
  }

  renderSaves() {
    const container = document.getElementById('saves-container');

    // Restore grid class for saves layout
    container.classList.add('saves-grid');

    container.innerHTML = this.saves.map(save => {
      const isHighlight = !!save.highlight;
      const date = new Date(save.created_at).toLocaleDateString();
      const tagsHtml = this.renderTagsHtml(save);

      if (isHighlight) {
        return `
          <div class="save-card highlight" data-id="${save.id}">
            <div class="save-card-content">
              <div class="save-card-site">${this.escapeHtml(save.site_name || '')}</div>
              <div class="save-card-highlight">"${this.escapeHtml(save.highlight)}"</div>
              ${save.note ? `<div class="save-card-note">${this.escapeHtml(save.note)}</div>` : ''}
              ${tagsHtml}
              <div class="save-card-title">${this.escapeHtml(save.title || 'Untitled')}</div>
              <div class="save-card-meta">
                <span class="save-card-date">${date}</span>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="save-card" data-id="${save.id}">
          ${save.image_url ? `<img class="save-card-image" src="${save.image_url}" alt="" onerror="this.style.display='none'">` : ''}
          <div class="save-card-content">
            <div class="save-card-site">${this.escapeHtml(save.site_name || '')}</div>
            <div class="save-card-title">${this.escapeHtml(save.title || 'Untitled')}</div>
            <div class="save-card-excerpt">${this.escapeHtml(save.excerpt || '')}</div>
            ${tagsHtml}
            <div class="save-card-meta">
              <span class="save-card-date">${date}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Bind click events
    container.querySelectorAll('.save-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const save = this.saves.find(s => s.id === id);
        if (save) this.openReadingPane(save);
      });
    });
  }

  // Weekly Review special rendering
  renderWeeklyReview() {
    const container = document.getElementById('saves-container');

    // Calculate stats
    const articles = this.saves.filter(s => !s.highlight);
    const highlights = this.saves.filter(s => s.highlight);
    const totalWords = articles.reduce((sum, s) => {
      const words = (s.content || '').split(/\s+/).length;
      return sum + words;
    }, 0);

    // Get unique sites
    const sites = [...new Set(this.saves.map(s => s.site_name).filter(Boolean))];

    // Pick a random "rediscovery" from older saves
    let rediscovery = null;
    const allSavesQuery = this.supabase
      .from('saves')
      .select('*')
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(50);

    allSavesQuery.then(({ data }) => {
      if (data && data.length > 0) {
        rediscovery = data[Math.floor(Math.random() * data.length)];
        this.updateRediscovery(rediscovery);
      }
    });

    container.innerHTML = `
      <div class="weekly-review">
        <div class="weekly-header">
          <h3>Your Week in Review</h3>
          <p class="weekly-dates">${this.getWeekDateRange()}</p>
        </div>

        <div class="weekly-stats">
          <div class="weekly-stat">
            <span class="weekly-stat-value">${this.saves.length}</span>
            <span class="weekly-stat-label">items saved</span>
          </div>
          <div class="weekly-stat">
            <span class="weekly-stat-value">${articles.length}</span>
            <span class="weekly-stat-label">articles</span>
          </div>
          <div class="weekly-stat">
            <span class="weekly-stat-value">${highlights.length}</span>
            <span class="weekly-stat-label">highlights</span>
          </div>
          <div class="weekly-stat">
            <span class="weekly-stat-value">${Math.round(totalWords / 1000)}k</span>
            <span class="weekly-stat-label">words</span>
          </div>
        </div>

        ${sites.length > 0 ? `
          <div class="weekly-section">
            <h4>Sources</h4>
            <div class="weekly-sources">
              ${sites.slice(0, 10).map(site => `<span class="weekly-source">${this.escapeHtml(site)}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <div class="weekly-section" id="rediscovery-section">
          <h4>Rediscover</h4>
          <p class="weekly-rediscovery-hint">Loading a random gem from your archive...</p>
        </div>

        <div class="weekly-section">
          <h4>This Week's Saves</h4>
        </div>

        <div class="saves-grid">
          ${this.saves.map(save => this.renderSaveCard(save)).join('')}
        </div>
      </div>
    `;

    // Bind click events
    container.querySelectorAll('.save-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const save = this.saves.find(s => s.id === id);
        if (save) this.openReadingPane(save);
      });
    });
  }

  updateRediscovery(save) {
    const section = document.getElementById('rediscovery-section');
    if (!section || !save) return;

    const date = new Date(save.created_at).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    section.innerHTML = `
      <h4>Rediscover</h4>
      <div class="rediscovery-card" data-id="${save.id}">
        <div class="rediscovery-meta">Saved ${date}</div>
        <div class="rediscovery-title">${this.escapeHtml(save.title || 'Untitled')}</div>
        ${save.highlight ? `<div class="rediscovery-highlight">"${this.escapeHtml(save.highlight)}"</div>` : ''}
        <div class="rediscovery-source">${this.escapeHtml(save.site_name || '')}</div>
      </div>
    `;

    section.querySelector('.rediscovery-card')?.addEventListener('click', () => {
      this.openReadingPane(save);
    });
  }

  renderSaveCard(save) {
    const isHighlight = !!save.highlight;
    const date = new Date(save.created_at).toLocaleDateString();
    const tagsHtml = this.renderTagsHtml(save);

    if (isHighlight) {
      return `
        <div class="save-card highlight" data-id="${save.id}">
          <div class="save-card-content">
            <div class="save-card-site">${this.escapeHtml(save.site_name || '')}</div>
            <div class="save-card-highlight">"${this.escapeHtml(save.highlight)}"</div>
            ${save.note ? `<div class="save-card-note">${this.escapeHtml(save.note)}</div>` : ''}
            ${tagsHtml}
            <div class="save-card-title">${this.escapeHtml(save.title || 'Untitled')}</div>
            <div class="save-card-meta">
              <span class="save-card-date">${date}</span>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="save-card" data-id="${save.id}">
        ${save.image_url ? `<img class="save-card-image" src="${save.image_url}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="save-card-content">
          <div class="save-card-site">${this.escapeHtml(save.site_name || '')}</div>
          <div class="save-card-title">${this.escapeHtml(save.title || 'Untitled')}</div>
          <div class="save-card-excerpt">${this.escapeHtml(save.excerpt || '')}</div>
          ${tagsHtml}
          <div class="save-card-meta">
            <span class="save-card-date">${date}</span>
          </div>
        </div>
      </div>
    `;
  }

  getWeekDateRange() {
    const now = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const options = { month: 'short', day: 'numeric' };
    return `${weekAgo.toLocaleDateString('en-US', options)} - ${now.toLocaleDateString('en-US', options)}`;
  }

  async loadTags() {
    const { data } = await this.supabase
      .from('tags')
      .select('*')
      .order('name');

    this.tags = data || [];
    this.renderTags();
  }

  renderTags() {
    const container = document.getElementById('tags-list');
    container.innerHTML = this.tags.map(tag => `
      <span class="tag${this.currentTag === tag.id ? ' active' : ''}" data-id="${tag.id}">${this.escapeHtml(tag.name)}</span>
    `).join('');

    container.querySelectorAll('.tag').forEach(el => {
      el.addEventListener('click', () => {
        const tagId = el.dataset.id;
        this.filterByTag(tagId);
      });
    });
  }

  async filterByTag(tagId) {
    // Clear other filters
    this.currentFolder = null;
    this.currentView = 'all';

    // Toggle tag filter (click again to clear)
    if (this.currentTag === tagId) {
      this.currentTag = null;
      document.getElementById('view-title').textContent = 'All Saves';
      this.loadSaves();
    } else {
      this.currentTag = tagId;
      const tag = this.tags.find(t => t.id === tagId);
      document.getElementById('view-title').textContent = tag ? `#${tag.name}` : 'Tag';

      // Load saves with this tag
      const container = document.getElementById('saves-container');
      const loading = document.getElementById('loading');
      const empty = document.getElementById('empty-state');

      loading.classList.remove('hidden');
      container.innerHTML = '';

      // Get save IDs that have this tag
      const { data: saveTagData } = await this.supabase
        .from('save_tags')
        .select('save_id')
        .eq('tag_id', tagId);

      if (!saveTagData || saveTagData.length === 0) {
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
        this.saves = [];
        return;
      }

      const saveIds = saveTagData.map(st => st.save_id);

      const sortValue = document.getElementById('sort-select').value;
      const [column, direction] = sortValue.split('.');

      const { data, error } = await this.supabase
        .from('saves')
        .select('*, save_tags(tags(id, name, color))')
        .in('id', saveIds)
        .eq('is_archived', false)
        .order(column, { ascending: direction === 'asc' });

      loading.classList.add('hidden');

      if (error) {
        console.error('Error loading saves by tag:', error);
        return;
      }

      this.saves = data || [];

      if (this.saves.length === 0) {
        empty.classList.remove('hidden');
      } else {
        empty.classList.add('hidden');
        this.renderSaves();
      }
    }

    // Update nav active states
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', !this.currentTag && item.dataset.view === 'all');
    });
    document.querySelectorAll('.nav-item[data-folder]').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelectorAll('.tag').forEach(item => {
      item.classList.toggle('active', item.dataset.id === this.currentTag);
    });
  }

  async loadFolders() {
    const { data } = await this.supabase
      .from('folders')
      .select('*')
      .order('name');

    this.folders = data || [];
    this.renderFolders();
  }

  renderFolders() {
    const container = document.getElementById('folders-list');
    container.innerHTML = this.folders.map(folder => `
      <a href="#" class="nav-item${this.currentFolder === folder.id ? ' active' : ''}" data-folder="${folder.id}">
        <span style="color: ${folder.color}">📁</span>
        ${this.escapeHtml(folder.name)}
      </a>
    `).join('');

    container.querySelectorAll('.nav-item[data-folder]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const folderId = el.dataset.folder;
        this.filterByFolder(folderId);
      });
    });
  }

  filterByFolder(folderId) {
    // Clear other filters
    this.currentTag = null;
    this.currentView = 'all';

    // Toggle folder filter (click again to clear)
    if (this.currentFolder === folderId) {
      this.currentFolder = null;
      document.getElementById('view-title').textContent = 'All Saves';
    } else {
      this.currentFolder = folderId;
      const folder = this.folders.find(f => f.id === folderId);
      document.getElementById('view-title').textContent = folder ? folder.name : 'Folder';
    }

    // Update nav active states
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', !this.currentFolder && item.dataset.view === 'all');
    });
    document.querySelectorAll('.nav-item[data-folder]').forEach(item => {
      item.classList.toggle('active', item.dataset.folder === this.currentFolder);
    });
    document.querySelectorAll('.tag').forEach(item => {
      item.classList.remove('active');
    });

    this.loadSaves();
  }

  setView(view) {
    this.currentView = view;
    this.currentFolder = null;
    this.currentTag = null;
    this.currentFeedCategory = null;

    // Update nav
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });
    document.querySelectorAll('.nav-item[data-folder]').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelectorAll('.tag').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelectorAll('.feed-category-item').forEach(item => {
      item.classList.remove('active');
    });

    // Update title
    const titles = {
      all: 'All Saves',
      highlights: 'Highlights',
      articles: 'Articles',
      kindle: 'Kindle Highlights',
      archived: 'Archived',
      stats: 'Stats',
      feeds: 'Feed Inbox',
      'manage-feeds': 'Manage Feeds',
      'feed-reader': '',
    };
    const titleEl = document.getElementById('view-title');
    if (titleEl) {
      titleEl.textContent = titles[view] || 'Saves';
      // Hide title for feed reader view
      titleEl.parentElement.style.display = view === 'feed-reader' ? 'none' : '';
    }

    // Show/hide tag filter for highlights view
    const tagFilterSelect = document.getElementById('tag-filter-select');
    if (view === 'highlights') {
      this.populateHighlightTagFilter();
      tagFilterSelect.classList.remove('hidden');
    } else {
      tagFilterSelect.classList.add('hidden');
      this.highlightTagFilter = null;
      tagFilterSelect.value = '';
    }

    if (view === 'stats') {
      this.showStats();
    } else if (view === 'kindle') {
      this.loadKindleHighlights();
    } else if (view === 'feeds') {
      this.loadFeedItems();
    } else if (view === 'manage-feeds') {
      this.renderManageFeedsView();
    } else if (view === 'feed-reader') {
      this.renderFeedReaderView();
    } else {
      this.loadSaves();
    }
  }

  async search(query) {
    if (!query.trim()) {
      this.loadSaves();
      return;
    }

    const { data } = await this.supabase.rpc('search_saves', {
      search_query: query,
      user_uuid: this.user.id,
    });

    this.saves = data || [];
    this.renderSaves();
  }

  openReadingPane(save) {
    this.currentSave = save;
    const pane = document.getElementById('reading-pane');

    // Stop any existing audio
    this.stopAudio();

    document.getElementById('reading-title').textContent = save.title || 'Untitled';
    document.getElementById('reading-meta').innerHTML = `
      ${save.site_name || ''} ${save.author ? `· ${save.author}` : ''} · ${new Date(save.created_at).toLocaleDateString()}
    `;

    // Handle audio player visibility
    const audioPlayer = document.getElementById('audio-player');
    const audioGenerating = document.getElementById('audio-generating');

    if (save.audio_url) {
      // Audio is ready - show player
      audioPlayer.classList.remove('hidden');
      audioGenerating.classList.add('hidden');
      this.initAudio(save.audio_url);
    } else if (save.content && save.content.length > 100 && !save.highlight) {
      // Content exists but no audio yet - show generating indicator
      audioPlayer.classList.add('hidden');
      audioGenerating.classList.remove('hidden');
    } else {
      // No audio applicable (highlights, short content)
      audioPlayer.classList.add('hidden');
      audioGenerating.classList.add('hidden');
    }

    if (save.highlight) {
      document.getElementById('reading-body').innerHTML = `
        <blockquote style="font-style: italic; background: #fef3c7; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          "${this.escapeHtml(save.highlight)}"
        </blockquote>
        ${save.note ? `
          <div style="background: #f0fdf4; padding: 16px 20px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid #22c55e;">
            <div style="font-size: 12px; color: #16a34a; font-weight: 600; margin-bottom: 6px;">MY NOTE</div>
            <div style="color: #166534;">${this.escapeHtml(save.note)}</div>
          </div>
        ` : ''}
        <p><a href="${save.url}" target="_blank" style="color: var(--primary);">View original →</a></p>
      `;
    } else {
      const content = save.content || save.excerpt || 'No content available.';
      document.getElementById('reading-body').innerHTML = this.renderMarkdown(content);
    }

    document.getElementById('open-original-btn').href = save.url || '#';

    // Update button states
    document.getElementById('archive-btn').classList.toggle('active', save.is_archived);
    document.getElementById('favorite-btn').classList.toggle('active', save.is_favorite);

    pane.classList.remove('hidden');
    // Add open class for mobile slide-in animation
    requestAnimationFrame(() => {
      pane.classList.add('open');
    });
  }

  closeReadingPane() {
    const pane = document.getElementById('reading-pane');
    pane.classList.remove('open');
    // Stop audio when closing
    this.stopAudio();
    // Reset progress bar
    const progressFill = document.getElementById('reading-progress-fill');
    if (progressFill) progressFill.style.width = '0%';
    // Wait for animation on mobile before hiding
    setTimeout(() => {
      if (!pane.classList.contains('open')) {
        pane.classList.add('hidden');
      }
    }, 300);
    this.currentSave = null;
  }

  // Reading Progress Bar
  updateReadingProgress() {
    const readingContent = document.getElementById('reading-content');
    const progressFill = document.getElementById('reading-progress-fill');

    if (!readingContent || !progressFill) return;

    const scrollTop = readingContent.scrollTop;
    const scrollHeight = readingContent.scrollHeight - readingContent.clientHeight;

    if (scrollHeight > 0) {
      const progress = (scrollTop / scrollHeight) * 100;
      progressFill.style.width = `${Math.min(progress, 100)}%`;
    }
  }

  // Audio player methods
  async initAudio(url) {
    this.stopAudio();

    // Extract filename from URL and get a signed URL
    const filename = url.split('/').pop();
    const signedUrl = await this.getSignedAudioUrl(filename);

    if (!signedUrl) {
      console.error('Failed to get signed URL for audio');
      return;
    }

    this.audio = new Audio(signedUrl);
    this.isPlaying = false;

    // Reset UI
    document.getElementById('audio-progress').style.width = '0%';
    document.getElementById('audio-current').textContent = '0:00';
    document.getElementById('audio-duration').textContent = '0:00';
    document.getElementById('audio-speed').value = '1';
    this.updatePlayButton();

    // Set up event listeners
    this.audio.addEventListener('loadedmetadata', () => {
      document.getElementById('audio-duration').textContent = this.formatTime(this.audio.duration);
    });

    this.audio.addEventListener('timeupdate', () => {
      const progress = (this.audio.currentTime / this.audio.duration) * 100;
      document.getElementById('audio-progress').style.width = `${progress}%`;
      document.getElementById('audio-current').textContent = this.formatTime(this.audio.currentTime);
    });

    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.updatePlayButton();
    });

    this.audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
    });
  }

  toggleAudioPlayback() {
    if (!this.audio) return;

    if (this.isPlaying) {
      this.audio.pause();
      this.isPlaying = false;
    } else {
      this.audio.play();
      this.isPlaying = true;
    }
    this.updatePlayButton();
  }

  stopAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
      this.isPlaying = false;
      this.updatePlayButton();
    }
  }

  updatePlayButton() {
    const playIcon = document.querySelector('#audio-play-btn .play-icon');
    const pauseIcon = document.querySelector('#audio-play-btn .pause-icon');

    if (this.isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  async getSignedAudioUrl(path) {
    // Get a signed URL for the audio file (valid for 1 hour)
    const { data, error } = await this.supabase.storage
      .from('audio')
      .createSignedUrl(path, 3600);

    if (error) {
      console.error('Error getting signed URL:', error);
      return null;
    }
    return data.signedUrl;
  }

  async toggleArchive() {
    if (!this.currentSave) return;

    const newValue = !this.currentSave.is_archived;
    await this.supabase
      .from('saves')
      .update({ is_archived: newValue })
      .eq('id', this.currentSave.id);

    this.currentSave.is_archived = newValue;
    this.loadSaves();
    if (newValue) this.closeReadingPane();
  }

  async toggleFavorite() {
    if (!this.currentSave) return;

    const newValue = !this.currentSave.is_favorite;
    await this.supabase
      .from('saves')
      .update({ is_favorite: newValue })
      .eq('id', this.currentSave.id);

    this.currentSave.is_favorite = newValue;
    document.getElementById('favorite-btn').classList.toggle('active', newValue);
  }

  async deleteSave() {
    if (!this.currentSave) return;

    if (!confirm('Delete this save? This cannot be undone.')) return;

    await this.supabase
      .from('saves')
      .delete()
      .eq('id', this.currentSave.id);

    this.closeReadingPane();
    this.loadSaves();
  }

  async addTagToSave() {
    if (!this.currentSave) return;

    const tagName = prompt('Enter tag name:');
    if (!tagName?.trim()) return;

    // Get or create tag
    let { data: existingTag } = await this.supabase
      .from('tags')
      .select('*')
      .eq('name', tagName.trim())
      .single();

    if (!existingTag) {
      const { data: newTag } = await this.supabase
        .from('tags')
        .insert({ user_id: this.user.id, name: tagName.trim() })
        .select()
        .single();
      existingTag = newTag;
    }

    if (existingTag) {
      await this.supabase
        .from('save_tags')
        .insert({ save_id: this.currentSave.id, tag_id: existingTag.id });

      this.loadTags();
    }
  }

  async addFolder() {
    const name = prompt('Folder name:');
    if (!name?.trim()) return;

    await this.supabase
      .from('folders')
      .insert({ user_id: this.user.id, name: name.trim() });

    this.loadFolders();
  }

  async showStats() {
    const { data: saves } = await this.supabase
      .from('saves')
      .select('created_at, highlight, is_archived');

    const totalSaves = saves?.length || 0;
    const highlights = saves?.filter(s => s.highlight)?.length || 0;
    const articles = totalSaves - highlights;
    const archived = saves?.filter(s => s.is_archived)?.length || 0;

    // Group by month
    const byMonth = {};
    saves?.forEach(s => {
      const month = new Date(s.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      byMonth[month] = (byMonth[month] || 0) + 1;
    });

    const content = document.querySelector('.content');
    content.innerHTML = `
      <div class="stats-container">
        <div class="stats-header">
          <h2>Your Stats</h2>
          <button class="btn secondary" onclick="app.setView('all')">← Back</button>
        </div>

        <div class="stats-cards">
          <div class="stat-card">
            <div class="stat-card-value">${totalSaves}</div>
            <div class="stat-card-label">Total Saves</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${articles}</div>
            <div class="stat-card-label">Articles</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${highlights}</div>
            <div class="stat-card-label">Highlights</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${archived}</div>
            <div class="stat-card-label">Archived</div>
          </div>
        </div>

        <div class="stats-section">
          <h3>Saves by Month</h3>
          <div style="display: flex; gap: 24px; flex-wrap: wrap; margin-top: 16px;">
            ${Object.entries(byMonth).slice(-6).map(([month, count]) => `
              <div>
                <div style="font-size: 24px; font-weight: 600; color: var(--primary);">${count}</div>
                <div style="font-size: 13px; color: var(--text-muted);">${month}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Kindle Highlights View
  async loadKindleHighlights() {
    const container = document.getElementById('saves-container');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');

    loading.classList.remove('hidden');
    container.innerHTML = '';

    const { data, error } = await this.supabase
      .from('saves')
      .select('*')
      .eq('source', 'kindle')
      .order('title', { ascending: true });

    loading.classList.add('hidden');

    if (error) {
      console.error('Error loading Kindle highlights:', error);
      return;
    }

    if (!data || data.length === 0) {
      empty.classList.remove('hidden');
      document.querySelector('.empty-icon').textContent = '📚';
      document.querySelector('.empty-state h3').textContent = 'No Kindle highlights yet';
      document.querySelector('.empty-state p').textContent = 'Import your Kindle highlights using the "Import Kindle" button in the sidebar, or sync from the Chrome extension.';
      return;
    }

    empty.classList.add('hidden');

    // Group by book title
    const books = {};
    data.forEach(save => {
      const key = save.title || 'Unknown Book';
      if (!books[key]) {
        books[key] = {
          title: save.title,
          author: save.author,
          highlights: [],
        };
      }
      books[key].highlights.push(save);
    });

    // Sort books by highlight count (most first)
    const sortedBooks = Object.values(books).sort((a, b) => b.highlights.length - a.highlights.length);

    this.renderKindleBooks(sortedBooks);
  }

  renderKindleBooks(books) {
    const container = document.getElementById('saves-container');

    container.innerHTML = `
      <div class="kindle-stats">
        <div class="kindle-stat">
          <span class="kindle-stat-value">${books.reduce((sum, b) => sum + b.highlights.length, 0)}</span>
          <span class="kindle-stat-label">highlights</span>
        </div>
        <div class="kindle-stat">
          <span class="kindle-stat-value">${books.length}</span>
          <span class="kindle-stat-label">books</span>
        </div>
        <button class="btn secondary kindle-clear-btn" id="clear-kindle-btn">Clear All Kindle Data</button>
      </div>
      <div class="kindle-books-grid">
        ${books.map(book => `
          <div class="kindle-book-card" data-title="${this.escapeHtml(book.title || '')}">
            <div class="kindle-book-header">
              <div class="kindle-book-icon">📖</div>
              <div class="kindle-book-info">
                <h3 class="kindle-book-title">${this.escapeHtml(book.title || 'Unknown Book')}</h3>
                ${book.author ? `<p class="kindle-book-author">${this.escapeHtml(book.author)}</p>` : ''}
              </div>
              <span class="kindle-book-count">${book.highlights.length}</span>
            </div>
            <div class="kindle-highlights-preview">
              ${book.highlights.slice(0, 3).map(h => `
                <div class="kindle-highlight-snippet" data-id="${h.id}">
                  "${this.escapeHtml(h.highlight?.substring(0, 150) || '')}${h.highlight?.length > 150 ? '...' : ''}"
                </div>
              `).join('')}
              ${book.highlights.length > 3 ? `
                <div class="kindle-more-highlights">+${book.highlights.length - 3} more highlights</div>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Bind click events to open highlights
    container.querySelectorAll('.kindle-highlight-snippet').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.dataset.id;
        const allHighlights = books.flatMap(b => b.highlights);
        const save = allHighlights.find(s => s.id === id);
        if (save) this.openReadingPane(save);
      });
    });

    // Bind book card clicks to expand
    container.querySelectorAll('.kindle-book-card').forEach(card => {
      card.addEventListener('click', () => {
        const title = card.dataset.title;
        const book = books.find(b => (b.title || '') === title);
        if (book) this.showBookHighlights(book);
      });
    });

    // Clear Kindle data button
    const clearBtn = document.getElementById('clear-kindle-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearKindleData());
    }
  }

  async clearKindleData() {
    const count = this.saves?.length || 0;
    if (!confirm(`Delete all ${count} Kindle highlights? This cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await this.supabase
        .from('saves')
        .delete()
        .eq('source', 'kindle');

      if (error) throw error;

      alert('All Kindle data cleared. You can now re-sync from the Chrome extension.');
      this.loadKindleHighlights();
    } catch (err) {
      console.error('Error clearing Kindle data:', err);
      alert('Failed to clear data: ' + err.message);
    }
  }

  showBookHighlights(book) {
    const container = document.getElementById('saves-container');

    container.innerHTML = `
      <div class="kindle-book-detail">
        <button class="btn secondary kindle-back-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back to all books
        </button>
        <div class="kindle-book-detail-header">
          <div class="kindle-book-icon-large">📖</div>
          <div>
            <h2>${this.escapeHtml(book.title || 'Unknown Book')}</h2>
            ${book.author ? `<p class="kindle-book-author">${this.escapeHtml(book.author)}</p>` : ''}
            <p class="kindle-book-meta">${book.highlights.length} highlights</p>
          </div>
        </div>
        <div class="kindle-highlights-list">
          ${book.highlights.map(h => `
            <div class="kindle-highlight-card" data-id="${h.id}">
              <div class="kindle-highlight-text">"${this.escapeHtml(h.highlight || '')}"</div>
              ${h.note ? `<div class="kindle-highlight-note">${this.escapeHtml(h.note)}</div>` : ''}
              <div class="kindle-highlight-meta">
                ${new Date(h.created_at).toLocaleDateString()}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Back button
    container.querySelector('.kindle-back-btn').addEventListener('click', () => {
      this.loadKindleHighlights();
    });

    // Highlight clicks
    container.querySelectorAll('.kindle-highlight-card').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const save = book.highlights.find(s => s.id === id);
        if (save) this.openReadingPane(save);
      });
    });
  }

  // Kindle Import Methods
  showKindleImportModal() {
    const modal = document.getElementById('kindle-import-modal');
    modal.classList.remove('hidden');
    this.resetKindleImportModal();
  }

  hideKindleImportModal() {
    const modal = document.getElementById('kindle-import-modal');
    modal.classList.add('hidden');
    this.resetKindleImportModal();
  }

  resetKindleImportModal() {
    this.pendingKindleImport = null;
    document.getElementById('kindle-file-input').value = '';
    document.getElementById('kindle-import-preview').classList.add('hidden');
    document.getElementById('kindle-import-footer').classList.add('hidden');
    const dropzone = document.getElementById('kindle-dropzone');
    dropzone.classList.remove('success', 'processing');
  }

  async handleKindleFile(file) {
    if (!file.name.endsWith('.txt')) {
      alert('Please upload a .txt file (My Clippings.txt from your Kindle)');
      return;
    }

    const dropzone = document.getElementById('kindle-dropzone');
    dropzone.classList.add('processing');

    try {
      const content = await file.text();
      const highlights = this.parseMyClippings(content);

      if (highlights.length === 0) {
        alert('No highlights found in this file. Make sure it\'s a valid My Clippings.txt file.');
        dropzone.classList.remove('processing');
        return;
      }

      // Check for duplicates against existing saves
      const { data: existingSaves } = await this.supabase
        .from('saves')
        .select('highlight, title')
        .not('highlight', 'is', null);

      const existingSet = new Set(
        (existingSaves || []).map(s => `${s.highlight}|||${s.title}`)
      );

      let duplicateCount = 0;
      const newHighlights = highlights.filter(h => {
        const key = `${h.highlight}|||${h.title}`;
        if (existingSet.has(key)) {
          duplicateCount++;
          return false;
        }
        return true;
      });

      this.pendingKindleImport = newHighlights;

      // Group by book for display
      const bookCounts = {};
      newHighlights.forEach(h => {
        const key = h.title;
        if (!bookCounts[key]) {
          bookCounts[key] = { title: h.title, author: h.author, count: 0 };
        }
        bookCounts[key].count++;
      });

      // Update UI
      dropzone.classList.remove('processing');
      dropzone.classList.add('success');

      document.getElementById('import-total').textContent = newHighlights.length;
      document.getElementById('import-books').textContent = Object.keys(bookCounts).length;
      document.getElementById('import-duplicates').textContent = duplicateCount;

      const booksList = document.getElementById('import-books-list');
      booksList.innerHTML = Object.values(bookCounts)
        .sort((a, b) => b.count - a.count)
        .map(book => `
          <div class="import-book-item">
            <div>
              <div class="import-book-title">${this.escapeHtml(book.title)}</div>
              ${book.author ? `<div class="import-book-author">${this.escapeHtml(book.author)}</div>` : ''}
            </div>
            <span class="import-book-count">${book.count}</span>
          </div>
        `).join('');

      document.getElementById('kindle-import-preview').classList.remove('hidden');
      document.getElementById('kindle-import-footer').classList.remove('hidden');

    } catch (error) {
      console.error('Error parsing Kindle file:', error);
      alert('Error reading the file. Please try again.');
      dropzone.classList.remove('processing');
    }
  }

  parseMyClippings(content) {
    // Split by the Kindle clipping delimiter
    const clippings = content.split('==========').filter(c => c.trim());
    const highlights = [];

    for (const clipping of clippings) {
      const lines = clipping.trim().split('\n').filter(l => l.trim());
      if (lines.length < 3) continue;

      // First line: Book Title (Author)
      const titleLine = lines[0].trim();
      let title = titleLine;
      let author = null;

      // Extract author from parentheses at the end
      const authorMatch = titleLine.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      if (authorMatch) {
        title = authorMatch[1].trim();
        author = authorMatch[2].trim();
      }

      // Second line: metadata (type, location, date)
      const metaLine = lines[1].trim();

      // Check if this is a highlight (not a bookmark or note)
      if (!metaLine.toLowerCase().includes('highlight')) {
        continue; // Skip bookmarks and notes
      }

      // Extract date from metadata line
      let addedAt = null;
      const dateMatch = metaLine.match(/Added on (.+)$/i);
      if (dateMatch) {
        try {
          addedAt = new Date(dateMatch[1]).toISOString();
        } catch (e) {
          // Ignore date parsing errors
        }
      }

      // Remaining lines are the highlight text
      const highlightText = lines.slice(2).join('\n').trim();

      if (!highlightText) continue;

      highlights.push({
        title,
        author,
        highlight: highlightText,
        addedAt,
      });
    }

    return highlights;
  }

  async confirmKindleImport() {
    if (!this.pendingKindleImport || this.pendingKindleImport.length === 0) {
      this.hideKindleImportModal();
      return;
    }

    const confirmBtn = document.getElementById('kindle-confirm-btn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Importing...';

    try {
      // Prepare saves for batch insert
      const saves = this.pendingKindleImport.map(h => ({
        user_id: this.user.id,
        title: h.title,
        author: h.author,
        highlight: h.highlight,
        site_name: 'Kindle',
        source: 'kindle',
        created_at: h.addedAt || new Date().toISOString(),
      }));

      // Insert in batches of 50 to avoid request size limits
      const batchSize = 50;
      for (let i = 0; i < saves.length; i += batchSize) {
        const batch = saves.slice(i, i + batchSize);
        const { error } = await this.supabase.from('saves').insert(batch);
        if (error) throw error;
      }

      // Success - close modal and refresh
      this.hideKindleImportModal();
      this.loadSaves();

      alert(`Successfully imported ${saves.length} highlights!`);

    } catch (error) {
      console.error('Error importing highlights:', error);
      alert('Error importing highlights. Please try again.');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Import Highlights';
    }
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  renderMarkdown(text) {
    if (!text) return '';

    // Configure marked for safe rendering
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,  // Convert \n to <br>
        gfm: true,     // GitHub Flavored Markdown
      });

      try {
        return marked.parse(text);
      } catch (e) {
        console.error('Markdown parse error:', e);
        // Fallback to escaped plain text
        return `<div style="white-space: pre-wrap;">${this.escapeHtml(text)}</div>`;
      }
    }

    // Fallback if marked isn't loaded
    return `<div style="white-space: pre-wrap;">${this.escapeHtml(text)}</div>`;
  }

  // Digest Settings Methods
  showDigestModal() {
    const modal = document.getElementById('digest-modal');
    modal.classList.remove('hidden');
    this.loadDigestPreferences();
  }

  hideDigestModal() {
    const modal = document.getElementById('digest-modal');
    modal.classList.add('hidden');
    document.getElementById('digest-status').classList.add('hidden');
  }

  async loadDigestPreferences() {
    try {
      const { data, error } = await this.supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', this.user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
        throw error;
      }

      // Populate form with existing preferences or defaults
      const prefs = data || {};
      document.getElementById('digest-enabled').checked = prefs.digest_enabled || false;
      document.getElementById('digest-email').value = prefs.digest_email || '';
      document.getElementById('digest-day').value = prefs.digest_day ?? 0;
      document.getElementById('digest-hour').value = prefs.digest_hour ?? 9;

      // Update UI state
      this.updateDigestOptionsState();

    } catch (error) {
      console.error('Error loading digest preferences:', error);
    }
  }

  updateDigestOptionsState() {
    const enabled = document.getElementById('digest-enabled').checked;
    const options = document.getElementById('digest-options');
    const schedule = document.getElementById('digest-schedule-group');

    if (enabled) {
      options.classList.remove('disabled');
      schedule.classList.remove('disabled');
    } else {
      options.classList.add('disabled');
      schedule.classList.add('disabled');
    }
  }

  async saveDigestPreferences() {
    const status = document.getElementById('digest-status');
    const saveBtn = document.getElementById('digest-save-btn');

    const enabled = document.getElementById('digest-enabled').checked;
    const email = document.getElementById('digest-email').value.trim();
    const day = parseInt(document.getElementById('digest-day').value);
    const hour = parseInt(document.getElementById('digest-hour').value);

    // Validate email if enabled
    if (enabled && !email) {
      status.textContent = 'Please enter an email address';
      status.className = 'digest-status error';
      status.classList.remove('hidden');
      return;
    }

    if (enabled && !email.includes('@')) {
      status.textContent = 'Please enter a valid email address';
      status.className = 'digest-status error';
      status.classList.remove('hidden');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      // Upsert preferences (insert or update)
      const { error } = await this.supabase
        .from('user_preferences')
        .upsert({
          user_id: this.user.id,
          digest_enabled: enabled,
          digest_email: email || null,
          digest_day: day,
          digest_hour: hour,
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      status.textContent = enabled
        ? 'Digest enabled! You\'ll receive emails weekly.'
        : 'Digest disabled. You won\'t receive emails.';
      status.className = 'digest-status success';
      status.classList.remove('hidden');

      // Close modal after delay
      setTimeout(() => this.hideDigestModal(), 1500);

    } catch (error) {
      console.error('Error saving digest preferences:', error);
      status.textContent = 'Error saving preferences. Please try again.';
      status.className = 'digest-status error';
      status.classList.remove('hidden');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Settings';
    }
  }

  // ==================== FEEDS ====================

  async loadFeeds() {
    const { data, error } = await this.supabase
      .from('feeds')
      .select('*, feed_category_feeds(category_id)')
      .order('title');

    if (error) {
      console.error('Error loading feeds:', error);
      return;
    }

    this.feeds = data || [];
  }

  async loadFeedCategories() {
    const { data, error } = await this.supabase
      .from('feed_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error loading feed categories:', error);
      return;
    }

    this.feedCategories = data || [];
    this.renderFeedCategoriesSidebar();
  }

  renderFeedCategoriesSidebar() {
    const container = document.getElementById('feed-categories-list');
    if (!container) return;

    container.innerHTML = this.feedCategories.map(cat => `
      <div class="feed-category-item${this.currentFeedCategory === cat.id ? ' active' : ''}" data-category-id="${cat.id}">
        <span class="feed-category-dot" style="background: ${cat.color || '#6366f1'}"></span>
        ${this.escapeHtml(cat.name)}
      </div>
    `).join('');

    container.querySelectorAll('.feed-category-item').forEach(el => {
      el.addEventListener('click', () => {
        const categoryId = el.dataset.categoryId;
        this.filterFeedsByCategory(categoryId);
      });
    });
  }

  async loadFeedItems() {
    const container = document.getElementById('saves-container');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');

    loading.classList.remove('hidden');
    container.innerHTML = '';

    let query = this.supabase
      .from('feed_items')
      .select('*, feeds(title, site_url)')
      .order('published_at', { ascending: false })
      .limit(100);

    // Filter by seen/unseen
    query = query.eq('is_seen', this.feedViewTab === 'seen');

    // Filter by category if selected
    if (this.currentFeedCategory) {
      const { data: feedIds } = await this.supabase
        .from('feed_category_feeds')
        .select('feed_id')
        .eq('category_id', this.currentFeedCategory);

      if (feedIds && feedIds.length > 0) {
        query = query.in('feed_id', feedIds.map(f => f.feed_id));
      } else {
        // No feeds in this category
        loading.classList.add('hidden');
        this.feedItems = [];
        this.renderFeedInbox();
        return;
      }
    }

    const { data, error } = await query;

    loading.classList.add('hidden');

    if (error) {
      console.error('Error loading feed items:', error);
      return;
    }

    this.feedItems = data || [];
    this.renderFeedInbox();
  }

  renderFeedInbox() {
    const container = document.getElementById('saves-container');
    const empty = document.getElementById('empty-state');

    // Remove grid class for full-width feed layout
    container.classList.remove('saves-grid');

    if (this.feeds.length === 0) {
      container.innerHTML = `
        <div class="feeds-empty-state">
          <div class="feeds-empty-icon">📡</div>
          <h3>No feeds yet</h3>
          <p>Subscribe to RSS feeds to see articles here.</p>
          <button class="btn primary" id="empty-add-feed-btn">Add Your First Feed</button>
        </div>
      `;
      document.getElementById('empty-add-feed-btn')?.addEventListener('click', () => {
        this.showAddFeedModal();
      });
      empty.classList.add('hidden');
      return;
    }

    // Feed controls bar
    const controlsHtml = `
      <div class="feed-controls">
        <div class="feed-tabs">
          <button class="feed-tab${this.feedViewTab === 'unseen' ? ' active' : ''}" data-tab="unseen">Unseen</button>
          <button class="feed-tab${this.feedViewTab === 'seen' ? ' active' : ''}" data-tab="seen">Seen</button>
        </div>
        <div class="feed-actions">
          <button class="feed-action-btn" id="mark-all-seen-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Mark all seen
          </button>
          <button class="feed-action-btn" id="refresh-feeds-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Refresh
          </button>
        </div>
      </div>
    `;

    if (this.feedItems.length === 0) {
      container.innerHTML = controlsHtml + `
        <div class="feeds-empty-state">
          <div class="feeds-empty-icon">${this.feedViewTab === 'unseen' ? '✨' : '📚'}</div>
          <h3>${this.feedViewTab === 'unseen' ? 'All caught up!' : 'No seen items'}</h3>
          <p>${this.feedViewTab === 'unseen' ? 'No new items to read.' : 'Items you read will appear here.'}</p>
        </div>
      `;
      this.bindFeedControlEvents();
      empty.classList.add('hidden');
      return;
    }

    empty.classList.add('hidden');

    // Simplified row layout: favicon, title, source, date
    const itemsHtml = this.feedItems.map(item => {
      const siteUrl = item.feeds?.site_url || '';
      const domain = siteUrl ? new URL(siteUrl).hostname : '';
      const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
      return `
      <div class="feed-item-row${!item.is_seen ? ' unseen' : ''}" data-id="${item.id}">
        ${faviconUrl ? `<img class="feed-item-favicon" src="${faviconUrl}" alt="" width="16" height="16">` : '<span class="feed-item-favicon-placeholder"></span>'}
        <span class="feed-item-title">${this.escapeHtml(item.title || 'Untitled')}</span>
        <span class="feed-item-source">${this.escapeHtml(item.feeds?.title || '')}</span>
        <span class="feed-item-time">${item.published_at ? this.formatRelativeDate(item.published_at) : ''}</span>
      </div>
    `}).join('');

    container.innerHTML = controlsHtml + `<div class="feed-items-list">${itemsHtml}</div>`;
    this.bindFeedControlEvents();
    this.bindFeedItemEvents();
  }

  bindFeedControlEvents() {
    // Tab switching
    document.querySelectorAll('.feed-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.feedViewTab = tab.dataset.tab;
        this.loadFeedItems();
      });
    });

    // Mark all seen
    document.getElementById('mark-all-seen-btn')?.addEventListener('click', () => {
      this.markAllFeedItemsSeen();
    });

    // Refresh feeds
    document.getElementById('refresh-feeds-btn')?.addEventListener('click', () => {
      this.refreshFeeds();
    });
  }

  bindFeedItemEvents() {
    // Reset selection
    this.selectedFeedIndex = null;

    document.querySelectorAll('.feed-item-row').forEach((row, index) => {
      // Click to open item
      row.addEventListener('click', () => {
        const item = this.feedItems[index];
        if (item) {
          this.openFeedItem(item);
        }
      });

      // Mouse hover selects the item
      row.addEventListener('mouseenter', () => {
        this.selectFeedItem(index);
      });
    });
  }

  formatRelativeDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  async openFeedItem(item) {
    // Mark as seen
    if (!item.is_seen) {
      await this.supabase
        .from('feed_items')
        .update({ is_seen: true })
        .eq('id', item.id);

      item.is_seen = true;
      this.updateFeedUnreadBadge();

      // Update the row to remove unseen styling
      const row = document.querySelector(`.feed-item-row[data-id="${item.id}"]`);
      if (row) row.classList.remove('unseen');
    }

    // Store current feed item for back navigation
    this.currentFeedItem = item;

    // Open full-page reader view
    this.setView('feed-reader');
  }

  async markFeedItemSeen(item) {
    if (item.is_seen) return;

    const currentIndex = this.selectedFeedIndex;

    await this.supabase
      .from('feed_items')
      .update({ is_seen: true })
      .eq('id', item.id);

    item.is_seen = true;
    this.updateFeedUnreadBadge();

    // Remove the row from the list with animation
    const row = document.querySelector(`.feed-item-row[data-id="${item.id}"]`);
    if (row) {
      row.classList.add('marking-seen');
      setTimeout(() => {
        // Remove from feedItems array if viewing unseen
        if (this.feedViewTab === 'unseen') {
          this.feedItems = this.feedItems.filter(i => i.id !== item.id);
          row.remove();
          // Keep selection at same index (now next item) or clamp if at end
          if (this.feedItems.length > 0 && currentIndex !== null) {
            this.selectFeedItem(Math.min(currentIndex, this.feedItems.length - 1));
          } else {
            this.selectedFeedIndex = null;
          }
        } else {
          row.classList.remove('unseen');
          row.classList.remove('marking-seen');
        }
      }, 200);
    }
  }

  renderFeedReaderView() {
    const container = document.getElementById('saves-container');
    const empty = document.getElementById('empty-state');
    const loading = document.getElementById('loading');

    container.classList.remove('saves-grid');
    loading.classList.add('hidden');
    empty.classList.add('hidden');

    const item = this.currentFeedItem;
    if (!item) {
      this.setView('feeds');
      return;
    }

    const content = item.content || item.excerpt || 'No content available.';
    const publishedDate = item.published_at ? new Date(item.published_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }) : '';

    container.innerHTML = `
      <div class="feed-reader-view">
        <div class="feed-reader-header">
          <button class="feed-reader-back-btn" id="feed-reader-back-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            Back
          </button>
          <div class="feed-reader-header-actions">
            <button class="feed-reader-action-btn${item.is_saved ? ' saved' : ''}" id="feed-reader-save-btn" title="${item.is_saved ? 'Saved to library' : 'Save to library'}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="${item.is_saved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
            <a href="${item.url || '#'}" target="_blank" class="feed-reader-action-btn" title="Open original">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
          </div>
        </div>
        <article class="feed-reader-article">
          <div class="feed-reader-source">${this.escapeHtml(item.feeds?.title || '')}</div>
          <h1 class="feed-reader-title">${this.escapeHtml(item.title || 'Untitled')}</h1>
          <div class="feed-reader-meta">
            ${item.author ? `<span class="feed-reader-author">${this.escapeHtml(item.author)}</span>` : ''}
            ${publishedDate ? `<span class="feed-reader-date">${publishedDate}</span>` : ''}
          </div>
          <div class="feed-reader-content">
            ${this.renderMarkdown(content)}
          </div>
        </article>
      </div>
    `;

    // Bind events
    document.getElementById('feed-reader-back-btn')?.addEventListener('click', () => {
      this.currentFeedItem = null;
      this.setView('feeds');
    });

    document.getElementById('feed-reader-save-btn')?.addEventListener('click', async () => {
      await this.saveFeedItemToLibrary(item.id);
      // Update button state
      const btn = document.getElementById('feed-reader-save-btn');
      if (btn) {
        btn.classList.add('saved');
        btn.title = 'Saved to library';
        btn.querySelector('svg').setAttribute('fill', 'currentColor');
      }
    });
  }

  async markAllFeedItemsSeen() {
    if (this.feedViewTab !== 'unseen') return;

    const unseenIds = this.feedItems.filter(i => !i.is_seen).map(i => i.id);
    if (unseenIds.length === 0) return;

    await this.supabase
      .from('feed_items')
      .update({ is_seen: true })
      .in('id', unseenIds);

    this.updateFeedUnreadBadge();
    this.loadFeedItems();
  }

  async refreshFeeds() {
    const btn = document.getElementById('refresh-feeds-btn');
    if (btn) {
      btn.classList.add('refreshing');
      btn.disabled = true;
    }

    try {
      const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/fetch-feeds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'fetch_all',
          user_id: this.user.id,
        }),
      });

      const result = await response.json();

      if (result.error) {
        alert('Error refreshing feeds: ' + result.error);
      } else if (result.new_items > 0) {
        this.updateFeedUnreadBadge();
        this.loadFeedItems();
      }
    } catch (err) {
      console.error('Error refreshing feeds:', err);
      alert('Failed to refresh feeds');
    } finally {
      if (btn) {
        btn.classList.remove('refreshing');
        btn.disabled = false;
      }
    }
  }

  async saveFeedItemToLibrary(itemId) {
    const item = this.feedItems.find(i => i.id === itemId);
    if (!item || item.is_saved) return;

    try {
      // Copy to saves table
      const { error } = await this.supabase
        .from('saves')
        .insert({
          user_id: this.user.id,
          url: item.url,
          title: item.title,
          excerpt: item.excerpt,
          content: item.content,
          image_url: item.image_url,
          author: item.author,
          site_name: item.feeds?.title,
          source: 'feed',
        });

      if (error) throw error;

      // Mark as saved in feed_items
      await this.supabase
        .from('feed_items')
        .update({ is_saved: true })
        .eq('id', itemId);

      item.is_saved = true;

      // Update button UI
      const btn = document.querySelector(`.feed-item-save-btn[data-item-id="${itemId}"]`);
      if (btn) {
        btn.classList.add('saved');
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        `;
      }
    } catch (err) {
      console.error('Error saving feed item:', err);
      alert('Failed to save to library');
    }
  }

  filterFeedsByCategory(categoryId) {
    this.currentView = 'feeds';
    this.currentFeedCategory = this.currentFeedCategory === categoryId ? null : categoryId;

    // Update nav active states
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === 'feeds');
    });
    document.querySelectorAll('.feed-category-item').forEach(item => {
      item.classList.toggle('active', item.dataset.categoryId === this.currentFeedCategory);
    });

    const category = this.feedCategories.find(c => c.id === categoryId);
    document.getElementById('view-title').textContent = this.currentFeedCategory && category
      ? category.name
      : 'Feed Inbox';

    this.loadFeedItems();
  }

  async updateFeedUnreadBadge() {
    const { count, error } = await this.supabase
      .from('feed_items')
      .select('*', { count: 'exact', head: true })
      .eq('is_seen', false);

    const badge = document.getElementById('feed-unread-badge');
    if (badge) {
      if (count && count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  }

  // Add Feed Modal
  showAddFeedModal() {
    const modal = document.getElementById('add-feed-modal');
    modal.classList.remove('hidden');
    this.resetAddFeedModal();
    this.renderCategoriesCheckboxes();
    document.getElementById('feed-url-input').focus();
  }

  hideAddFeedModal() {
    const modal = document.getElementById('add-feed-modal');
    modal.classList.add('hidden');
    this.resetAddFeedModal();
  }

  resetAddFeedModal() {
    document.getElementById('feed-url-input').value = '';
    document.getElementById('feed-subscribe-btn').disabled = true;
    document.getElementById('feed-discovery-status').classList.add('hidden');
    document.getElementById('feed-categories-picker').classList.add('hidden');
    document.querySelector('.discovery-loading').classList.add('hidden');
    document.querySelector('.discovery-success').classList.add('hidden');
    document.querySelector('.discovery-error').classList.add('hidden');
    this.discoveredFeed = null;
  }

  renderCategoriesCheckboxes() {
    const container = document.getElementById('feed-categories-checkboxes');
    container.innerHTML = this.feedCategories.map(cat => `
      <label class="category-checkbox">
        <input type="checkbox" value="${cat.id}">
        <span>${this.escapeHtml(cat.name)}</span>
      </label>
    `).join('');
  }

  async discoverFeed(url) {
    const statusEl = document.getElementById('feed-discovery-status');
    const loadingEl = document.querySelector('.discovery-loading');
    const successEl = document.querySelector('.discovery-success');
    const errorEl = document.querySelector('.discovery-error');
    const subscribeBtn = document.getElementById('feed-subscribe-btn');
    const categoriesPickerEl = document.getElementById('feed-categories-picker');

    statusEl.classList.remove('hidden');
    loadingEl.classList.remove('hidden');
    successEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    subscribeBtn.disabled = true;
    categoriesPickerEl.classList.add('hidden');
    this.discoveredFeed = null;

    try {
      const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/fetch-feeds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'discover',
          user_id: this.user.id,
          url,
        }),
      });

      const result = await response.json();

      loadingEl.classList.add('hidden');

      if (result.error) {
        errorEl.classList.remove('hidden');
        errorEl.querySelector('.error-text').textContent = result.error;
      } else {
        successEl.classList.remove('hidden');
        document.getElementById('discovered-feed-title').textContent = result.title || 'Unknown Feed';
        document.getElementById('discovered-feed-description').textContent = result.description || '';
        document.getElementById('discovered-item-count').textContent = `${result.item_count} items`;

        this.discoveredFeed = {
          feed_url: result.feed_url,
          title: result.title,
          description: result.description,
          site_url: result.site_url,
        };

        subscribeBtn.disabled = false;
        categoriesPickerEl.classList.remove('hidden');
      }
    } catch (err) {
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      errorEl.querySelector('.error-text').textContent = 'Failed to discover feed';
    }
  }

  async addCategoryInModal() {
    const input = document.getElementById('new-category-input');
    const name = input.value.trim();
    if (!name) return;

    try {
      const { data, error } = await this.supabase
        .from('feed_categories')
        .insert({
          user_id: this.user.id,
          name,
          sort_order: this.feedCategories.length,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          alert('Category already exists');
        } else {
          throw error;
        }
        return;
      }

      this.feedCategories.push(data);
      this.renderCategoriesCheckboxes();
      this.renderFeedCategoriesSidebar();
      input.value = '';
    } catch (err) {
      console.error('Error adding category:', err);
      alert('Failed to add category');
    }
  }

  async subscribeFeed() {
    if (!this.discoveredFeed) return;

    const subscribeBtn = document.getElementById('feed-subscribe-btn');
    subscribeBtn.disabled = true;
    subscribeBtn.textContent = 'Subscribing...';

    // Get selected category IDs
    const categoryIds = Array.from(
      document.querySelectorAll('#feed-categories-checkboxes input:checked')
    ).map(cb => cb.value);

    try {
      const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/fetch-feeds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'subscribe',
          user_id: this.user.id,
          url: this.discoveredFeed.feed_url,
          category_ids: categoryIds,
        }),
      });

      const result = await response.json();

      if (result.error) {
        alert('Error: ' + result.error);
        subscribeBtn.disabled = false;
        subscribeBtn.textContent = 'Subscribe';
        return;
      }

      // Success - reload feeds and close modal
      await this.loadFeeds();
      await this.loadFeedCategories();
      this.updateFeedUnreadBadge();
      this.hideAddFeedModal();

      // Switch to feeds view
      this.setView('feeds');

    } catch (err) {
      console.error('Error subscribing:', err);
      alert('Failed to subscribe to feed');
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = 'Subscribe';
    }
  }

  // Manage Feeds View
  renderManageFeedsView() {
    const container = document.getElementById('saves-container');
    const empty = document.getElementById('empty-state');
    const loading = document.getElementById('loading');

    // Remove grid class for full-width layout
    container.classList.remove('saves-grid');

    loading.classList.add('hidden');
    empty.classList.add('hidden');

    if (this.feeds.length === 0 && this.feedCategories.length === 0) {
      container.innerHTML = `
        <div class="feeds-empty-state">
          <div class="feeds-empty-icon">📡</div>
          <h3>No feeds yet</h3>
          <p>Subscribe to RSS feeds to get started.</p>
          <button class="btn primary" id="empty-add-feed-btn2">Add Your First Feed</button>
        </div>
      `;
      document.getElementById('empty-add-feed-btn2')?.addEventListener('click', () => {
        this.showAddFeedModal();
      });
      return;
    }

    const feedsTableHtml = this.feeds.length > 0 ? `
      <div class="feeds-table">
        <div class="feeds-table-header">
          <div>Feed</div>
          <div>Categories</div>
          <div>Items</div>
          <div>Actions</div>
        </div>
        ${this.feeds.map(feed => {
          const categoryIds = (feed.feed_category_feeds || []).map(fcf => fcf.category_id);
          const categories = this.feedCategories.filter(c => categoryIds.includes(c.id));
          return `
            <div class="feed-row" data-feed-id="${feed.id}">
              <div class="feed-info">
                <div class="feed-favicon" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center; font-size: 16px;">📰</div>
                <div class="feed-details">
                  <div class="feed-title">${this.escapeHtml(feed.title || 'Unknown Feed')}</div>
                  <div class="feed-url">${this.escapeHtml(feed.feed_url)}</div>
                </div>
              </div>
              <div class="feed-categories-cell">
                <div class="feed-categories-tags feed-categories-clickable" data-feed-id="${feed.id}">
                  ${categories.length > 0
                    ? categories.map(c => `<span class="feed-category-tag" style="background: ${c.color}20; color: ${c.color}">${this.escapeHtml(c.name)}</span>`).join('')
                    : '<span class="add-category-hint">+ Add category</span>'}
                </div>
                <div class="feed-category-dropdown hidden" data-feed-id="${feed.id}">
                  ${this.feedCategories.map(c => {
                    const isSelected = categoryIds.includes(c.id);
                    return `
                      <label class="category-checkbox-item">
                        <input type="checkbox" data-category-id="${c.id}" data-feed-id="${feed.id}" ${isSelected ? 'checked' : ''}>
                        <span class="category-color-dot" style="background: ${c.color}"></span>
                        ${this.escapeHtml(c.name)}
                      </label>
                    `;
                  }).join('')}
                  ${this.feedCategories.length === 0 ? '<div class="dropdown-empty">No categories yet</div>' : ''}
                </div>
              </div>
              <div class="feed-item-count">${feed.item_count || 0}</div>
              <div class="feed-row-actions">
                <button class="feed-row-btn refresh-feed-btn" data-feed-id="${feed.id}" title="Refresh">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                </button>
                <button class="feed-row-btn danger unsubscribe-feed-btn" data-feed-id="${feed.id}" title="Unsubscribe">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : '';

    const categoriesHtml = `
      <div class="categories-section">
        <h3>Categories</h3>
        <div class="categories-list">
          ${this.feedCategories.map(cat => `
            <div class="category-row" data-category-id="${cat.id}">
              <span class="category-color-dot" style="background: ${cat.color}"></span>
              <span class="category-name">${this.escapeHtml(cat.name)}</span>
              <span class="category-feed-count">${this.feeds.filter(f => (f.feed_category_feeds || []).some(fcf => fcf.category_id === cat.id)).length} feeds</span>
              <button class="category-delete-btn" data-category-id="${cat.id}" title="Delete category">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          `).join('')}
        </div>
        <div class="add-category-form">
          <input type="text" id="manage-new-category-input" placeholder="New category name">
          <button class="btn secondary" id="manage-add-category-btn">Add Category</button>
        </div>
      </div>
    `;

    container.innerHTML = `
      <div class="manage-feeds-container">
        <div class="manage-feeds-header">
          <h2>Manage Feeds</h2>
          <button class="btn primary" id="manage-add-feed-btn">Add Feed</button>
        </div>
        ${feedsTableHtml}
        ${categoriesHtml}
      </div>
    `;

    // Bind events
    document.getElementById('manage-add-feed-btn')?.addEventListener('click', () => {
      this.showAddFeedModal();
    });

    document.querySelectorAll('.refresh-feed-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const feedId = btn.dataset.feedId;
        await this.refreshSingleFeed(feedId);
      });
    });

    document.querySelectorAll('.unsubscribe-feed-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const feedId = btn.dataset.feedId;
        await this.unsubscribeFeed(feedId);
      });
    });

    document.querySelectorAll('.category-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const categoryId = btn.dataset.categoryId;
        await this.deleteCategory(categoryId);
      });
    });

    document.getElementById('manage-add-category-btn')?.addEventListener('click', () => {
      this.addCategoryFromManageView();
    });
    document.getElementById('manage-new-category-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addCategoryFromManageView();
      }
    });

    // Category dropdown toggle
    document.querySelectorAll('.feed-categories-clickable').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const feedId = el.dataset.feedId;
        this.toggleCategoryDropdown(feedId);
      });
    });

    // Category checkbox changes
    document.querySelectorAll('.feed-category-dropdown input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', async (e) => {
        e.stopPropagation();
        const feedId = checkbox.dataset.feedId;
        const categoryId = checkbox.dataset.categoryId;
        await this.toggleFeedCategory(feedId, categoryId, checkbox.checked);
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.feed-categories-cell')) {
        document.querySelectorAll('.feed-category-dropdown').forEach(d => d.classList.add('hidden'));
      }
    }, { once: true });
  }

  async refreshSingleFeed(feedId) {
    try {
      const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/fetch-feeds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          action: 'fetch',
          user_id: this.user.id,
          feed_id: feedId,
        }),
      });

      const result = await response.json();

      if (result.error) {
        alert('Error refreshing feed: ' + result.error);
      } else {
        await this.loadFeeds();
        this.updateFeedUnreadBadge();
        this.renderManageFeedsView();
      }
    } catch (err) {
      console.error('Error refreshing feed:', err);
      alert('Failed to refresh feed');
    }
  }

  async unsubscribeFeed(feedId) {
    const feed = this.feeds.find(f => f.id === feedId);
    if (!confirm(`Unsubscribe from "${feed?.title}"? This will also delete all items from this feed.`)) {
      return;
    }

    try {
      const { error } = await this.supabase
        .from('feeds')
        .delete()
        .eq('id', feedId);

      if (error) throw error;

      await this.loadFeeds();
      this.updateFeedUnreadBadge();
      this.renderManageFeedsView();
    } catch (err) {
      console.error('Error unsubscribing:', err);
      alert('Failed to unsubscribe');
    }
  }

  async deleteCategory(categoryId) {
    const category = this.feedCategories.find(c => c.id === categoryId);
    if (!confirm(`Delete category "${category?.name}"? Feeds will not be deleted.`)) {
      return;
    }

    try {
      const { error } = await this.supabase
        .from('feed_categories')
        .delete()
        .eq('id', categoryId);

      if (error) throw error;

      await this.loadFeedCategories();
      this.renderManageFeedsView();
    } catch (err) {
      console.error('Error deleting category:', err);
      alert('Failed to delete category');
    }
  }

  async addCategoryFromManageView() {
    const input = document.getElementById('manage-new-category-input');
    const name = input.value.trim();
    if (!name) return;

    try {
      const { data, error } = await this.supabase
        .from('feed_categories')
        .insert({
          user_id: this.user.id,
          name,
          sort_order: this.feedCategories.length,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          alert('Category already exists');
        } else {
          throw error;
        }
        return;
      }

      this.feedCategories.push(data);
      this.renderFeedCategoriesSidebar();
      this.renderManageFeedsView();
    } catch (err) {
      console.error('Error adding category:', err);
      alert('Failed to add category');
    }
  }

  toggleCategoryDropdown(feedId) {
    // Close all other dropdowns
    document.querySelectorAll('.feed-category-dropdown').forEach(d => {
      if (d.dataset.feedId !== feedId) {
        d.classList.add('hidden');
      }
    });
    // Toggle this one
    const dropdown = document.querySelector(`.feed-category-dropdown[data-feed-id="${feedId}"]`);
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  }

  async toggleFeedCategory(feedId, categoryId, isAdding) {
    try {
      if (isAdding) {
        // Add feed to category
        const { error } = await this.supabase
          .from('feed_category_feeds')
          .insert({ feed_id: feedId, category_id: categoryId });
        if (error) throw error;
      } else {
        // Remove feed from category
        const { error } = await this.supabase
          .from('feed_category_feeds')
          .delete()
          .eq('feed_id', feedId)
          .eq('category_id', categoryId);
        if (error) throw error;
      }

      // Reload feeds to get updated category relationships
      await this.loadFeeds();
      this.renderFeedCategoriesSidebar();

      // Update just the tags display for this feed without closing dropdown
      const feed = this.feeds.find(f => f.id === feedId);
      const categoryIds = (feed?.feed_category_feeds || []).map(fcf => fcf.category_id);
      const categories = this.feedCategories.filter(c => categoryIds.includes(c.id));
      const tagsEl = document.querySelector(`.feed-categories-clickable[data-feed-id="${feedId}"]`);
      if (tagsEl) {
        tagsEl.innerHTML = categories.length > 0
          ? categories.map(c => `<span class="feed-category-tag" style="background: ${c.color}20; color: ${c.color}">${this.escapeHtml(c.name)}</span>`).join('')
          : '<span class="add-category-hint">+ Add category</span>';
      }
    } catch (err) {
      console.error('Error toggling category:', err);
      alert('Failed to update category');
    }
  }
}

// Initialize app
const app = new StashApp();
