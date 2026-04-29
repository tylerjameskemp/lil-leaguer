# Lil Leaguer

Lil Leaguer is a game-day helper for assistant coaches managing Portland AAA Little League baseball rotations.

## What It Does

- Generates six defensive innings for the players marked present.
- Rotates bench turns fairly for 14-player rosters.
- Tracks player position requests so kids get a shot at preferred spots.
- Checks the AAA rule that every player must play at least 3 full defensive innings.
- Tracks pitch counts, daily pitch limits by league age, rest days, and pitcher/catcher lockouts.
- Saves roster, pitch-count state, and season fairness totals in the browser for quick use at the field.
- Lets one coach save each completed game to carry bench and position fairness across the season.

## AAA Rules Included

The first version is based on the attached `AAA Rules 2026.docx`:

- Games are 6 innings or 90 minutes.
- No new inning starts after 75 minutes.
- Continuous batting order.
- Every player must play at least 3 full innings in the field.
- Inning changes after 3 outs, batting through the lineup, or 5 runs.
- Pitch limits: 50 pitches for ages 7-8, 75 for ages 9-10, 85 for ages 11-12.
- Pitcher rest: 0 days for 1-20, 1 day for 21-35, 2 days for 36-50, 3 days for 51-65, 4 days for 66+.
- A pitcher who throws 41+ pitches cannot catch for the rest of the day.
- A catcher who catches 4+ innings cannot pitch for the rest of the day.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploying

This is a Next.js app and is ready to import into Vercel after the GitHub repo is created.
