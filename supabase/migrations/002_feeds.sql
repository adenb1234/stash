-- RSS Feeds Schema Migration
-- Run this in your Supabase SQL Editor

-- Feed categories (for organizing feeds)
CREATE TABLE feed_categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- Feed subscriptions
CREATE TABLE feeds (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feed_url TEXT NOT NULL,
  site_url TEXT,
  title TEXT,
  description TEXT,
  favicon TEXT,
  last_fetched_at TIMESTAMP WITH TIME ZONE,
  fetch_error TEXT,
  item_count INTEGER DEFAULT 0,
  is_paused BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, feed_url)
);

-- Many-to-many: feeds <-> categories
CREATE TABLE feed_category_feeds (
  feed_id UUID REFERENCES feeds(id) ON DELETE CASCADE,
  category_id UUID REFERENCES feed_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (feed_id, category_id)
);

-- Feed items (separate from saves table)
CREATE TABLE feed_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  feed_id UUID REFERENCES feeds(id) ON DELETE CASCADE NOT NULL,
  guid TEXT NOT NULL,
  url TEXT,
  title TEXT,
  excerpt TEXT,
  content TEXT,
  author TEXT,
  image_url TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  is_seen BOOLEAN DEFAULT FALSE,
  is_saved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(feed_id, guid)
);

-- Indexes for performance
CREATE INDEX feed_categories_user_id_idx ON feed_categories(user_id);
CREATE INDEX feeds_user_id_idx ON feeds(user_id);
CREATE INDEX feed_items_user_id_idx ON feed_items(user_id);
CREATE INDEX feed_items_feed_id_idx ON feed_items(feed_id);
CREATE INDEX feed_items_is_seen_idx ON feed_items(user_id, is_seen);
CREATE INDEX feed_items_published_at_idx ON feed_items(published_at DESC);

-- Trigger for updated_at on feeds
CREATE TRIGGER feeds_updated_at
  BEFORE UPDATE ON feeds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security (RLS)
ALTER TABLE feed_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_category_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for feed_categories
CREATE POLICY "Users can view own feed_categories" ON feed_categories
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feed_categories" ON feed_categories
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feed_categories" ON feed_categories
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own feed_categories" ON feed_categories
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for feeds
CREATE POLICY "Users can view own feeds" ON feeds
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feeds" ON feeds
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feeds" ON feeds
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own feeds" ON feeds
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for feed_category_feeds (check via feeds table)
CREATE POLICY "Users can view own feed_category_feeds" ON feed_category_feeds
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM feeds WHERE feeds.id = feed_id AND feeds.user_id = auth.uid())
  );

CREATE POLICY "Users can insert own feed_category_feeds" ON feed_category_feeds
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM feeds WHERE feeds.id = feed_id AND feeds.user_id = auth.uid())
  );

CREATE POLICY "Users can delete own feed_category_feeds" ON feed_category_feeds
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM feeds WHERE feeds.id = feed_id AND feeds.user_id = auth.uid())
  );

-- RLS Policies for feed_items
CREATE POLICY "Users can view own feed_items" ON feed_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own feed_items" ON feed_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own feed_items" ON feed_items
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own feed_items" ON feed_items
  FOR DELETE USING (auth.uid() = user_id);
