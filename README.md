# NSW Curriculum Explorer

A custom interface for browsing the NSW Curriculum (curriculum.nsw.edu.au), built with [Web Awesome](https://webawesome.com/) web components and deployed on Vercel.

## Project structure

```
/
├── index.html          # App shell — wa-page layout, nav, sidebar
├── app.js              # Routing, tree wiring, content fetching & rendering
├── styles.css          # Custom styles on top of Web Awesome
├── api/
│   └── proxy.js        # Vercel Edge Function — proxies curriculum.nsw.edu.au
├── vercel.json         # Vercel rewrite rules
└── package.json
```

## How it works

1. The browser loads `index.html` which renders the Web Awesome `<wa-page>` shell.
2. The sidebar uses `<wa-tree>` with lazy loading — syllabuses are fetched on demand when a user expands a learning area or stage.
3. Every fetch goes through `/api/proxy?url=<encoded>`, the Edge Function, which:
   - Validates the target URL is `curriculum.nsw.edu.au`
   - Fetches the page server-side (no CORS issues)
   - Caches the response for 1 hour
   - Returns the HTML with CORS headers so the browser can read it
4. `app.js` parses the returned HTML, extracts the main content, and injects it into the page.

## Local development

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`

### Run locally

```bash
npm install
npm run dev
# → http://localhost:3000
```

`vercel dev` runs both the static files and the Edge Function locally.

## Deploy to Vercel

### Option A — Vercel CLI

```bash
npm run deploy
```

### Option B — GitHub

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your GitHub repo
4. Leave all settings as default — Vercel auto-detects the config
5. Click **Deploy**

No environment variables are needed.

## Customisation ideas

- **Theming** — Web Awesome supports full CSS theming. Try changing `--wa-color-brand-*` variables in `styles.css`.
- **Search** — add a `<wa-input>` in the header and filter tree items client-side.
- **Caching** — increase `CACHE_TTL_SECONDS` in `api/proxy.js` to reduce upstream requests.
- **Printing** — add a print stylesheet to render syllabus content cleanly.
- **Dark mode** — Web Awesome handles this automatically; add a toggle with `document.documentElement.classList.toggle('wa-dark')`.

## Notes

- Content is fetched live from `curriculum.nsw.edu.au` — this site is publicly accessible with no authentication required.
- The proxy only allows requests to `curriculum.nsw.edu.au` (validated server-side).
- Web Awesome is currently in public beta. Check [webawesome.com](https://webawesome.com) for updates and consider pinning to a specific version in production.
