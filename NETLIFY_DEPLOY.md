# Deploy the dashboard and API to Netlify

The repository-root `netlify.toml` builds the admin dashboard and routes `/api/*` to a Netlify Function. Supabase stores API state and evidence; Netlify's filesystem is used only for temporary upload processing.

## One-time Supabase setup

1. Open the Supabase project's SQL Editor.
2. Run the contents of `supabase-distress-sessions.sql`. This creates the state table and the service-role-only lock functions required by the Netlify Function.
3. In Supabase Project Settings, copy the project URL and service-role key. Keep the service-role key private.

## Netlify setup

Use the existing dashboard site if it deploys this repository, or create a site from the same repository. In **Site configuration > Build & deploy > Build settings**, set the Base directory to the repository root (leave it blank), so Netlify reads the root `netlify.toml` rather than `police-admin/netlify.toml`.

Set these environment variables under **Environment variables**:

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service-role key. Never add this to the mobile app or browser bundle.
- `NODE_VERSION`: `22`.

For each variable, put the variable name in **Key** and its setting in **Value**. If a secret was accidentally entered as the key name, delete that malformed variable, rotate the exposed Supabase key, and create the variable again with `SUPABASE_SERVICE_ROLE_KEY` as the key name and the replacement key as its secret value.

Trigger **Deploys > Trigger deploy > Deploy site**. The deploy builds `police-admin/dist` and publishes the `/api/*` function routes on the same Netlify site.

## Connect Expo Go

After the deploy succeeds, copy the Netlify site's public URL into `citizen-mobile/.env` as `EXPO_PUBLIC_API_URL`, then restart Expo with `npx expo start -c`. The admin dashboard uses same-origin `/api` routes in the Netlify build.

## Upload size note

Netlify Functions have a much smaller request limit than the current Render server. This deployment caps API JSON and individual multipart uploads at 4 MB. Larger video or Get Help audio uploads need a direct-to-Supabase signed upload flow before they will work reliably on Netlify.
