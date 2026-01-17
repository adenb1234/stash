import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseHTML } from "https://esm.sh/linkedom@0.16.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Detect if URL is a Substack and convert to RSS
function convertToFeedUrl(url: string): string {
  const parsed = new URL(url);

  // Substack URLs
  if (parsed.hostname.endsWith('.substack.com') || parsed.pathname.includes('/p/')) {
    // Already a feed URL
    if (parsed.pathname === '/feed') return url;
    // Convert to feed URL
    return `${parsed.origin}/feed`;
  }

  // Common RSS paths to try
  return url;
}

// Try to discover feed URL from HTML page
function discoverFeedFromHtml(html: string, baseUrl: string): string | null {
  const { document } = parseHTML(html);

  // Look for RSS/Atom link tags
  const feedLinks = document.querySelectorAll(
    'link[type="application/rss+xml"], link[type="application/atom+xml"], link[rel="alternate"][type*="xml"]'
  );

  for (const link of feedLinks) {
    const href = link.getAttribute('href');
    if (href) {
      // Handle relative URLs
      if (href.startsWith('/')) {
        const base = new URL(baseUrl);
        return `${base.origin}${href}`;
      }
      return href;
    }
  }

  return null;
}

// Parse RSS/Atom XML into normalized items
function parseFeed(xml: string, feedUrl: string): {
  title: string;
  description: string;
  siteUrl: string;
  items: Array<{
    guid: string;
    url: string;
    title: string;
    excerpt: string;
    content: string;
    author: string;
    imageUrl: string | null;
    publishedAt: string | null;
  }>;
} {
  const { document } = parseHTML(xml);

  // Try RSS 2.0 format first
  const channel = document.querySelector('channel');
  if (channel) {
    return parseRss(channel, feedUrl);
  }

  // Try Atom format
  const feed = document.querySelector('feed');
  if (feed) {
    return parseAtom(feed, feedUrl);
  }

  throw new Error('Unknown feed format');
}

function parseRss(channel: any, feedUrl: string) {
  const title = channel.querySelector('title')?.textContent || 'Unknown Feed';
  const description = channel.querySelector('description')?.textContent || '';
  const siteUrl = channel.querySelector('link')?.textContent || feedUrl;

  const items: any[] = [];
  const itemNodes = channel.querySelectorAll('item');

  for (const item of itemNodes) {
    const guid = item.querySelector('guid')?.textContent ||
                 item.querySelector('link')?.textContent ||
                 `${Date.now()}-${Math.random()}`;

    const url = item.querySelector('link')?.textContent || '';
    const itemTitle = item.querySelector('title')?.textContent || 'Untitled';

    // Get content from different possible fields
    const contentEncoded = item.querySelector('content\\:encoded, encoded')?.textContent || '';
    const descriptionText = item.querySelector('description')?.textContent || '';
    const content = contentEncoded || descriptionText;

    // Extract excerpt (first 300 chars of plain text)
    const { document: contentDoc } = parseHTML(content);
    const plainText = contentDoc.body?.textContent || content;
    const excerpt = plainText.substring(0, 300).trim() + (plainText.length > 300 ? '...' : '');

    // Get author
    const author = item.querySelector('author')?.textContent ||
                   item.querySelector('dc\\:creator, creator')?.textContent || '';

    // Get image
    const mediaContent = item.querySelector('media\\:content, content')?.getAttribute('url');
    const enclosure = item.querySelector('enclosure[type^="image"]')?.getAttribute('url');
    const imageUrl = mediaContent || enclosure || extractFirstImage(content);

    // Get published date
    const pubDate = item.querySelector('pubDate')?.textContent;
    let publishedAt = null;
    if (pubDate) {
      try {
        publishedAt = new Date(pubDate).toISOString();
      } catch (e) {
        // Ignore date parsing errors
      }
    }

    items.push({
      guid,
      url,
      title: itemTitle,
      excerpt,
      content: stripHtml(content).substring(0, 50000),
      author,
      imageUrl,
      publishedAt,
    });
  }

  return { title, description, siteUrl, items };
}

