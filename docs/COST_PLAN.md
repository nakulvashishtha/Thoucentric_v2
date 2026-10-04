# Cost plan: build, API calls and hosting (cheapest setup that does not hurt quality)

Prices below were read from the vendors' pages in October 2026. Check them again before you commit money.

## 1. Running cost per research case (what the app spends each time someone uses it)

| Item | Setting | Rough amount per case | Cost |
|---|---|---|---|
| Source reading (the bulk of the work) | Haiku-class model, about 40 sources, 4k tokens in and 0.6k out each | 160k in, 24k out | 0.28 USD |
| Routing, queries, linking, unknowns | Haiku-class, about 15 small calls | 45k in, 7.5k out | 0.08 USD |
| Framing, plan, follow-up, summary | Sonnet-class, about 5 calls | 30k in, 5k out | 0.11 USD |
| **AI total** | | | **about 0.47 USD** |
| Web search | basic search, about 1 query per need | about 10 to 15 credits | free plan covers about 65 to 100 cases a month |

Prices used: Haiku 4.5 at 1 USD in and 5 USD out per million tokens; Sonnet 5.5 at 2 USD in and 10 USD out; Tavily basic search at 1 credit with 1,000 free credits a month.

## 2. The levers that keep it cheap (all are in the build prompt, section 14.1)
1. **Two models only.** The cheap model does the high-volume reading; the better model is used for about five calls. No top-tier model at runtime.
2. **Fewer calls.** Reading a source and describing it is one call. Duplicates are removed before reading, so copies cost nothing. At most 4 sources per need.
3. **Smaller calls.** Only the text around candidate figures is sent (at most 8,000 characters), with short instructions and compact JSON replies.
4. **Cache.** Repeat reads, retries and reloads cost nothing because replies and searches are stored by hash.
5. **Hard caps.** 100 AI calls per case, a daily dollar cap (default 3 USD) and a per-case search cap. The app stops spending and shows a banner.
6. **Ledger on screen.** The settings drawer shows this case's and today's spend, so there are no surprises.
7. **If quality is not good enough on the cheap model,** change `MODEL_FAST` to the Sonnet-class model in the hosting dashboard. It costs about twice as much per case and needs no code change.

## 3. Hosting
- **Rehearsal period:** Render's free instance (512 MB, sleeps when idle, no disk). Cases are disposable and the sample cases reload instantly, so this is fine.
- **Pitch week only:** switch to the cheapest paid instance (about 7 USD a month) so it never sleeps. Then suspend or delete the service after the event.
- **No persistent disk** (it would cost about 0.25 USD per GB a month and is not needed). Use the JSON export to keep a case.
- **Free alternatives** exist, but I have not verified them; stay with Render because the runbook is written for it.

## 4. Likely total for the whole project
| Item | Estimate |
|---|---|
| 20 rehearsal cases | about 10 USD of AI |
| Pitch day, 3 cases plus a few retries | about 2 USD of AI |
| Web search | 0 USD on the free plan |
| Hosting | 0 USD while rehearsing, about 7 USD for the pitch month |
| **Runtime total** | **about 20 USD at most** |

Building the app in Claude Code is separate. On a Claude subscription it uses your plan allowance; on pay-as-you-go credits my earlier guess of 50 to 200 USD still applies, and the resume protocol (`PROGRESS.md` and `/clear` after each approved step) is there to keep it toward the low end.

## 5. Guardrails to set yourself
- In the Claude Console, set a monthly spend limit on the workspace that the app's key belongs to, and keep auto-reload off.
- Use one key for the build and a different key for the live demo; delete both after the event.
- Check your balance the day before the pitch and run the app's self-check.
