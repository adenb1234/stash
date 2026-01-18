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

**Key feed methods in app.js:**
- `loadFeeds()`, `loadFeedCategories()`, `loadFeedItems()` — Data loading
- `renderFeedInbox()` — Feed item list with selection state
- `renderFeedReaderView()` — Full-page article reader
- `renderManageFeedsView()` — Feed management with category dropdowns
- `subscribeFeed()`, `refreshFeeds()` — Edge Function calls
- `markFeedItemSeen()`, `openFeedItem()`, `selectFeedItem()` — Item interactions
- `toggleFeedCategory()` — Category assignment on Manage Feeds page

**Views:** `setView()` handles: `'all'`, `'highlights'`, `'articles'`, `'kindle'`, `'archived'`, `'feeds'`, `'feed-reader'`, `'manage-feeds'`, `'weekly-review'`, `'stats'`

### Database

**Core tables** (`supabase/schema.sql`): `saves`, `tags`, `save_tags` (junction), `folders`, `user_preferences`

**Feed tables** (`supabase/migrations/002_feeds.sql`):
- `feeds` — Feed subscriptions (feed_url, title, favicon, last_fetched_at)
- `feed_items` — Individual articles from feeds (guid, url, title, content, is_seen, is_saved)
- `feed_categories` — Categories for organizing feeds (name, color)
- `feed_category_feeds` — Junction table (many-to-many feeds ↔ categories)

**Key columns on `saves`:**
- `highlight` — Selected text (null for full page saves)
- `note` — User annotation on highlights
- `content` — Full article text
- `fts` — Auto-generated tsvector for full-text search

**Search:** `search_saves(query, user_id)` function with weighted ranking (title > excerpt/highlight > content)

**RLS:** Configured for single-user mode with hardcoded USER_ID in config files.

### Edge Functions (`supabase/functions/`)

- `save-page/index.ts` — Extracts article content from URL using Readability.js
- `fetch-feeds/index.ts` — RSS/Atom feed operations:
  - `discover` — Find feed URL from website (handles Substack → /feed conversion)
  - `subscribe` — Add new feed, fetch initial items
  - `fetch` — Refresh single feed
  - `fetch_all` — Refresh all feeds for user

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
- Feed inbox with Unseen/Seen tabs, compact row layout (title, source, date)
- Feed categories (many-to-many with feeds, managed on Manage Feeds page)
- Add Feed modal with URL discovery (supports RSS, Atom, Substack)
- Manage Feeds page with category dropdown for each feed
- Full-page reader view for feed items (not sidebar)
- Manual refresh via Edge Function
- Save feed items to library
- Unread count badge in sidebar

**Feed Keyboard Shortcuts:**
- `↓`/`↑` or `j`/`k` — Navigate feed items (visual selection with purple outline)
- `o` or `Enter` — Open selected item in reader view
- `e` — Mark selected item as seen (removes from Unseen)
- `Esc` — Return from reader to inbox
- `o` (in reader) — Open original article URL in new tab

**Next:** Phase 3 — TBD (see STASH_PROJECT_PLAN_1.md)