function parseAtom(feed: any, feedUrl: string) {
  const title = feed.querySelector('title')?.textContent || 'Unknown Feed';
  const subtitle = feed.querySelector('subtitle')?.textContent || '';
  const linkNode = feed.querySelector('link[rel="alternate"], link:not([rel])');
  const siteUrl = linkNode?.getAttribute('href') || feedUrl;

  const items: any[] = [];
  const entries = feed.querySelectorAll('entry');

  for (const entry of entries) {
    const guid = entry.querySelector('id')?.textContent ||
                 entry.querySelector('link')?.getAttribute('href') ||
                 `${Date.now()}-${Math.random()}`;

    const linkEl = entry.querySelector('link[rel="alternate"], link:not([rel])');
    const url = linkEl?.getAttribute('href') || '';

    const itemTitle = entry.querySelector('title')?.textContent || 'Untitled';

    // Get content
    const contentEl = entry.querySelector('content');
    const summaryEl = entry.querySelector('summary');
    const content = contentEl?.textContent || summaryEl?.textContent || '';

    // Extract excerpt
    const { document: contentDoc } = parseHTML(content);
    const plainText = contentDoc.body?.textContent || content;
    const excerpt = plainText.substring(0, 300).trim() + (plainText.length > 300 ? '...' : '');

    // Get author
    const authorName = entry.querySelector('author name')?.textContent || '';

    // Get image
    const mediaContent = entry.querySelector('media\\:content, content[type^="image"]')?.getAttribute('url');
    const imageUrl = mediaContent || extractFirstImage(content);

    // Get published date
    const published = entry.querySelector('published')?.textContent ||
                      entry.querySelector('updated')?.textContent;
    let publishedAt = null;
    if (published) {
      try {
        publishedAt = new Date(published).toISOString();
      } catch (e) {
        // Ignore date parsing errors
      }
    }

    items.push({
      guid,
      url,
      title: itemTitle,
      excerpt,
      content: stripHtml(content).substring(0, 50000),
      author: authorName,
      imageUrl,
      publishedAt,
    });
  }

  return { title, description: subtitle, siteUrl, items };
}

// Extract first image from HTML content
function extractFirstImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

// Strip HTML tags
function stripHtml(html: string): string {
  const { document } = parseHTML(html);
  return document.body?.textContent || html;
}

