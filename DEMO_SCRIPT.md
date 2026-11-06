# Plotline demo script (5–10 minutes)

## Before the meeting (do this 20+ minutes ahead)
1. Start the backend and frontend (see README). Put `OPENAI_API_KEY=...` in `.env` at the repo root and restart the backend.
2. Open http://localhost:5174, drop the tender pack folder (or the house-type PDFs) on the home page, and click **Run full takeoff** with the AI second pass on. Let it finish: it takes about 2 minutes per house type (5 electrical sheets) on a 4-core laptop, plus the AI pass.
3. Keep that finished tender for the demo. For the live upload, use a small pack (one house type, **Quick scan** ticked) so it finishes while you talk.

## The story
**1. "Upload the tender pack, that's the only input."** (1 min)
Home page → drop the pack folder. Plotline sorts it: house-type drawings with electrical sheets on the left, everything else set aside. Point at the run options:
- Strong matches (85%+) are trusted without AI.
- Only the borderline band (60–85%) goes to AI, so we don't pay for the obvious ones or the noise.
- There is an AI budget cap.
Click **Run full takeoff** and show the live progress (house type · sheet · symbol).

**2. "Here's every symbol across every house type."** (2 min)
Switch to the pre-run tender. Show:
- The tiles: house types, sheets, symbols found, what AI kept and removed, what is waiting for review.
- The **house type → sheets** hierarchy on the left, with counts per sheet and plots per house type.
- The **symbol × house type** matrix with totals × plots.
- The threshold slider: at 80% only high-confidence marks count; drag it down to show the weaker ones appear.

**3. "The estimator's job is now: approve or delete."** (3 min)
Click **Start review queue**:
- Library sample on the left, the match on the drawing in the middle, the surroundings on the right.
- Press **A** to approve and **X** to delete. It jumps to the next one automatically. **Z** undoes.
- Point out the AI's reason on AI-confirmed marks.
- Filter by house type or symbol. **Approve all in view** for symbols they trust.
- **Open on drawing** jumps to the full sheet with that mark selected, for anything they want to see in context.

**4. "The output is the workbook they already use."** (1 min)
From the drawing view, **Export → Master tender workbook**.

## If something goes wrong
- No AI key: the run still completes. Borderline marks are kept for human review and the overview says why.
- A symbol is missing from the library: open the house type's drawings, press **C**, crop one example, **Save and count**.

## Plots and AI spend (added)
- **Plots come from the accommodation schedule.** Include the schedule spreadsheet (xlsx/csv) in the pack, or add it on the run screen. Plotline finds the house-type column, counts plots per type and matches them to the drawings. Variants are summed, so "Ashton" = Ashton v1 + v2. Green plot pills came from the schedule; amber ones weren't found in it. You can always override by hand.
- **AI runs when you choose (default).** Counting costs nothing. On the overview, the **AI second pass** panel shows how many marks it would check, how many calls that is, and the estimated cost, before you click **Run AI check**. You can limit it to one house type or set a budget.
- **Spend tracker.** The pill in the top bar shows today's and all-time AI spend. Click it for spend per tender, per day and per call. Costs are priced from the real token counts OpenAI returns.
