# Time-Tracking Buddy

An animated desktop companion that quietly captures your active-window activity
during work hours and nudges you at the end of the day to review and log your
time. Everything stays on your machine in a local SQLite database; AI
summarizing is entirely optional.

## Download

- **Windows** — download **Time-Tracking Buddy Setup `<version>`.exe** from the
  assets below and run it. It installs per-user (no admin rights). The installer
  isn't code-signed, so SmartScreen may warn on first run — click
  **More info → Run anyway**.
- **macOS (experimental)** — download the `.dmg` below. It is unsigned and not
  notarized, so Gatekeeper blocks it on first open: **right-click the app →
  Open**, then confirm. Grant **Screen Recording** permission (System Settings →
  Privacy & Security) so it can read window titles, then restart it.

**SmartScreen note:** the Windows installer is unsigned, so Windows Defender
SmartScreen may show "Windows protected your PC / Unknown publisher." This is
expected for an unsigned open-source app — click **More info**, then **Run
anyway** to proceed.

See the [README](https://github.com/chriskokk/time-tracking-buddy#readme) for
full setup and AI-provider instructions.

## 1.0.0

First public release.

- **Animated desktop companion** with four avatars (Musko, Drago, Gato, Tido),
  each with idle, sleeping, alert, talking, reading, and dragging states.
- **Automatic activity capture** of your focused app and window title, with
  idle detection and retention pruning of old raw activity (your saved time
  entries are always kept).
- **End-of-day review** that groups your day into editable, labelled time
  blocks — adjust times, merge, split, add, or delete by hand.
- **Three summarization options**, switchable in Settings: a local **Ollama**
  model, the **Claude Code CLI**, or a **No-AI** deterministic grouping that
  needs nothing installed and always works.
- **History & reports** with per-day and per-ticket totals and **CSV export**
  for billing.
- **Private by design** — no account, no telemetry. All data stays in a local
  SQLite database; nothing is sent anywhere except to the AI provider you
  explicitly choose. Exclude sensitive apps from capture, and keep per-block
  notes that are never sent to any AI.
