# Stash Enhancement Project

## Overview

I'm building a self-hosted read-it-later app to replace Reader.io ($12/month). The base is an open-source project called **Stash** that handles article saving and highlighting. My goal is to fork it, verify it works, then extend it with RSS feed support.

**Source repo:** https://github.com/kbroose/stash

## Current Stash Features (from repo)

- Chrome extension to save pages and highlights
- Web app (PWA) to access saves from any device
- Kindle sync for importing highlights
- Full-text search (weighted: title > excerpt/highlight > content)
- Text-to-speech with neural voices
- iOS Shortcut for Safari
- Bookmarklet for any browser
- Runs on Supabase free tier (500MB storage)
- **Tagging already built in** ✅
- **Folders for organization** ✅
- **Favorites and archive** ✅

## Existing Database Schema

The schema already has a solid foundation:

### Core Tables
- **`saves`** - Main content table (articles + highlights in one table)
  - `url`, `title`, `excerpt`, `content`, `highlight` (if it's a highlight save)
  - `folder_id` (optional folder organization)
  - `is_archived`, `is_favorite`, `read_at` (status tracking)
  - `source` ('extension', 'import', 'manual')
  - `audio_url` (for TTS)
  - Full-text search via `fts` tsvector column

- **`tags`** - User tags with colors
  - `name`, `color`, `user_id`
  - Unique constraint on (user_id, name)

- **`save_tags`** - Junction table for many-to-many saves ↔ tags

- **`folders`** - Folder organization with colors

- **`user_preferences`** - Email digest settings

### Security
- Row Level Security (RLS) enabled on all tables
- Users can only access their own data via `auth.uid() = user_id` policies

## Project Phases

### Phase 1: Fork & Setup (Verify it works)

**Goal:** Get a working local/deployed instance of Stash

**Tasks:**
1. Fork `kbroose/stash` to my GitHub
2. Create a free Supabase project at supabase.com
3. Run the database schema from `supabase/schema.sql`
4. Configure credentials in `extension/config.js` and `web/config.js`
5. Load the Chrome extension locally (`chrome://extensions` → Load unpacked)
6. Deploy the web app to Vercel or Netlify (free tier)
7. Test the full flow:
   - Save an article from Chrome extension
   - Highlight text and save
   - Add tags to a save
   - Create folders and organize
   - Search across saves
   - Verify everything appears in web app

**Key files to examine:**
- `supabase/schema.sql` - database structure (attached below for reference)
- `extension/config.js` - extension configuration
- `web/config.js` - web app configuration  
- `SETUP.md` - detailed setup instructions

**Tech stack:**
- Frontend: Vanilla JS, HTML, CSS (no frameworks)
- Backend: Supabase (PostgreSQL + REST API)
- Hosting: Any static host

---

### Phase 2: Add RSS/Subscription Support

**Goal:** Turn Stash into a full Reader.io replacement by adding feed subscriptions

**Design Decision:** Feed items should integrate with the existing `saves` table rather than being completely separate. This lets users tag, folder, favorite, and search feed items the same way they do manual saves.

**Tasks:**

#### 2a. Add Feed Tables
```sql
-- Feeds table (subscriptions)
CREATE TABLE feeds (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  site_url TEXT,
  favicon TEXT,
  folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
  last_fetched TIMESTAMP WITH TIME ZONE,
  fetch_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(user_id, url)
);

-- Index for efficient fetching
CREATE INDEX feeds_user_id_idx ON feeds(user_id);
CREATE INDEX feeds_last_fetched_idx ON feeds(last_fetched);

-- RLS for feeds
ALTER TABLE feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own feeds" ON feeds
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own feeds" ON feeds
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own feeds" ON feeds
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own feeds" ON feeds
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER feeds_updated_at
  BEFORE UPDATE ON feeds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 2b. Extend Saves Table for Feed Items
```sql
-- Add feed-related columns to saves
ALTER TABLE saves ADD COLUMN feed_id UUID REFERENCES feeds(id) ON DELETE CASCADE;
ALTER TABLE saves ADD COLUMN guid TEXT; -- RSS item GUID for deduplication
ALTER TABLE saves ADD COLUMN is_read BOOLEAN DEFAULT FALSE;

-- Index for feed items
CREATE INDEX saves_feed_id_idx ON saves(feed_id);
CREATE INDEX saves_is_read_idx ON saves(is_read) WHERE feed_id IS NOT NULL;

-- Unique constraint to prevent duplicate feed items
CREATE UNIQUE INDEX saves_feed_guid_idx ON saves(feed_id, guid) WHERE guid IS NOT NULL;
```

#### 2c. Build Feed Fetching System
Options:
1. **Supabase Edge Function + pg_cron** - Serverless, stays within Supabase ecosystem
2. **External service** (e.g., small Node.js app on Railway/Render free tier)
3. **Client-side fetching** - Fetch when user opens app (simpler but less reliable)

Recommended: Start with Option 3 (client-side) for MVP, then migrate to Edge Function.

**Feed fetching logic:**
- Parse RSS/Atom feeds (use `rss-parser` library or similar)
- For each item, check if `guid` already exists for that feed
- Insert new items as saves with `source = 'feed'`, `feed_id` set, `is_read = false`
- Update feed's `last_fetched` timestamp
- Handle errors gracefully (store in `fetch_error`, implement backoff)

#### 2d. Update Web App
- Feed management UI:
  - Add feed by URL (with feed discovery/validation)
  - List subscribed feeds
  - Edit/delete feeds
  - Organize feeds into folders
- Feed reader view:
  - Show unread items (filter: `feed_id IS NOT NULL AND is_read = false`)
  - Mark as read (individual and mark all)
  - "Save to library" = set `is_read = true`, optionally remove `feed_id` to treat as regular save
- Integrate with existing features:
  - Feed items should be taggable
  - Feed items should appear in search
  - Feed items can be favorited

#### 2e. OPML Import/Export
- Import: Parse OPML file, create feeds for each `<outline>` with `xmlUrl`
- Export: Generate OPML from user's feeds for backup/migration

---

## Reader.io Features Comparison

| Feature | Reader.io | Stash (Current) | After Phase 2 |
|---------|-----------|-----------------|---------------|
| Save articles | ✅ | ✅ | ✅ |
| Highlight text | ✅ | ✅ | ✅ |
| Kindle import | ✅ | ✅ | ✅ |
| Tag content | ✅ | ✅ | ✅ |
| Folders | ✅ | ✅ | ✅ |
| Full-text search | ✅ | ✅ | ✅ |
| RSS feeds | ✅ | ❌ | ✅ |
| All-in-one view | ✅ | ❌ | ✅ |
| Cost | $12/month | Free | Free |

---

## Development Notes

**Supabase Free Tier Limits:**
- 500MB database storage
- 1GB file storage  
- 2GB bandwidth
- 50,000 monthly active users
- Unlimited API requests

**Recommended dev workflow:**
1. Use Supabase CLI for local development: `supabase start`
2. Test migrations locally before pushing to production
3. Use `supabase db diff` to generate migrations from schema changes

**Important commands:**
```bash
# Install Supabase CLI
npm install -g supabase

# Start local Supabase
supabase start

# Link to remote project
supabase link --project-ref <project-id>

# Push migrations to production
supabase db push

# Generate migration from diff
supabase db diff -f <migration_name>
```

---

## Existing Schema Reference

```sql
-- Core tables already exist:
-- saves (articles + highlights, with fts search)
-- tags (with colors, user-scoped)
-- save_tags (junction table)
-- folders (with colors)
-- user_preferences (digest settings)

-- Key columns on saves:
-- url, title, excerpt, content, highlight
-- folder_id, is_archived, is_favorite, read_at
-- source ('extension', 'import', 'manual')
-- audio_url (TTS)
-- fts (full-text search tsvector)

-- All tables have RLS policies restricting access to owner
```

---

## Success Criteria

**Phase 1:** Can save an article from Chrome, highlight text, add tags, organize in folders, search, and see everything in the web app

**Phase 2:** Can subscribe to RSS feeds, see new items in a feed view, mark as read, save items to library, and have feed items integrate with existing tags/folders/search
