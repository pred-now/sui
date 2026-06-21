# docs

The Pred documentation website. It explains the product and the economic model in plain
English, from "what is a prediction market" up to the exact pricing and solvency math.

It is built with Next.js and Nextra. The words live in `content/` as Markdown files, and
Nextra turns them into a browsable site with a sidebar and search.

## Folders

- `app/`     The Next.js app shell. A single catch-all route renders any Markdown page,
             plus the shared layout and styles.
- `content/` The actual documentation, written as `.mdx` files and grouped into sections
             (basics, economy, lp-pool, technical). The `_meta.js` files set the order and
             titles in the sidebar.
- `public/`  Static images, like the Pred logo.

## Running it

```bash
pnpm install
pnpm dev      # serves the docs on :3000
pnpm build    # builds the static site
```

## Editing

To change the docs, edit the `.mdx` files in `content/`. To add a page, drop a new `.mdx`
file in the right section and add it to that section's `_meta.js` so it shows in the sidebar.
