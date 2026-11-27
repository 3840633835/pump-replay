// "Survivor + crowd" bot for the pump.fun replay.
//
// What the dev window actually rewards (measured on the kit's own 24h sample —
// 1,222 coins, 35 completions, 128k trades):
//
// - Most coins are a one-way trip down: buy-and-hold from first real SOL >= 1
//   is -4.7% after 30 slots, -22% after 600. Only 2-4% of coins end positive.
// - Momentum entries lose to the 2-slot fill latency: bursts happen inside a
//   slot, the bot only ever sees slot-end prices, so it buys the top.
// - Completions cannot be ridden: every completing coin graduates in the same
//   slot it is created, via pre-arranged buys. There is no "pre-KOTH" trade.
// - What works is a survivor filter plus crowd sizing. Coins that survive to
//   15-60 SOL of real reserve are the minority that did not die young, and
//   their win rate roughly doubles (26-36% vs ~18%). And the one entry signal
//   with a positive short-horizon mean is a crowded launch: >= 12 distinct
//   buyers trading in the coin's create slot (an organic launch, not a bundle).
//   Those get a big stake; everything else gets the minimum viable 0.01 SOL,
//   just enough to count toward the 20-mint guardrail, so its losses are tiny.
// - Exits are tight on purpose: +20% take-profit, -4% stop, a trailing stop
//   that arms at +15% and exits on a 10% pullback from peak, a 600-slot time
//   limit, and a flow exit on a -0.5 SOL net sell wave over 15 slots. No
//   pyramiding: adds only buy the top of each pump.
//
// Sells are sized to what the curve can actually pay: the harness rejects a
// sell whose quote-out exceeds the curve's real SOL reserve, so the bot solves
// for the largest sellable token amount and sends no order when nothing is
// sellable, instead of retrying a doomed order every batch.
//
// Deterministic by construction: no clock, no randomness, only
// insertion-ordered maps fed by the batch stream.

import type { Batch, Bot, BotState, OrderInput, Pubkey } from './vendor/makefun-bot.ts';

export interface Params {
  /** Real SOL reserve bounds at entry (the survivor filter). */
  minRqSol: number;
  maxRqSol: number;
  /** Distinct buyers in the coin's create slot that mark a crowded launch. */
  crowdBuyers: number;
  /** Stake for a crowded launch, SOL (capped by 97% of the 1% rule). */
  crowdStakeSol: number;
  /** Stake for every other entrant, SOL (the minimum viable round trip). */
  scoutStakeSol: number;
  /** Smallest buy worth sending, SOL. */
  minBuySol: number;
  /** Slippage on buys, bps. Sells always go out wide open. */
  buySlipBps: number;
  /** Sell when mark-to-market value reaches cost * (1 + takeProfit). */
  takeProfit: number;
  /** Sell when mark-to-market value falls to cost * (1 - stopLoss). */
  stopLoss: number;
  /** Trailing stop arms once value reaches cost * (1 + trailArm). */
  trailArm: number;
  /** Sell when value falls this far below its peak. */
  trail: number;
  /** Sell after this many slots held. */
  maxHold: number;
  /** Flow exit: sell when net SOL over the fade window falls below -fadeNetSol. */
  fadeWindow: number;
  fadeNetSol: number;
  /** Skip a coin if its creator sold at any point. */
  skipCreatorSold: boolean;
  /** Skip a coin if any single sell in the last guardWindow slots is >= maxSingleSellSol. */
  guardWindow: number;
  maxSingleSellSol: number;
  /** Slots to wait after an exit before the same curve may be bought again. */
  cooldown: number;
  /** Most entries per curve over the run. */
  maxEntries: number;
  /** Most positions open at once. */
  maxOpen: number;
}

export const DEFAULT_PARAMS: Params = {
  minRqSol: 15,
  maxRqSol: 60,
  crowdBuyers: 12,
  crowdStakeSol: 0.5,
  scoutStakeSol: 0.01,
  minBuySol: 0.01,
  buySlipBps: 1500,
  takeProfit: 0.2,
  stopLoss: 0.1,
  trailArm: 0.15,
  trail: 0.1,
  maxHold: 600,
  fadeWindow: 15,
  // Fade exit disabled: on the dev window it cut winners more than losers
  // (fade off +0.16 SOL vs fade at -0.5). The time limit + stop + trail
  // still bound every position's downside.
  fadeNetSol: 1000,
  skipCreatorSold: true,
  guardWindow: 30,
  maxSingleSellSol: 5,
  cooldown: 0,
  maxEntries: 1,
  maxOpen: 5,
};

const LAM_F = 1e9;
const CURVE_FEE = 0.0125;

interface TapeTrade {
  slot: number;
  buy: boolean;
  sol: number;
  user: string;
}

