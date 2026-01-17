import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "https://esm.sh/fast-xml-parser@4.3.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// XML Parser configured to handle RSS/Atom feeds
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ['item', 'entry'].includes(name),
});

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
  // Simple regex-based discovery (faster and more reliable than DOM parsing for this)
  const linkRegex = /<link[^>]+(?:type=["']application\/(?:rss|atom)\+xml["']|rel=["']alternate["'][^>]+type=["'][^"']*xml[^"']*["'])[^>]*>/gi;
  const matches = html.match(linkRegex);

  if (matches) {
    for (const match of matches) {
      const hrefMatch = match.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const href = hrefMatch[1];
        // Handle relative URLs
        if (href.startsWith('/')) {
          const base = new URL(baseUrl);
          return `${base.origin}${href}`;
        }
        if (href.startsWith('http')) {
          return href;
        }
      }
    }
  }

  return null;
}

// Strip HTML tags from text
function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract first image from HTML content
function extractFirstImage(html: string): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

// Get text content from a parsed XML node (handles both string and object with #text)
function getText(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && node['#text']) return node['#text'];
  return '';
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
  const parsed = xmlParser.parse(xml);

  // Try RSS 2.0 format first
  if (parsed.rss?.channel) {
    return parseRss(parsed.rss.channel, feedUrl);
  }

  // Try Atom format
  if (parsed.feed) {
    return parseAtom(parsed.feed, feedUrl);
  }

  // Try RSS 1.0 / RDF format
  if (parsed['rdf:RDF']) {
    return parseRdf(parsed['rdf:RDF'], feedUrl);
  }

  throw new Error('Unknown feed format - could not find rss, feed, or rdf:RDF root element');
}

function parseRss(channel: any, feedUrl: string) {
  const title = getText(channel.title) || 'Unknown Feed';
  const description = getText(channel.description) || '';
  const siteUrl = getText(channel.link) || feedUrl;

  const items: any[] = [];
  const itemNodes = channel.item || [];

  for (const item of itemNodes) {
    const guid = getText(item.guid) || getText(item.link) || `${Date.now()}-${Math.random()}`;
    const url = getText(item.link) || '';
    const itemTitle = getText(item.title) || 'Untitled';

    // Get content from different possible fields
    const contentEncoded = getText(item['content:encoded']) || '';
    const descriptionText = getText(item.description) || '';
    const content = contentEncoded || descriptionText;

    // Extract excerpt (first 300 chars of plain text)
    const plainText = stripHtml(content);
    const excerpt = plainText.substring(0, 300).trim() + (plainText.length > 300 ? '...' : '');

    // Get author
    const author = getText(item.author) || getText(item['dc:creator']) || '';

    // Get image
    const mediaContent = item['media:content']?.['@_url'] || item['media:thumbnail']?.['@_url'];
    const enclosure = item.enclosure?.['@_type']?.startsWith('image') ? item.enclosure['@_url'] : null;
    const imageUrl = mediaContent || enclosure || extractFirstImage(content);

    // Get published date
    const pubDate = getText(item.pubDate);
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
  const title = getText(feed.title) || 'Unknown Feed';
  const subtitle = getText(feed.subtitle) || '';

  // Get site URL from link element
  let siteUrl = feedUrl;
  const links = Array.isArray(feed.link) ? feed.link : [feed.link].filter(Boolean);
  for (const link of links) {
    if (link['@_rel'] === 'alternate' || !link['@_rel']) {
      siteUrl = link['@_href'] || siteUrl;
      break;
    }
  }

  const items: any[] = [];
  const entries = feed.entry || [];

  for (const entry of entries) {
    const guid = getText(entry.id) || '';

    // Get URL from link element
    let url = '';
    const entryLinks = Array.isArray(entry.link) ? entry.link : [entry.link].filter(Boolean);
    for (const link of entryLinks) {
      if (link['@_rel'] === 'alternate' || !link['@_rel']) {
        url = link['@_href'] || '';
        break;
      }
    }

    const itemTitle = getText(entry.title) || 'Untitled';

    // Get content
    const contentEl = entry.content;
    const summaryEl = entry.summary;
    const content = getText(contentEl) || getText(summaryEl) || '';

    // Extract excerpt
    const plainText = stripHtml(content);
    const excerpt = plainText.substring(0, 300).trim() + (plainText.length > 300 ? '...' : '');

    // Get author
    const authorEl = entry.author;
    const authorName = authorEl?.name ? getText(authorEl.name) : '';

    // Get image
    const mediaContent = entry['media:content']?.['@_url'] || entry['media:thumbnail']?.['@_url'];
    const imageUrl = mediaContent || extractFirstImage(content);

    // Get published date
    const published = getText(entry.published) || getText(entry.updated);
    let publishedAt = null;
    if (published) {
      try {
        publishedAt = new Date(published).toISOString();
      } catch (e) {
        // Ignore date parsing errors
      }
    }

    items.push({
      guid: guid || url || `${Date.now()}-${Math.random()}`,
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

function parseRdf(rdf: any, feedUrl: string) {
  const channel = rdf.channel || {};
  const title = getText(channel.title) || 'Unknown Feed';
  const description = getText(channel.description) || '';
  const siteUrl = getText(channel.link) || feedUrl;

  const items: any[] = [];
  const itemNodes = rdf.item || [];

  for (const item of itemNodes) {
    const guid = getText(item['@_rdf:about']) || getText(item.link) || `${Date.now()}-${Math.random()}`;
    const url = getText(item.link) || '';
    const itemTitle = getText(item.title) || 'Untitled';
    const content = getText(item.description) || getText(item['content:encoded']) || '';

    const plainText = stripHtml(content);
    const excerpt = plainText.substring(0, 300).trim() + (plainText.length > 300 ? '...' : '');

    const author = getText(item['dc:creator']) || '';

    const pubDate = getText(item['dc:date']);
    let publishedAt = null;
    if (pubDate) {
      try {
        publishedAt = new Date(pubDate).toISOString();
      } catch (e) {
        // Ignore
      }
    }

    items.push({
      guid,
      url,
      title: itemTitle,
      excerpt,
      content: stripHtml(content).substring(0, 50000),
      author,
      imageUrl: extractFirstImage(content),
      publishedAt,
    });
  }

  return { title, description, siteUrl, items };
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
      let lastError = "";

      // Try the converted URL first
      try {
        console.log("Trying to fetch:", feedUrl);
        const xml = await fetchFeed(feedUrl);
        console.log("Got XML, length:", xml.length, "starts with:", xml.substring(0, 100));
        if (xml.includes('<rss') || xml.includes('<feed') || xml.includes('<channel') || xml.includes('rdf:RDF')) {
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
        lastError = `Direct fetch failed: ${e.message}`;
        console.log(lastError);
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
          if (xml.includes('<rss') || xml.includes('<feed') || xml.includes('<channel') || xml.includes('rdf:RDF')) {
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
        JSON.stringify({ error: "Could not find RSS/Atom feed for this URL. " + lastError }),
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
