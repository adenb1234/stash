// Content script - runs on every page
// Handles article extraction and highlight detection

// Prevent duplicate initialization if script is injected multiple times
if (window.__stashContentScriptLoaded) {
  console.log('Stash content script already loaded, skipping initialization');
} else {
  window.__stashContentScriptLoaded = true;
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Stash content script received message:', request.action);
  if (request.action === 'extractArticle') {
    // Handle async extraction
    extractArticle().then(article => {
      sendResponse(article);
    }).catch(err => {
      console.error('Extract error:', err);
      sendResponse(null);
    });
    return true; // Keep channel open for async response
  } else if (request.action === 'getSelection') {
    const selection = window.getSelection().toString().trim();
    sendResponse({ selection });
    return false;
  } else if (request.action === 'showToast') {
    showToast(request.message, request.isError);
    sendResponse({ success: true });
    return false;
  } else if (request.action === 'showTagSelector') {
    showTagSelector(request.saveId, request.tags, request.highlightText);
    sendResponse({ success: true });
    return false;
  }
  return false;
});

async function extractArticle() {
  try {
    // Clone the document for Readability (it modifies the DOM)
    const documentClone = document.cloneNode(true);
    const reader = new Readability(documentClone, {
      charThreshold: 100,
      classesToPreserve: ['article', 'content', 'post'],
    });
    const article = reader.parse();

    if (article && article.textContent && article.textContent.length > 200) {
      return {
        success: true,
        title: article.title || document.title,
        content: htmlToText(article.content),
        excerpt: article.excerpt || article.textContent?.substring(0, 300) + '...',
        siteName: article.siteName || extractSiteName(),
        author: article.byline,
        publishedTime: extractPublishedTime(),
        imageUrl: extractMainImage(),
      };
    }
  } catch (e) {
    console.error('Readability failed:', e);
  }

  // Fallback: try to find article content more intelligently
  const content = extractFallbackContent();

  return {
    success: true,
    title: document.title,
    content: cleanContent(content),
    excerpt: document.querySelector('meta[name="description"]')?.content ||
             content.substring(0, 300) + '...',
    siteName: extractSiteName(),
    author: extractAuthor(),
    publishedTime: extractPublishedTime(),
    imageUrl: extractMainImage(),
  };
}

function extractFallbackContent() {
  // Try specific article selectors first
  const selectors = [
    'article',
    '[role="article"]',
    '.article-body',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.story-body',
    'main article',
    'main .content',
    '.c-entry-content', // Vox/Verge
    '.article__body',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = extractTextFromElement(el);
      if (text.length > 500) {
        return text;
      }
    }
  }

  // Fallback: get all paragraphs from main content area
  const mainContent = document.querySelector('main') || document.querySelector('article') || document.body;
  const paragraphs = [];

  mainContent.querySelectorAll('p').forEach(p => {
    const text = p.innerText?.trim();
    // Filter out short paragraphs (likely nav/footer) and common junk
    if (text && text.length > 50 && !isBoilerplate(text)) {
      paragraphs.push(text);
    }
  });

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n');
  }

  // Last resort: body text, but limited
  return document.body.innerText.substring(0, 50000);
}

function extractTextFromElement(el) {
  const paragraphs = [];
  el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote').forEach(child => {
    const text = child.innerText?.trim();
    if (text && text.length > 20 && !isBoilerplate(text)) {
      paragraphs.push(text);
    }
  });
  return paragraphs.join('\n\n');
}

function isBoilerplate(text) {
  const lower = text.toLowerCase();
  const boilerplatePatterns = [
    'subscribe',
    'sign up for',
    'newsletter',
    'follow us',
    'share this',
    'related articles',
    'recommended',
    'advertisement',
    'sponsored',
    'cookie',
    'privacy policy',
    'terms of service',
    'all rights reserved',
    'featured video',
    'watch now',
    'read more',
    'see also',
  ];
  return boilerplatePatterns.some(pattern => lower.includes(pattern));
}

function cleanContent(text) {
  if (!text) return '';

  return text
    // Remove excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    // Remove common UI text patterns
    .replace(/^(Share|Tweet|Email|Print|Save)[\s\n]+/gim, '')
    .replace(/\n(Share|Tweet|Email|Print|Save)\n/gi, '\n')
    // Clean up
    .trim();
}

