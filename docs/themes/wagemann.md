# Accent `wagemann`: Wagemann + Partner

Link: `/?firma=wagemann`. The company only picks the accent colour: petrol. Everything else (layout, type, surfaces, light and dark mode) is the same for every company. No logo, image or text of the company is used, and the company has nothing to do with this demo.

| Token | Light | Dark |
| :--- | :--- | :--- |
| `--accent` (buttons, active navigation, first chart series, gauge) | `#0b6d7e` | `#3dbdd0` |
| `--accent-hover` | `#085968` | `#62cddc` |
| `--accent-soft` (selected rows, highlighted cards) | `#e6f3f5` | `#122d34` |
| `--chart-2` (second chart series) | `#92cbd4` | `#9fe0ea` |

The full set, including `--accent-ink` and `--accent-text`, is in `web/src/styles.css`. The dark values also apply inside the dark hero cards in light mode. `tests/theme.test.ts` checks WCAG AA for every pair the interface draws and that the hue stays between green and violet; `e2e/themes.spec.ts` measures every visible text in the browser in both modes.
