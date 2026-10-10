# docs/

The GitHub Pages site for this repository: a landing page (`index.html`) and a results walkthrough
per recorded run. Plain HTML, CSS and JS with no build step, so Pages can serve the folder as is
(`.nojekyll` turns Jekyll off).

To publish it: **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`,
folder `/docs`.

| Path | What it is |
| --- | --- |
| `index.html` | Landing page: why the experiments were run, the premise (what Jev is), the four experiments, the process, the notebook log, a note on the level of rigor |
| `assets/` | Shared by every page: styles (`site.css`) and the theme toggle (`site.js`). Shared by the results pages: `results.css`, and `results.js` (tooltips, chart helpers, the side contents) |
| `model-router/` | The 2026-10-08 model-router run: `index.html`, `app.js`, generated `data.js`, and two captures of the page's route explorer (`screenshot-light.png`, `screenshot-dark.png`) that the landing page shows as a thumbnail |
| `godot-jev/` | The 2026-10-08 three-model godot-jev run: `index.html`, `page.css`, `app.js`, a screenshot of the game, and generated `data.js` |
| `tools/build-model-router-data.mjs` | Builds `model-router/data.js` |
| `tools/build-godot-jev-data.gd` | Builds `godot-jev/data.js` |

`model-router/data.js` is generated, not written by hand. The script reads the three recorded runs in
`model-router/eval/results-2026-10-08T*.json`, routes every answer with model-router's own policy
(`src/policy.mjs`) at each bar from 0.00 to 0.60, and refuses to write if its summaries differ from the
ones each run saved. After a change to those runs or to the policy, regenerate it:

```bash
node docs/tools/build-model-router-data.mjs
```

`godot-jev/data.js` is generated the same way, by a Godot script, because the policy it replays is
the game's parser. It reads `godot-jev/eval/results-2026-10-08T134205.json`, puts every recorded
answer back through `demo/parser.gd` in the game state where it was asked, at the run's thresholds
and at every setting the page's sliders reach, and refuses to write if an outcome or a summary
differs from what the run saved:

```bash
godot --headless --path godot-jev --import
godot --headless --path godot-jev --script ../docs/tools/build-godot-jev-data.gd
```

To preview locally: `python3 -m http.server --directory docs`.
