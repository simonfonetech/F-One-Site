# Branding & styling notes

How the static build's CSS relates to the live WordPress site at
https://fonetech.uk, and which differences are deliberate.

## Stylesheet load order

Set in `templates/base.html`. It mirrors the order WordPress uses on live, so
the cascade resolves the same way:

| # | File | Role |
|---|---|---|
| 1 | `static/css/wp-blocks.css` | WordPress core block styles, ported from live |
| 2 | `static/css/brand.css` | Brand tokens + WordPress preset colour classes |
| 3 | `static/css/theme.css` | The f-one theme stylesheet, as served by live |
| 4 | `static/css/style.css` | **Hand-written layer for the static build** |
| 5 | `static/css/generateblocks-global.css` | GenerateBlocks global styles, as served by live |
| 6 | `static/css/generated/<page-id>.css` | Per-instance GenerateBlocks CSS, as served by live |
| 7 | `static/css/wp-custom.css` | Port of live's Customizer CSS |
| 8 | `static/css/carousel.css` | Carousel styling for the static build |

**Which files are ours to edit**

- `brand.css`, `style.css`, `carousel.css` — ours. Edit freely.
- `theme.css`, `generateblocks-global.css`, `generated/*.css` — **mirrors of
  live**, byte-identical to what fonetech.uk serves. Editing them diverges from
  live and they are overwritten on re-migration.
- `wp-blocks.css` — the `<style id="wp-block-*-inline-css">` blocks live emits
  (block library, heading, image, paragraph, columns, group, quote). These are
  WordPress core styles the migrated block markup depends on; the original
  migration never carried them across. Loaded first, mirroring live's head
  order. `core-block-supports-inline-css` is deliberately excluded — it is
  per-page CSS keyed on `.wp-container-core-*` / `.is-layout-*` classes that our
  markup does not carry.
- `wp-custom.css` — a **verbatim port** of live's `<style id="wp-custom-css">`
  (the WordPress Customizer block), minus rules targeting the site header, nav,
  mega-menu and footer, which the static build re-implements under the same
  class names. Keep it a faithful mirror: put our own decisions in `style.css`
  so provenance stays clear.

## How button styling resolves

There is no single rule; it depends on the button.

- **Header bar CTA** (`.gb-button-wrapper a` inside `.site-header`) —
  `theme.css` wins via `padding: 6px 12px !important`.
- **Content buttons** (`a.gb-button-<hash>`) — the per-instance rule in
  `generated/<page-id>.css` wins. It outranks the `.gb-button` fallback in
  `style.css` on both specificity and load order, so editing `.gb-button` will
  *not* change them. Eight different padding values are in use across the site.

To restyle all content buttons, a rule must either load after the generated CSS
or match its specificity.

## Shape dividers (the angled section edges)

GenerateBlocks Pro renders shape dividers server-side, so the markup never
reached the WordPress export -- only the container's `shapeDividers` attribute
did. The original migration therefore produced pages with the divider CSS
present (`.gb-container-{id} > .gb-shapes .gb-shape-{n}`, fetched from live) but
no elements for it to style, so every angled edge was missing.

`_build/gbrender.py` now rebuilds them: `SHAPE_SVGS` holds the four shapes this
site uses (`gb-angle-1`, `gb-triangle-1`, `gb-triangle-2`, `gb-triangle-8`),
copied verbatim from live's output, and `_shape_dividers()` emits
`<div class="gb-shapes">` as the container's last child. Colour, height,
position and flips all come from the existing per-page CSS.

Read the dividers from each block's own attributes, never from a lookup keyed on
uniqueId: the same id is reused across pages with different settings (dba2aa1b
has one shape on one page, two on another).

Existing content was patched in place rather than re-migrated (a full
`migrate.py` run also rewrites `data/nav.yaml` and `theme.css`, which would undo
unrelated fixes). 35 divider blocks across 21 pages; verified as additions only.

## Dynamic GenerateBlocks markup rebuilt in gbrender.py

Three things GenerateBlocks renders server-side never reached the export, and
each left CSS in place with no element to style. All are now emitted by
`_build/gbrender.py`, and existing content was patched in place:

