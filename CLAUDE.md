# CLAUDE.md

This is a self-hosted read-it-later app to replace Reader.io, based on the open-source Stash project.

## Project Context
- **Source repo:** https://github.com/kbroose/stash (forked to adenb1234/stash)
- **Full plan:** See STASH_PROJECT_PLAN_1.md
- **Current phase:** Phase 1 COMPLETE, working on enhancements

## Live URLs
- **Web App:** https://stash-hazel.vercel.app
- **Supabase Project:** https://supabase.com/dashboard/project/evpruqiugexseqzdokir

## Credentials (already configured in config files)
- **Supabase URL:** https://evpruqiugexseqzdokir.supabase.co
- **Supabase Anon Key:** sb_publishable_UiGBcqFdNymYKunGqCsoug_yWROVr5m
- **User ID:** 341976e3-e922-4da5-a77d-21e22aaef5bb

## Tech Stack
- **Frontend:** Vanilla JS, HTML, CSS (no frameworks - keep it that way)
- **Backend:** Supabase (PostgreSQL + REST API + Auth)
- **Hosting:** Vercel (auto-deploys from GitHub main branch)
- **Extension:** Chrome Manifest V3

## What's Working
- Chrome extension saves articles and highlights
- Web app displays saves at https://stash-hazel.vercel.app
- Folder filtering (click folder in sidebar to filter)
- Tag filtering (click tag in sidebar to filter)
- Search, favorites, archive
- PWA - can install on phone via "Add to Home Screen"

## Current Work in Progress
- **Tag selector when saving highlights:** When user right-clicks and saves a highlight, a modal should pop up letting them select/create tags. The code is implemented in:
  - `extension/background.js` - sends tags to content script after save
  - `extension/content.js` - `showTagSelector()` function renders the modal
- **Issue:** The tag selector modal isn't appearing. Need to debug.

## Key Files
- `extension/config.js` - Chrome extension config (configured)
- `extension/background.js` - Extension background script (handles saves)
- `extension/content.js` - Content script (article extraction, tag selector UI)
- `web/config.js` - Web app config (configured)
- `web/app.js` - Main web app code
- `supabase/schema.sql` - Database schema

## Database Notes
- RLS policies are set up for single-user mode using the hardcoded USER_ID
- Added custom policies to bypass auth.uid() checks:
  ```sql
  CREATE POLICY "Allow single user insert" ON saves
    FOR INSERT WITH CHECK (user_id = '341976e3-e922-4da5-a77d-21e22aaef5bb'::uuid);
  ```
- Same pattern used for saves, folders, tags, save_tags tables

## Git Workflow
- Push to main → Vercel auto-deploys web app
- Extension changes need manual reload at chrome://extensions

## Commands
```bash
# Push changes (triggers Vercel deploy for web/)
git add . && git commit -m "message" && git push

# Reload extension after changes
# Go to chrome://extensions → click refresh on Stash card
```

## Phase 2 Preview (RSS Feeds)
When we get there, feed items should extend the `saves` table (add `feed_id`, `guid`, `is_read`) rather than being a separate table. This lets feed items use existing tags/folders/search.
