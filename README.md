# Stash

A simple, self-hosted read-it-later app. Save articles, highlights, and Kindle notes to your own database.

**Your data. Your server. No subscription.**

Forked from [Kevin Roose's Stash](https://github.com/kbroose/stash) — thanks Kevin for the foundation. This fork adds:

- **RSS Feed Reader** - Subscribe to feeds with a full reader view, unseen/seen tabs, and auto-refresh
- **Feed Categories** - Organize feeds into categories with filtering
- **Feed Keyboard Shortcuts** - `j`/`k` to navigate, `o` to open, `e` to mark seen, `z` to undo
- **In-Reader Highlighting** - Select any text while reading to save it as a highlight
- **Podcast Support** - Save and listen to podcast episodes
- **Readwise Reader Import** - Migrate existing highlights from Readwise Reader
- **WebHighlights Import** - Import highlights from the WebHighlights browser extension
- **OpenAI TTS** - Text-to-speech via OpenAI's API (in place of Edge TTS)

## Features

- **Chrome Extension** - Save pages and highlights with one click
- **Web App** - Access your saves from any device
- **Kindle Sync** - Import highlights from your Kindle library
- **Full-Text Search** - Find anything you've saved
- **Text-to-Speech** - Listen to articles with neural voices
- **iOS Shortcut** - Save from Safari on iPhone/iPad
- **Bookmarklet** - Works in any browser

## Why Stash?

- **Free forever** - Runs on Supabase free tier (500MB, unlimited API calls)
- **You own your data** - Everything stored in your own database
- **No account needed** - Single-user mode, no sign-up friction
- **Works offline** - PWA support for mobile
- **Open source** - Fork it, modify it, make it yours

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

- **Frontend**: Vanilla JS, HTML, CSS (no framework bloat)
- **Backend**: Supabase (PostgreSQL + REST API)
- **Hosting**: Any static host (Vercel, Netlify, GitHub Pages)

## Screenshots

*Coming soon*

## License

MIT
