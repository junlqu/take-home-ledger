# Brainstorming Step

## Initial Thoughts

When first reading this task, a few ideas first pop into my head. I considered using a decentralized ledger design, as it fits well with the offline/sync protocol. The issue is that it is far too complicated for this use case, especially with a central trusted operator. Then the next best choice would be a token-based ledger, as it aligns with the initial top-up procedure by keeping the currency live on the wristband. This would infer that the user pays a certain cost up front eligible to be spent at the festival, which I will assume is always online. A clear benefit is keeping digitized receipts with the token rather than explicit money (imagine university campus money, or loading a prepaid card). To further this approach, I would opt for an append-only ledger, which further allows the ledger to keep an immutable history (like a reciept). This is useful when we delve into the considerations provided later.

## Considerations/Stack

So now we concluded that we want to use an append-only token-basde ledger, we have many things we need to consider. To keep it append-only, we can store all the transactions on a SQLite database. On top of just transactions, we need to also store all the details for wristbands as well. This way we have an easy way to see total amount topped-up and whether a wristband has been flagged. As for the rest of the stack, I chose to use Node and Express, as I am more familiar with that.

## Cases

When making these decisions for which issues we want to address, we should place them in order of priority. Depending on the client, the priority could change due to budget restrictions or hardware limitations. I used a more personalized, subjective metric, as it was what I am being test on. These cases below are ordered in terms of importance (based on my own judgment).

### Malformed batch

I would prioritize this issue as the most prevalent, since a single malformed transaction can cancel an entire batch, which could go south very quickly. The work around would be when submitting a transaction, we can attach a response with a code system (like in HTTP), or go with a simpler approach of `accepted`/`rejected` and the reason. This way, the once a sync happens, all transactions are approved, but only accepted transactions affect token count.

### Two terminals accepting

This is more nuanced with the client's needs. There are two paths we can take here: flagging with debt collection, or hard limit. The benefit of flagging and then collecting the negative balance out after syncing is that sales happen more, but comes with the added risk of people not fulfilling the debt. There could be counter measures set up for that, such as collateral or a deposit prior to toping up. The downside is that the host will go negative for the duration the debt is not collected. Under a token system, there is some more leeway, but that depends on the client. The other option, which includes a hard limit to enfore negatives never happen, has the added benefit that is a transaction exceeds the current token balance recorded on the wristband, then the transaction is rejected. The downside is that it might be disruptive to the festival. As a simple system, I will opt towards the flagging of transactions, as it is difficult to set up a hard limit when I don't have access to the wristband program.

### Out of order

There is a small issue with the out of order system, as loading the balance of a user might be inaccurate prior to a terminal's sync. Since we are going to be using the accept-then-flag rule, we can discount the issue as we can sort using the `recorded_at` column to determine which transaction to flag.

### Double batches

A simple way around this is to check the database for whether each `(terminmal_id, temrinal_txn_id)` key exists. If it does, we can mark the transaction to be duplicated and reject it. Even if the transaction is applied in more than two batches, the response and rejection should be consistent. The main issue with this is having to parse the entire database for each transaction can be costly (in time and computational power). But since we are only dealing with 200 terminals, the amount of transactions should be feasible for our system.

### Flagged wristbands

This assignment does not talk about whether the terminals also receive information back from the site. There are different measures to reject transactions depending on if they do or do not. If they can receive callbacks (apart from just the ACK), we can keep a list of balances for each wristband after each sync, or a list of flagged wristbands, which could limit the purchasing power of individual wristbands. For larger festivals, this might not be feasible. If the wristband can store details and keep a local ledger of transactions, that would also work (but I do not reckon it can). Then if the terminal receives nothing but the ACK from the site, the best we can do is limit spending while the system is offline (ie. tap on bank cards) per wristband. This does not prevent overspending, but will cull the damage. I raised this concern, but will not be implementing issues with this as I do not have the full details of the system.
