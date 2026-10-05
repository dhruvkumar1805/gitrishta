# gitrishta

apna GitHub soulmate dhoondo.

Type a GitHub username and Pandit ji reads your public profile, makes your rishta biodata, matches your kundli against well-known developers and prints the shaadi ka card.

**Live:** https://dhruvkumar.dev/gitrishta

![dan weds Evan You](og.jpg)

## What it reads

Everything comes from the public GitHub API, in your browser. Nothing is stored or sent anywhere else.

| Biodata field | Comes from |
| --- | --- |
| Kad (height) | total stars |
| Gotra | top language |
| Rashi | the hour you commit the most |
| Manglik | pushes on Friday nights |
| Package | followers (not in-hand) |
| Sampatti | repos, and how many you abandoned |

The kundli scores 8 ashtakoot gunas (out of 36) from both profiles: shared languages, sleep schedules, weekend commits, stars, repo counts and GitHub age.

## Run locally

It's one static page.

```sh
python3 -m http.server 8787
```

`famous.js` is a snapshot of public data for the developers in the rishta pool, so suggestions don't use up your GitHub rate limit. Refresh or extend it with:

```sh
node build-famous.mjs torvalds gaearon yyx990803
```

Made by [@dhruvkumar1805](https://x.com/dhruvkumar1805). For fun, not for actual shaadi.
