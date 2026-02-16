NASCAR Style Guide (https://brand.nascar.com/galleries/C0000bYrQ1z1DDqg/G00009rrXiY6gIvA/I0000qPi3kZmvxes/NASCAR-IP-Guideline-Sheet-1-pdf)
This style guide outlines the key branding elements for consistent use in the vibe code app. Focus on colors, typography, logos, and striping to maintain visual integrity.
Colors
Use the following primary colors for all app elements. These include Pantone references, CMYK, RGB, HEX, and embroidery (Madeira) breakdowns.





















































ColorPantoneCMYKRGBHEXMadeira ClassicBlackBlack 6C100c/61m/32y/96k16r/24g/32b(N/A)1000White(N/A)0c/0m/0y/0k250r/250g/250bffffff1001Blue300C100c/56m/0y/3k0r/94g/184b005EB81177Red185C0c/100m/89y/0k228r/0g/43bE4002B1037Yellow129C0c/10m/80y/0k243r/208g/62bF3D03E1125

Usage Notes: Logos should be reproduced in full color or black/white only. Color background applications are recommended for better visibility.

Typography

**NASCAR brand (reference):** Stainless (from brand guidelines).
Character Set Example:textAaBbCcDdEeFfGg
HhIiJjKkLlMmNn
OoPpQqRrSsTtUu
VvWwXxYyZz
0123456789

Use this typeface for headings, body text, and UI elements to ensure consistency. Apply bold or italic variations sparingly for emphasis.

**App typography (web & iOS):**
- **Racer Italic** — Display font for race titles, headers, and accents (in `web/src/assets/fonts/` and iOS Fonts).
- **Barlow Condensed** — Fallback for headings.
- **Source Sans 3** — Body text.

**Web styles:** `web/src/styles/app.css` imports `tokens.css` (design tokens) and `app-core.css` (component styles).

Logos
Incorporate the following logo variants based on context:

Primary Full Color: Multicolor logo with blue, red, and yellow stripes integrated into the design. Ideal for headers and prominent branding.
Logo on Colored Backgrounds: Adapted full-color versions for blue, red, yellow, or black backgrounds to maintain contrast.
Primary One Color: Monochrome versions in black or white. Use for simplified UI elements or low-contrast scenarios.
Primary Embroidery Version: Optimized for digital representation of embroidered looks, using the full color palette.
Wordmark: Standalone "NASCAR" text without stripes.
Icon: Standalone stripe icon (yellow, red, blue bars).
Usage Notes: Always use the full logo where possible. Scale proportionally and avoid distortions.

Striping
The striping pattern consists of proportional bars in yellow, red, and blue. Define a constant base width x for flexibility in app layouts (e.g., borders, dividers, or backgrounds).

Proportions:
a = 50% of x (yellow bar)
x = Constant (red bar)
b = 160% of x (blue bar)
c = 300% of x (optional overall container or spacing)


Apply this pattern horizontally or vertically for decorative elements, ensuring colors match the palette above.