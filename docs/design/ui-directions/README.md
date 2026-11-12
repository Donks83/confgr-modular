# UI directions (checkpoint 3)

Open `index.html` in a browser. It shows all three directions side by side, desktop and phone,
with a theme switch. `direction.html?d=a|b|c&theme=youk|confgr` opens one at full size.
`shots/` holds headless-Edge screenshots of each, at 1280 × 800 and at a true 390 × 844.

## The stage image

`hero.png` is a real render of our own pipeline, not a stock picture.

1. A 2-bay, 1500 mm, four-metal-shelf product built by `buildGuided`.
2. Exported with `npm run youk:export` (the same GLB AR gets).
3. Rendered in **headless** Blender (Cycles, AgX, one soft sun, a shadow catcher, transparent
   background), so it sits on the `#efece7` build space.

It is a preview of what "light, high-quality presentation" could look like in the runtime, with
softer shadows and a better default angle than today's.

## How the YouK-flavoured theme was derived

From kesseboehmer.com and its YouK page, read on 12 November 2026:

| What they do | What the theme takes | What it deliberately does not take |
|---|---|---|
| Roboto, light 300 headings, bold 700 titles | the Roboto family, light headings | their type sizes |
| Deep green-black ink `#002925`, accent green `#007058`, pale green bands `#f0f5f1` | a pine ink `#12302b`, a green `#17705b` (AA on white), a tint `#eef3ef` | their exact colours |
| Square corners, outline buttons, large room photography, overlapping dark panels | square corners, quiet outline controls, a dark rail as an option (C) | logo, wordmark, photography, any copy |

The neutral **confgr** theme comes from Studio's existing palette (`--amber` `#c9853a`, darkened
to `#a35f1f` so white text on it passes AA at 5.0:1), Inter, and 8–14 px radii.

## Tokens

Each theme is one block of CSS custom properties: `--ink`, `--accent`, `--surface`, `--tint`,
`--line`, `--radius`, `--font`, and so on, defined on `:root[data-theme]`. In the real runtime
that block becomes per-client branding (§3.6, §6); nothing in the layout reads a colour directly.

The build space `--stage: #efece7` and the material colours (steel 45, plastic 50) are **not**
theme tokens. They are Matt's decisions and stay fixed.
