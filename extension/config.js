// Stash Configuration
// Replace these with your Supabase project details

const CONFIG = {
  // Your Supabase project URL (from Project Settings > API)
  SUPABASE_URL: 'https://your-project-id.supabase.co',

  // Your Supabase anon/public key (from Project Settings > API)
  SUPABASE_ANON_KEY: 'your-anon-key',

  // Your web app URL (after deploying to Vercel/Netlify)
  WEB_APP_URL: 'https://your-stash-app.vercel.app',

  // Your user ID from Supabase (Authentication > Users)
  // For multi-user mode, this can be removed and auth will be required
  USER_ID: 'your-user-uuid',
};

// Don't edit below this line
if (typeof module !== 'undefined') {
  module.exports = CONFIG;
}
