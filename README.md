# AI, Explained

A calm, static blog for teaching people how AI actually works. Plain HTML, CSS and vanilla JavaScript — no build step, no framework, no backend. Deploys directly to GitHub Pages.

## Project structure

```
index.html          the app shell (sidebar, layout, containers)
style.css            the entire design system (light + dark themes)
script.js             all behaviour: routing, markdown parsing, search, highlighting…
blogs/
  manifest.json      list of blog filenames, newest or oldest order doesn't matter
  2026-07-23-what-is-ai.md
  2026-07-30-how-ai-answers-questions.md
  2026-08-06-why-ai-makes-mistakes.md
```

## Adding a new blog post (the only maintenance step)

1. Create a new Markdown file in `blogs/`, e.g. `blogs/2026-08-20-my-new-post.md`.
2. Add front matter at the top:

   ```yaml
   ---
   title: "Your Post Title"
   date: "2026-08-20"
   description: "One sentence describing the post."
   category: "AI Basics"
   author: "Your Name"
   ---
   ```

3. Add the filename to `blogs/manifest.json`:

   ```json
   [
     "2026-08-20-my-new-post.md",
     "2026-07-23-what-is-ai.md",
     "2026-07-30-how-ai-answers-questions.md",
     "2026-08-06-why-ai-makes-mistakes.md"
   ]
   ```

That's it. The site figures out the rest: whichever post has the newest `date` becomes the featured post, everything else moves into the archive, and any new `category` values show up automatically.

### Why a manifest file, instead of fully automatic discovery?

GitHub Pages only serves static files — there's no server-side code to ask "what files exist in this folder?" at runtime, so a page can't truly auto-discover new files on its own. `manifest.json` is the smallest possible workaround: one line per post, no metadata duplicated, nothing to keep in sync besides the filename itself. It's about as close to "just drop in a file" as static hosting allows.

## Features included

- Automatic latest-post / archive / category logic driven entirely by front matter
- Client-side Markdown rendering (headings, bold/italic, links, images, lists, blockquotes, code, fenced code blocks, tables, horizontal rules)
- Sidebar navigation that becomes a slide-out menu on mobile
- Automatic "On this page" table of contents, built from `##`/`###` headings **and** standalone bold lines (e.g. `**Like This**`), with scroll-spy highlighting
- Bookmarkable articles and sections via the URL hash (`#/blog/<id>` and `#/blog/<id>/<section-slug>`)
- Text highlighting saved in `localStorage`, restored on return visits, with per-article "My Highlights" management (jump / remove / clear all)
- Client-side search across titles, descriptions, categories and full article text
- Subtle reading-progress indicator
- Light/dark theme toggle that respects system preference and remembers your choice
- Friendly fallback states for missing files, broken images, invalid dates, and highlights that can no longer be located

## Customizing

Nearly everything you'd want to change lives in one of two places:

- **`style.css`**, top of the file: CSS variables for colors, fonts, sidebar width, etc.
- **`script.js`**, top of the file: the `SITE_TAGLINE` constant, and the nav labels in `index.html`'s `<nav class="main-nav">`.

## Testing before you publish

Because this is a fully static site, you can preview it locally with any simple file server, for example:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Opening `index.html` directly by double-clicking it will *not* work in most browsers, since `fetch()` requires an actual HTTP server (this is also true once it's live on GitHub Pages, so it isn't a concern there).
