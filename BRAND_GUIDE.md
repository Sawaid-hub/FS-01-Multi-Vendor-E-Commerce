# Market Lane Brand Guide

## Brand foundation

**Positioning:** A considered marketplace for discovering independent shops and useful, well-made things.

**Promise:** Make independent shopping feel clear, personal, and easy to trust.

**Personality:** Confident, warm, curious, and practical. We give makers room to be distinctive while keeping shopping simple.

**Voice:** Plainspoken, specific, and human. Name the maker or product benefit. Keep calls to action short. Avoid inflated claims, bargain language, and generic luxury wording.

## Visual system

### Color palette

| Token | Value | Use |
| --- | --- | --- |
| `ink-950` | `#171717` | Primary dark surfaces, headings, controls, and overlays |
| `ink-700` | `#333333` | Body text and secondary dark surfaces |
| `paper-0` | `#FFFFFF` | Header, cards, footer, and primary canvas |
| `paper-50` | `#FAF8F5` | Warm alternate sections and product canvases |
| `neutral-100` | `#F0F0F0` | Confidence, benefit, and seller story sections |
| `stone-200` | `#E9E4DC` | Small selected and focus accents |
| `white` | `#FFFFFF` | Raised surfaces and text on dark backgrounds |
| `slate-600` | `#666666` | Muted text on light surfaces |
| `slate-300` | `#E7E4E0` | Borders on light surfaces |

Use a crisp white two-row header, near-black text and calls to action, warm-white catalog areas, and light grey feature sections. Keep dark tones prominent in the hero treatment, text, controls, and CTA buttons. Product photography or original illustration supplies the color and texture. Use light grey surfaces for benefit and story bands; reserve near-black for prominent calls to action and selected states. Preserve readable contrast.

### Typography

Use **DM Sans** as the only typeface throughout the product, including headings, body copy, controls, dashboards, and invoices. Use weight and size to create hierarchy; do not introduce a display serif or a second font family.

- Display heading: 48–56px desktop, 36–42px mobile, weight 600, tight line height.
- Section heading: 28–34px, weight 600.
- Body: 14–16px, line height 1.55–1.7.
- Labels and metadata: 11–13px, medium weight, with restrained letter spacing.
- Buttons: 13–14px, weight 600.

### Layout and components

- Use a centered content width up to 1200px with 24–48px desktop gutters and 16px mobile gutters.
- Keep the marketplace header visible while browsing. Put brand, search, account actions, and key categories in two compact white rows.
- Use a wide edge-to-edge hero with an original image/illustration, dark overlay, white copy, and a clear action.
- Order the home page as hero, featured shops/categories, confidence benefits, best-selling products, seller story, and footer.
- Use horizontal category pills and image-led shop/product cards with restrained 4px corners and no heavy card shadows.
- Use near-black backgrounds with white text for primary actions. Use light grey surfaces for feature bands and subtle motion for hover, carousel, and entrance cues.
- Maintain visible keyboard focus and responsive behavior at tablet and mobile widths.

### Motion

- Use short 160–240ms ease-out transitions for hover, focus, and card imagery.
- Let cards lift by at most 3px and images scale by at most 1.03; keep movement subtle.
- Use a single short entrance fade for the hero. Avoid looping decorative motion.
- Honor `prefers-reduced-motion` by removing nonessential transforms and entrance animations.

## Product UI rules

1. Follow this guide for all new storefront, seller, and admin screens.
2. Add new colors and type treatments only when a documented need exists; update this guide at the same time.
3. Do not use a second font family. Use DM Sans weights for hierarchy.
4. Keep sample content and brand artwork original to Market Lane.
5. Build demo states with clear labels; never imply simulated checkout or browser-local profiles are production services.
