# economics

The house engine simulation. It models how Pred prices and matches bets, and how the
treasury carries the small leftover imbalance, then measures the cost and the risk across
many random markets. The settings it lands on are the ones the server uses in
`server/lib/econ.ts`.

## Files

- `sim.ts`           The simulation. Runs the house engine over random markets and reports
                     the spread captured, how much is matched internally, and how much the
                     treasury has to carry.
- `plot.py`          A small Python script that turns the results into a chart.
- `requirements.txt` The Python packages the plot needs.
- `results.json`     The saved numbers from a run.
- `results.png`      The saved chart.
- `tsconfig.json`    TypeScript settings for the sim.

## Running

```bash
pnpm install
pnpm tsx sim.ts          # run the simulation, writes results.json

# optional chart
pip install -r requirements.txt
python plot.py           # reads results.json, writes results.png
```
