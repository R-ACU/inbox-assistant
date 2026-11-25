# Accent `provipanda`: ProviPanda

Link: `/?firma=provipanda`. The company only picks the accent colour: a calm violet. Everything else (layout, type, surfaces, light and dark mode) is the same for every company. No logo, image or text of the company is used, and the company has nothing to do with this demo.

| Token | Light | Dark |
| :--- | :--- | :--- |
| `--accent` (buttons, active navigation, first chart series, gauge) | `#6b46e0` | `#a68cfa` |
| `--accent-hover` | `#5835c8` | `#bba7fb` |
| `--accent-soft` (selected rows, highlighted cards) | `#f1edfd` | `#241c40` |
| `--chart-2` (second chart series) | `#bba9f5` | `#d2c4fd` |

The full set, including `--accent-ink` and `--accent-text`, is in `web/src/styles.css`. The dark values also apply inside the dark hero cards in light mode. `tests/theme.test.ts` checks WCAG AA for every pair the interface draws and that the hue stays between green and violet; `e2e/themes.spec.ts` measures every visible text in the browser in both modes.
