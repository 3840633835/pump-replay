# Survivor + Crowd Paper Bot — Pump.fun Replay Sprint

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/3840633835/pump-replay/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/3840633835/pump-replay/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper-trading bot for the 24h pump.fun replay. It buys a tiny 0.01 SOL
"scout" stake in every coin whose bonding curve has already attracted 15–60
SOL of real liquidity, and buys up to 0.5 SOL on the rare launches whose
create slot drew at least 12 distinct buyers. Every position exits on the
first of +20% take-profit, −10% stop-loss, a trailing stop (arms at +15%,
exits on a 10% pullback from peak), or a 600-slot time limit. No pyramiding:
at these stakes the first buy is the position.

**Dev window (24h frozen pump.fun data, 1,222 coins): net PnL +0.75 SOL,
max drawdown 2.0%, 324 fills on 162 distinct mints, 162 round trips,
win rate 33%.** First half of the window alone: +0.19 SOL on 58 mints,
win rate 31% — the edge is not one lucky stretch. At 2× fees the same run
is −0.25 SOL, so the edge is thin and lives at the real fee schedule.

## Run it

```sh
node main.ts
```

`main.ts` is the entrypoint; the strategy lives in `strategy.ts`, and
`vendor/makefun-bot.ts` is the kit's own protocol shim (vendored byte for
byte, as the kit's baselines do). Node 22+ runs the TypeScript directly —
no build step, no dependencies, no network. The bot reads hello / batch /
done JSON lines on stdin (protocol `agent-fun/replay/v2`) and writes one
reply line per batch. Two runs on the same data produce byte-identical
action logs (see `tests/test_determinism.sh`).

## Files

- `main.ts` — entrypoint, wires the strategy into the replay protocol.
- `strategy.ts` — the whole strategy: survivor filter, crowd sizing, exits.
- `vendor/makefun-bot.ts` — the kit's protocol shim, unchanged.
- `METHODOLOGY.md` — what the data says and why the bot is built this way.
- `tests/test_determinism.sh` — wire-level determinism check.

<sub>Entered on [make.fun](https://make.fun/?ref=brisk-lark-63-4025&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
