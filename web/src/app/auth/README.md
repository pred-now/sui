# auth

The login routes. Pred lets people sign in with Slush, Enoki, or Privy. After they sign in
with the provider, the provider sends them back to a page under here.

- `callback/` The landing page the provider returns to. It finishes the login and stores
              the session.
