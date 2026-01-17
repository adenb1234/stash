# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self-hosted read-it-later app (Reader.io replacement) based on the open-source Stash project. Saves articles, highlights, and Kindle notes to a personal Supabase database.

**Live:** https://stash-hazel.vercel.app
**Supabase:** https://supabase.com/dashboard/project/evpruqiugexseqzdokir
**Full roadmap:** STASH_PROJECT_PLAN_1.md

## Tech Stack

- **Frontend:** Vanilla JS, HTML, CSS — no frameworks, keep it that way
- **Backend:** Supabase (PostgreSQL + REST API)
- **Hosting:** Vercel (auto-deploys from main branch)
- **Extension:** Chrome Manifest V3

## Architecture

### Chrome Extension (`extension/`)
- `background.js` — Service worker handling context menus, Supabase operations, message passing
- `content.js` — Injected into pages for article extraction (uses Readability.js) and UI overlays (toast, tag selector modal)
- `popup.js/html` — Extension popup UI
- `supabase.js` — Lightweight Supabase client wrapper
- `config.js` — Credentials (USER_ID, SUPABASE_URL, SUPABASE_ANON_KEY)

### Web App (`web/`)
- `app.js` — Single-file SPA (`StashApp` class) with all views: saves list, reading pane, Kindle import, stats, digest settings
- `index.html` — Main HTML with sidebar nav, modals, reading pane
- `styles.css` — All styling including dark mode via `[data-theme="dark"]`
- `config.js` — Same credentials as extension
- `sw.js` — Service worker for PWA offline support

### Database (`supabase/`)
- `schema.sql` — Full schema: `saves`, `tags`, `save_tags`, `folders`, `user_preferences`
- Full-text search via `fts` tsvector column on saves
- RLS policies configured for single-user mode with hardcoded USER_ID

### Data Flow
1. Extension saves via `supabase.insert()` → Supabase REST API
2. Web app reads via Supabase JS client with same credentials
3. `save_tags` junction table links saves ↔ tags (many-to-many)
4. `search_saves()` PostgreSQL function handles weighted FTS

## Development

```bash
# Deploy web changes (push triggers Vercel)
git add . && git commit -m "message" && git push

# Test extension changes
# 1. Go to chrome://extensions
# 2. Click refresh on Stash card
# 3. Test on any webpage
```

No build step. Edit files directly, push to deploy web app, reload extension manually.

## Configured Credentials

Already in config files:
- **Supabase URL:** https://evpruqiugexseqzdokir.supabase.co
- **User ID:** 341976e3-e922-4da5-a77d-21e22aaef5bb

RLS policies bypass `auth.uid()` using this hardcoded USER_ID.

## Current WIP

**Tag selector modal not appearing on highlight save:**
- `background.js:saveHighlight()` sends `showTagSelector` message after insert
- `content.js:showTagSelector()` should render modal
- Debug: check if message is received, if content script is injected

## Phase 2 (Future)

RSS feed support — extend `saves` table with `feed_id`, `guid`, `is_read` rather than separate table. Lets feed items use existing tags/folders/search infrastructure.