| Missing | Symptom | Emitted by |
|---|---|---|
| `.gb-shapes` | angled section edges absent | `_shape_dividers()` |
| `.gb-button-wrapper` | industries hero buttons purple, not orange | `button-container` branch |
| `.gb-container-link` | handset cards not clickable | container `url` attribute |

The button wrapper matters because per-instance CSS for those buttons is scoped
`.gb-button-wrapper a.gb-button-{id}` (56 rules across 14 stylesheets) and
theme.css styles `.gb-button-wrapper a` with `!important` -- which is what makes
them orange on live.

The handset cross-links also needed 18 URL corrections (`/yealinkw59r/`,
`/yealink-t785w/` and similar); those slugs are wrong in the source data, so the
same links are broken on the live site.

## Customer area documents

The "Useful Information" accordions are a GenerateBlocks query loop over a
`customer-area-link` post type (83 published entries, each with a `link` to a
PDF and a `link-category` taxonomy term). Being a dynamic loop, the export only
carried the loop's template card -- a `<span class="gb-button">` with no href and
"This is a test" as the sample title -- repeated a few times per accordion.

Rather than reconstruct the category-to-accordion mapping, each accordion's
rendered content was lifted from live, its asset URLs rewritten to
`/assets/uploads/`, and the 30 referenced PDFs downloaded. Prod now matches live
across all ten accordions on link count, PDF count and headings.

If the source data changes, re-run the port rather than hand-editing: the page
content is generated, not authored.

## Ionicons and the social rail

Two pieces of live's chrome were absent:

- The contact details on `/contact-us/` and in the footer are `<ion-icon>` web
  components. The markup survived migration but the Ionicons script did not, so
  they rendered as nothing. `base.html` now loads it, matching live.
- The floating social rail (`.f-one-social-buttons`) is part of live's theme
  footer rather than page content, so it never came across -- while theme.css
  already carried all its styling. It is now `templates/partials/socials.html`
  with the eight icons in `assets/social/`, plus the small scroll-away behaviour
  live uses below 768px.

## Known issue: mobile nav drawer (deferred)

`wp-custom.css` still carries seven `.main-navigation` rules that target the
**live** site's mobile nav, which the chrome filter should have dropped during
the port. The damaging one is:

```css
@media (max-width: 1024px) { .main-navigation ul.nav-menu {
  overflow-y: scroll; height: 100vh; display: block; } }
```

It has the same specificity as style.css's `display: none` but loads later, so
it wins: below 1024px the nav list is always rendered, full height, fixed, and
sits over the hamburger button (`document.elementFromPoint` at the toggle
returns `ul#primary-menu`).

Note the breakpoint is **1024px, not the 991px** the static build uses, so this
also affects small laptops, not just phones. In the 992–1024px band it puts the
`.mega-services` item at `x=0` (while the nav itself is at `x=130`), which drags
the Services panel 24px off the left edge. Measured at both the old 740px panel
width and the current 980px, so it is this rule and not the panel size.
Above 1100px everything is correct.

Fix when mobile is back in scope: strip rules matching
`.main-navigation` / `.nav-menu` / `.sub-menu` / `ul.menu` from
`static/css/wp-custom.css`. Deferred at the user's request.

## Contact page

Three things were missing and are now rebuilt:

- **Both forms.** `CF7_RE` in migrate.py only matched numeric shortcode ids
  (`id="(\d+)"`), but these forms use hashes (`ad4dec2`, `7d59c66`), so neither
  shortcode was ever converted and both rendered as literal text on the page.
  The pattern now accepts `[\w-]+`, and the field sets mirror live: name /
  email / message for the enquiry form, service / user count / name / phone /
  email for the quote form. Neither can submit until a form endpoint is
  connected -- both carry a note saying so.
- **The map.** `wpmapblock/wp-map-block` is another dynamic block. Its
  attributes carry the marker (50.903689614642644, -1.3970843554852768,
  "F One Technologies"), zoom 16 and height 1000px, and the block's own
  `map_type` is "GM", so `gbrender.py` renders a Google Maps embed at those
  coordinates. It belongs inside `gb-container-59df0676` -- the empty container
  between the two forms -- which is where live shows it.
- **Form labels.** Both forms sit in sections whose text colour is orange;
  labels inherited it and were unreadable on the deep blue. Live avoids this by
  using placeholders with no visible labels, so the labels are given an explicit
  colour instead, keeping them for accessibility.

