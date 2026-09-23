# Take-Home: Festival Cashless Ledger

**Time budget:** 4–6 hours. Please don't spend more; we'd rather see what you prioritize than a polished everything.
**Language / framework:** your choice. Keep dependencies minimal.
**AI tools:** allowed. Everything you submit is yours — you'll be asked to explain and change any part of it live.

---

## The situation

At a music festival, attendees wear RFID wristbands. They load money onto the wristband at top-up stations, then tap to pay at bars and food vendors. There are ~200 point-of-sale (POS) terminals on site.

The site's network is unreliable. Terminals lose connectivity for anywhere from a few seconds to twenty minutes, several times a day. **Sales must keep working while offline.** When a terminal reconnects, it uploads the transactions it recorded.

You're building the backend service the terminals talk to.

## What to build

A small HTTP API with three operations:

1. **Top-up** — add funds to a wristband. Always online (top-up stations have wired connections).
2. **Sync** — a terminal uploads a batch of transactions it recorded while offline. Each transaction is a spend: `{wristband_id, amount, terminal_id, terminal_txn_id, recorded_at}`.
3. **Balance** — return a wristband's current balance and its transaction history.

Use any storage you like (SQLite is fine). No auth needed. No UI.

## The parts that actually matter

These are the questions we care about. Your code should answer them, and your `DECISIONS.md` should explain *why* you answered them that way.

- **A terminal may upload the same batch twice** (it crashed before getting the ACK). What happens?
- **Two terminals, both offline, both accept spends from the same wristband.** Combined, the spends exceed the balance. Both terminals later sync. What's the final state, and who finds out?
- **Batches arrive out of order.** Terminal A's 2:15pm batch arrives after Terminal B's 2:40pm batch. Does the order of arrival change the outcome? Should it?
- **A spend in a batch is malformed** (negative amount, unknown wristband, missing field). Does the whole batch fail, or just that transaction? What does the terminal need to know to recover?

You do not need to handle every edge case. You need to **choose** which ones you handle, handle those correctly, and write down the ones you didn't and what would go wrong.

## Deliverables

1. **Code** with a way to run it (`README`, one command ideally).
2. **Tests** covering the scenarios above — at minimum, duplicate sync and the overspend case.
3. **`DECISIONS.md`**, under one page, covering:
   - The rule you chose for overspend, and one reason someone might choose differently.
   - What you'd have to change if there were 20,000 terminals instead of 200.
   - What you deliberately left out and why.
   - Anything you'd push back on if this were a real ticket.

## What we're looking at

Roughly in this order:

1. Does the overspend and duplicate handling actually work, under test?
2. Do your decisions hold together, and can you argue for them?
3. Is the code something a teammate could pick up?
4. Did you stay inside the time budget by cutting the right things?

We are not scoring on framework choice, folder structure, or how many endpoints you added beyond the three.

---

*Submit as a git repo (public or a zip). Commit as you go — we read the history.*
