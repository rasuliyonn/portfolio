# Portfolio site and Atlas Studio

Two Vercel-ready surfaces in one static project:

- **`/`** — the portfolio: selected systems, two full case studies, approach and about.
- **`/studio/`** — Atlas Studio, an interactive co-channel spectrum planner that runs
  entirely in the browser.

No build step, no runtime dependencies. HTML, CSS and ES modules only.

## Structure

```
index.html                       landing page
work/interference-atlas/         case study: spectrum planning with bounds
work/convergence-notes/          case study: CRDT synchronisation
studio/index.html                Atlas Studio app shell
studio/styles.css                app UI
studio/src/model.js              path loss, interference graph, DSATUR, clique, SINR
studio/src/app.js                canvas renderer, drag/keyboard, exports, share links
assets/                          stylesheet, favicon, case-study coverage map, preview
data/projects.json               curated project data (GitHub API enriches language)
vercel.json                      clean URLs, trailing slashes, cache and security headers
```

## Run locally

```
cd web
python3 -m http.server 4173
```

Open <http://localhost:4173/>. ES modules and `fetch` require an HTTP origin, so
opening `index.html` from the filesystem will not populate the project grid.

## Atlas Studio

The planner reimplements the Python model in `src/model.js`:

- log-distance path loss with a configurable exponent and antenna gain;
- thermal noise `-174 dBm/Hz + 10log10(BW) + NF`;
- an interference graph at a configurable protection margin;
- DSATUR colouring and a Bron–Kerbosch maximum clique for the lower bound;
- SINR per probe with 30 dB adjacent-channel and 70 dB out-of-band isolation.

Interaction: drag sites, nudge the selected site with arrow keys (Shift for 500 m),
tune power/gain/exponent/margin, toggle layers, and export an SVG map or a JSON plan.
Plans travel as share links (`#p=` base64 state), and exported JSON can be loaded
back into the app.

The app recomputes at 88 × 56 probes on a 45 ms throttle while dragging, so the
heat map stays responsive without a worker. All computation is local; nothing is
sent to a server.

## Deploy to Vercel

```
cd web
npx vercel@latest --prod
```

Or import the repository in the Vercel dashboard and set **Root Directory** to
`web`. `vercel.json` configures clean URLs (`/work/interference-atlas/`), immutable
caching for `/assets`, and basic security headers.

## Notes and limits

- The project grid loads `data/projects.json` and enriches it with public GitHub
  data; unauthenticated API rate limits fall back to the curated data.
- `assets/studio-preview.svg` is an illustration of the interface, not a screenshot.
- Coverage quality uses fixed thresholds (≥20 dB great, 10–20 dB good, 0–10 dB fair).
- The model is deterministic: no fading, terrain or antenna patterns.
- The studio link is keyboard-accessible for site movement; the canvas is not a
  screen-reader representation of the field, so the numeric readouts carry the result.
