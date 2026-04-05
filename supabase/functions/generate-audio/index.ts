import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function stripHtml(html: string): string {
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function chunkText(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = maxLen;
    const searchRegion = remaining.substring(maxLen - 500, maxLen);
    const lastPeriod = searchRegion.lastIndexOf(". ");
    if (lastPeriod !== -1) {
      splitAt = maxLen - 500 + lastPeriod + 2;
    } else {
      const lastSpace = remaining.lastIndexOf(" ", maxLen);
      if (lastSpace > maxLen * 0.5) {
        splitAt = lastSpace + 1;
      }
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }

  return chunks;
}

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { save_id, action } = await req.json();
    if (!save_id) return jsonResponse({ error: "save_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Action: get_url — return a signed URL for existing audio
    if (action === "get_url") {
      const filename = `${save_id}.mp3`;
      const { data, error } = await supabase.storage
        .from("audio")
        .createSignedUrl(filename, 3600);

      if (error || !data?.signedUrl) {
        return jsonResponse({ error: "Audio not found" }, 404);
      }
      return jsonResponse({ success: true, signed_url: data.signedUrl });
    }

    // Default action: generate audio
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);

    // Fetch the save
    const { data: save, error: fetchError } = await supabase
      .from("saves")
      .select("id, title, content")
      .eq("id", save_id)
      .single();

    if (fetchError || !save) return jsonResponse({ error: "Save not found" }, 404);

    // Strip HTML and prepend title
    const plainText = stripHtml(save.content || "");
    if (!plainText || plainText.length < 50) {
      return jsonResponse({ error: "Not enough content to generate audio" }, 400);
    }

    const fullText = `${save.title || ""}. ${plainText}`;
    const chunks = chunkText(fullText);

    console.log(`Generating audio for save ${save_id}: ${chunks.length} chunk(s), ${fullText.length} chars`);

    // Generate TTS for each chunk
    const audioBuffers: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          voice: "nova",
          input: chunks[i],
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`OpenAI TTS error on chunk ${i}:`, errText);
        return jsonResponse({ error: `TTS generation failed: ${errText}` }, 500);
      }

      const buffer = new Uint8Array(await res.arrayBuffer());
      audioBuffers.push(buffer);
    }

    // Concatenate MP3 buffers
    const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      combined.set(buf, offset);
      offset += buf.length;
    }

    // Upload to Supabase Storage
    const filename = `${save_id}.mp3`;
    const { error: uploadError } = await supabase.storage
      .from("audio")
      .upload(filename, combined, {
        contentType: "audio/mpeg",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return jsonResponse({ error: "Failed to upload audio" }, 500);
    }

    // Update save with audio_url
    const { error: updateError } = await supabase
      .from("saves")
      .update({ audio_url: filename })
      .eq("id", save_id);

    if (updateError) console.error("Update error:", updateError);

    // Create a signed URL for immediate playback
    const { data: signedData } = await supabase.storage
      .from("audio")
      .createSignedUrl(filename, 3600);

    console.log(`Audio generated for save ${save_id}: ${filename} (${combined.length} bytes)`);

    return jsonResponse({
      success: true,
      audio_url: filename,
      signed_url: signedData?.signedUrl || null,
    });
  } catch (err) {
    console.error("Error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
});
