// Snapshots public GitHub data for well-known devs into famous.js, so the site can
// suggest "rishte" without spending the visitor's API rate limit.
// usage: node build-famous.mjs handle1 handle2 ...   (existing entries are kept)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = new URL('./famous.js', import.meta.url);
const PREFIX = 'window.FAMOUS = ';

const existing = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, 'utf8').slice(PREFIX.length).replace(/;\s*$/, ''))
  : [];
const have = new Set(existing.map(d => d.user.login.toLowerCase()));

async function gh(path) {
  const r = await fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

for (const handle of process.argv.slice(2)) {
  if (have.has(handle.toLowerCase())) { console.log('skip', handle); continue; }
  try {
    const u = await gh(`/users/${handle}`);
    const repos = await gh(`/users/${handle}/repos?per_page=100&sort=pushed`);
    existing.push({
      user: {
        login: u.login, name: u.name, avatar_url: u.avatar_url, bio: u.bio, company: u.company,
        location: u.location, twitter_username: u.twitter_username, followers: u.followers,
        following: u.following, created_at: u.created_at,
      },
      repos: repos.map(r => ({
        name: r.name, fork: r.fork, language: r.language, stargazers_count: r.stargazers_count,
        pushed_at: r.pushed_at, created_at: r.created_at,
      })),
    });
    have.add(handle.toLowerCase());
    console.log('ok', u.login, repos.length, 'repos');
  } catch (e) {
    console.log('fail', handle, e.message);
  }
}

writeFileSync(OUT, PREFIX + JSON.stringify(existing) + ';\n');
console.log('total', existing.length);
