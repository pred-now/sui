# app

The Next.js app shell for the docs site. This folder holds the framework wiring, not the
documentation text. The text lives in `../content`.

## Files

- `[[...mdxPath]]/` A catch-all route. Any URL maps to a Markdown file in `content/` and is
                    rendered here. One small route serves the whole site.
- `layout.tsx`      The shared page layout: the sidebar, the top bar, the theme, and search.
                    It pulls the page tree from `content/`.
- `globals.css`     Global styles.
- `favicon.ico`     The browser tab icon.
