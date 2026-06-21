# [[...mdxPath]]

A catch-all route. The double brackets mean it matches any path, including the home page.

When someone opens a docs URL, this route takes the path, finds the matching Markdown file
in `../../content`, and renders it with the shared layout. Because it handles every path,
the whole site is served by this one small file. You do not add a route per page. You just
add a Markdown file in `content/`.
