# Stash iOS Shortcut

Save pages to Stash from your iPhone's share sheet.

## Setup

1. Open the Shortcuts app on your iPhone
2. Tap + to create a new shortcut
3. Add these actions:

### Action 1: Receive input
- Type: **Receive** what's passed to the shortcut
- Accept: **URLs** and **Safari web pages**

### Action 2: Get URL
- **Get URLs from** Shortcut Input

### Action 3: Get contents of URL (this saves to Stash)
- URL: `https://YOUR_PROJECT_ID.supabase.co/rest/v1/saves`
- Method: **POST**
- Headers:
  - `apikey`: `YOUR_SUPABASE_ANON_KEY`
  - `Content-Type`: `application/json`
  - `Prefer`: `return=minimal`
- Request Body: **JSON**
  ```
  {
    "user_id": "YOUR_USER_ID",
    "url": [URLs variable],
    "title": "Saved from iPhone",
    "site_name": "",
    "source": "ios-shortcut"
  }
  ```

### Action 4: Show notification
- "Saved to Stash!"

## Add to Share Sheet

1. Tap the shortcut name at the top
2. Tap the (i) info icon
3. Enable "Show in Share Sheet"
4. Name it "Save to Stash"

Now when you're in Safari (or any app), tap Share → Save to Stash!
