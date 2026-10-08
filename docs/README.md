# docs/

The GitHub Pages site for this repository: a landing page (`index.html`) and a results walkthrough
per recorded run. Plain HTML, CSS and JS with no build step, so Pages can serve the folder as is
(`.nojekyll` turns Jekyll off).

To publish it: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`,
folder `/docs`.

| Path | What it is |
| --- | --- |
| `index.html` | Landing page: what System One models are, the four experiments, the protocol, the notebook log |
| `assets/` | Shared styles (`site.css`) and the theme toggle (`site.js`) |
| `model-router/` | The 2026-10-08 model-router run: `index.html`, `results.css`, `app.js`, and generated `data.js` |
| `tools/build-model-router-data.mjs` | Builds `model-router/data.js` |

`model-router/data.js` is generated, not written by hand. The script reads the three recorded runs in
`model-router/eval/results-2026-10-08T*.json`, routes every answer with model-router's own policy
(`src/policy.mjs`) at each bar from 0.00 to 0.60, and refuses to write if its summaries differ from the
ones each run saved. After a change to those runs or to the policy, regenerate it:

```bash
node docs/tools/build-model-router-data.mjs
```

To preview locally: `python3 -m http.server --directory docs`.