interface Tape {
  created: number | null;
  creator: string | null;
  /** Distinct buyers trading in the create slot. */
  createBuyers: Set<string>;
  creatorSold: boolean;
  trades: TapeTrade[];
  entries: number;
  lastExit: number;
}

interface Held {
  opened: number;
  /** SOL actually spent on buys that filled (fees included). */
  invested: number;
  peakValue: number;
  /** A sell order is in flight for this position. */
  exiting: boolean;
  crowded: boolean;
}

function priceOf(s: BotState, mint: Pubkey): number {
  const c = s.curves.get(mint);
  if (!c) return 0;
  const vt = Number(c.virtual_token_reserves);
  if (vt <= 0) return 0;
  return Number(c.virtual_quote_reserves) / vt;
}

/** Mark-to-market close value in SOL, curve fees + one tx fee deducted. */
function closeValue(s: BotState, mint: Pubkey, tokens: bigint): number {
  const c = s.curves.get(mint);
  if (!c) return 0;
  const vt = Number(c.virtual_token_reserves);
  const vq = Number(c.virtual_quote_reserves);
  const t = Number(tokens);
  if (vt <= 0 || t <= 0) return 0;
  const q = (t * vq) / (vt + t) / LAM_F;
  return Math.max(0, q * (1 - CURVE_FEE) - Number(s.txFeeLamports()) / LAM_F);
}

/**
 * Largest token amount whose quote-out does not exceed the curve's real SOL
 * reserve (the harness rejects a bigger sell). Returns 0n when nothing is
 * sellable. q(T) = T*vq/(vt+T) <= rq  =>  T <= rq*vt/(vq-rq).
 */
function realizableSale(s: BotState, mint: Pubkey, tokens: bigint): bigint {
  const c = s.curves.get(mint);
  if (!c) return 0n;
  const vt = Number(c.virtual_token_reserves);
  const vq = Number(c.virtual_quote_reserves);
  const rq = Number(c.real_quote_reserves);
  if (vt <= 0 || vq <= rq || rq <= 0) return 0n;
  const maxT = Math.floor((rq * vt) / (vq - rq) * 0.99);
  if (maxT <= 0) return 0n;
  const m = BigInt(maxT);
  return tokens < m ? tokens : m;
}

