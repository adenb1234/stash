// Stash Web App (Single-user mode - no auth required)
class StashApp {
  constructor() {
    this.supabase = null;
    this.user = { id: CONFIG.USER_ID }; // Hardcoded single user
    this.currentView = 'feeds'; // Default to feeds view
    this.currentSave = null;
    this.currentFolder = null;
    this.currentTag = null;
    this.highlightTagFilter = null; // Tag filter for highlights view
    this.saves = [];
    this.tags = [];
    this.folders = [];
    this.pendingKindleImport = null; // Stores parsed highlights before import
    this.pendingPodcast = null; // Stores detected podcast info before saving
    this.pendingQuickSave = null; // Stores quick save preview (article or podcast)

    // Notes state
    this.notes = [];
    this.currentNote = null;
    this.noteSaveTimer = null;

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
    this.lastMarkedSeenItem = null; // For undo functionality
    this.selectedFeedIndex = null;
    this.kindleEmail = null; // Cached Kindle email for Send to Kindle feature
    this.pendingKindleSend = null; // Pending send while user sets up Kindle email

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

    // Check password — skip if already verified this session
    if (!localStorage.getItem('stash-authed')) {
      this.showAuthScreen();
      this.bindAuthEvents();
      return;
    }

    this.showMainScreen();
    this.loadData();
    this.loadKindleEmail();
    this.bindEvents();
    this.checkAutoRefresh();
  }

  // Auto-refresh feeds each morning
  checkAutoRefresh() {
    const lastRefresh = localStorage.getItem('stash-last-feed-refresh');
    const today = new Date().toDateString();

    if (lastRefresh !== today) {
      console.log('New day detected, auto-refreshing feeds...');
      localStorage.setItem('stash-last-feed-refresh', today);

      // Wait a moment for data to load, then refresh feeds
      setTimeout(async () => {
        try {
          await this.refreshFeeds();
          console.log('Auto-refresh completed');
        } catch (error) {
          console.error('Auto-refresh failed:', error);
        }
      }, 2000);
    }

    // Check again in 1 hour (in case user keeps tab open overnight)
    setTimeout(() => this.checkAutoRefresh(), 60 * 60 * 1000);
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

  bindAuthEvents() {
    document.getElementById('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.signIn();
    });
  }

