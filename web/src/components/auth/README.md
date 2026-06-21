# auth

The sign-in UI and the third-party auth wiring.

- `Providers.tsx` Wraps the app with the libraries that power login and on-chain reads:
                  the Sui wallet kit, the React Query client, Privy, and Pred's own
                  `AuthProvider`, plus the deposit and withdraw providers.
- `LoginModal.tsx`The sign-in dialog. It offers the available login methods (Slush, Enoki,
                  Privy) and starts the chosen flow.

After login, the session itself is held by `AuthProvider` one level up in `../`.
