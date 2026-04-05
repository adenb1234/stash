# Stash

A self-hosted read-it-later app. Replaced a host of former apps to have my note-taking, RSS feeds, and article highlighting all in one place.

Forked from [Kevin Roose's Stash](https://github.com/kbroose/stash). Added:

- **RSS Feed Reader** - Subscribe to feeds with a full reader view, unseen/seen tabs, and auto-refresh
- **Feed Categories** - Organize feeds into categories with filtering
- **Feed Keyboard Shortcuts** - `j`/`k` to navigate, `o` to open, `e` to mark seen, `z` to undo
- **In-Reader Highlighting** - Select any text while reading to save it as a highlight
- **Podcast Support** - Save and listen to podcast episodes
- **Highlight Import** - Migrate existing highlights from third-party apps
- **OpenAI TTS** - Text-to-speech via OpenAI's API (in place of Edge TTS)

## Quick Start

1. **Create a Supabase project** (free) at [supabase.com](https://supabase.com)
2. **Run the schema** from `supabase/schema.sql`
3. **Add your credentials** to `extension/config.js` and `web/config.js`
4. **Load the extension** in Chrome (`chrome://extensions` > Load unpacked)
5. **Deploy the web app** to Vercel/Netlify (free)

See [SETUP.md](SETUP.md) for detailed instructions.

## Project Structure

```
stash/
├── extension/       # Chrome extension
├── web/            # Web app (PWA)
├── tts/            # Text-to-speech generator
├── bookmarklet/    # Universal save bookmarklet
├── ios-shortcut/   # iOS Shortcut for Safari
└── supabase/       # Database schema & Edge Functions
```

## Tech Stack

- **Frontend**: Vanilla JS, HTML, CSS
- **Backend**: Supabase (PostgreSQL + REST API)
- **Hosting**: Any static host (Vercel, Netlify, GitHub Pages)

## License

MIT