## Deliberate divergences from live

From this point the static build is **prod-only** — changes are no longer
mirrored to the live WordPress site, and live is a design reference rather than
a parity target. Anything listed here is intentional.

### 1. Button spacing (`style.css`)

```css
.site-main a.gb-button,
.site-main .gb-button-wrapper a,
.site-main .wp-block-button a { margin-top: 20px; }
```

Live has no equivalent rule: every button there ships with `margin-top: 0`, so
in-page buttons sit flush against the paragraph above them. Requested change.

- Scoped to `.site-main`, so the fixed header bar CTA and the footer are
  untouched.
- In-page buttons go 0px → 20px. Hero buttons already get 20px from their
  container's `row-gap`, so they land at 40px.
- Uses `margin-top`, not `padding-top`: padding would grow the button box and
  push the label off centre, and would have to override the eight per-instance
  padding values.

**Not yet applied to live.** To keep the two in step, paste the same rule into
WordPress → Appearance → Customise → Additional CSS.

### 3. Footer (`style.css`)

Live's footer runs 12px/18px type with no per-item margin; prod had 16px
headings, 14px links and an 8px gap per `<li>`, making it 777px against live's
507px. Now matched, plus `line-height: 18px` on the `li` itself -- it inherits
body's 1.5 and the strut sets the line-box floor regardless of the anchor.
`margin-top` is 0 so the client-logo band runs into the footer, as on live.

### 4. "Proud to Support These Businesses" band (`style.css`)

Bottom padding forced to 0 on `gb-container-55e4be16` and its section wrapper.
Live stacks two 50px paddings there (100px of dead space); this is tighter than
live by request.

### 5. Default button colour (`style.css`)

The `.gb-button` fallback -- what a button with no per-instance CSS inherits --
was purple, an accent colour. It is now `--brand-btn-bg` (F One orange), so newly
authored buttons come out on-brand.

### 6. Carousel controls (`carousel.css`, `main.js`)

Dots are white -- translucent when idle, solid when active -- with a faint dark
ring so they stay visible on the one carousel that sits on white. The original
flat `rgba(0,33,53,.18)` vanished on the coloured sections, leaving only the
active dot showing.

### 7. Client feedback slider (`carousel.css`)

Dots are hidden on this carousel (`.testimonial-slider .slick-dots`).

The soft shape behind each quote is `.f_one_testimonial::after` -- a radial
gradient at `top: 50px; z-index: -1`, sized `height: 100%` of the card. It was
landing well below the card because the card was stretching to the full 500px
slide height (live: 298px, hugging its content), pushing the gradient's centre
to ~350px instead of tucking it under the 234px quote.

The stretch came from `carousel.css`'s own
`.wp-block-cb-carousel .slick-slide > div { height: 100% }` -- the card is that
direct child. That rule is wanted for the equal-height card carousels, so the
override is scoped to this slider and made specific enough to outrank it. The
slides themselves stay a uniform 500px, as on live, so the carousel does not
jump between quotes of different lengths.

### 8. Headline paragraph spacing (`style.css`)

`p.gb-headline` was pinned to `margin: 0`, which flattened spacing live leaves
in place -- most visibly between a testimonial quote and its attribution (0px
here against live's 16px). It is now `margin: 0 0 1rem`, matching theme.css's
default for `<p>`; per-instance generated CSS still overrides it where a
particular headline needs something else. Measured on the homepage, 28 of 35
headline paragraphs now land on exactly live's 16px.

`main.js` sets `waitForAnimate: false` when initialising Slick -- the default
swallows drags and clicks until the current transition ends, and with autoplay
running a 1000ms transition every 3s the track was unresponsive much of the
time. Clicking the outer 15% of either edge steps the carousel, ignoring clicks
on links/buttons and on the click Slick emits at the end of a swipe.

### 2. Blog index and post hero

The static build's blog index is a simplified rebuild (no search block, not
full-viewport-height). Its colour treatment matches live — dark hero, white
heading, plain white category links — but the structure is not a pixel match.

## Verifying against live

`_build/visual_audit.py` captures matched screenshots and computed styles from
both sites. It uses an installed Chrome if present, otherwise Playwright's
bundled Chromium (`python -m playwright install chromium`).

Colour parity was last verified across 24 pages with zero mismatches.