// Convert HTML to plain text while preserving structure
function htmlToText(html) {
  if (!html) return '';

  // Create a temporary element to parse HTML
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Process the DOM to preserve formatting
  function processNode(node) {
    let result = '';

    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();

        // Block elements that need line breaks
        if (['p', 'div', 'article', 'section', 'header', 'footer', 'main'].includes(tag)) {
          result += '\n\n' + processNode(child) + '\n\n';
        }
        // Headings
        else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
          result += '\n\n' + processNode(child) + '\n\n';
        }
        // Line breaks
        else if (tag === 'br') {
          result += '\n';
        }
        // List items
        else if (tag === 'li') {
          result += '\n• ' + processNode(child);
        }
        // Lists
        else if (['ul', 'ol'].includes(tag)) {
          result += '\n' + processNode(child) + '\n';
        }
        // Blockquotes
        else if (tag === 'blockquote') {
          const text = processNode(child).trim().split('\n').map(line => '> ' + line).join('\n');
          result += '\n\n' + text + '\n\n';
        }
        // Links - convert to markdown
        else if (tag === 'a') {
          const href = child.getAttribute('href');
          const text = processNode(child).trim();
          if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
            // Make relative URLs absolute
            const absoluteUrl = href.startsWith('http') ? href : new URL(href, window.location.origin).href;
            result += `[${text}](${absoluteUrl})`;
          } else {
            result += text;
          }
        }
        // Bold
        else if (['strong', 'b'].includes(tag)) {
          result += '**' + processNode(child) + '**';
        }
        // Italic
        else if (['em', 'i'].includes(tag)) {
          result += '*' + processNode(child) + '*';
        }
        // Code
        else if (tag === 'code') {
          result += '`' + processNode(child) + '`';
        }
        // Pre/code blocks
        else if (tag === 'pre') {
          result += '\n\n```\n' + processNode(child) + '\n```\n\n';
        }
        // Skip script, style, etc.
        else if (['script', 'style', 'noscript', 'iframe'].includes(tag)) {
          // Skip
        }
        // Other inline elements
        else {
          result += processNode(child);
        }
      }
    }

    return result;
  }

  let text = processNode(temp);

  // Clean up excessive whitespace while preserving intentional line breaks
  text = text
    .replace(/[ \t]+/g, ' ')           // Collapse horizontal whitespace
    .replace(/\n[ \t]+/g, '\n')        // Remove leading spaces on lines
    .replace(/[ \t]+\n/g, '\n')        // Remove trailing spaces on lines
    .replace(/\n{3,}/g, '\n\n')        // Max 2 consecutive newlines
    .trim();

  return text;
}

function extractAuthor() {
  return document.querySelector('meta[name="author"]')?.content ||
         document.querySelector('meta[property="article:author"]')?.content ||
         document.querySelector('[rel="author"]')?.innerText?.trim() ||
         document.querySelector('.author, .byline, .author-name')?.innerText?.trim() ||
         null;
}

function extractSiteName() {
  return document.querySelector('meta[property="og:site_name"]')?.content ||
         document.querySelector('meta[name="application-name"]')?.content ||
         window.location.hostname.replace('www.', '');
}

function extractPublishedTime() {
  const timeEl = document.querySelector('time[datetime]');
  if (timeEl) return timeEl.getAttribute('datetime');

  const metaTime = document.querySelector('meta[property="article:published_time"]')?.content;
  if (metaTime) return metaTime;

  return null;
}

function extractMainImage() {
  return document.querySelector('meta[property="og:image"]')?.content ||
         document.querySelector('meta[name="twitter:image"]')?.content ||
         null;
}

