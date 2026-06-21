# components

The React components. Two kinds of things live here: providers that hold shared app state,
and the visible UI pieces.

## Providers (the state layer)

- `AuthProvider.tsx`    Holds the session: the logged-in user and token, login, and logout.
- `MarketsProvider.tsx` Opens the socket (carrying the session token), tracks the live
                        markets, the selected market, and the chosen strike, and exposes the
                        socket for the trading layer.

## Folders

- `Trade/`  The trading experience: the trade panel, the positions and history tables, the
            chart, the deposit and withdraw flows, and the trading state provider.
- `Header/` The top bar: navigation, the live balance, and the account menu.
- `Footer/` The bottom bar.
- `auth/`   The login modal and the third-party auth providers wrapper.
- `ui/`     Small, reusable, unstyled-ish building blocks (buttons, inputs, tables, dialogs).

Pages and components read state from the providers, so they stay focused on layout and
display.
