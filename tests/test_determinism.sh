#!/bin/sh
# Wire-level determinism check for the replay bot.
# Feeds the same hello + batches + done to main.ts twice and requires
# byte-identical replies. The bot reads stdin, so both runs see exactly
# the same input; any clock/randomness dependence would show up here.
set -eu
cd "$(dirname "$0")/.."

INPUT=$(mktemp)
cat > "$INPUT" <<'EOF'
{"type":"hello","protocol":"agent-fun/replay/v2","seed":"1","universe":{"program":"6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P","quote":"SOL","mayhem":"excluded","exclude_cashback":true,"sample":{"hash":"sha256","modulus":16,"residue":15}},"capital":{"lamports":"10000000000"},"caps":{"max_open_positions":5,"max_order_bps_of_real_reserve":100,"max_orders_per_batch":16,"shorts":false,"leverage":false},"latency_slots":2,"fees":{"protocol_bps_fallback":95,"creator_bps_fallback":30,"base_fee_lamports":"5000","priority_fee_lamports":"100000","failed_tx_bps":200}}
{"type":"batch","seq":0,"slot":464338663,"events":[{"event":"CreateEvent","name":"Test","symbol":"TEST","uri":"","mint":"FdfDYUcHRar4ezebmC7dbYvFLjoFK7ceUy5WzHzvpump","bonding_curve":"EeL819NdKaFrxWSbgGkpvqwn5FJ9rUSYst96FQLsAhnY","user":"E1CrPhVtP9A7XWyAZQacdG5LxZSENRDm2FVrmV3Ndz1Y","creator":"E1CrPhVtP9A7XWyAZQacdG5LxZSENRDm2FVrmV3Ndz1Y","timestamp":"1793588980","virtual_token_reserves":"1073000000000000","virtual_sol_reserves":"30000000000","real_token_reserves":"793100000000000","token_total_supply":"1000000000000000","token_program":"TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb","is_mayhem_mode":false,"is_cashback_enabled":false,"quote_mint":"11111111111111111111111111111111","virtual_quote_reserves":"30000000000","creator_fee_bps":"0","is_holder_reward":false,"depth":0,"slot":464338663,"signature":"x","block_time":1793588980,"chain_seq":0}],"marks":[],"fills":[],"account":{"cash_lamports":"10000000000","positions":[]}}
{"type":"done","seq":1,"reason":"end_of_data","account":{"cash_lamports":"10000000000","positions":[]}}
EOF

node main.ts < "$INPUT" > /tmp/det-a.txt
node main.ts < "$INPUT" > /tmp/det-b.txt
rm -f "$INPUT"
if cmp -s /tmp/det-a.txt /tmp/det-b.txt; then
  echo "determinism: PASS ($(wc -l < /tmp/det-a.txt) reply lines, byte-identical)"
else
  echo "determinism: FAIL"
  diff /tmp/det-a.txt /tmp/det-b.txt || true
  exit 1
fi
