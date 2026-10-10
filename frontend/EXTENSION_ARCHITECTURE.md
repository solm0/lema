# Chrome Extension Notes

This scaffold adds a separate Chrome extension build without changing the existing web, Electron, or Capacitor entrypoints.

## Build

- `npm run build` keeps building the existing frontend app
- `npm run build:extension` builds the extension into `frontend/dist-extension`

## Runtime split

- `extension/content.tsx`
  - Watches hovered elements on normal web pages
  - Shows the small `Lema` action button
  - Mounts a draggable, minimizable panel inside a `shadowRoot`
- `extension/background.ts`
  - Proxies network requests so the content script does not depend on page CORS
  - Opens install URLs and app deeplinks
- `extension/api.ts`
  - Uses local-first APIs for analyze and lemma lookup
  - Uses central APIs for save and favorite

## Current scope

- Hover a text-heavy element
- Click `Lema`
- Probe the local Lema server
- If unavailable, show an install CTA to `lema.solmi.wiki`
- If available, analyze the element and render tokens in the floating panel
- Click a token to fetch lemma details
- Save the analyzed page and attempt to open the saved page in the app

## Intentional omissions in this first scaffold

- Browser-side selection annotations
- N-gram tools
- Full `PageView` routing reuse
- Extension auth UX
- Production deeplink fallback handling

## Safe impact

This does not replace the main Vite config or the existing app entrypoint. Existing Electron, web, and mobile builds keep the same flow.
