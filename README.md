# BrandScope.AI

Paste a website, get its brand on one bento board: logo, colours, fonts, interface style, headline and imagery. Download it as a PNG, or as a two-page PDF (board plus brand notes).

## What's inside
- `index.html`: the app and the board layout (1920 x 1080)
- `netlify/functions/extract.mjs`: reads a website and its stylesheets and returns the brand details (`/api/extract?url=`)
- `netlify/functions/asset.mjs`: passes images and fonts through the site so exports work (`/api/asset?url=`)
- `netlify/lib/`: safe fetching (public websites only) and the colour/font analysis

## Deploy
Connect this repository to Netlify (Add new project, then Import an existing project, then GitHub). No build command is needed; the settings come from `netlify.toml`.

## Notes
- Homepage screenshots come from microlink.io's free tier (about 50 a day). If one fails, the board shows a drawn version of the homepage instead, and you can upload your own screenshot.
- Some websites block automated visits or build everything with scripts, so a few boards may come back with fewer details.
