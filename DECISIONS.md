# Brainstorming Step

## Initial Thoughts

When first reading this task, a few ideas first pop into my head. I considered using a decentralized ledger design, as it fits well with the offline/sync protocol. The issue is that it is far too complicated for this use case, especially with a central trusted operator. Then the next best choice would be a token-based ledger, as it aligns with the initial top-up procedure by keeping the currency live on the wristband. This would infer that the user pays a certain cost up front eligible to be spent at the festival, which I will assume is always online. A clear benefit is keeping digitized receipts with the token rather than explicit money (imagine university campus money, or loading a prepaid card). To further this approach, I would opt for an append-only ledger, which further allows the ledger to keep an immutable history (like a reciept). This is useful when we delve into the considerations provided later.

## Considerations/Stack

So now we concluded that we want to use an append-only token-basde ledger, we have many things we need to consider. To keep it append-only, we can store all the transactions on a SQLite database. On top of just transactions, we need to also store all the details for wristbands as well. This way we have an easy way to see total amount topped-up and whether a wristband has been flagged.

### Stack

The stack consists of Node.js 22.13+, Express API 5.2.1 and Node's builtin SQLite.

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

# Afterthoughts

After completing the code segment of this project, I will now debrief on the results and what changed from the Brainstorming stage, as well as other choices I have made.

## Systemic changes

Originally, the idea was to create a token-based system that works in sync with the ledger, however the idea quickly shifted once I realized that I had no access to the wristbands. This ended up being a ledger-only system that relied on an accept-then-flag system to counter overspending.

## Overdrafts

I ended up going with an accept-then-flag system. This was the easiest system to implement, as it still allows transactions to go through. There are a few flaws with this system (priorly pointed out in the brainstorming part), which are that the topup host foots the debt costs until debts are paid, the debt growth can be astronomical, and also that we don't have the payment details for the terminals. The first two can be easier delt with by either linking a card to overcharge or having to pay a deposit to used the wristband. The last issue is how I implemented flagging. Since I implemented flagging into the system, I would hope that the payment terminal uses it to reject wristbands that have been flagged. I do not know that since I do not have the details for the "spending" part of the terminals. As such, I implemented the flagging as a "hopeful" system. Another option that someone else might have is to limit the damage by limiting the amount the user can spend per purchase or amount the user can spend per hour. This would decrease the amount of possible damage on top of the flagging. There were too many "assumptions" to create more personalized designs.

## Duplicates

Originally, I made it so any duplicates will return as "REJECTED", but there was a major issue with that, and that is the terminal will read it as rejected, and does not know that that transaction has already been inputted. As such, I opted to add another status apart from ACCEPTED/REJECT, and that was DUPLICATED, which has the same success as ACCETPED, but does not make any changes to the database. This way, the terminal knows the transaction has been accepted but not added.

## 20,000 vs 200

Once we get to a larger terminal count, there are definitely a few changes that could be made. The first being the database used; SQLite might be alright for a smaller user base, but once we expand 100 fold, it might be better to move to Postgres or MySQL, which has better row-level locking for concurrent syncs. This way, we can also ensure that we hit the batch size maximum as little as possible.

## What was left out?

One of the more important things left out here is refunds and corrections. Right now, we only have a basic ledger with the ability to topup or report what was spent. If there was an issue or certain stores allow the user to return something, we have no way to offer a refund. Technically, we can offer it as a "topup" type, but that would be difficult to diffrentiate between actual top ups and refunds. I opt to leave this out since it was out of the scope of the project, although it would be nice to have.
As mentioned above in the Overdrafts section, since I do not know the capabilities of the terminals themselves, the flagged wristbands list might be unused if the terminals do have the ability to keep track of them. But if they can record a list of transactions, I'm leaning towards them being able to keep a list of flagged wristbands. As such, I left this detail in on the condition that the mechines work as intended.
Lastly, I think another thing I chose not to implement would be loading Rejections in a manual review queue. This could be an option as many companies do have a customer service team that can help resolve issues and override certain transactions. As I am not too familiar with such systems, due to the interest of time, I decided to leave that out.

## Pushback

For certain. There were a lot of details that were left out. Is there an on-chip cache for the wristband? How does each terminal process payment? Can the terminals store flagging details? Can the wrist band access current balance? These details affect how the backend will be designed and implemented, and are likely far more important than the backend itself.
Another crucial detail is the overdraft and negative balance policy. This is something that was not clarified before begining the project. Since this is a very important business decision, I would definitely ask for directions as to how strict their policy is, or if there are any soft/hard limits.
Lastly, the last detail that I would look into is how the terminals measure their time. Since the backend heavily relies on `recorded_at` for most of the calculations, I need to know how the terminals are getting a centralized time source, or if I need to create offsets or even another way to ensure the payments are in the correct order.
