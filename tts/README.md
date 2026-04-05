# Stash TTS (Text-to-Speech)

Generate audio versions of your saved articles using Microsoft's free Edge TTS neural voices.

## Setup

### 1. Install Dependencies

```bash
pip install edge-tts requests
```

### 2. Create Storage Bucket

In Supabase Dashboard:
1. Go to **Storage**
2. Create a new bucket called `audio`
3. Make it **public** (so the web app can play the files)

### 3. Configure the Script

Edit `tts.py` and update these values:

```python
SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co"
SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY"
USER_ID = "YOUR_USER_ID"
```

### 4. Run

```bash
# Run as daemon (checks every 2 minutes)
python tts.py

# Or run once and exit
python tts.py --once
```

## Voice Options

Change the `VOICE` variable to use different voices:

- `en-US-AriaNeural` - Female, American (default)
- `en-US-GuyNeural` - Male, American
- `en-GB-SoniaNeural` - Female, British
- `en-AU-NatashaNeural` - Female, Australian

See all voices: `edge-tts --list-voices`

## How It Works

1. Script polls Supabase for saves without `audio_url`
2. Extracts and cleans article text (removes markdown, code blocks, etc.)
3. Generates MP3 using Edge TTS (free, no API key needed)
4. Uploads to Supabase Storage
5. Updates the save record with the audio URL
6. Web app shows audio player when `audio_url` exists

## Running as a Service

To keep TTS running in the background:

```bash
# Using nohup
nohup python tts.py > /dev/null 2>&1 &

# Or create a systemd service (Linux)
# Or use launchd (macOS)
```
