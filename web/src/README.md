# src

All of the frontend source. Three folders do most of the work.

- `app/`        The pages and the root layout. Next.js maps folders here to URLs.
- `components/` The React components. This includes the providers that hold shared state
                (auth, markets, trading) and the reusable UI pieces.
- `lib/`        Plain TypeScript: API calls, shared types, and the client-side math for
                pricing and position values.
- `hooks/`      Small reusable React hooks.

State flows top down. The providers in `components/` connect to the backend (REST and the
socket) and expose data and actions through React context. The pages and components read
from those providers, so most files stay simple and declarative.
