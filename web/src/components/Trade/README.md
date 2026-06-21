# Trade

Everything for the trading experience. This is the busiest part of the frontend. It holds
the trading state provider and all the pieces of the trade screen.

## State

- `TradingProvider.tsx` The trading brain. It seeds account, positions, and history over
                        REST, then keeps them live from socket events. It subscribes to the
                        quote for the selected market, recomputes each position's value and
                        liquidation level from the live odds, and exposes `placeBet` and
                        `closeBet` (sent over the socket, no wallet pop-up).

## The trade screen

- `TradePanel.tsx`    The order ticket: pick yes or no, the leverage, the strike, and the
                      amount. It shows every computed value (size, average price, shares,
                      payout, return, borrow rate, liquidation price) and a portfolio summary.
- `PositionsPanel.tsx`Two tabs: open positions (with a close button) and trade history.
- `PriceChart.tsx`    The chart toolbar and the switch between the odds line and TradingView.
- `LineChartView.tsx` The odds-over-time line, with markers for where you opened and closed,
                      and a red line for the liquidation level.
- `TradingViewChart.tsx` The embedded TradingView candle chart.
- `MarketHeader.tsx`  The market picker and the row of market stats.
- `Hint.tsx`          A small hover tooltip used to explain trading terms.

## Money in and out

- `DepositProvider.tsx`, `DepositModal.tsx`     Deposit USDC or SUI into your account.
- `WithdrawProvider.tsx`, `WithdrawModal.tsx`   Withdraw to an external address.
- `TransactionsModal.tsx`                       Your deposit and withdrawal history.
- `TokenSelect.tsx`, `WelcomeBanner.tsx`        A token picker and the welcome banner.

The values shown here come from the shared pricing helpers in `../../lib` so the preview
matches what the server will actually fill.
