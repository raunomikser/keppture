<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/b800d8e0-cdc2-4fdc-8b2d-da098d816694

## Run Locally

**Prerequisites:** Deno 2+ (or Node.js 20+ with npm)

The app is a plain client-side Vite/React web application. It does not need a desktop wrapper.

### With Deno (no Node.js install needed)

```bash
deno task install
deno task dev      # http://localhost:3000
deno task check    # TypeScript type-check
deno task build    # production build into dist/
```

### With Node.js / npm

```bash
npm install
npm run dev
npm run build
```

Set `GEMINI_API_KEY` in `.env.local` only if you want to use the Gemini-backed AI features. The CAD/3D workspace itself works without it.