// Fetch and validate a feed URL
async function fetchFeed(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status}`);
  }

  return await response.text();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, user_id, url, feed_id, category_ids } = await req.json();

    if (!action || !user_id) {
      return new Response(
        JSON.stringify({ error: "action and user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Action: discover - Find feed URL from website URL
    if (action === "discover") {
      if (!url) {
        return new Response(
          JSON.stringify({ error: "url required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let feedUrl = convertToFeedUrl(url);

      // Try the converted URL first
      try {
        const xml = await fetchFeed(feedUrl);
        if (xml.includes('<rss') || xml.includes('<feed') || xml.includes('<channel')) {
          const parsed = parseFeed(xml, feedUrl);
          return new Response(
            JSON.stringify({
              success: true,
              feed_url: feedUrl,
              title: parsed.title,
              description: parsed.description,
              site_url: parsed.siteUrl,
              item_count: parsed.items.length
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (e) {
        // URL wasn't a direct feed, try to discover from HTML
      }

      // Fetch the page and look for feed links
      try {
        const html = await fetchFeed(url);
        const discoveredUrl = discoverFeedFromHtml(html, url);

        if (discoveredUrl) {
          const xml = await fetchFeed(discoveredUrl);
          const parsed = parseFeed(xml, discoveredUrl);
          return new Response(
            JSON.stringify({
              success: true,
              feed_url: discoveredUrl,
              title: parsed.title,
              description: parsed.description,
              site_url: parsed.siteUrl,
              item_count: parsed.items.length
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (e) {
        // Could not discover feed
      }

      // Try common feed paths
      const basePaths = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];
      const baseUrl = new URL(url);

      for (const path of basePaths) {
        try {
          const tryUrl = `${baseUrl.origin}${path}`;
          const xml = await fetchFeed(tryUrl);
          if (xml.includes('<rss') || xml.includes('<feed') || xml.includes('<channel')) {
            const parsed = parseFeed(xml, tryUrl);
            return new Response(
              JSON.stringify({
                success: true,
                feed_url: tryUrl,
                title: parsed.title,
                description: parsed.description,
                site_url: parsed.siteUrl,
                item_count: parsed.items.length
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        } catch (e) {
          // Try next path
        }
      }

      return new Response(
        JSON.stringify({ error: "Could not find RSS/Atom feed for this URL" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: subscribe - Add new feed and fetch initial items
    if (action === "subscribe") {
      if (!url) {
        return new Response(
          JSON.stringify({ error: "url required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Fetch and parse the feed
      const xml = await fetchFeed(url);
      const parsed = parseFeed(xml, url);

      // Create feed record
      const { data: feed, error: feedError } = await supabase
        .from('feeds')
        .insert({
          user_id,
          feed_url: url,
          site_url: parsed.siteUrl,
          title: parsed.title,
          description: parsed.description,
          last_fetched_at: new Date().toISOString(),
          item_count: parsed.items.length,
        })
        .select()
        .single();

      if (feedError) {
        if (feedError.code === '23505') { // Unique violation
          return new Response(
            JSON.stringify({ error: "Already subscribed to this feed" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw feedError;
      }

      // Add category associations if provided
      if (category_ids && category_ids.length > 0) {
        const categoryLinks = category_ids.map((catId: string) => ({
          feed_id: feed.id,
          category_id: catId,
        }));
        await supabase.from('feed_category_feeds').insert(categoryLinks);
      }

      // Insert feed items
      if (parsed.items.length > 0) {
        const feedItems = parsed.items.map(item => ({
          user_id,
          feed_id: feed.id,
          guid: item.guid,
          url: item.url,
          title: item.title,
          excerpt: item.excerpt,
          content: item.content,
          author: item.author,
          image_url: item.imageUrl,
          published_at: item.publishedAt,
          is_seen: false,
          is_saved: false,
        }));

        await supabase.from('feed_items').insert(feedItems);
      }

      return new Response(
        JSON.stringify({
          success: true,
          feed,
          items_added: parsed.items.length
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Action: fetch - Refresh a single feed
    if (action === "fetch") {
      if (!feed_id) {
        return new Response(
          JSON.stringify({ error: "feed_id required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get feed details
      const { data: feed, error: feedError } = await supabase
        .from('feeds')
        .select('*')
        .eq('id', feed_id)
        .eq('user_id', user_id)
        .single();

      if (feedError || !feed) {
        return new Response(
          JSON.stringify({ error: "Feed not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      try {
        const xml = await fetchFeed(feed.feed_url);
        const parsed = parseFeed(xml, feed.feed_url);

        // Get existing GUIDs to avoid duplicates
        const { data: existingItems } = await supabase
          .from('feed_items')
          .select('guid')
          .eq('feed_id', feed_id);

        const existingGuids = new Set(existingItems?.map(i => i.guid) || []);
        const newItems = parsed.items.filter(item => !existingGuids.has(item.guid));

        // Insert new items
        if (newItems.length > 0) {
          const feedItems = newItems.map(item => ({
            user_id,
            feed_id,
            guid: item.guid,
            url: item.url,
            title: item.title,
            excerpt: item.excerpt,
            content: item.content,
            author: item.author,
            image_url: item.imageUrl,
            published_at: item.publishedAt,
            is_seen: false,
            is_saved: false,
          }));

          await supabase.from('feed_items').insert(feedItems);
        }

        // Update feed metadata
        await supabase
          .from('feeds')
          .update({
            last_fetched_at: new Date().toISOString(),
            fetch_error: null,
            item_count: (feed.item_count || 0) + newItems.length,
          })
          .eq('id', feed_id);

        return new Response(
          JSON.stringify({
            success: true,
            new_items: newItems.length
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

      } catch (err) {
        // Update feed with error
        await supabase
          .from('feeds')
          .update({
            last_fetched_at: new Date().toISOString(),
            fetch_error: err.message,
          })
          .eq('id', feed_id);

        throw err;
      }
    }

    // Action: fetch_all - Refresh all feeds for user
    if (action === "fetch_all") {
      const { data: feeds, error: feedsError } = await supabase
        .from('feeds')
        .select('*')
        .eq('user_id', user_id)
        .eq('is_paused', false);

      if (feedsError) throw feedsError;

      let totalNewItems = 0;
      const errors: Array<{ feed_id: string; error: string }> = [];

      for (const feed of feeds || []) {
        try {
          const xml = await fetchFeed(feed.feed_url);
          const parsed = parseFeed(xml, feed.feed_url);

          // Get existing GUIDs
          const { data: existingItems } = await supabase
            .from('feed_items')
            .select('guid')
            .eq('feed_id', feed.id);

          const existingGuids = new Set(existingItems?.map(i => i.guid) || []);
          const newItems = parsed.items.filter(item => !existingGuids.has(item.guid));

          if (newItems.length > 0) {
            const feedItems = newItems.map(item => ({
              user_id,
              feed_id: feed.id,
              guid: item.guid,
              url: item.url,
              title: item.title,
              excerpt: item.excerpt,
              content: item.content,
              author: item.author,
              image_url: item.imageUrl,
              published_at: item.publishedAt,
              is_seen: false,
              is_saved: false,
            }));

            await supabase.from('feed_items').insert(feedItems);
            totalNewItems += newItems.length;
          }

          await supabase
            .from('feeds')
            .update({
              last_fetched_at: new Date().toISOString(),
              fetch_error: null,
              item_count: (feed.item_count || 0) + newItems.length,
            })
            .eq('id', feed.id);

        } catch (err) {
          errors.push({ feed_id: feed.id, error: err.message });
          await supabase
            .from('feeds')
            .update({
              last_fetched_at: new Date().toISOString(),
              fetch_error: err.message,
            })
            .eq('id', feed.id);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          feeds_refreshed: (feeds || []).length - errors.length,
          new_items: totalNewItems,
          errors: errors.length > 0 ? errors : undefined
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
