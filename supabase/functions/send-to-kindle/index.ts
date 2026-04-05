import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function buildKindleHtml(title: string, author: string | null, content: string, url: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 700px; margin: 0 auto; padding: 20px; line-height: 1.7; color: #222; }
    h1 { font-size: 1.8em; margin-bottom: 0.3em; }
    .meta { color: #666; font-size: 0.9em; margin-bottom: 2em; border-bottom: 1px solid #eee; padding-bottom: 1em; }
    p { margin: 0 0 1em; }
    blockquote { border-left: 3px solid #ccc; margin: 1em 0; padding: 0.5em 1em; color: #555; font-style: italic; }
    img { max-width: 100%; height: auto; }
    a { color: #333; }
    h2, h3, h4 { margin: 1.5em 0 0.5em; }
    .source { margin-top: 2em; font-size: 0.8em; color: #999; border-top: 1px solid #eee; padding-top: 1em; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">${author ? `By ${author} · ` : ""}Sent from Stash</div>
  ${content}
  <div class="source">Source: <a href="${url}">${url}</a></div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "onboarding@resend.dev";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { user_id, save_id, kindle_email: inlineKindleEmail, title: inlineTitle, content: inlineContent, author: inlineAuthor, url: inlineUrl } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Always send to Gmail relay address — Gmail filter auto-forwards to Kindle
    const GMAIL_RELAY = Deno.env.get("KINDLE_RELAY_EMAIL") || "adenbarton@gmail.com";

    let title: string;
    let content: string;
    let url: string;
    let author: string | null;

    if (inlineContent) {
      // Inline content provided (e.g. send URL to Kindle flow)
      title = inlineTitle || "Article";
      content = inlineContent;
      url = inlineUrl || "";
      author = inlineAuthor || null;
    } else {
      // Fetch from saved article in DB
      if (!save_id) {
        return new Response(
          JSON.stringify({ error: "save_id or inline content required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: save, error: saveError } = await supabase
        .from("saves")
        .select("title, content, url, author, highlight, excerpt")
        .eq("id", save_id)
        .eq("user_id", user_id)
        .single();

      if (saveError) throw saveError;
      if (!save) throw new Error("Save not found");

      title = save.title || "Article";
      url = save.url || "";
      author = save.author || null;
      content = save.highlight
        ? `<blockquote>${save.highlight}</blockquote>`
        : save.content || save.excerpt || "";
    }

    if (!content) {
      return new Response(
        JSON.stringify({ error: "No content to send" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build HTML and encode as base64 for attachment
    const html = buildKindleHtml(title, author, content, url);
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(html);
    const htmlBase64 = btoa(String.fromCharCode(...htmlBytes));

    const safeFilename = title.replace(/[^a-z0-9\s-]/gi, "").trim().replace(/\s+/g, "_").substring(0, 60) || "article";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: GMAIL_RELAY,
        subject: title,
        text: `Article: ${title}\n\nSent from Stash.\n\nSource: ${url}`,
        attachments: [{
          filename: `${safeFilename}.html`,
          content: htmlBase64,
        }],
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      throw new Error(`Resend error: ${errText}`);
    }

    return new Response(
      JSON.stringify({ success: true, message: `Sent to Kindle via ${GMAIL_RELAY}` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Send to Kindle error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
