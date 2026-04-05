-- Index to speed up feed item cleanup queries
CREATE INDEX IF NOT EXISTS idx_feed_items_cleanup
  ON feed_items (published_at, is_saved)
  WHERE is_saved = false;
