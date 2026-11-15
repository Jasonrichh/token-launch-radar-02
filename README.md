# Token Radar 3 — make.fun bounty entry (token-radar-01)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Jasonrichh/token-launch-radar-02/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Jasonrichh/token-launch-radar-02/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A dashboard that finds pre-token protocols in a sealed DefiLlama snapshot, ranks them by
implied value, and shows how to farm each one — with the value model fitted on the
snapshot's own live-token protocols and tested out of sample before it prices anything.
Built for the make.fun bounty "Build the best token launch radar" (deadline Mon 14 Dec
2026 18:00, $1,325 in prizes). A second, independent entry: the first ("Token Radar",
model radar-2) used median category multiples; this one fits a size curve instead.

## The model (radar-3)

`implied = round(10^(a + b x log10(TVL) + category offset) x growth multiplier x maturity multiplier)`

- **Size curve** — `log10(market cap) = a + b x log10(TVL)`, ordinary least squares over
  the live-token protocols that record a market cap above zero (exchanges excluded). On
  this snapshot: `a = 3.382, b = 0.472, R² = 0.143, n = 119`. A bigger protocol's token
  is worth more than a smaller one's, but only as roughly the square root of its size —
  and the dashboard says plainly that TVL alone explains little. The curve is a
  yardstick, not a price.
- **Category offset** — each category's mean residual from the curve, shrunk by
  `n / (n + 5)` and clamped to ±0.4 in log10 (a factor of 0.4x to 2.5x). Categories with
  fewer than 3 live samples get no offset. Computed from the snapshot at run time.
- **Growth multiplier** — `1 + 0.35 x tanh(clamp(change_7d, -80, 400) / 50)`. A 7-day
  surge lifts the value, a slide cuts it; tanh keeps a +4,448% outlier from counting
  more than a strong +120% run. A bounded judgement term, stated as one.
- **Maturity** — `0.90 + 0.10 x min(age_days, 1460) / 1460` (unknown age: 365 days). A
  protocol that has run a long time with no token is a little overdue for one. Kept
  small on purpose: the live-token fit finds age pulls multiples slightly down.

## How the curve was tested

Both tests are computed from the snapshot at run time and printed on the dashboard:

- **Leave-one-out** — refit the curve (and the left-out protocol's category offset)
  without each live protocol in turn, predict its market cap, and report the median
  absolute log10 error and the share of predictions within 2x of the truth.
- **Time split** — split the dated live protocols at their median listing date, fit on
  the earlier half, test on the later half: the curve prices listings it has never
  seen. Same two numbers as leave-one-out.

## The board and the farm plans

The board covers the whole 40-protocol watchlist plus every other rankable pre-token
protocol below the floor (226 rows on this snapshot), with an 8-step farm plan per row:
wallet setup, the category's main action, a second qualifying action, weekly cadence,
a points-page check, the hold, claim safety, and a netting step. Each step states its
cost and its time, and the last step nets the whole plan to the dollar: capital plus
gas over every transaction the plan asks for, the total out of pocket, and the
break-even share — the basis points of the implied value a launch would have to pay
the farmer for the farm to cover its own cost. The dashboard's Live token view runs
the same curve over the tokens that already trade, so a reader can see where the
curve reads high and where the market pays more than size alone explains.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Node 22.18+ (type stripping, standard library only). The program reads the snapshot,
fits the curve, writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/`,
and writes `dossier.json` with the vendored make.fun library. Two runs produce
byte-identical output.

## Layout

- `main.ts` — the program: reads the snapshot, scores the board, writes the outputs.
- `lib/model.ts` — the radar-3 model: the size-curve fit, its two tests, the implied
  values, the farm economics and the farm plans.
- `vendor/makefun-board.ts` — the make.fun dossier library, byte for byte from the kit.
- `dashboard/` — the static page (index.html, app.css, app.js), no network, no framework.
- `screenshots/` — the board, a protocol's detail view, and a filtered view, rendered
  in headless Chromium at 1440x900 from this dashboard's own files.