export function createStrategy(p: Params = DEFAULT_PARAMS): Bot {
  const tapes = new Map<Pubkey, Tape>();
  const held = new Map<Pubkey, Held>();
  /** Buys sent but not yet resolved, per mint. */
  const pendingBuys = new Map<Pubkey, number>();
  /** Sells sent but not yet resolved, per mint. */
  const pendingSells = new Map<Pubkey, number>();
  /** Mints whose buy filled at least once (position is live). */
  const live = new Set<Pubkey>();

  const tapeFor = (mint: Pubkey): Tape => {
    let t = tapes.get(mint);
    if (!t) {
      t = { created: null, creator: null, createBuyers: new Set(), creatorSold: false, trades: [], entries: 0, lastExit: -1 };
      tapes.set(mint, t);
    }
    return t;
  };

  /** Net SOL flow over the last `win` slots ending at `slot`. */
  const windowNet = (t: Tape, slot: number, win: number): number => {
    let net = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i];
      if (tr.slot < slot - win) break;
      net += tr.buy ? tr.sol : -tr.sol;
    }
    return net;
  };

  /** Largest single sell (SOL) in the last `win` slots. */
  const maxSingleSell = (t: Tape, slot: number, win: number): number => {
    let m = 0;
    for (let i = t.trades.length - 1; i >= 0; i--) {
      const tr = t.trades[i];
      if (tr.slot < slot - win) break;
      if (!tr.buy && tr.sol > m) m = tr.sol;
    }
    return m;
  };

  const onBatch = (s: BotState, b: Batch): OrderInput[] => {
    // --- fold fills: track live positions, pending orders, and closes ---
    for (const f of b.fills) {
      if (f.side === 'buy') {
        const n = (pendingBuys.get(f.mint) ?? 1) - 1;
        if (n <= 0) pendingBuys.delete(f.mint);
        else pendingBuys.set(f.mint, n);
        if (f.status === 'filled') {
          live.add(f.mint);
          const h = held.get(f.mint);
          if (h) h.invested += Number(f.quote_lamports) / LAM_F;
        }
      } else {
        const n = (pendingSells.get(f.mint) ?? 1) - 1;
        if (n <= 0) pendingSells.delete(f.mint);
        else pendingSells.set(f.mint, n);
        if (f.status === 'filled') {
          live.delete(f.mint);
          held.delete(f.mint);
        } else {
          // rejected / failed sell: the position is still ours, retry next batch
          const h = held.get(f.mint);
          if (h) h.exiting = false;
        }
      }
      if (f.client_id.startsWith('_complete') || f.client_id.startsWith('_flatten') || f.client_id.startsWith('_writeoff')) {
        live.delete(f.mint);
        held.delete(f.mint);
      }
    }

    // --- fold events into tapes ---
    for (const e of b.events) {
      if (e.event === 'CreateEvent') {
        const t = tapeFor(e.mint);
        t.created = e.slot;
        t.creator = e.creator;
      } else if (e.event === 'TradeEvent') {
        const t = tapeFor(e.mint);
        t.trades.push({ slot: e.slot, buy: e.is_buy, sol: Number(e.sol_amount) / LAM_F, user: e.user });
        if (t.created !== null && e.slot === t.created) t.createBuyers.add(e.user);
        if (!e.is_buy && t.creator !== null && e.user === t.creator) t.creatorSold = true;
        const horizon = Math.max(p.fadeWindow, p.guardWindow);
        while (t.trades.length > 0 && t.trades[0].slot < e.slot - horizon) t.trades.shift();
      }
    }

    const orders: OrderInput[] = [];
    const tx = Number(s.txFeeLamports());
    let free = Number(s.freeCashLamports());

    // --- exits (live positions only; a sell in flight is not re-sent) ---
    for (const [mint, h] of held) {
      if (h.exiting) continue;
      const pos = s.positions.get(mint);
      if (!pos) {
        if (!pendingBuys.has(mint)) held.delete(mint);
        continue;
      }
      if (!live.has(mint)) continue;
      const v = closeValue(s, mint, pos.token_amount);
      if (v > h.peakValue) h.peakValue = v;
      const cost = h.invested > 0 ? h.invested : Number(pos.cost_lamports) / LAM_F;
      const up = v / cost - 1;
      let why = '';
      if (up >= p.takeProfit) why = 'take-profit';
      else if (up <= -p.stopLoss) why = 'stop';
      else if (h.peakValue >= cost * (1 + p.trailArm) && v <= h.peakValue * (1 - p.trail)) why = 'trail';
      else if (s.slot - h.opened > p.maxHold) why = 'time';
      else {
        const t = tapes.get(mint);
        if (t && windowNet(t, s.slot, p.fadeWindow) < -p.fadeNetSol) why = 'fade';
      }
      if (why !== '') {
        const amount = realizableSale(s, mint, pos.token_amount);
        if (amount <= 0n) continue; // nothing sellable right now; retry next batch
        orders.push({ side: 'sell', mint, token_amount: amount, max_slippage_bps: 10000 });
        h.exiting = true;
        pendingSells.set(mint, (pendingSells.get(mint) ?? 0) + 1);
        const t = tapes.get(mint);
        if (t) t.lastExit = s.slot;
      }
    }

    // --- entries: survivor filter + crowd sizing, one buy per coin ---
    let slots = Math.min(p.maxOpen, s.hello.caps.max_open_positions) - s.committedPositionCount();
    if (slots > 0) {
      const seen = new Set<Pubkey>();
      for (const e of b.events) {
        if (slots <= 0) break;
        if (e.event !== 'TradeEvent') continue;
        if (seen.has(e.mint)) continue;
        seen.add(e.mint);
        const t = tapes.get(e.mint);
        const c = s.curves.get(e.mint);
        if (!t || !c || c.complete) continue;
        if (held.has(e.mint) || live.has(e.mint) || pendingBuys.has(e.mint)) continue;
        if (t.entries >= p.maxEntries) continue;
        if (t.created !== null && s.slot - t.lastExit < p.cooldown) continue;
        if (p.skipCreatorSold && t.creatorSold) continue;
        if (maxSingleSell(t, s.slot, p.guardWindow) >= p.maxSingleSellSol) continue;
        const rq = Number(c.real_quote_reserves) / LAM_F;
        if (rq < p.minRqSol || rq > p.maxRqSol) continue;
        const crowded = t.createBuyers.size >= p.crowdBuyers;
        const wantSol = crowded ? p.crowdStakeSol : p.scoutStakeSol;
        const cap = Number(s.maxBuyLamports(e.mint));
        const amt = Math.min(cap * 0.97, wantSol * LAM_F);
        if (amt < p.minBuySol * LAM_F || free < amt + tx) continue;
        orders.push({ side: 'buy', mint: e.mint, quote_lamports: BigInt(Math.floor(amt)), max_slippage_bps: p.buySlipBps });
        free -= amt + tx;
        slots--;
        pendingBuys.set(e.mint, (pendingBuys.get(e.mint) ?? 0) + 1);
        t.entries++;
        held.set(e.mint, { opened: s.slot, invested: 0, peakValue: 0, exiting: false, crowded });
      }
    }

    return orders;
  };

  return { onBatch };
}
