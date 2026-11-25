# Credits

## Picture on the sign-in page

`web/public/img/login-malerraum.webp`

- **What:** a freshly painted room with a step ladder, a paint roller and a drop cloth.
- **Source:** generated for this demo with an image model (Gemini 3.1 Flash Image, through Figma AI). No photo of a real person, company or place.
- **Changes:** converted to WebP (848 x 1264 px). The sign-in page crops it and lays a frosted panel over part of it, and says in a small caption that the picture was generated.

## Font

- **Allo** 1.1.0 by Josh Puckett, variable font `AlloVariableFriendly.woff2` (weights 100 to 900, optical size automatic, rounding fixed to "Friendly"). Self-hosted from `web/src/fonts/allo/`.
- **License:** SIL Open Font License 1.1, free for commercial use. The full license text ships next to the font: `web/src/fonts/allo/OFL.txt`.

## Icons and components

- Icons: Lucide (`lucide-react`), ISC license. The brand mark and the favicon use Lucide's "paint-roller".
- Components follow shadcn/ui (MIT) on Radix UI primitives (MIT), styled with the app's own tokens. Charts: Recharts (MIT). Motion: motion (MIT).

## Logos

- The Claude and n8n marks (history, model row, test-mode badge, send note) are the official glyphs from [Simple Icons](https://simpleicons.org) 16.38.1, CC0, in their brand colours (`#D97757`, `#FF91AC`). They are stored as SVG paths in `web/src/components/brand.tsx`, because the CSP allows no image CDN. They name the products the assistant works with; neither company is connected to this demo.
- Suppliers have no logos (they are invented). They are shown with a Lucide icon of their trade (paint bucket, scaffolding, hammer and so on) instead.