// Show save confirmation toast
function showToast(message, isError = false) {
  const existing = document.getElementById('stash-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'stash-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 24px;
    background: ${isError ? '#ef4444' : '#10b981'};
    color: white;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    animation: stashSlideIn 0.3s ease;
  `;

  const style = document.createElement('style');
  style.textContent = `
    @keyframes stashSlideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'stashSlideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// Tag Selector Modal
function showTagSelector(saveId, tags, highlightText) {
  console.log('showTagSelector called with:', { saveId, tagsCount: tags?.length, highlightText: highlightText?.substring(0, 50) });

  // Remove any existing selector
  const existing = document.getElementById('stash-tag-selector');
  if (existing) existing.remove();

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'stash-tag-selector';
  modal.innerHTML = `
    <div class="stash-modal-overlay"></div>
    <div class="stash-modal-content">
      <div class="stash-modal-header">
        <h3>Tag this highlight</h3>
        <button class="stash-close-btn">&times;</button>
      </div>
      <div class="stash-highlight-preview">"${highlightText.substring(0, 100)}${highlightText.length > 100 ? '...' : ''}"</div>
      <div class="stash-note-container">
        <textarea class="stash-note-input" placeholder="Add a note... (optional)"></textarea>
      </div>
      <div class="stash-search-container">
        <input type="text" class="stash-tag-search" placeholder="Search or create tag...">
      </div>
      <div class="stash-tags-list">
        ${tags.map(tag => `
          <div class="stash-tag-item" data-id="${tag.id}" data-name="${tag.name}">
            <span class="stash-tag-name">${tag.name}</span>
          </div>
        `).join('')}
      </div>
      <div class="stash-create-tag" style="display: none;">
        <button class="stash-create-btn">Create "<span class="stash-new-tag-name"></span>"</button>
      </div>
      <div class="stash-modal-footer">
        <button class="stash-skip-btn">Skip</button>
        <button class="stash-done-btn" disabled>Done</button>
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.id = 'stash-tag-selector-styles';
  style.textContent = `
    #stash-tag-selector {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #stash-tag-selector * {
      box-sizing: border-box;
    }
    .stash-modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
    }
    .stash-modal-content {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 12px;
      width: 360px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      animation: stashModalIn 0.2s ease;
    }
    @keyframes stashModalIn {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    .stash-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #eee;
    }
    .stash-modal-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #111;
    }
    .stash-close-btn {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #666;
      padding: 0;
      line-height: 1;
    }
    .stash-close-btn:hover {
      color: #111;
    }
    .stash-highlight-preview {
      padding: 12px 20px;
      background: #f9fafb;
      font-size: 13px;
      color: #666;
      font-style: italic;
      border-bottom: 1px solid #eee;
    }
    .stash-note-container {
      padding: 12px 20px;
      border-bottom: 1px solid #eee;
    }
    .stash-note-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      resize: vertical;
      min-height: 60px;
      max-height: 120px;
      outline: none;
    }
    .stash-note-input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    .stash-note-input::placeholder {
      color: #999;
    }
    .stash-search-container {
      padding: 12px 20px;
    }
    .stash-tag-search {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .stash-tag-search:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    .stash-tags-list {
      flex: 1;
      overflow-y: auto;
      padding: 0 12px;
      max-height: 200px;
    }
    .stash-tag-item {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      margin: 4px 0;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .stash-tag-item:hover {
      background: #f3f4f6;
    }
    .stash-tag-item.selected {
      background: #6366f1;
      color: white;
    }
    .stash-tag-name {
      font-size: 14px;
    }
    .stash-create-tag {
      padding: 8px 20px;
    }
    .stash-create-btn {
      width: 100%;
      padding: 10px;
      background: #f3f4f6;
      border: 1px dashed #ccc;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      color: #666;
    }
    .stash-create-btn:hover {
      background: #e5e7eb;
    }
    .stash-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 16px 20px;
      border-top: 1px solid #eee;
    }
    .stash-skip-btn, .stash-done-btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
    }
    .stash-skip-btn {
      background: none;
      border: 1px solid #ddd;
      color: #666;
    }
    .stash-skip-btn:hover {
      background: #f3f4f6;
    }
    .stash-done-btn {
      background: #6366f1;
      border: none;
      color: white;
    }
    .stash-done-btn:hover:not(:disabled) {
      background: #5558e3;
    }
    .stash-done-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .stash-tag-item.hidden {
      display: none;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(modal);
  console.log('Tag selector modal appended to DOM');

  // State
  let selectedTags = [];
  let allTags = [...tags];

  // Elements
  const noteInput = modal.querySelector('.stash-note-input');
  const searchInput = modal.querySelector('.stash-tag-search');
  const tagsList = modal.querySelector('.stash-tags-list');
  const createTagDiv = modal.querySelector('.stash-create-tag');
  const createBtn = modal.querySelector('.stash-create-btn');
  const newTagNameSpan = modal.querySelector('.stash-new-tag-name');
  const doneBtn = modal.querySelector('.stash-done-btn');
  const skipBtn = modal.querySelector('.stash-skip-btn');
  const closeBtn = modal.querySelector('.stash-close-btn');
  const overlay = modal.querySelector('.stash-modal-overlay');

  // Helper to save note if present
  async function saveNote() {
    const note = noteInput.value.trim();
    if (note && saveId) {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'updateSave',
          saveId: saveId,
          updates: { note: note }
        }, resolve);
      });
    }
  }

  // Close modal
  function closeModal() {
    modal.style.animation = 'stashModalIn 0.15s ease reverse';
    setTimeout(() => {
      modal.remove();
      style.remove();
    }, 150);
  }

  // Update done button state - enabled if there are tags or a note
  function updateDoneButton() {
    const hasNote = noteInput.value.trim().length > 0;
    const hasTags = selectedTags.length > 0;
    doneBtn.disabled = !hasNote && !hasTags;
  }

  // Update done button when note changes
  noteInput.addEventListener('input', updateDoneButton);

  // Handle tag click
  tagsList.addEventListener('click', (e) => {
    const tagItem = e.target.closest('.stash-tag-item');
    if (!tagItem) return;

    const tagId = tagItem.dataset.id;
    const tagName = tagItem.dataset.name;

    if (tagItem.classList.contains('selected')) {
      tagItem.classList.remove('selected');
      selectedTags = selectedTags.filter(t => t.id !== tagId);
    } else {
      tagItem.classList.add('selected');
      selectedTags.push({ id: tagId, name: tagName });
    }
    updateDoneButton();
  });

  // Search/filter tags
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();

    // Filter existing tags
    let hasMatch = false;
    tagsList.querySelectorAll('.stash-tag-item').forEach(item => {
      const name = item.dataset.name.toLowerCase();
      if (name.includes(query) || !query) {
        item.classList.remove('hidden');
        if (name === query) hasMatch = true;
      } else {
        item.classList.add('hidden');
      }
    });

    // Show create button if no exact match and query exists
    if (query && !hasMatch) {
      createTagDiv.style.display = 'block';
      newTagNameSpan.textContent = e.target.value;
    } else {
      createTagDiv.style.display = 'none';
    }
  });

  // Create new tag
  createBtn.addEventListener('click', async () => {
    const tagName = searchInput.value.trim();
    if (!tagName) return;

    createBtn.textContent = 'Creating...';
    createBtn.disabled = true;

    chrome.runtime.sendMessage({ action: 'createTag', tagName }, (response) => {
      if (response.success && response.tag) {
        // Add to list
        const newTag = response.tag;
        allTags.push(newTag);

        const tagItem = document.createElement('div');
        tagItem.className = 'stash-tag-item selected';
        tagItem.dataset.id = newTag.id;
        tagItem.dataset.name = newTag.name;
        tagItem.innerHTML = `<span class="stash-tag-name">${newTag.name}</span>`;
        tagsList.insertBefore(tagItem, tagsList.firstChild);

        selectedTags.push({ id: newTag.id, name: newTag.name });
        updateDoneButton();

        // Reset
        searchInput.value = '';
        createTagDiv.style.display = 'none';
        createBtn.innerHTML = 'Create "<span class="stash-new-tag-name"></span>"';
        createBtn.disabled = false;
      } else {
        alert('Failed to create tag: ' + (response.error || 'Unknown error'));
        createBtn.textContent = 'Create "' + tagName + '"';
        createBtn.disabled = false;
      }
    });
  });

  // Done - save selected tags and note
  doneBtn.addEventListener('click', async () => {
    doneBtn.textContent = 'Saving...';
    doneBtn.disabled = true;

    // Save note if present
    await saveNote();

    // Add each selected tag to the save
    for (const tag of selectedTags) {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'addTagToSave',
          saveId: saveId,
          tagId: tag.id,
        }, resolve);
      });
    }

    const note = noteInput.value.trim();
    const hasNote = note.length > 0;
    const hasTags = selectedTags.length > 0;

    let message = 'Highlight saved';
    if (hasTags && hasNote) {
      message += ` with ${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''} and note`;
    } else if (hasTags) {
      message += ` with ${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''}`;
    } else if (hasNote) {
      message += ' with note';
    }
    message += '!';

    showToast(message);
    closeModal();
  });

  // Skip - close but still save note if present
  skipBtn.addEventListener('click', async () => {
    await saveNote();
    const note = noteInput.value.trim();
    showToast(note ? 'Highlight saved with note!' : 'Highlight saved!');
    closeModal();
  });

  // Close button - save note if present
  closeBtn.addEventListener('click', async () => {
    await saveNote();
    const note = noteInput.value.trim();
    showToast(note ? 'Highlight saved with note!' : 'Highlight saved!');
    closeModal();
  });

  // Click overlay to close - save note if present
  overlay.addEventListener('click', async () => {
    await saveNote();
    const note = noteInput.value.trim();
    showToast(note ? 'Highlight saved with note!' : 'Highlight saved!');
    closeModal();
  });

  // Focus note input
  setTimeout(() => noteInput.focus(), 100);
}
