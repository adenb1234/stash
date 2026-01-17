// Stash Configuration
// Replace these with your Supabase project details

const CONFIG = {
  // Your Supabase project URL (from Project Settings > API)
  SUPABASE_URL: 'https://evpruqiugexseqzdokir.supabase.co',

  // Your Supabase anon/public key (from Project Settings > API)
  SUPABASE_ANON_KEY: 'sb_publishable_UiGBcqFdNymYKunGqCsoug_yWROVr5m',

  // Your web app URL (after deploying to Vercel/Netlify)
  WEB_APP_URL: 'https://stash-hazel.vercel.app',

  // Your user ID from Supabase (Authentication > Users)
  // For multi-user mode, this can be removed and auth will be required
  USER_ID: '341976e3-e922-4da5-a77d-21e22aaef5bb',
};

// Don't edit below this line
if (typeof module !== 'undefined') {
  module.exports = CONFIG;
}
