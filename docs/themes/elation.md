# Accent `elation`: Elation Health

Link: `/?firma=elation`. The company only picks the accent colour: navy and sky blue. Everything else (layout, type, surfaces, light and dark mode) is the same for every company. No logo, image or text of the company is used, and the company has nothing to do with this demo.

| Token | Light | Dark |
| :--- | :--- | :--- |
| `--accent` (buttons, active navigation, first chart series, gauge) | `#0b5aa8` | `#4fb2f5` |
| `--accent-hover` | `#094a8b` | `#75c4f8` |
| `--accent-soft` (selected rows, highlighted cards) | `#e7f1fb` | `#10273b` |
| `--chart-2` (second chart series) | `#86c0ef` | `#a9d8fa` |

The full set, including `--accent-ink` and `--accent-text`, is in `web/src/styles.css`. The dark values also apply inside the dark hero cards in light mode. `tests/theme.test.ts` checks WCAG AA for every pair the interface draws and that the hue stays between green and violet; `e2e/themes.spec.ts` measures every visible text in the browser in both modes.
