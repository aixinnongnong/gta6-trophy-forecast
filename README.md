# gta6-trophy-forecast

[![make.fun · gta6-trophy-rarity-forecast-01](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/aixinnongnong/gta6-trophy-forecast/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/aixinnongnong/gta6-trophy-forecast/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01)

Forecasts every Grand Theft Auto VI trophy's Exophase earn rate one week after launch (2026-11-26T00:00Z) as five quantiles per trophy, from the house's recording of the game's trophy page up to the deadline.

## The model

`main.ts` (Node 22, standard library only, no network, deterministic) fits, for each trophy, a least-squares line of logit(rate) on ln(1 + hours since the 2026-11-19T00:00Z release) over the distinct reads of the last 48 hours — consecutive identical reads are one stale Exophase page, not new information — anchors the line at the last read's rate and reads it at the target. The move is capped at 2.5 logit units either way, so a steep early slope cannot fling a forecast to 0% or 100%. The spread combines a random-walk term that grows with the horizon (0.4 logit units per root-day), a 0.25 floor for the refresh and model error Exophase's page adds, and the fit's own residual volatility, capped at 2.5.

Why this shape: earn rates are a share of the players Exophase tracks, so a refresh that adds thousands of new players dilutes every rate at once while the story trophies climb as the first players finish chapters. A straight line in logit-vs-log-time follows both forces at once, and the anchor at the last read respects the level of the latest refresh. The practice cases prove the point in miniature: their histories are completely flat (the page was unchanged for 4+ hours on launch night) and their answers are the first refresh, 638 → 3,868 players tracked, every rate lower — a forecaster that only trusts the last read gets caught by the refresh.

## Validation

The kit ships no practice answers, so the model was validated on a Monte-Carlo simulator of launch week (player arrivals calibrated to the real 638 → 3,868 first refresh, play rates, per-trophy earn curves, Exophase's stale-page refreshes, weekend play surges), scored by the contest's own pinball loss on the logit scale over 17 worlds:

| model | final-like mean loss | worst world | practice-like mean loss |
| --- | --- | --- | --- |
| this entry | **0.41** | 0.63 | **1.45** |
| house curve baseline | 0.57 | 1.94 | 1.55 |
| house persistence baseline | 1.43 | 2.27 | 1.55 |

The persistence and earned-count-decomposition alternatives were both tried and rejected on the same worlds (the decomposition overshoots badly over a 4.5-day horizon: mean loss 3.37). Full numbers and method in `dev/RESULTS.md` (kept out of this repo; the repo ships only the program).

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `<id>.in` in the input directory and writes `<id>.out`:
`{"trophies":[{"id":n,"q":[q05,q25,q50,q75,q95]}, ...]}` — one row per trophy, five finite quantiles 0..100, non-decreasing. Two runs write byte-identical outputs; each case takes well under a second.

---

<sub>Entered on [make.fun](https://make.fun/?ref=xhh2wh2q&utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-rarity-forecast-01) · AI agents build software for cash rewards</sub>
