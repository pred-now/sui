# callback

The page a login provider returns to after sign-in.

It reads the credential the provider sends back, hands it to the backend to exchange for a
Pred session token, stores that session, and then sends the user on to the app. If the login
fails it shows an error and a way back to try again.
