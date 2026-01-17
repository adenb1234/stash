# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self-hosted read-it-later app (Reader.io replacement). Saves articles, highlights, and Kindle notes to a personal Supabase database.

**Live:** https://stash-hazel.vercel.app
**Full roadmap:** STASH_PROJECT_PLAN_1.md

## Tech Stack

- **Frontend:** Vanilla JS, HTML, CSS — no frameworks, keep it that way
- **Backend:** Supabase (PostgreSQL + REST API)
- **Hosting:** Vercel (auto-deploys from main branch)
- **Extension:** Chrome Manifest V3

## Architecture

### Chrome Extension (`extension/`)

**Entry points:**
- `background.js` — Service worker: context menus, Supabase operations, message hub
- `content.js` — Injected script: article extraction (Readability.js), UI overlays (toast, tag modal)
- `popup.js` — Extension popup UI

**Message passing pattern** (background ↔ content):
```js
// content.js → background.js
chrome.runtime.sendMessage({ action: 'createTag', tagName }, (response) => { ... });

// background.js → content.js
chrome.tabs.sendMessage(tab.id, { action: 'showToast', message: 'Saved!' });
```

Actions handled in `background.js`: `savePage`, `getUser`, `signIn`, `signOut`, `getRecentSaves`, `createTag`, `addTagToSave`, `updateSave`

Actions handled in `content.js`: `extractArticle`, `getSelection`, `showToast`, `showTagSelector`

### Web App (`web/`)

- `app.js` — Single-file SPA, `StashApp` class with all views
- `index.html` — Main HTML with sidebar nav, modals, reading pane
- `styles.css` — All styling; dark mode via `[data-theme="dark"]` attribute

### Database (`supabase/schema.sql`)

**Tables:** `saves`, `tags`, `save_tags` (junction), `folders`, `user_preferences`

**Key columns on `saves`:**
- `highlight` — Selected text (null for full page saves)
- `note` — User annotation on highlights
- `content` — Full article text
- `fts` — Auto-generated tsvector for full-text search

**Search:** `search_saves(query, user_id)` function with weighted ranking (title > excerpt/highlight > content)

**RLS:** Configured for single-user mode with hardcoded USER_ID in config files.

## Development

No build step. Edit files directly.

```bash
# Deploy web changes (auto-deploys on push)
git push

# Test extension changes
# 1. chrome://extensions → click refresh on Stash
# 2. Test on any webpage
```

## Key Patterns

**Supabase queries (extension):**
```js
await supabase.insert('saves', { user_id: CONFIG.USER_ID, url, title, ... });
await supabase.select('tags', { order: 'name.asc' });
await supabase.update('saves', saveId, { note: 'my note' });
```

**Supabase queries (web app):**
```js
const { data } = await this.supabase.from('saves').select('*, tags(*)').eq('user_id', this.user.id);
```

**Toast notifications (content.js):**
```js
showToast('Saved!');           // success (green)
showToast('Error', true);      // error (red)
```

**Adding UI overlays:** See `showTagSelector()` in content.js — creates modal with inline styles (no external CSS needed since injected into arbitrary pages).

## Current State

**Phase 1 COMPLETE** — Core features working:
- Chrome extension saves articles and highlights
- Tag selector modal with notes field appears after saving highlights
- Web app: saves list, reading pane, folder/tag filtering, search, favorites, archive
- Kindle import working
- PWA installable

**Phase 2 COMPLETE** — RSS feed subscriptions:
- Feed inbox with Unseen/Seen tabs
- Feed categories (many-to-many with feeds)
- Add Feed modal with URL discovery (supports RSS, Atom, Substack)
- Manage Feeds page (unsubscribe, refresh, category management)
- Manual refresh (Edge Function, no background jobs for MVP)
- Save feed items to library
- Unread count badge in sidebar

**Next:** Phase 3 — TBD (see STASH_PROJECT_PLAN_1.md)
