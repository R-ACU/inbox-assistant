# Accent `netzhandwerker`: Die Netzhandwerker

Link: `/?firma=netzhandwerker`. The company only picks the accent colour: navy instead of their signal orange (orange is not used as a main colour in this app). Everything else (layout, type, surfaces, light and dark mode) is the same for every company. No logo, image or text of the company is used, and the company has nothing to do with this demo.

| Token | Light | Dark |
| :--- | :--- | :--- |
| `--accent` (buttons, active navigation, first chart series, gauge) | `#213f8f` | `#7f9ff2` |
| `--accent-hover` | `#1a3274` | `#9cb5f6` |
| `--accent-soft` (selected rows, highlighted cards) | `#ecf0fa` | `#1a2342` |
| `--chart-2` (second chart series) | `#9cb0e2` | `#bccbf7` |

The full set, including `--accent-ink` and `--accent-text`, is in `web/src/styles.css`. The dark values also apply inside the dark hero cards in light mode. `tests/theme.test.ts` checks WCAG AA for every pair the interface draws and that the hue stays between green and violet; `e2e/themes.spec.ts` measures every visible text in the browser in both modes.