  bindEvents() {


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

    document.getElementById('send-kindle-btn').addEventListener('click', () => {
      if (this.currentSave) this.sendToKindle(this.currentSave.id);
    });

    // Kindle email setup modal
    const kindleEmailModal = document.getElementById('kindle-email-modal');
    kindleEmailModal.querySelector('.modal-overlay').addEventListener('click', () => this.hideKindleEmailModal());
    document.getElementById('kindle-email-close-btn').addEventListener('click', () => this.hideKindleEmailModal());
    document.getElementById('kindle-email-cancel-btn').addEventListener('click', () => this.hideKindleEmailModal());
    document.getElementById('kindle-email-save-btn').addEventListener('click', () => this.saveKindleEmailAndSend());

    // Send URL to Kindle quick action
    document.getElementById('kindle-url-btn').addEventListener('click', () => this.showKindleUrlModal());
    document.getElementById('kindle-url-modal').querySelector('.modal-overlay').addEventListener('click', () => this.hideKindleUrlModal());
    document.getElementById('kindle-url-close-btn').addEventListener('click', () => this.hideKindleUrlModal());
    document.getElementById('kindle-url-cancel-btn').addEventListener('click', () => this.hideKindleUrlModal());
    document.getElementById('kindle-url-send-btn').addEventListener('click', () => this.sendUrlToKindle());

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

    // Generate audio button
    document.getElementById('generate-audio-btn').addEventListener('click', () => {
      if (this.currentSave) {
        this.generateAudio(this.currentSave.id);
      }
    });

    // Quick Save (Articles & Podcasts)
    document.getElementById('quick-save-btn').addEventListener('click', () => {
      this.showQuickSaveModal();
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

    // Quick Save Modal (Articles & Podcasts)
    const quickSaveModal = document.getElementById('quick-save-modal');

    quickSaveModal.querySelector('.modal-overlay').addEventListener('click', () => {
      this.hideQuickSaveModal();
    });
    quickSaveModal.querySelector('.modal-close-btn').addEventListener('click', () => {
      this.hideQuickSaveModal();
    });
    document.getElementById('quick-save-cancel-btn').addEventListener('click', () => {
      this.hideQuickSaveModal();
    });
    document.getElementById('quick-save-submit-btn').addEventListener('click', () => {
      this.submitQuickSave();
    });

    // Quick save URL input with debounced detection
    let quickSaveUrlTimeout;
    document.getElementById('quick-save-url-input').addEventListener('input', (e) => {
      clearTimeout(quickSaveUrlTimeout);
      quickSaveUrlTimeout = setTimeout(() => {
        const url = e.target.value.trim();
        if (url && url.startsWith('http')) {
          this.detectQuickSaveUrl(url);
        } else {
          document.getElementById('quick-save-status').classList.add('hidden');
          document.getElementById('quick-save-submit-btn').disabled = true;
          this.pendingQuickSave = null;
        }
      }, 500);
    });

    // Digest Settings Modal
    const digestModal = document.getElementById('digest-modal');
    const digestSettingsBtn = document.getElementById('digest-settings-btn');

    if (digestSettingsBtn && digestModal) {
      digestSettingsBtn.addEventListener('click', () => {
        this.showDigestModal();
      });

      digestModal.querySelector('.modal-overlay')?.addEventListener('click', () => {
        this.hideDigestModal();
      });
      digestModal.querySelector('.modal-close-btn')?.addEventListener('click', () => {
        this.hideDigestModal();
      });
      document.getElementById('digest-cancel-btn')?.addEventListener('click', () => {
        this.hideDigestModal();
      });
      document.getElementById('digest-save-btn')?.addEventListener('click', () => {
        this.saveDigestPreferences();
      });

      // Toggle enabled/disabled state of options
      document.getElementById('digest-enabled')?.addEventListener('change', () => {
        this.updateDigestOptionsState();
      });
    }

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

    // Retry button
    document.getElementById('retry-btn').addEventListener('click', () => {
      this.hideError();
      this.loadData();
    });

    // Global keyboard shortcuts for feeds
    document.addEventListener('keydown', async (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      console.log('Keydown:', e.key, 'currentView:', this.currentView, 'feedItems:', this.feedItems?.length, 'selectedIndex:', this.selectedFeedIndex);

      // Feed reader shortcuts
      if (this.currentView === 'feed-reader') {
        // Esc to go back
        if (e.key === 'Escape') {
          e.preventDefault();
          this.returnToFeedInbox();
          return;
        }
        // 'e' to mark as seen and go back to inbox
        if (e.key === 'e' || e.key === 'E') {
          e.preventDefault();
          if (this.currentFeedItem && !this.currentFeedItem.is_seen) {
            this.markFeedItemSeen(this.currentFeedItem);
          }
          this.stopAudio();
          this.returnToFeedInbox();
          return;
        }
        // 'u' to mark as unread and return to inbox
        if (e.key === 'u' || e.key === 'U') {
          e.preventDefault();
          if (this.currentFeedItem) {
            await this.markFeedItemUnseen(this.currentFeedItem);
          }
          this.stopAudio();
          this.returnToFeedInbox();
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
      if (this.currentView === 'feeds') {
        // 'z' to undo last mark as seen (works even with empty list)
        if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          this.undoMarkFeedItemSeen();
          return;
        }

        if (this.feedItems.length > 0) {
          // Arrow keys to navigate
          if (e.key === 'ArrowDown' || e.key === 'j') {
            e.preventDefault();
            this.selectFeedItem((this.selectedFeedIndex ?? -1) + 1, true);
            this.disableMouseSelection();
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'k') {
            e.preventDefault();
            this.selectFeedItem((this.selectedFeedIndex ?? 1) - 1, true);
            this.disableMouseSelection();
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
      }
    });
  }

  selectFeedItem(index, viaKeyboard = false) {
    // Clamp index to valid range
    if (index < 0) index = 0;
    if (index >= this.feedItems.length) index = this.feedItems.length - 1;

    this.selectedFeedIndex = index;

    // Update visual selection
    document.querySelectorAll('.feed-item-card').forEach((row, i) => {
      row.classList.toggle('selected', i === index);
    });

    // Scroll into view if needed (only for keyboard navigation)
    if (viaKeyboard) {
      const selectedRow = document.querySelector('.feed-item-card.selected');
      if (selectedRow) {
        selectedRow.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
    }
  }

  disableMouseSelection() {
    // Prevent mouse from interfering with keyboard navigation
    this.mouseSelectionDisabled = true;
  }

  enableMouseSelection() {
    this.mouseSelectionDisabled = false;
  }

  showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('main-screen').classList.add('hidden');
  }

  showMainScreen() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('main-screen').classList.remove('hidden');
  }

  signIn() {
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('auth-error');

    if (password === CONFIG.APP_PASSWORD) {
      localStorage.setItem('stash-authed', '1');
      this.showMainScreen();
      this.bindEvents();
      this.loadData();
      this.loadKindleEmail();
      this.checkAutoRefresh();
    } else {
      errorEl.textContent = 'Incorrect password.';
      document.getElementById('password').value = '';
    }
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

  showError(message) {
    const errorState = document.getElementById('error-state');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');
    const container = document.getElementById('saves-container');

    if (message) {
      document.getElementById('error-state-message').textContent = message;
    }

    loading.classList.add('hidden');
    empty.classList.add('hidden');
    container.innerHTML = '';
    errorState.classList.remove('hidden');
  }

  hideError() {
    document.getElementById('error-state').classList.add('hidden');
  }

  showOfflineBanner() {
    document.getElementById('offline-banner').classList.remove('hidden');
  }

  hideOfflineBanner() {
    document.getElementById('offline-banner').classList.add('hidden');
  }

  cacheData(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      // localStorage full or unavailable - ignore
    }
  }

  getCachedData(key) {
    try {
      const cached = localStorage.getItem(key);
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  }

  async loadData() {
    this.hideError();
    this.hideOfflineBanner();
    await Promise.all([
      this.loadSaves(),
      this.loadTags(),
      this.loadFolders(),
      this.loadFeeds(),
      this.loadFeedCategories(),
    ]);
    this.updateFeedUnreadBadge();

    // Auto-archive old feed items (fire and forget)
    this.archiveOldFeedItems();
  }

  async loadSaves() {
    const container = document.getElementById('saves-container');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');

    this.hideError();
    this.hideOfflineBanner();
    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    container.innerHTML = '';

    const sortValue = document.getElementById('sort-select').value;
    const [column, direction] = sortValue.split('.');

    let query = this.supabase
      .from('saves')
      .select('*, save_tags(tags(id, name, color))')
      .order(column, { ascending: direction === 'asc' });

    // Apply view filters
    // Always exclude archived items and notes
    query = query.eq('is_archived', false).neq('source', 'note');

    if (this.currentView === 'highlights') {
      query = query.not('highlight', 'is', null);
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
      const cached = this.getCachedData('stash-cache-saves');
      if (cached) {
        this.saves = cached;
        this.showOfflineBanner();
        this.renderSaves();
      } else {
        this.showError('Could not load saves. Check your connection and try again.');
      }
      return;
    }

    this.saves = data || [];
    this.cacheData('stash-cache-saves', this.saves);

    if (this.saves.length === 0) {
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      this.renderSaves();
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

      const isImageSave = save.image_url && !save.highlight && !save.content;

      if (isImageSave) {
        return `
          <div class="save-card image-save" data-id="${save.id}">
            <img class="save-card-image" src="${save.image_url}" alt="" onerror="this.style.display='none'">
            <div class="save-card-content">
              <div class="save-card-site">${this.escapeHtml(save.site_name || '')}</div>
              ${tagsHtml}
              <div class="save-card-meta">
                <span class="save-card-date">${date}</span>
              </div>
            </div>
          </div>
        `;
      }

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

    const siteLabel = save.source === 'podcast' ? `🎧 ${this.escapeHtml(save.site_name || '')}` : this.escapeHtml(save.site_name || '');

    return `
      <div class="save-card" data-id="${save.id}">
        ${save.image_url ? `<img class="save-card-image" src="${save.image_url}" alt="" onerror="this.style.display='none'">` : ''}
        <div class="save-card-content">
          <div class="save-card-site">${siteLabel}</div>
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
    const { data, error } = await this.supabase
      .from('tags')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error loading tags:', error);
      const cached = this.getCachedData('stash-cache-tags');
      if (cached) this.tags = cached;
      return;
    }

    this.tags = data || [];
    this.cacheData('stash-cache-tags', this.tags);
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
    const { data, error } = await this.supabase
      .from('folders')
      .select('*')
      .order('name');

    if (error) {
      console.error('Error loading folders:', error);
      const cached = this.getCachedData('stash-cache-folders');
      if (cached) this.folders = cached;
      return;
    }

    this.folders = data || [];
    this.cacheData('stash-cache-folders', this.folders);
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
    this.currentView = 'feeds'; // Reset to feeds view

    // Toggle folder filter (click again to clear)
    if (this.currentFolder === folderId) {
      this.currentFolder = null;
      document.getElementById('view-title').textContent = 'Library';
    } else {
      this.currentFolder = folderId;
      const folder = this.folders.find(f => f.id === folderId);
      document.getElementById('view-title').textContent = folder ? folder.name : 'Folder';
    }

    // Update nav active states
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.remove('active');
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
      highlights: 'Highlights',
      notes: 'Notes',
      stats: 'Stats',
      feeds: 'Feed Inbox',
      'manage-feeds': 'Manage Feeds',
      'feed-reader': '',
    };
    const titleEl = document.getElementById('view-title');
    if (titleEl) {
      titleEl.textContent = titles[view] || 'Library';
      // Hide title/header for feed-reader and notes views (they have their own headers)
      titleEl.parentElement.style.display = (view === 'feed-reader' || view === 'notes') ? 'none' : '';
    }

    // Toggle notes layout class on content div
    const contentDiv = document.querySelector('.content');
    if (view === 'notes') {
      contentDiv.classList.add('notes-content');
    } else {
      contentDiv.classList.remove('notes-content');
      // Clear pending note save timer when leaving notes
      clearTimeout(this.noteSaveTimer);
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
    } else if (view === 'notes') {
      this.loadNotes();
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

    // Show/hide Send to Kindle button (articles with content only)
    const sendKindleBtn = document.getElementById('send-kindle-btn');
    if (save.content && save.content.length > 100 && !save.highlight && save.source !== 'podcast') {
      sendKindleBtn.classList.remove('hidden');
    } else {
      sendKindleBtn.classList.add('hidden');
    }

    // Handle audio player visibility
    const audioPlayer = document.getElementById('audio-player');
    const audioGenerating = document.getElementById('audio-generating');
    const generateAudioBtn = document.getElementById('generate-audio-btn');
    const isPodcast = save.source === 'podcast';

    // Reset all audio UI
    audioPlayer.classList.add('hidden');
    audioGenerating.classList.add('hidden');
    generateAudioBtn.classList.add('hidden');

    if (isPodcast && save.audio_url) {
      // Direct audio podcast — show player
      audioPlayer.classList.remove('hidden');
      this.initAudio(save.audio_url);
    } else if (isPodcast && !save.audio_url) {
      // Spotify podcast — no native audio player
    } else if (save.audio_url) {
      // Regular save with audio ready - show player
      audioPlayer.classList.remove('hidden');
      this.initAudio(save.audio_url);
    } else if (save.content && save.content.length > 100 && !save.highlight) {
      // Content exists but no audio yet - show "Listen" button
      generateAudioBtn.classList.remove('hidden');
    }

    if (isPodcast && !save.audio_url && save.content) {
      // Spotify podcast — render embed iframe + link
      document.getElementById('reading-body').innerHTML = `
        <div class="spotify-embed-container">${save.content}</div>
        <p style="margin-top: 16px;"><a href="${save.url}" target="_blank" style="color: var(--primary);">Open in Spotify →</a></p>
      `;
    } else if (isPodcast && save.audio_url) {
      // Direct audio podcast — show link to original
      document.getElementById('reading-body').innerHTML = `
        <p><a href="${save.url}" target="_blank" style="color: var(--primary);">Open original →</a></p>
      `;
    } else if (save.highlight) {
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

    // Initialize highlighting UI for article content (not for highlights or podcasts)
    if (!save.highlight && !isPodcast && save.content) {
      this.initHighlightingUI();
    }
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
    // Clean up highlighting UI
    this.cleanupHighlightingUI();
  }

  // Text Highlighting Feature
  initHighlightingUI() {
    const readingBody = document.getElementById('reading-body');
    if (!readingBody) return;

    // Remove any existing listeners
    this.cleanupHighlightingUI();

    // Store bound functions so we can remove them later
    this.highlightMouseUp = this.handleTextSelection.bind(this);
    this.highlightTouchEnd = this.handleTextSelection.bind(this);

    readingBody.addEventListener('mouseup', this.highlightMouseUp);
    readingBody.addEventListener('touchend', this.highlightTouchEnd);
  }

  cleanupHighlightingUI() {
    const readingBody = document.getElementById('reading-body');
    if (!readingBody) return;

    if (this.highlightMouseUp) {
      readingBody.removeEventListener('mouseup', this.highlightMouseUp);
      this.highlightMouseUp = null;
    }
    if (this.highlightTouchEnd) {
      readingBody.removeEventListener('touchend', this.highlightTouchEnd);
      this.highlightTouchEnd = null;
    }

    // Remove any existing tooltip
    const existingTooltip = document.querySelector('.highlight-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }
  }

  handleTextSelection() {
    // Remove any existing tooltip
    const existingTooltip = document.querySelector('.highlight-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // Only show tooltip if there's selected text
    if (!selectedText || selectedText.length < 3) {
      return;
    }

    // Get selection position
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Create and show tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'highlight-tooltip';
    tooltip.textContent = '💡 Save Highlight';
    tooltip.style.left = `${rect.left + (rect.width / 2) - 75}px`;
    tooltip.style.top = `${rect.top - 40 + window.scrollY}px`;

    tooltip.addEventListener('click', async () => {
      await this.saveHighlight(selectedText);
      tooltip.remove();
      selection.removeAllRanges(); // Clear selection
    });

    document.body.appendChild(tooltip);

    // Remove tooltip if user clicks elsewhere
    const removeTooltip = (e) => {
      if (!tooltip.contains(e.target)) {
        tooltip.remove();
        document.removeEventListener('click', removeTooltip);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', removeTooltip);
    }, 100);
  }

  async saveHighlight(highlightText) {
    if (!this.currentSave) {
      this.showToast('Error: No article open', true);
      return;
    }

    const saveData = {
      user_id: this.user.id,
      url: this.currentSave.url,
      title: this.currentSave.title,
      site_name: this.currentSave.site_name,
      image_url: this.currentSave.image_url,
      highlight: highlightText,
      source: 'extension', // Mark as created via the app
    };

    const { data, error } = await this.supabase
      .from('saves')
      .insert(saveData)
      .select()
      .single();

    if (error) {
      console.error('Error saving highlight:', error);
      this.showToast('Error saving highlight', true);
      return;
    }

    this.showToast('✨ Highlight saved!');

    // Increment reading goal
    await this.incrementReadingGoal('saved');

    // Reload saves to show the new highlight
    await this.loadSaves();
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

    let audioSrc;
    if (url.startsWith('https://') || url.startsWith('http://')) {
      // External URL (e.g. podcast or signed URL) — use directly
      audioSrc = url;
    } else {
      // Storage filename — get a signed URL via edge function
      const saveId = url.replace('.mp3', '');
      audioSrc = await this.getSignedAudioUrl(saveId);
      if (!audioSrc) {
        console.error('Failed to get signed URL for audio');
        return;
      }
    }

    this.audio = new Audio(audioSrc);
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

  async getSignedAudioUrl(saveId) {
    // Get a signed URL via edge function (uses service role key)
    try {
      const res = await fetch(
        `${CONFIG.SUPABASE_URL}/functions/v1/generate-audio`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': CONFIG.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ save_id: saveId, action: 'get_url' }),
        }
      );
      const result = await res.json();
      return result.signed_url || null;
    } catch (err) {
      console.error('Error getting signed URL:', err);
      return null;
    }
  }

  async generateAudio(saveId) {
    const generateBtn = document.getElementById('generate-audio-btn');
    const audioGenerating = document.getElementById('audio-generating');
    const audioPlayer = document.getElementById('audio-player');

    // Hide button, show spinner
    generateBtn.classList.add('hidden');
    audioGenerating.classList.remove('hidden');

    try {
      const res = await fetch(
        `${CONFIG.SUPABASE_URL}/functions/v1/generate-audio`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': CONFIG.SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ save_id: saveId }),
        }
      );

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Audio generation failed');
      }

      // Update local save object
      if (this.currentSave && this.currentSave.id === saveId) {
        this.currentSave.audio_url = result.audio_url;
      }

      // Show audio player — use signed URL directly
      audioGenerating.classList.add('hidden');
      audioPlayer.classList.remove('hidden');
      this.initAudio(result.signed_url || result.audio_url);
    } catch (err) {
      console.error('Audio generation error:', err);
      // Show button again so user can retry
      audioGenerating.classList.add('hidden');
      generateBtn.classList.remove('hidden');
      generateBtn.textContent = 'Retry — audio generation failed';
    }
  }

  async loadKindleEmail() {
    try {
      const { data } = await this.supabase
        .from('user_preferences')
        .select('kindle_email')
        .eq('user_id', this.user.id)
        .single();
      this.kindleEmail = data?.kindle_email || null;
    } catch {
      // No prefs row yet — that's fine
    }
  }

  showKindleEmailModal(saveId) {
    this.pendingKindleSend = saveId;
    const modal = document.getElementById('kindle-email-modal');
    const select = document.getElementById('kindle-email-input');
    if (this.kindleEmail) select.value = this.kindleEmail;
    document.getElementById('kindle-email-status').classList.add('hidden');
    modal.classList.remove('hidden');
  }

  hideKindleEmailModal() {
    document.getElementById('kindle-email-modal').classList.add('hidden');
    this.pendingKindleSend = null;
  }

  async saveKindleEmailAndSend() {
    const email = document.getElementById('kindle-email-input').value;
    const status = document.getElementById('kindle-email-status');

    // Save selected device to user_preferences
    const { error } = await this.supabase
      .from('user_preferences')
      .upsert({ user_id: this.user.id, kindle_email: email }, { onConflict: 'user_id' });

    if (error) {
      status.textContent = 'Failed to save: ' + error.message;
      status.classList.remove('hidden');
      return;
    }

    this.kindleEmail = email;
    const saveId = this.pendingKindleSend;
    this.hideKindleEmailModal();

    if (saveId) this.sendToKindle(saveId);
  }

  async sendToKindle(saveId) {
    if (!this.kindleEmail) {
      this.showKindleEmailModal(saveId);
      return;
    }

    this.showToast('Sending to Kindle...');

    try {
      const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/send-to-kindle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: this.user.id, save_id: saveId }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Send failed');
      }

      this.showToast('📖 Sent to Kindle!');
    } catch (err) {
      console.error('Send to Kindle error:', err);
      this.showToast('Failed to send to Kindle: ' + err.message, true);
    }
  }

  showKindleUrlModal() {
    const modal = document.getElementById('kindle-url-modal');
    document.getElementById('kindle-url-input').value = '';
    document.getElementById('kindle-url-status').classList.add('hidden');
    if (this.kindleEmail) document.getElementById('kindle-url-device').value = this.kindleEmail;
    modal.classList.remove('hidden');
    document.getElementById('kindle-url-input').focus();
  }

  hideKindleUrlModal() {
    document.getElementById('kindle-url-modal').classList.add('hidden');
  }

  async sendUrlToKindle() {
    const url = document.getElementById('kindle-url-input').value.trim();
    const kindleEmail = document.getElementById('kindle-url-device').value;
    const status = document.getElementById('kindle-url-status');
    const sendBtn = document.getElementById('kindle-url-send-btn');

    if (!url || !url.startsWith('http')) {
      status.textContent = 'Please enter a valid URL.';
      status.classList.remove('hidden');
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Fetching article...';
    status.classList.add('hidden');

    try {
      // Save the article first (save-page fetches + saves to DB)
      const fetchRes = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/save-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': CONFIG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ url, user_id: this.user.id }),
      });
      const fetchResult = await fetchRes.json();
      if (!fetchRes.ok) throw new Error(fetchResult.error || 'Failed to fetch article');

      const saveId = fetchResult.save?.id;
      if (!saveId) throw new Error('Failed to save article');

      sendBtn.textContent = 'Sending...';

      // Send to Kindle using the saved article
      const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/send-to-kindle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': CONFIG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ user_id: this.user.id, save_id: saveId, kindle_email: kindleEmail }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Send failed');

      this.hideKindleUrlModal();
      this.showToast('📖 Sent to Kindle!');
    } catch (err) {
      status.textContent = err.message;
      status.classList.remove('hidden');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send to Kindle';
    }
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
      .select('created_at, highlight, is_archived, source');

    const totalSaves = saves?.length || 0;
    const highlights = saves?.filter(s => s.highlight)?.length || 0;
    const articles = totalSaves - highlights;
    const archived = saves?.filter(s => s.is_archived)?.length || 0;

    // Reading goals from localStorage
    const goals = this.getReadingGoals();
    const weeklyGoal = goals.weeklyGoal || 10;
    const monthlyGoal = goals.monthlyGoal || 40;

    // Calculate this week/month progress
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisWeekSaves = saves?.filter(s => new Date(s.created_at) >= weekStart).length || 0;
    const thisMonthSaves = saves?.filter(s => new Date(s.created_at) >= monthStart).length || 0;

    // Calculate streak
    const streak = this.calculateReadingStreak(saves);

    // Top sources
    const sourceCount = {};
    saves?.forEach(s => {
      const source = s.source === 'import' ? 'Readwise' :
                     s.source === 'webhighlights' ? 'WebHighlights' :
                     s.source === 'extension' ? 'Chrome Extension' :
                     s.source === 'feed' ? 'RSS Feeds' :
                     s.source === 'podcast' ? 'Podcasts' : 'Other';
      sourceCount[source] = (sourceCount[source] || 0) + 1;
    });
    const topSources = Object.entries(sourceCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Group by week for last 8 weeks
    const weeklyActivity = [];
    for (let i = 7; i >= 0; i--) {
      const weekDate = new Date(now);
      weekDate.setDate(now.getDate() - (i * 7));
      weekDate.setHours(0, 0, 0, 0);
      const nextWeek = new Date(weekDate);
      nextWeek.setDate(weekDate.getDate() + 7);

      const count = saves?.filter(s => {
        const d = new Date(s.created_at);
        return d >= weekDate && d < nextWeek;
      }).length || 0;

      weeklyActivity.push({
        week: weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count
      });
    }

    const maxWeekly = Math.max(...weeklyActivity.map(w => w.count), 1);

    const content = document.querySelector('.content');
    content.innerHTML = `
      <div class="stats-container">
        <div class="stats-header">
          <h2>Reading Stats & Goals</h2>
          <button class="btn secondary" onclick="app.setView('all')">← Back</button>
        </div>

        <!-- Reading Goals -->
        <div class="stats-section" style="background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); color: white; border: none;">
          <h3 style="color: white; margin-bottom: 20px;">📊 Reading Goals</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
            <div>
              <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px;">This Week</div>
              <div style="font-size: 32px; font-weight: 700; margin-bottom: 8px;">${thisWeekSaves} / ${weeklyGoal}</div>
              <div style="background: rgba(255,255,255,0.2); height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="background: white; height: 100%; width: ${Math.min(100, (thisWeekSaves / weeklyGoal) * 100)}%; transition: width 0.3s;"></div>
              </div>
              <div style="font-size: 12px; opacity: 0.8; margin-top: 6px;">${Math.round((thisWeekSaves / weeklyGoal) * 100)}% complete</div>
            </div>
            <div>
              <div style="font-size: 13px; opacity: 0.9; margin-bottom: 8px;">This Month</div>
              <div style="font-size: 32px; font-weight: 700; margin-bottom: 8px;">${thisMonthSaves} / ${monthlyGoal}</div>
              <div style="background: rgba(255,255,255,0.2); height: 8px; border-radius: 4px; overflow: hidden;">
                <div style="background: white; height: 100%; width: ${Math.min(100, (thisMonthSaves / monthlyGoal) * 100)}%; transition: width 0.3s;"></div>
              </div>
              <div style="font-size: 12px; opacity: 0.8; margin-top: 6px;">${Math.round((thisMonthSaves / monthlyGoal) * 100)}% complete</div>
            </div>
          </div>
          <button class="btn secondary" onclick="app.editReadingGoals()" style="margin-top: 20px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white;">Edit Goals</button>
        </div>

        <!-- Key Stats -->
        <div class="stats-cards">
          <div class="stat-card">
            <div class="stat-card-value">${totalSaves}</div>
            <div class="stat-card-label">Total Saves</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${streak}</div>
            <div class="stat-card-label">Day Streak 🔥</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${articles}</div>
            <div class="stat-card-label">Articles</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-value">${highlights}</div>
            <div class="stat-card-label">Highlights</div>
          </div>
        </div>

        <!-- Weekly Activity Chart -->
        <div class="stats-section">
          <h3>Weekly Activity</h3>
          <div style="display: flex; gap: 8px; align-items: flex-end; margin-top: 20px; height: 150px;">
            ${weeklyActivity.map(w => `
              <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <div style="flex: 1; display: flex; align-items: flex-end; width: 100%;">
                  <div style="width: 100%; background: var(--primary); border-radius: 4px 4px 0 0; height: ${(w.count / maxWeekly) * 100}%; min-height: ${w.count > 0 ? '8px' : '0'}; transition: height 0.3s;" title="${w.count} saves"></div>
                </div>
                <div style="font-size: 11px; color: var(--text-muted); writing-mode: horizontal-tb;">${w.week}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Top Sources -->
        <div class="stats-section">
          <h3>Top Sources</h3>
          <div style="margin-top: 16px;">
            ${topSources.map(([source, count]) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border-light);">
                <span style="font-size: 14px; color: var(--text);">${source}</span>
                <span style="font-size: 14px; font-weight: 600; color: var(--primary);">${count}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  calculateReadingStreak(saves) {
    if (!saves || saves.length === 0) return 0;

    // Sort saves by date descending
    const sorted = [...saves].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Get unique days
    const days = new Set();
    sorted.forEach(s => {
      const date = new Date(s.created_at);
      const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      days.add(dayKey);
    });

    const uniqueDays = Array.from(days).sort().reverse();

    // Check if today or yesterday has activity
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    if (!uniqueDays.includes(todayKey) && !uniqueDays.includes(yesterdayKey)) {
      return 0; // Streak broken
    }

    // Count consecutive days
    let streak = 0;
    let checkDate = new Date(today);

    for (let i = 0; i < uniqueDays.length; i++) {
      const checkKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
      if (uniqueDays.includes(checkKey)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  getReadingGoals() {
    const stored = localStorage.getItem('stash-reading-goals');
    if (stored) {
      return JSON.parse(stored);
    }
    return { weeklyGoal: 10, monthlyGoal: 40 };
  }

  saveReadingGoals(goals) {
    localStorage.setItem('stash-reading-goals', JSON.stringify(goals));
  }

  editReadingGoals() {
    const goals = this.getReadingGoals();
    const weekly = prompt('Weekly reading goal (articles to save):', goals.weeklyGoal);
    if (weekly === null) return;

    const monthly = prompt('Monthly reading goal (articles to save):', goals.monthlyGoal);
    if (monthly === null) return;

    this.saveReadingGoals({
      weeklyGoal: parseInt(weekly) || 10,
      monthlyGoal: parseInt(monthly) || 40
    });

    this.showStats(); // Refresh
  }

  async incrementReadingGoal(action) {
    // Track saves for reading goals (called from submitQuickSave)
    // This is a placeholder for future goal tracking features
    console.log('Reading goal action:', action);
  }

  // Notes View
  async loadNotes() {
    const container = document.getElementById('saves-container');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');

    this.hideError();
    container.classList.remove('saves-grid');
    loading.classList.remove('hidden');
    empty.classList.add('hidden');

    const { data, error } = await this.supabase
      .from('saves')
      .select('*')
      .eq('user_id', this.user.id)
      .eq('source', 'note')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false });

    loading.classList.add('hidden');

    if (error) {
      console.error('Error loading notes:', error);
      this.showError('Could not load notes.');
      return;
    }

    this.notes = data || [];
    this.renderNotesView();
  }

  renderNotesView() {
    const container = document.getElementById('saves-container');
    const empty = document.getElementById('empty-state');
    empty.classList.add('hidden');

    container.innerHTML = `
      <div class="notes-layout">
        <div class="notes-list-panel">
          <div class="notes-list-header">
            <button class="notes-new-btn" id="notes-new-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              New Note
            </button>
          </div>
          <div class="notes-list" id="notes-list">
            ${this.notes.length === 0 ? `
              <div class="notes-empty">
                <p>No notes yet.</p>
                <p>Click "New Note" to get started.</p>
              </div>
            ` : this.notes.map(note => this.renderNoteListItem(note)).join('')}
          </div>
        </div>
        <div class="notes-editor-panel" id="notes-editor-panel">
          <div class="notes-editor-empty" id="notes-editor-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted)">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <p>Select a note or create a new one</p>
          </div>
        </div>
      </div>
    `;

    document.getElementById('notes-new-btn').addEventListener('click', () => this.createNote());

    this.notes.forEach(note => {
      const el = document.querySelector(`.notes-list-item[data-id="${note.id}"]`);
      if (el) el.addEventListener('click', () => this.selectNote(note));
    });

    // Re-select the current note if one was open
    if (this.currentNote) {
      const stillExists = this.notes.find(n => n.id === this.currentNote.id);
      if (stillExists) this.selectNote(stillExists);
    }
  }

  renderNoteListItem(note) {
    const isActive = this.currentNote && this.currentNote.id === note.id;
    const title = note.title || 'Untitled';
    const preview = (note.content || '').replace(/\n/g, ' ').substring(0, 80);
    const date = new Date(note.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `
      <div class="notes-list-item${isActive ? ' active' : ''}" data-id="${note.id}">
        <div class="notes-list-item-title">${this.escapeHtml(title)}</div>
        ${preview ? `<div class="notes-list-item-preview">${this.escapeHtml(preview)}</div>` : ''}
        <div class="notes-list-item-date">${date}</div>
      </div>
    `;
  }

  selectNote(note) {
    this.currentNote = note;

    // Update active state in list
    document.querySelectorAll('.notes-list-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === note.id);
    });

    const panel = document.getElementById('notes-editor-panel');
    panel.innerHTML = `
      <div class="notes-editor">
        <div class="notes-editor-toolbar">
          <button class="notes-editor-back-btn" id="notes-editor-back-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            Notes
          </button>
          <span class="notes-save-status" id="notes-save-status"></span>
          <button class="notes-delete-btn" id="notes-delete-btn" title="Delete note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
        <input class="notes-title-input" id="notes-title-input" type="text" placeholder="Title" value="${this.escapeHtml(note.title || '')}">
        <textarea class="notes-body-textarea" id="notes-body-textarea" placeholder="Start writing...">${this.escapeHtml(note.content || '')}</textarea>
      </div>
    `;

    const titleInput = document.getElementById('notes-title-input');
    const bodyTextarea = document.getElementById('notes-body-textarea');

    titleInput.addEventListener('input', () => this.scheduleNoteSave());
    bodyTextarea.addEventListener('input', () => this.scheduleNoteSave());

    document.getElementById('notes-delete-btn').addEventListener('click', () => this.deleteNote(note.id));

    document.getElementById('notes-editor-back-btn')?.addEventListener('click', () => {
      const layout = document.querySelector('.notes-layout');
      if (layout) layout.classList.remove('mobile-editor-open');
      this.currentNote = null;
      document.querySelectorAll('.notes-list-item').forEach(el => el.classList.remove('active'));
    });

    // On mobile, slide to editor panel
    const layout = document.querySelector('.notes-layout');
    if (layout && window.innerWidth <= 768) {
      layout.classList.add('mobile-editor-open');
    }

    // Focus body if title is set, otherwise focus title
    if (note.title) {
      bodyTextarea.focus();
      bodyTextarea.setSelectionRange(bodyTextarea.value.length, bodyTextarea.value.length);
    } else {
      titleInput.focus();
    }
  }

  scheduleNoteSave() {
    const statusEl = document.getElementById('notes-save-status');
    if (statusEl) statusEl.textContent = '';
    clearTimeout(this.noteSaveTimer);
    this.noteSaveTimer = setTimeout(() => this.saveCurrentNote(), 800);
  }

  async saveCurrentNote() {
    if (!this.currentNote) return;

    const titleInput = document.getElementById('notes-title-input');
    const bodyTextarea = document.getElementById('notes-body-textarea');
    if (!titleInput || !bodyTextarea) return;

    const title = titleInput.value;
    const content = bodyTextarea.value;

    const { error } = await this.supabase
      .from('saves')
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq('id', this.currentNote.id);

    if (!error) {
      // Update local state
      this.currentNote.title = title;
      this.currentNote.content = content;
      const note = this.notes.find(n => n.id === this.currentNote.id);
      if (note) { note.title = title; note.content = content; note.updated_at = new Date().toISOString(); }

      // Refresh list item in place
      const listItem = document.querySelector(`.notes-list-item[data-id="${this.currentNote.id}"]`);
      if (listItem) listItem.outerHTML = this.renderNoteListItem(this.currentNote);
      // Re-bind click for the updated item
      const updatedItem = document.querySelector(`.notes-list-item[data-id="${this.currentNote.id}"]`);
      if (updatedItem) updatedItem.addEventListener('click', () => this.selectNote(this.currentNote));

      const statusEl = document.getElementById('notes-save-status');
      if (statusEl) {
        statusEl.textContent = 'Saved';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
      }
    }
  }

  async createNote() {
    const { data, error } = await this.supabase
      .from('saves')
      .insert({
        user_id: this.user.id,
        title: '',
        content: '',
        source: 'note',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating note:', error);
      return;
    }

    this.notes.unshift(data);
    this.currentNote = null; // reset so renderNotesView doesn't re-select old note

    // Refresh list and select new note
    const listEl = document.getElementById('notes-list');
    if (listEl) {
      listEl.innerHTML = this.notes.map(n => this.renderNoteListItem(n)).join('');
      this.notes.forEach(n => {
        const el = document.querySelector(`.notes-list-item[data-id="${n.id}"]`);
        if (el) el.addEventListener('click', () => this.selectNote(n));
      });
    }

    this.selectNote(data);
  }

  async deleteNote(id) {
    if (!confirm('Delete this note?')) return;

    const { error } = await this.supabase
      .from('saves')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting note:', error);
      return;
    }

    this.notes = this.notes.filter(n => n.id !== id);
    this.currentNote = null;

    // Refresh list
    const listEl = document.getElementById('notes-list');
    if (listEl) {
      listEl.innerHTML = this.notes.length === 0
        ? '<div class="notes-empty"><p>No notes yet.</p><p>Click "New Note" to get started.</p></div>'
        : this.notes.map(n => this.renderNoteListItem(n)).join('');
      this.notes.forEach(n => {
        const el = document.querySelector(`.notes-list-item[data-id="${n.id}"]`);
        if (el) el.addEventListener('click', () => this.selectNote(n));
      });
    }

    // On mobile, go back to list
    const layout = document.querySelector('.notes-layout');
    if (layout) layout.classList.remove('mobile-editor-open');

    // Clear editor
    const panel = document.getElementById('notes-editor-panel');
    if (panel) {
      panel.innerHTML = `
        <div class="notes-editor-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted)">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
          <p>Select a note or create a new one</p>
        </div>
      `;
    }
  }

  // Kindle Highlights View
  async loadKindleHighlights() {
    const container = document.getElementById('saves-container');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');

    this.hideError();
    this.hideOfflineBanner();
    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    container.innerHTML = '';

    const { data, error } = await this.supabase
      .from('saves')
      .select('*')
      .eq('source', 'kindle')
      .order('title', { ascending: true });

    loading.classList.add('hidden');

    if (error) {
      console.error('Error loading Kindle highlights:', error);
      this.showError('Could not load Kindle highlights. Check your connection and try again.');
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

  decodeHtmlEntities(text) {
    if (!text) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  renderMarkdown(text) {
    if (!text) return '';

    // Check if content looks like HTML (has common HTML tags)
    const isHtml = /<(p|div|a|br|h[1-6]|ul|ol|li|blockquote|img|figure|figcaption|strong|em|b|i|span)\b/i.test(text);

    if (isHtml) {
      // Content is HTML - sanitize and return directly
      return this.sanitizeHtml(text);
    }

    // Content is plain text or markdown
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,  // Convert \n to <br>
        gfm: true,     // GitHub Flavored Markdown
      });

      try {
        return marked.parse(text);
      } catch (e) {
        console.error('Markdown parse error:', e);
        return `<div style="white-space: pre-wrap;">${this.escapeHtml(text)}</div>`;
      }
    }

    // Fallback if marked isn't loaded
    return `<div style="white-space: pre-wrap;">${this.escapeHtml(text)}</div>`;
  }

  sanitizeHtml(html) {
    // Allow safe HTML tags for article content, strip dangerous ones
    const allowedTags = ['p', 'div', 'a', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'img', 'figure', 'figcaption',
      'strong', 'em', 'b', 'i', 'span', 'pre', 'code', 'table', 'thead',
      'tbody', 'tr', 'th', 'td', 'hr', 'sub', 'sup', 'mark'];
    const allowedAttrs = ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'];

    // Create a temporary element to parse and sanitize
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // Process all elements
    const sanitize = (el) => {
      const children = Array.from(el.children);
      for (const child of children) {
        const tagName = child.tagName.toLowerCase();

        // Remove disallowed tags but keep their text content
        if (!allowedTags.includes(tagName)) {
          const text = document.createTextNode(child.textContent);
          child.replaceWith(text);
          continue;
        }

        // Remove script/style content entirely
        if (tagName === 'script' || tagName === 'style') {
          child.remove();
          continue;
        }

        // Remove disallowed attributes
        const attrs = Array.from(child.attributes);
        for (const attr of attrs) {
          if (!allowedAttrs.includes(attr.name.toLowerCase())) {
            child.removeAttribute(attr.name);
          }
          // Remove javascript: URLs
          if (attr.name === 'href' && attr.value.toLowerCase().startsWith('javascript:')) {
            child.removeAttribute('href');
          }
        }

        // Make links open in new tab
        if (tagName === 'a' && child.hasAttribute('href')) {
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noopener noreferrer');
        }

        // Recursively sanitize children
        sanitize(child);
      }
    };

    sanitize(temp);
    return temp.innerHTML;
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
      const cached = this.getCachedData('stash-cache-feeds');
      if (cached) this.feeds = cached;
      return;
    }

    this.feeds = data || [];
    this.cacheData('stash-cache-feeds', this.feeds);
  }

  async loadFeedCategories() {
    const { data, error } = await this.supabase
      .from('feed_categories')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error loading feed categories:', error);
      const cached = this.getCachedData('stash-cache-feedcategories');
      if (cached) this.feedCategories = cached;
      return;
    }

    this.feedCategories = data || [];
    this.cacheData('stash-cache-feedcategories', this.feedCategories);
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
    // If the user is currently reading an article (feed-reader view or
    // reading pane open), update the data silently without rebuilding the DOM
    // so a background refresh doesn't kick them out of what they're reading.
    const isReading = this.currentView === 'feed-reader' || !!this.currentSave;

    const container = document.getElementById('saves-container');
    const loading = document.getElementById('loading');
    const empty = document.getElementById('empty-state');

    if (!isReading) {
      this.hideError();
      this.hideOfflineBanner();
      loading.classList.remove('hidden');
      empty.classList.add('hidden');
      container.innerHTML = '';
    }

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
        if (!isReading) {
          loading.classList.add('hidden');
          this.feedItems = [];
          this.renderFeedInbox();
        } else {
          this.feedItems = [];
        }
        return;
      }
    }

    const { data, error } = await query;

    if (!isReading) {
      loading.classList.add('hidden');
    }

    if (error) {
      console.error('Error loading feed items:', error);
      if (isReading) return;
      const cached = this.getCachedData('stash-cache-feeditems');
      if (cached) {
        this.feedItems = cached;
        this.showOfflineBanner();
        this.renderFeedInbox();
      } else {
        this.showError('Could not load feed items. Check your connection and try again.');
      }
      return;
    }

    this.feedItems = data || [];
    this.cacheData('stash-cache-feeditems', this.feedItems);
    if (!isReading) {
      this.renderFeedInbox();
    }
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

    // Card layout with thumbnail, title, subtitle, and meta
    const itemsHtml = this.feedItems.map(item => {
      const siteUrl = item.feeds?.site_url || '';
      const domain = siteUrl ? new URL(siteUrl).hostname : '';
      const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : '';
      const smallFaviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32` : '';
      const thumbnailUrl = item.image_url || '';
      // Decode HTML entities and truncate excerpt
      const rawExcerpt = item.excerpt || '';
      const excerpt = this.decodeHtmlEntities(rawExcerpt).substring(0, 150);
      const author = item.author || '';

      // Use article image if available, otherwise use larger favicon as fallback
      const displayImage = thumbnailUrl || faviconUrl;
      const imageStyle = thumbnailUrl
        ? 'width:64px;height:64px;object-fit:cover;flex-shrink:0;border-radius:6px;'
        : 'width:64px;height:64px;object-fit:contain;flex-shrink:0;border-radius:6px;background:#f9f9f9;padding:12px;box-sizing:border-box;';

      return `
      <div class="feed-item-swipe-wrapper" data-index="${this.feedItems.indexOf(item)}">
        <div class="feed-item-swipe-action">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          Seen
        </div>
        <div class="feed-item-card${!item.is_seen ? ' unseen' : ''}" data-id="${item.id}">
          ${displayImage ? `<img class="feed-item-thumbnail" src="${this.escapeHtml(displayImage)}" alt="" loading="lazy" style="${imageStyle}">` : ''}
          <div class="feed-item-content">
            <div class="feed-item-title">${this.escapeHtml(item.title || 'Untitled')}</div>
            ${excerpt ? `<div class="feed-item-subtitle">${this.escapeHtml(excerpt)}</div>` : ''}
            <div class="feed-item-meta">
              ${smallFaviconUrl ? `<img class="feed-item-meta-favicon" src="${smallFaviconUrl}" alt="" width="12" height="12">` : ''}
              <span class="feed-item-meta-source">${this.escapeHtml(item.feeds?.title || '')}</span>
              ${author ? `<span class="feed-item-meta-sep">•</span><span class="feed-item-meta-author">${this.escapeHtml(author)}</span>` : ''}
              <span class="feed-item-meta-sep">•</span>
              <span class="feed-item-meta-time">${item.published_at ? this.formatRelativeDate(item.published_at) : ''}</span>
            </div>
          </div>
        </div>
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

    document.querySelectorAll('.feed-item-card').forEach((row, index) => {
      // Click to open item (skip if user just swiped)
      row.addEventListener('click', () => {
        if (this._swipedRecently) return;
        const item = this.feedItems[index];
        if (item) {
          this.openFeedItem(item);
        }
      });

      // Mouse hover selects the item (unless keyboard navigation is active)
      row.addEventListener('mouseenter', () => {
        if (!this.mouseSelectionDisabled) {
          this.selectFeedItem(index);
        }
      });
    });

    // Re-enable mouse selection when user actually moves the mouse
    const container = document.getElementById('saves-container');
    if (container) {
      // Remove old listener if it exists
      if (this.mouseMoveHandler) {
        container.removeEventListener('mousemove', this.mouseMoveHandler);
      }
      // Add new listener
      this.mouseMoveHandler = () => {
        this.enableMouseSelection();
      };
      container.addEventListener('mousemove', this.mouseMoveHandler);
    }

    // Bind swipe-to-mark-seen on touch devices
    this.bindFeedSwipeEvents();
  }

  bindFeedSwipeEvents() {
    const isTouchDevice = 'ontouchstart' in window;
    if (!isTouchDevice) return;

    document.querySelectorAll('.feed-item-swipe-wrapper').forEach((wrapper) => {
      const card = wrapper.querySelector('.feed-item-card');
      if (!card) return;

      let startX = 0;
      let startY = 0;
      let currentX = 0;
      let swiping = false;
      let directionLocked = false;

      const THRESHOLD = 100; // px to trigger action

      card.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        currentX = 0;
        swiping = false;
        directionLocked = false;
        card.style.transition = 'none';
      }, { passive: true });

      card.addEventListener('touchmove', (e) => {
        const dx = e.touches[0].clientX - startX;
        const dy = e.touches[0].clientY - startY;

        // Lock direction after first significant movement
        if (!directionLocked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
          directionLocked = true;
          swiping = Math.abs(dx) > Math.abs(dy); // Horizontal wins
        }

        if (!swiping) return;

        e.preventDefault(); // Prevent scroll while swiping horizontally

        // Only allow swiping left (negative dx)
        currentX = Math.min(0, dx);
        card.style.transform = `translateX(${currentX}px)`;

        // Show action background intensity based on swipe distance
        if (Math.abs(currentX) > THRESHOLD) {
          wrapper.classList.add('swipe-threshold');
        } else {
          wrapper.classList.remove('swipe-threshold');
        }
      }, { passive: false });

      card.addEventListener('touchend', () => {
        if (!swiping) return;

        // Prevent the click from firing after a swipe
        this._swipedRecently = true;
        setTimeout(() => { this._swipedRecently = false; }, 300);

        card.style.transition = 'transform 0.2s ease';

        if (Math.abs(currentX) > THRESHOLD) {
          // Swiped past threshold — animate off and mark seen
          card.style.transform = `translateX(-100%)`;
          wrapper.classList.remove('swipe-threshold');

          const itemId = card.dataset.id;
          const item = this.feedItems.find(i => i.id === itemId);
          if (item) {
            setTimeout(() => this.markFeedItemSeen(item), 200);
          }
        } else {
          // Snap back
          card.style.transform = 'translateX(0)';
          wrapper.classList.remove('swipe-threshold');
        }

        swiping = false;
      }, { passive: true });
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
      const row = document.querySelector(`.feed-item-card[data-id="${item.id}"]`);
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

    // Save for undo before marking
    this.lastMarkedSeenItem = {
      item: { ...item }, // Clone the item
      index: currentIndex,
      tab: this.feedViewTab
    };

    await this.supabase
      .from('feed_items')
      .update({ is_seen: true })
      .eq('id', item.id);

    item.is_seen = true;
    this.updateFeedUnreadBadge();

    // Remove the row from the list with animation
    const row = document.querySelector(`.feed-item-card[data-id="${item.id}"]`);
    if (row) {
      row.classList.add('marking-seen');
      setTimeout(() => {
        // Remove from feedItems array if viewing unseen
        if (this.feedViewTab === 'unseen') {
          this.feedItems = this.feedItems.filter(i => i.id !== item.id);
          // Remove the swipe wrapper (parent) so no empty shell is left behind
          const wrapper = row.closest('.feed-item-swipe-wrapper');
          (wrapper || row).remove();
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

  async markFeedItemUnseen(item) {
    await this.supabase
      .from('feed_items')
      .update({ is_seen: false })
      .eq('id', item.id);

    item.is_seen = false;
    this.updateFeedUnreadBadge();
  }

  async undoMarkFeedItemSeen() {
    if (!this.lastMarkedSeenItem) return;

    const { item, index, tab } = this.lastMarkedSeenItem;
    this.lastMarkedSeenItem = null; // Clear undo state

    // Mark as unseen in database
    await this.supabase
      .from('feed_items')
      .update({ is_seen: false })
      .eq('id', item.id);

    this.updateFeedUnreadBadge();

    // If we're still on the unseen tab, re-add the item
    if (this.feedViewTab === 'unseen' && tab === 'unseen') {
      // Restore item at original position
      item.is_seen = false;
      this.feedItems.splice(index, 0, item);
      this.renderFeedInbox();
      this.selectFeedItem(index);
    } else if (this.feedViewTab === 'seen') {
      // If on seen tab, remove the item from view
      this.feedItems = this.feedItems.filter(i => i.id !== item.id);
      this.renderFeedInbox();
    } else {
      // Just reload to be safe
      this.loadFeedItems();
    }
  }

  returnToFeedInbox() {
    this.currentFeedItem = null;

    // Preserve currentFeedCategory so we return to the same folder
    const savedCategory = this.currentFeedCategory;
    const savedTab = this.feedViewTab;

    this.currentView = 'feeds';

    // Restore category and tab
    this.currentFeedCategory = savedCategory;
    this.feedViewTab = savedTab;

    // Update nav highlights
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === 'feeds');
    });
    document.querySelectorAll('.nav-item[data-folder]').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelectorAll('.tag').forEach(item => {
      item.classList.remove('active');
    });
    document.querySelectorAll('.feed-category-item').forEach(item => {
      item.classList.toggle('active', item.dataset.categoryId === savedCategory);
    });

    // Update title
    const titleEl = document.getElementById('view-title');
    if (titleEl) {
      const category = savedCategory ? this.feedCategories.find(c => c.id === savedCategory) : null;
      titleEl.textContent = category ? category.name : 'Feed Inbox';
      titleEl.parentElement.style.display = '';
    }

    // Hide tag filter
    const tagFilterSelect = document.getElementById('tag-filter-select');
    if (tagFilterSelect) {
      tagFilterSelect.classList.add('hidden');
    }

    // Render instantly from cached feedItems instead of reloading from network
    // Just remove any items that were marked seen while in the reader
    if (savedTab === 'unseen') {
      this.feedItems = this.feedItems.filter(i => !i.is_seen);
    }
    document.getElementById('loading')?.classList.add('hidden');
    this.renderFeedInbox();
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
            <button class="feed-reader-action-btn" id="feed-reader-unread-btn" title="Mark as unread (u)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
            </button>
            <button class="feed-reader-action-btn" id="feed-reader-kindle-btn" title="Send to Kindle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
              </svg>
            </button>
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
          <button class="generate-audio-btn" id="feed-reader-listen-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor"></polygon>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
            Listen to this article
          </button>
          <div class="audio-generating hidden" id="feed-reader-audio-generating">
            <div class="audio-generating-spinner"></div>
            <span>Generating audio...</span>
          </div>
          <div class="audio-player hidden" id="feed-reader-audio-player">
            <button class="audio-play-btn" id="feed-reader-audio-play-btn" title="Play audio">
              <svg class="play-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <svg class="pause-icon hidden" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            </button>
            <div class="audio-progress-container">
              <div class="audio-time" id="feed-reader-audio-current">0:00</div>
              <div class="audio-progress-bar" id="feed-reader-audio-progress-bar">
                <div class="audio-progress" id="feed-reader-audio-progress"></div>
              </div>
              <div class="audio-time" id="feed-reader-audio-duration">0:00</div>
            </div>
            <select class="audio-speed" id="feed-reader-audio-speed" title="Playback speed">
              <option value="0.75">0.75x</option>
              <option value="1" selected>1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
            </select>
          </div>
          <div class="feed-reader-content">
            ${this.renderMarkdown(content)}
          </div>
        </article>
      </div>
    `;

    // Bind events
    document.getElementById('feed-reader-back-btn')?.addEventListener('click', () => {
      this.stopAudio();
      this.returnToFeedInbox();
    });

    document.getElementById('feed-reader-unread-btn')?.addEventListener('click', async () => {
      await this.markFeedItemUnseen(item);
      this.stopAudio();
      this.returnToFeedInbox();
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

    document.getElementById('feed-reader-kindle-btn')?.addEventListener('click', async () => {
      // Save to library first to get a save_id, then send to Kindle
      let saveId = item.save_id;
      if (!saveId) {
        saveId = await this.saveFeedItemToLibrary(item.id);
        if (!saveId) {
          this.showToast('Failed to save article before sending to Kindle', true);
          return;
        }
        const saveBtn = document.getElementById('feed-reader-save-btn');
        if (saveBtn) {
          saveBtn.classList.add('saved');
          saveBtn.title = 'Saved to library';
          saveBtn.querySelector('svg').setAttribute('fill', 'currentColor');
        }
      }
      this.sendToKindle(saveId);
    });

    // Listen button: save to library first if needed, then generate audio
    document.getElementById('feed-reader-listen-btn')?.addEventListener('click', async () => {
      const listenBtn = document.getElementById('feed-reader-listen-btn');
      const generating = document.getElementById('feed-reader-audio-generating');
      const player = document.getElementById('feed-reader-audio-player');

      listenBtn.classList.add('hidden');
      generating.classList.remove('hidden');

      try {
        // Save to library if not already saved
        let saveId = item.save_id;
        if (!saveId) {
          saveId = await this.saveFeedItemToLibrary(item.id);
          if (!saveId) throw new Error('Failed to save article');
          // Update save button state
          const saveBtn = document.getElementById('feed-reader-save-btn');
          if (saveBtn) {
            saveBtn.classList.add('saved');
            saveBtn.title = 'Saved to library';
            saveBtn.querySelector('svg').setAttribute('fill', 'currentColor');
          }
        }

        // Generate audio
        const res = await fetch(
          `${CONFIG.SUPABASE_URL}/functions/v1/generate-audio`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': CONFIG.SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ save_id: saveId }),
          }
        );

        const result = await res.json();
        if (!res.ok || !result.success) throw new Error(result.error || 'Audio generation failed');

        // Show audio player
        generating.classList.add('hidden');
        player.classList.remove('hidden');
        this.initFeedReaderAudio(result.signed_url || result.audio_url);
      } catch (err) {
        console.error('Feed reader audio error:', err);
        generating.classList.add('hidden');
        listenBtn.classList.remove('hidden');
        listenBtn.textContent = 'Retry — audio generation failed';
      }
    });

    // Feed reader audio player controls
    document.getElementById('feed-reader-audio-play-btn')?.addEventListener('click', () => {
      this.toggleAudioPlayback();
    });

    document.getElementById('feed-reader-audio-speed')?.addEventListener('change', (e) => {
      if (this.audio) this.audio.playbackRate = parseFloat(e.target.value);
    });

    document.getElementById('feed-reader-audio-progress-bar')?.addEventListener('click', (e) => {
      if (this.audio && this.audio.duration) {
        const rect = e.target.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        this.audio.currentTime = percent * this.audio.duration;
      }
    });
  }

  async initFeedReaderAudio(url) {
    this.stopAudio();

    let audioSrc;
    if (url.startsWith('https://') || url.startsWith('http://')) {
      audioSrc = url;
    } else {
      const filename = url.split('/').pop();
      audioSrc = await this.getSignedAudioUrl(filename);
      if (!audioSrc) { console.error('Failed to get signed URL'); return; }
    }

    this.audio = new Audio(audioSrc);
    this.isPlaying = false;

    const playBtn = document.getElementById('feed-reader-audio-play-btn');
    const updatePlayBtn = () => {
      if (!playBtn) return;
      playBtn.querySelector('.play-icon').classList.toggle('hidden', this.isPlaying);
      playBtn.querySelector('.pause-icon').classList.toggle('hidden', !this.isPlaying);
    };
    updatePlayBtn();

    this.audio.addEventListener('loadedmetadata', () => {
      const el = document.getElementById('feed-reader-audio-duration');
      if (el) el.textContent = this.formatTime(this.audio.duration);
    });

    this.audio.addEventListener('timeupdate', () => {
      const progress = (this.audio.currentTime / this.audio.duration) * 100;
      const bar = document.getElementById('feed-reader-audio-progress');
      const cur = document.getElementById('feed-reader-audio-current');
      if (bar) bar.style.width = `${progress}%`;
      if (cur) cur.textContent = this.formatTime(this.audio.currentTime);
    });

    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      updatePlayBtn();
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

  async archiveOldFeedItems() {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 100);

      const { error, count } = await this.supabase
        .from('feed_items')
        .delete({ count: 'exact' })
        .eq('is_saved', false)
        .lt('published_at', cutoff.toISOString());

      if (count > 0) {
        console.log(`Auto-archived ${count} feed items older than 100 days`);
      }
    } catch (err) {
      console.error('Error archiving old feed items:', err);
    }
  }

  async refreshFeeds() {
    const btn = document.getElementById('refresh-feeds-btn');
    if (btn) {
      btn.classList.add('refreshing');
      btn.disabled = true;
    }

    // Track start time to ensure animation runs at least one full rotation
    const startTime = Date.now();
    const minAnimationTime = 1000; // 1 second minimum

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
      console.log('Refresh feeds result:', result);

      if (result.error) {
        alert('Error refreshing feeds: ' + result.error);
      } else {
        // Show how many new items were found
        if (result.new_items > 0) {
          console.log(`Found ${result.new_items} new items`);
        }
        // Always reload feed items to show current state
        this.updateFeedUnreadBadge();
        this.loadFeedItems();
      }
    } catch (err) {
      console.error('Error refreshing feeds:', err);
      alert('Failed to refresh feeds: ' + err.message);
    } finally {
      // Wait for minimum animation time before stopping
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, minAnimationTime - elapsed);

      setTimeout(() => {
        if (btn) {
          btn.classList.remove('refreshing');
          btn.disabled = false;
        }
      }, remaining);
    }
  }

  async saveFeedItemToLibrary(itemId) {
    const item = this.feedItems.find(i => i.id === itemId);
    if (!item) return null;
    if (item.is_saved && item.save_id) return item.save_id;

    try {
      // Copy to saves table
      const { data: saveData, error } = await this.supabase
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
        })
        .select('id')
        .single();

      if (error) throw error;
      const saveId = saveData?.id;

      // Mark as saved in feed_items
      await this.supabase
        .from('feed_items')
        .update({ is_saved: true })
        .eq('id', itemId);

      item.is_saved = true;
      item.save_id = saveId;

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

      return saveId;
    } catch (err) {
      console.error('Error saving feed item:', err);
      alert('Failed to save to library');
      return null;
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

  // Save Podcast Modal
  showSavePodcastModal() {
    const modal = document.getElementById('save-podcast-modal');
    modal.classList.remove('hidden');
    this.resetSavePodcastModal();
    document.getElementById('podcast-url-input').focus();
  }

  hideSavePodcastModal() {
    const modal = document.getElementById('save-podcast-modal');
    modal.classList.add('hidden');
    this.resetSavePodcastModal();
  }

  resetSavePodcastModal() {
    document.getElementById('podcast-url-input').value = '';
    document.getElementById('podcast-save-btn').disabled = true;
    document.getElementById('podcast-detection-status').classList.add('hidden');
    document.querySelector('.podcast-detection-loading').classList.add('hidden');
    document.querySelector('.podcast-detection-success').classList.add('hidden');
    document.querySelector('.podcast-detection-error').classList.add('hidden');
    this.pendingPodcast = null;
  }

  async detectPodcastUrl(url) {
    const statusEl = document.getElementById('podcast-detection-status');
    const loadingEl = document.querySelector('.podcast-detection-loading');
    const successEl = document.querySelector('.podcast-detection-success');
    const errorEl = document.querySelector('.podcast-detection-error');
    const saveBtn = document.getElementById('podcast-save-btn');

    // Show loading
    statusEl.classList.remove('hidden');
    loadingEl.classList.remove('hidden');
    successEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    saveBtn.disabled = true;
    this.pendingPodcast = null;

    // Check for direct audio file
    const audioExtensions = ['.mp3', '.m4a', '.ogg', '.wav'];
    const urlPath = new URL(url).pathname.toLowerCase();
    const isDirectAudio = audioExtensions.some(ext => urlPath.endsWith(ext));

    if (isDirectAudio) {
      const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
      const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
      const hostname = new URL(url).hostname;

      this.pendingPodcast = { url, title, image_url: null, site_name: hostname, type: 'audio', spotify_embed_html: null };

      loadingEl.classList.add('hidden');
      successEl.classList.remove('hidden');
      document.getElementById('podcast-preview-title').textContent = title;
      document.getElementById('podcast-preview-source').textContent = hostname;
      document.getElementById('podcast-preview-image').classList.add('hidden');
      saveBtn.disabled = false;
      return;
    }

    // Check for Spotify episode link
    const spotifyMatch = url.match(/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/);
    if (spotifyMatch) {
      try {
        const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
        const response = await fetch(oembedUrl);
        if (!response.ok) throw new Error('Spotify oembed failed');
        const data = await response.json();

        this.pendingPodcast = {
          url,
          title: data.title || 'Spotify Episode',
          image_url: data.thumbnail_url || null,
          site_name: 'Spotify',
          type: 'spotify',
          spotify_embed_html: data.html || null
        };

        loadingEl.classList.add('hidden');
        successEl.classList.remove('hidden');
        document.getElementById('podcast-preview-title').textContent = data.title || 'Spotify Episode';
        document.getElementById('podcast-preview-source').textContent = 'Spotify';

        const previewImg = document.getElementById('podcast-preview-image');
        if (data.thumbnail_url) {
          previewImg.src = data.thumbnail_url;
          previewImg.classList.remove('hidden');
        } else {
          previewImg.classList.add('hidden');
        }

        saveBtn.disabled = false;
        return;
      } catch (err) {
        console.error('Spotify oembed error:', err);
      }
    }

    // Unsupported URL
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
  }

  async savePodcast() {
    if (!this.pendingPodcast) return;

    const saveBtn = document.getElementById('podcast-save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const p = this.pendingPodcast;
    const saveData = {
      user_id: this.user.id,
      url: p.url,
      title: p.title,
      site_name: p.site_name,
      image_url: p.image_url,
      source: 'podcast',
      audio_url: p.type === 'audio' ? p.url : null,
      content: p.type === 'spotify' ? p.spotify_embed_html : null,
    };

    const { error } = await this.supabase.from('saves').insert(saveData);

    if (error) {
      console.error('Error saving podcast:', error);
      saveBtn.textContent = 'Error — try again';
      saveBtn.disabled = false;
      return;
    }

    this.hideSavePodcastModal();
    this.loadSaves();
  }

  // Quick Save (Articles & Podcasts combined)
  showQuickSaveModal() {
    const modal = document.getElementById('quick-save-modal');
    modal.classList.remove('hidden');
    this.resetQuickSaveModal();
    document.getElementById('quick-save-url-input').focus();
  }

  hideQuickSaveModal() {
    const modal = document.getElementById('quick-save-modal');
    modal.classList.add('hidden');
    this.resetQuickSaveModal();
  }

  resetQuickSaveModal() {
    document.getElementById('quick-save-url-input').value = '';
    document.getElementById('quick-save-submit-btn').disabled = true;
    document.getElementById('quick-save-status').classList.add('hidden');
    document.querySelector('#quick-save-status .discovery-loading').classList.add('hidden');
    document.querySelector('#quick-save-status .discovery-success').classList.add('hidden');
    document.querySelector('#quick-save-status .discovery-error').classList.add('hidden');
    this.pendingQuickSave = null;
  }

  async detectQuickSaveUrl(url) {
    const statusEl = document.getElementById('quick-save-status');
    const loadingEl = statusEl.querySelector('.discovery-loading');
    const successEl = statusEl.querySelector('.discovery-success');
    const errorEl = statusEl.querySelector('.discovery-error');
    const submitBtn = document.getElementById('quick-save-submit-btn');

    // Show loading
    statusEl.classList.remove('hidden');
    loadingEl.classList.remove('hidden');
    successEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    submitBtn.disabled = true;
    this.pendingQuickSave = null;

    try {
      // First check if it's a podcast (direct audio or Spotify)
      const audioExtensions = ['.mp3', '.m4a', '.ogg', '.wav'];
      const urlPath = new URL(url).pathname.toLowerCase();
      const isDirectAudio = audioExtensions.some(ext => urlPath.endsWith(ext));

      if (isDirectAudio) {
        const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
        const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
        const hostname = new URL(url).hostname;

        this.pendingQuickSave = {
          url,
          title,
          excerpt: '',
          site_name: hostname,
          image_url: null,
          type: 'podcast',
          audio_url: url
        };

        loadingEl.classList.add('hidden');
        successEl.classList.remove('hidden');
        document.getElementById('quick-save-title').textContent = title;
        document.getElementById('quick-save-excerpt').textContent = hostname;
        document.getElementById('quick-save-type').textContent = '🎧 Podcast';
        submitBtn.disabled = false;
        return;
      }

      // Check for Spotify
      const spotifyMatch = url.match(/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)/);
      if (spotifyMatch) {
        const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
        const response = await fetch(oembedUrl);
        if (response.ok) {
          const data = await response.json();
          this.pendingQuickSave = {
            url,
            title: data.title || 'Spotify Episode',
            excerpt: 'Spotify',
            site_name: 'Spotify',
            image_url: data.thumbnail_url || null,
            type: 'spotify',
            content: data.html || null
          };

          loadingEl.classList.add('hidden');
          successEl.classList.remove('hidden');
          document.getElementById('quick-save-title').textContent = data.title || 'Spotify Episode';
          document.getElementById('quick-save-excerpt').textContent = 'Spotify podcast episode';
          document.getElementById('quick-save-type').textContent = '🎧 Spotify Podcast';
          submitBtn.disabled = false;
          return;
        }
      }

      // Otherwise, it's an article - use edge function
      const response = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/save-page`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': CONFIG.SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ url, user_id: this.user.id })
      });

      if (!response.ok) throw new Error('Failed to fetch article');

      const data = await response.json();

      this.pendingQuickSave = {
        url,
        title: data.title || 'Untitled',
        excerpt: data.excerpt || '',
        site_name: data.site_name || new URL(url).hostname,
        image_url: data.image_url || null,
        content: data.content || '',
        type: 'article'
      };

      loadingEl.classList.add('hidden');
      successEl.classList.remove('hidden');
      document.getElementById('quick-save-title').textContent = data.title || 'Untitled';
      document.getElementById('quick-save-excerpt').textContent = (data.excerpt || '').substring(0, 150) + '...';
      document.getElementById('quick-save-type').textContent = '📄 Article';
      submitBtn.disabled = false;

    } catch (error) {
      console.error('Error detecting URL:', error);
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
    }
  }

  async submitQuickSave() {
    if (!this.pendingQuickSave) return;

    const submitBtn = document.getElementById('quick-save-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    const s = this.pendingQuickSave;
    const saveData = {
      user_id: this.user.id,
      url: s.url,
      title: s.title,
      excerpt: s.excerpt || null,
      site_name: s.site_name,
      image_url: s.image_url,
      content: s.content || null,
      source: s.type === 'article' ? 'extension' : 'podcast',
      audio_url: s.audio_url || null
    };

    const { error } = await this.supabase.from('saves').insert(saveData);

    if (error) {
      console.error('Error saving:', error);
      submitBtn.textContent = 'Error — try again';
      submitBtn.disabled = false;
      return;
    }

    // Track reading goal
    await this.incrementReadingGoal('saved');

    this.hideQuickSaveModal();
    this.loadSaves();

    // Show success toast
    this.showToast('Saved successfully!');
  }

  showToast(message, isError = false) {
    // Simple toast notification
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: ${isError ? 'var(--danger)' : 'var(--success)'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 1000;
      animation: slideUp 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
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
    console.log('subscribeFeed called', this.discoveredFeed);
    if (!this.discoveredFeed) {
      console.error('No discovered feed');
      this.showToast('Error: No feed discovered', true);
      return;
    }

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
      console.log('Subscribe result:', result);

      if (result.error) {
        console.error('Subscribe error:', result.error);
        this.showToast('Error: ' + result.error, true);
        subscribeBtn.disabled = false;
        subscribeBtn.textContent = 'Subscribe';
        return;
      }

      // Success - save title before modal closes (it resets discoveredFeed)
      const feedTitle = this.discoveredFeed.title || 'feed';

      // Reload feeds and close modal
      await this.loadFeeds();
      await this.loadFeedCategories();
      this.updateFeedUnreadBadge();
      this.hideAddFeedModal();

      // Show success message
      this.showToast(`✅ Subscribed to ${feedTitle}!`);

      // Switch to feeds view
      this.setView('feeds');

    } catch (err) {
      console.error('Error subscribing:', err);
      this.showToast('Failed to subscribe to feed: ' + err.message, true);
      subscribeBtn.disabled = false;
      subscribeBtn.textContent = 'Subscribe';
    }
  }

  // Manage Feeds View
  renderManageFeedsView(filterCategoryId = null) {
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

    // Filter feeds by category if specified
    let feedsToShow = this.feeds;
    if (filterCategoryId) {
      feedsToShow = this.feeds.filter(feed => {
        const categoryIds = (feed.feed_category_feeds || []).map(fcf => fcf.category_id);
        return categoryIds.includes(filterCategoryId);
      });
    }

    const feedsTableHtml = feedsToShow.length > 0 ? `
      <div class="feeds-table">
        <div class="feeds-table-header">
          <div>Feed</div>
          <div>Categories</div>
          <div>Items</div>
          <div>Actions</div>
        </div>
        ${feedsToShow.map(feed => {
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
          <div style="display: flex; gap: 12px; align-items: center;">
            <select id="manage-feeds-category-filter" style="padding: 8px 12px; border: 1px solid var(--border-light); border-radius: var(--radius); background: var(--bg); font-size: 14px; color: var(--text-secondary);">
              <option value="">All Categories (${this.feeds.length})</option>
              ${this.feedCategories.map(cat => {
                const count = this.feeds.filter(f => (f.feed_category_feeds || []).some(fcf => fcf.category_id === cat.id)).length;
                return `<option value="${cat.id}" ${filterCategoryId === cat.id ? 'selected' : ''}>
                  ${this.escapeHtml(cat.name)} (${count})
                </option>`;
              }).join('')}
            </select>
            <button class="btn secondary" id="manage-share-view-btn" title="Pretty view for screenshots">Share View</button>
            <button class="btn secondary" id="manage-export-feeds-btn" title="Export feeds as Excel">Export Excel</button>
            <button class="btn primary" id="manage-add-feed-btn">Add Feed</button>
          </div>
        </div>
        ${feedsTableHtml}
        ${feedsToShow.length === 0 && filterCategoryId ? '<div class="feeds-empty-state"><p>No feeds in this category</p></div>' : ''}
        ${categoriesHtml}
      </div>
    `;

    // Bind events
    document.getElementById('manage-add-feed-btn')?.addEventListener('click', () => {
      this.showAddFeedModal();
    });

    document.getElementById('manage-export-feeds-btn')?.addEventListener('click', () => {
      const categoryFilter = document.getElementById('manage-feeds-category-filter');
      const selectedCategoryId = categoryFilter?.value || null;
      this.exportFeedsAsCSV(selectedCategoryId);
    });

    document.getElementById('manage-share-view-btn')?.addEventListener('click', () => {
      const categoryFilter = document.getElementById('manage-feeds-category-filter');
      const selectedCategoryId = categoryFilter?.value || null;
      this.showShareView(selectedCategoryId);
    });

    document.getElementById('manage-feeds-category-filter')?.addEventListener('change', (e) => {
      const categoryId = e.target.value;
      this.renderManageFeedsView(categoryId || null);
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

  exportFeedsAsCSV(filterCategoryId = null) {
    let feedsToExport = this.feeds;
    let categoryName = 'All Feeds';

    if (filterCategoryId) {
      feedsToExport = this.feeds.filter(feed => {
        const categoryIds = (feed.feed_category_feeds || []).map(fcf => fcf.category_id);
        return categoryIds.includes(filterCategoryId);
      });
      const cat = this.feedCategories.find(c => c.id === filterCategoryId);
      categoryName = cat ? cat.name : 'Filtered';
    }

    if (feedsToExport.length === 0) {
      this.showToast('No feeds to export', true);
      return;
    }

    const headers = ['Name', 'Feed URL', 'Site URL', 'Categories'];
    const data = feedsToExport.map(feed => {
      const catIds = (feed.feed_category_feeds || []).map(fcf => fcf.category_id);
      const cats = this.feedCategories.filter(c => catIds.includes(c.id)).map(c => c.name);
      return [
        feed.title || 'Unknown Feed',
        feed.feed_url,
        feed.site_url || '',
        cats.join(', '),
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

    // Bold header row
    for (let c = 0; c < headers.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { font: { bold: true } };
    }

    // Set column widths based on content
    ws['!cols'] = [
      { wch: Math.max(20, ...data.map(r => (r[0] || '').length)) },
      { wch: Math.max(30, ...data.map(r => (r[1] || '').length)) },
      { wch: Math.max(20, ...data.map(r => (r[2] || '').length)) },
      { wch: Math.max(15, ...data.map(r => (r[3] || '').length)) },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, categoryName.slice(0, 31));
    XLSX.writeFile(wb, `stash-feeds-${categoryName.toLowerCase().replace(/\s+/g, '-')}.xlsx`);

    this.showToast(`Exported ${feedsToExport.length} feeds`);
  }

  showShareView(filterCategoryId = null) {
    let feedsToShow = this.feeds;
    let title = 'My Feeds';

    if (filterCategoryId) {
      feedsToShow = this.feeds.filter(feed => {
        const categoryIds = (feed.feed_category_feeds || []).map(fcf => fcf.category_id);
        return categoryIds.includes(filterCategoryId);
      });
      const cat = this.feedCategories.find(c => c.id === filterCategoryId);
      title = cat ? cat.name : 'My Feeds';
    }

    if (feedsToShow.length === 0) {
      this.showToast('No feeds to show', true);
      return;
    }

    // Group feeds by category (or "Uncategorized")
    const grouped = {};
    for (const feed of feedsToShow) {
      const catIds = (feed.feed_category_feeds || []).map(fcf => fcf.category_id);
      const cats = this.feedCategories.filter(c => catIds.includes(c.id));
      if (cats.length === 0) {
        grouped['Uncategorized'] = grouped['Uncategorized'] || { color: '#9ca3af', feeds: [] };
        grouped['Uncategorized'].feeds.push(feed);
      } else {
        for (const cat of cats) {
          grouped[cat.name] = grouped[cat.name] || { color: cat.color, feeds: [] };
          grouped[cat.name].feeds.push(feed);
        }
      }
    }

    // If filtering by a single category, don't group — just list them
    const isSingleCategory = filterCategoryId && Object.keys(grouped).length === 1;

    let feedsHtml;
    if (isSingleCategory) {
      const feeds = Object.values(grouped)[0].feeds;
      feedsHtml = `<div class="share-view-list">
        ${feeds.map(f => `<div class="share-view-feed">
          <span class="share-view-feed-name">${this.escapeHtml(f.title || 'Unknown')}</span>
          ${f.site_url ? `<span class="share-view-feed-url">${this.escapeHtml(new URL(f.site_url).hostname.replace('www.', ''))}</span>` : ''}
        </div>`).join('')}
      </div>`;
    } else {
      feedsHtml = Object.entries(grouped).sort(([a], [b]) => a === 'Uncategorized' ? 1 : b === 'Uncategorized' ? -1 : a.localeCompare(b)).map(([catName, { color, feeds }]) => `
        <div class="share-view-category">
          <div class="share-view-category-header">
            <span class="share-view-category-dot" style="background: ${color}"></span>
            ${this.escapeHtml(catName)}
          </div>
          <div class="share-view-list">
            ${feeds.map(f => `<div class="share-view-feed">
              <span class="share-view-feed-name">${this.escapeHtml(f.title || 'Unknown')}</span>
              ${f.site_url ? `<span class="share-view-feed-url">${this.escapeHtml(new URL(f.site_url).hostname.replace('www.', ''))}</span>` : ''}
            </div>`).join('')}
          </div>
        </div>
      `).join('');
    }

    const overlay = document.createElement('div');
    overlay.className = 'share-view-overlay';
    overlay.innerHTML = `
      <div class="share-view-modal">
        <div class="share-view-toolbar">
          <button class="btn secondary share-view-close">Close</button>
        </div>
        <div class="share-view-content">
          <h1 class="share-view-title">${this.escapeHtml(title)}</h1>
          <div class="share-view-subtitle">${feedsToShow.length} blog${feedsToShow.length === 1 ? '' : 's'} I follow</div>
          ${feedsHtml}
          <div class="share-view-footer">curated with Stash</div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.share-view-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
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
