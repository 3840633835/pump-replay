# Methodology — Survivor + Crowd Paper Bot

Competition: **Pump.fun Replay Sprint — Paper Bot, Real Ranking**
(`u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122`). One strategy program
(`main.ts` + `strategy.ts`, Node 22+) trades 10 SOL of paper money on a 24h
pump.fun replay. Places go by **net PnL**, best first; a placement reward needs
**net PnL > 0** after every fee. Guardrails: max 5 open positions; round trips
≥ 0.01 SOL on ≥ 20 distinct mints; max drawdown 50%; deterministic (two
executions produce byte-identical action logs); no network.

## What the data says (dev window: 2026-11-02 03:09 → 2026-11-03 03:09 UTC)

The kit's frozen window holds 128,058 events, 126,801 trades, 1,222 mints,
35 completions. Fees are 95 bps protocol + 30 bps creator = 125 bps per side,
plus a fixed 105,000 lamports (0.000105 SOL) per order; ~2% of orders fail and
still pay the tx fee. A round trip on a 0.01 SOL stake costs ~4.6%; on a
0.05 SOL stake ~2.9%. The 1%-of-real-reserve cap limits each buy to 1% of the
curve's real SOL reserve, so stake size is bounded by how much real liquidity
a coin has attracted. The harness fills orders 2 slots after they are decided.

Key measurements (all net of fees, fill +2 slots):

- **Buy-and-hold loses everywhere.** Median return from first real SOL ≥ 1:
  −4.7% after 30 slots, −14% after 150, −22% after 600. Only 2–4% of coins
  end positive. Most pump.fun coins are a one-way trip down.
- **The 2-slot fill latency kills momentum entries.** A momentum signal that
  wins 56% / loses 35% with instant fills goes to 15% / 78% with a realistic
  +2-slot fill delay. Bursts happen inside a slot; the bot only ever sees
  slot-end prices, so it buys the top of the burst. My own momentum build
  (selective entry on inflow + rising price, TP +50–100%, SL −25%, pyramid
  to 0.3 SOL) lost −0.74 SOL on the dev window at a 20% win rate; a pure
  early "sniper" variant lost −1.09 SOL at 6% wins.
- **Completions cannot be ridden.** Every completing coin graduates in the
  same slot it is created, via pre-arranged buys totalling ~85 SOL. There is
  no "pre-KOTH" trade: by the time a coin looks close to completing, it has
  already completed. A "ride to completion" build lost −2.16 SOL with 0 wins
  in 19 trips — its 5 slots clogged on coins that never completed.
- **The oracle upper bound is real but narrow.** Buying at first real ≥ 1 and
  exiting at the best point within 6h: median +5.7%, p75 +34.8%, p90 +100%,
  p99 +440%. 10% of coins more than double. The money is in a few coins —
  but only if you hold them through pullbacks, which tight scalping never
  does, and only if you can tell them apart before the fact.

## The shape that works: survivor filter + crowd sizing + cheap breadth

Three moves, each verified separately on the dev window with the kit's own
local engine port:

1. **Enter late, not early.** Entering only once real liquidity reaches
   15–60 SOL (a survivor filter — most coins die before that) raises the win
   rate from ~18% to 26–39% and cuts drawdown to ~2%. Entering at real ≥ 20
   with TP 20% / SL 10% was the single best cell (+0.78 SOL, 95 coins,
   39% wins); the shipped 15–60 range keeps more breadth (162 coins) at
   nearly the same PnL (+0.75 SOL, 33% wins).
2. **Size on the crowd, not on the pump.** The one entry signal with a
   positive short-horizon mean in the dev data: **≥ 12 distinct buyers in
   the create slot** (n = 17 coins in 24h, median +4.2%, mean +4.6%, 65%
   positive). A crowded launch is an organic launch — many wallets, not a
   bundle. The bot buys up to 0.5 SOL on crowded launches (capped at 97% of
   the 1% rule, so 0.15–0.58 SOL in practice), and the minimum viable
   0.01 SOL on everything else.
3. **Make the breadth cheap.** Non-crowded entrants get 0.01 SOL — just
   enough to count toward the 20-mint guardrail. Their losses are tiny; the
   crowded launches carry the P&L. Raising the scout stake to 0.02 SOL cost
   0.10 SOL of PnL; to 0.05 SOL cost 0.67 SOL.

Exits: take-profit +20%, stop-loss −10%, trailing stop (arms at +15%, exits
on a 10% pullback from peak), 600-slot time limit. No pyramiding — the sweep
showed adds only buy the top. The fade exit (sell on a −0.5 SOL net sell wave
over 15 slots) was tested and left OFF: disabling it gained +0.16 SOL, so
the shipped config sets its threshold where it never fires; the time limit,
stop and trail still bound every position's downside.

Two engineering details mattered more than any parameter:

- **Sells must be sized to what the curve can pay.** The harness rejects a
  sell whose quote-out exceeds the curve's real SOL reserve. The bot solves
  for the largest sellable token amount (`realizableSale`) and sends no order
  when nothing is sellable, instead of retrying a doomed order every batch.
- **A sent sell is not a filled sell.** The bot keeps a position tracked
  until its sell fill (or a harness close) arrives, and re-sends on a
  rejection — otherwise rejected sells orphan the position and clog a slot
  for the rest of the run. An earlier build lost exactly this way: five
  orphaned positions, five coins traded all day.

## Final parameters

| Parameter | Value |
|---|---|
| Entry: real SOL at entry | 15–60 SOL |
| Scout stake / crowded stake | 0.01 SOL / up to 0.5 SOL, capped at 97% of the 1% rule |
| Crowd threshold | ≥ 12 distinct buyers in the create slot |
| Creator-sold filter | skip if the creator sold |
| Max single-sell guard | skip if any single sell ≥ 5 SOL in the last 30 slots |
| Take-profit / stop-loss | +20% / −10% of cost |
| Trailing stop | arms at +15%, exits on a 10% pullback from peak |
| Time limit | 600 slots |
| Fade exit | off (threshold set where it never fires) |
| Max open positions | 5 (harness cap) |

## Backtest (kit's local engine port, dev window)

| Run | Net PnL | Fills | Coins | Trips | Wins | Max DD |
|---|---|---|---|---|---|---|
| Full 24h dev | **+0.752 SOL** | 324 | 162 | 162 | 53 (33%) | 2.0% |
| First half only | +0.192 SOL | 116 | 58 | 58 | 18 (31%) | 2.0% |
| Without failed txs | +0.741 SOL | — | — | — | — | — |
| At 2× fees | −0.252 SOL | — | — | — | — | — |

The edge is thin and lives at the real fee schedule: at double fees it goes
negative, so the final window's fees (same 95 + 30 bps schedule) are what
count. The first-half check shows the edge is not one lucky stretch of the
window. The final window is fresh data collected after entries close, so no
dev number guarantees a final result — but the shape (survivor filter +
crowd sizing + cheap breadth + tight exits) is chosen from flat regions of
the sweep, not single best cells: stop-loss 0.06–0.15 all land +0.68–0.75 SOL,
crowd stake 0.3–1.0 SOL all land +0.40–0.44 SOL on the pre-tuned base.

## Determinism

No clock, no randomness, no network: the only inputs are the hello seed and
the batch stream, and all state lives in insertion-ordered maps. Two runs
through the kit's local engine on the dev window produce byte-identical
action logs (335 orders, sha256 `748906a4ea85080f…`, net +0.752139154 SOL
both times). `tests/test_determinism.sh` repeats the wire-level check:
same stdin in, byte-identical replies out.
