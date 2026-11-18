# Music Journal design system

A private journal for the music you listen to. Teenage Engineering-inspired: white, black and neutral greys with one signal orange, set in **Allo**, a friendly variable sans. Components are **shadcn/ui** built on **Base UI** primitives (shadcn's `vega` style), themed only through the tokens below. Light and dark themes.

This is the default design system for all existing screens and future features.
Source: [Music Journal design system](https://claude.ai/artifact/1q7WDwqqA5LMR9CBf8FWi4#readme), adopted 2026-11-17.

## Implementation and contribution workflow

1. Read this guide before adding, changing or reviewing UI.
2. Reuse `components/ui/` primitives. `components.json` selects shadcn **base-vega**; add missing components with `npx shadcn@latest add <name>`. Use Base UI, never Radix. Review generated files against this guide before using them.
3. `app/globals.css` is the source of truth for tokens, font faces, typography and the TE layer. Use token utilities (`bg-background`, `text-muted-foreground`, `border-input`) or these variables in shared CSS. Keep literal colours in token definitions only. `@theme inline` maps the palette and radii into Tailwind 4.
4. Reading type uses self-hosted Allo Friendly; controls and metadata use self-hosted Geist Mono. Font files and OFL licenses live in `public/fonts/`. Allo italics include the reading weights 400–700. No remote font service is required.
5. Forms use FieldGroup, Field, FieldLabel and Input. Preserve label associations, field names, validation, server actions, pending labels and error/status announcements. Hidden fields remain native. Set `type="submit"` explicitly on form buttons; Base UI defaults to `button`.
6. Use Card with CardHeader, CardTitle and CardContent for grouped surfaces. Keep semantic sections and heading levels. Plain navigation links remain links; page navigation is not an interactive Tabs widget.
7. Use one orange primary action per view, neutral secondary save controls, destructive removal controls, and ghost sign-out. Long control labels wrap rather than overflow.
8. For simple GET forms, use the registry NativeSelect to retain browser keyboard, required-field validation and server submission behavior. Custom popups use the Base UI Select from the same registry when needed.

### Theme behavior

Light uses the exact reference `:root` tokens. Dark uses the reference values under `.dark`; the app also follows `prefers-color-scheme` by default. `.light` on `<html>` forces light, `.dark` forces dark. Keep both palettes updated together. New components must work in both themes. There is no persisted theme preference control.

### Review before shipping

- Reuse a primitive and a semantic token for every new control/surface; add shared variants in the primitive, not per-page overrides.
- Check light and dark, keyboard focus and submission, disabled/pending/error/empty states, long titles and names, and 320px width without horizontal scrolling.
- Keep input text at least 16px on touch screens to avoid browser zoom; coarse pointers get at least 44px controls. Desktop controls default to 36px; primary actions use 40px.
- Preserve ISO listen dates, listener privacy, accessible names and domain vocabulary.
- Run `npm run typecheck`, `npm run build` and `npm test`. The design-system tests cover font loading, theme colours, focus and mobile layout; existing tests cover product flows.
- When intentionally changing a foundation or adding a reusable pattern, update this guide and the shared implementation together. Explain the deviation from the reference in the change description.

## Colour

- The look is instrument-like: mostly white, black and grey, with orange as a small, deliberate signal. If a screen looks orange, there is too much of it.
- `background` is the page: plain white in light, black in dark. `card` and `popover` are white in light (a 1px ring and a small shadow set cards apart) and lifted one step in dark.
- `foreground` for text; `muted-foreground` for anything secondary: descriptions, metadata (Artist · Year), hints, placeholders, empty states.
- `primary` (signal orange) is the only brand colour and is a FILL, never text: the one main action per view, checked Checkbox and Switch, the 2px underline under links, focus rings, small markers. Text on orange is always `primary-foreground` (black), never white. Don't set orange text or headings on white (3.1:1).
- Links are `foreground` text with an orange underline (Button `variant="link"`). In an app, style plain `<a>` the same way: `underline decoration-primary decoration-2 underline-offset-4`.
- `secondary`, `muted` and `accent` are neutral greys: secondary buttons, quiet fills, hover and highlighted items. None of them is a brand colour.
- `destructive` is a deep red, for errors and removal only; it is much darker than the orange, so the two don't read as the same signal. Destructive buttons and badges are a soft red tint with red text. Always pair it with a clear verb (Remove, Delete).
- `border` is a hairline and purely decorative. Control boundaries use `input` (3:1 or more on every surface in both themes).
- Focus is always visible: `ring-ring/50` at 3px plus a solid orange `border-ring`. Don't remove outlines.
- The reference text pairs pass 4.5:1 in both themes (foreground about 19:1, muted-foreground 4.9:1 or more, black on orange 6.3:1, destructive on its tint 4.5:1 or more).

## Type

- Two families with fixed jobs. **Allo** (`--font-sans`) is for what people read: headings, body text, input values, album and artist names, dialog copy. **Geist Mono** (`--font-mono`) is for what the interface says: control labels, tags, metadata, numbers.
- `control` (12px mono, medium, UPPERCASE, +0.05em tracking) labels every Button, Tab and form Label. `tag` (11px, same treatment) is for Badges, tooltips, Select group labels and small eyebrows above sections. Both are uppercased by CSS: write them in sentence case in the source so screen readers read words, not letters.
- `meta` (12px mono, mixed case, tabular figures) is for data: Artist · Year, listen dates (2026-11-12), counts, durations. Dates are always ISO `YYYY-MM-DD` in mono.
- Never set reading text, headings or anything longer than one line in mono caps.
- Allo changes its optical size with the font size (`font-optical-sizing: auto`), so large headings get the tighter Display cut automatically. Don't override `opsz`.
- Headings (Allo): `h1` 36px bold, `h2` 30px semibold, `h3` 24px semibold, `h4` 20px semibold, slightly tight tracking. `display` (60px) is for the wordmark and hero only.
- Text (Allo): `body` 16/28 for reading, `lead` under a page title, `large` for an emphasised line, `small` 14px for helper text in `muted-foreground`.
- Weights in use: Allo 400–700, Geist Mono 400–500. Avoid Thin–Light at text sizes.
- Use the product's vocabulary: Listener, Journal, Catalog, Album, Artist, Want to Listen, Saved Artists, Discover. Avoid "library", "profile", "playlist".

## Shape, space, depth

- Corners are tight, like an instrument panel. Radius comes from one `--radius` (0.25rem): `radius-sm` checkboxes and items, `radius-md` buttons, fields, the Select popup and tooltips, `radius-xl` cards and dialogs, `radius-4xl` keeps badges as pills, full circles for avatars and switches. Don't round cards or buttons further.
- Spacing is Tailwind's 4px `--spacing`. Fields stack at `space-4`; label to field `space-2`; cards pad `space-6`; sections are `space-8` apart.
- Depth is light: cards use a 1px `foreground/10` ring and the smallest shadow, popups add a medium shadow, the dialog overlay is a 10% black wash with a slight blur. No heavy shadows, no gradients.
- Buttons, inputs and Select triggers are 36px tall by default (`h-9`); use `size="lg"` (40px) for primary actions on touch screens, and keep `xs`/`sm` sizes for dense desktop toolbars.

## Components

Catalog artwork uses a shared square frame with `muted` fill, a `border` edge, and `radius-lg` corners. Rows use a 64px frame. Album detail artwork scales to the available width up to 256px. Keep the frame in place for loading, success, and missing artwork. The loading skeleton observes reduced-motion preferences. Missing artwork uses a disc or person icon and a text label. Artist image credits sit with the artist name and link to the file and license.

Installed: Button, Input, Label, Field, Card, NativeSelect and Separator. The reference also defines Textarea, Badge, Checkbox, Switch, Select, Tabs, Dialog, Tooltip and Avatar; add them from the same Base UI registry when a feature needs them. Apply the TE typography layer to new controls, tags and metadata in the shared stylesheet.

## Credits and sources

- Components: shadcn-ui/ui at `968d8cb` (`apps/v4/registry/bases/base/ui`, style `vega`), on `@base-ui/react` 1.9.0, compiled with Tailwind CSS 4.3.5.
- Fonts: Allo 1.0.1 by Josh Puckett (joshpuckett/allo at `750182d2`) and Geist Mono 1.9.2 by Vercel and basement.studio (npm `geist`), both SIL Open Font License 1.1; see `public/fonts/licenses/`.
- Palette: white, black and neutral greys with a signal orange, after Teenage Engineering's product look. Link variants are restyled from shadcn's (orange underline instead of orange text) for contrast.

## Scope

Chart and sidebar tokens are not defined until those components are needed. Shadows use Tailwind defaults. Only the Allo Friendly WOFF2 cut ships; the larger adjustable-roundness TTF is not needed.
