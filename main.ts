// Survivor + crowd paper bot for the pump.fun replay.
//
// Run by the grader as `node /bot/main.ts` with this directory mounted at /bot.
// Reads hello / batch / done JSON lines on stdin (protocol agent-fun/replay/v2),
// writes one reply line per batch. Node 22.18+ runs this TypeScript as-is.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
