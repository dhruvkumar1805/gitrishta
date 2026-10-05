/* gitrishta: find your GitHub soulmate.
 * Reads public GitHub data in the browser, builds a desi rishta biodata and matches your
 * kundli against three pools: people in your own GitHub circle, everyone who has used
 * gitrishta (the rishta pool, served by /api/gitrishta) and a snapshot of well-known devs. */

const API = 'https://api.github.com';
const CREATOR = 'dhruvkumar1805';
const ON_WEB = location.protocol.startsWith('http');
const SITE = ON_WEB
  ? location.host.replace(/^www\./, '') + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '')
  : 'dhruvkumar.dev/gitrishta';
const CIRCLE_MAX = 14;
const SEARCH_MAX = 10;
const $ = id => document.getElementById(id);

const SNAP = {};
(window.FAMOUS || []).forEach(s => { SNAP[s.user.login.toLowerCase()] = s; });

/* ---------- language: English for everyone, Hinglish "Desi" mode one tap away ---------- */
function detectLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'desi') return q;
  try { const s = localStorage.getItem('gr-lang'); if (s === 'en' || s === 'desi') return s; } catch (e) {}
  return 'en';
}
let LANG = detectLang();
const T = (desi, en) => (LANG === 'en' ? en : desi);
const num = n => (n || 0).toLocaleString(LANG === 'en' ? 'en-US' : 'en-IN');

/* ---------- GitHub ---------- */
// Direct first, so each visitor spends their own rate limit. When that runs out (shared
// college or office IPs), fall back to the cached proxy on dhruvkumar.dev.
async function gh(path) {
  let r = null;
  try { r = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } }); } catch (e) {}
  if ((!r || r.status === 403 || r.status === 429) && ON_WEB) {
    try { r = await fetch(`${location.origin}/api/gitrishta/gh?path=${encodeURIComponent(path)}`); } catch (e) {}
  }
  if (!r) throw new Error('fail');
  if (r.status === 404) throw new Error((r.headers.get('content-type') || '').includes('json') ? 'notfound' : 'rate');
  if (r.status === 403 || r.status === 429) throw new Error('rate');
  if (!r.ok) throw new Error('fail');
  return r.json();
}

const cache = {};
async function load(login) {
  const key = login.toLowerCase();
  if (cache[key]) return cache[key];
  if (SNAP[key]) return (cache[key] = famous(key));
  const user = await gh(`/users/${encodeURIComponent(login)}`);
  const [repos, events] = await Promise.all([
    gh(`/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`).catch(() => []),
    gh(`/users/${encodeURIComponent(login)}/events/public?per_page=100`).catch(() => []),
  ]);
  return (cache[key] = analyze(user, repos, events));
}

function analyze(user, repos, events) {
  const own = repos.filter(r => !r.fork);
  const forks = repos.length - own.length;
  const stars = own.reduce((s, r) => s + r.stargazers_count, 0);
  const langCount = {};
  own.forEach(r => { if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1; });
  const langs = Object.entries(langCount).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const best = own.slice().sort((a, b) => b.stargazers_count - a.stargazers_count)[0];
  const yearAgo = Date.now() - 365 * 864e5;
  const dead = own.filter(r => new Date(r.pushed_at) < yearAgo).sort((a, b) => new Date(a.pushed_at) - new Date(b.pushed_at));
  const latest = own.slice().sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))[0];
  const lastPush = Math.max(
    latest ? +new Date(latest.pushed_at) : 0,
    ...events.filter(e => e.type === 'PushEvent').map(e => +new Date(e.created_at)), 0);

  let acts = events.filter(e => ['PushEvent', 'PullRequestEvent', 'CreateEvent', 'IssuesEvent', 'IssueCommentEvent'].includes(e.type)).map(e => e.created_at);
  // many people's public event feed is nearly empty, so fall back to repo push/create times
  if (acts.length < 10) acts = acts.concat(own.flatMap(r => [r.pushed_at, r.created_at]).filter(Boolean));
  const hours = Array(24).fill(0);
  let weekend = 0, lateFri = 0;
  acts.forEach(ts => {
    const d = new Date(ts), h = d.getHours(), day = d.getDay();
    hours[h]++;
    if (day === 0 || day === 6) weekend++;
    if ((day === 5 && h >= 18) || (day === 6 && h < 4)) lateFri++;
  });
  let peak = null, best3 = 0;
  for (let h = 0; h < 24; h++) {
    const w = hours[h] + hours[(h + 1) % 24] + hours[(h + 23) % 24];
    if (w > best3) { best3 = w; peak = h; }
  }
  const since = new Date(user.created_at).getFullYear();
  return {
    login: user.login, name: user.name || user.login, avatar: user.avatar_url, bio: user.bio || '',
    company: (user.company || '').replace(/^@/, '').trim(), location: user.location || '',
    twitter: user.twitter_username || null, followers: user.followers || 0, following: user.following || 0,
    since, age: Math.max(0, Math.floor((Date.now() - new Date(user.created_at)) / (365.25 * 864e5))),
    stars, forks, own: own.length, langs, best, dead, latest, lastPush,
    acts: acts.length, peak, weekendRatio: acts.length ? weekend / acts.length : 0, lateFri, lite: false,
  };
}

const famousMemo = {};
const famous = k => famousMemo[k] || (famousMemo[k] = analyze(SNAP[k].user, SNAP[k].repos, []));
const famousList = () => Object.keys(SNAP).filter(k => k !== CREATOR).map(famous);

/* compact form shared with the pool API and the session cache */
function toCompact(d) {
  return {
    l: d.login, n: d.name, a: d.avatar, s: d.since, st: d.stars, o: d.own, lg: d.langs.slice(0, 5),
    p: d.peak, w: Math.round(d.weekendRatio * 100) / 100, f: d.lateFri,
    loc: (d.location || '').slice(0, 40), tw: d.twitter || '', fo: d.followers || 0,
  };
}
function fromCompact(c) {
  return {
    login: c.l, name: c.n || c.l, avatar: c.a, bio: '', company: '', location: c.loc || '', twitter: c.tw || null,
    followers: c.fo || 0, following: 0, since: c.s, age: Math.max(0, new Date().getFullYear() - c.s),
    stars: c.st || 0, forks: 0, own: c.o || 0, langs: c.lg || [], best: null, dead: [], latest: null, lastPush: 0,
    acts: 1, peak: c.p === undefined ? null : c.p, weekendRatio: c.w || 0, lateFri: c.f || 0, lite: false,
  };
}

/* ---------- the rishta pool ---------- */
let poolCount = 0, joined = null;
const poolPromise = (async () => {
  if (!ON_WEB) return [];
  try {
    const r = await fetch(`${location.origin}/api/gitrishta`);
    if (!r.ok) return [];
    const j = await r.json();
    poolCount = j.count || 0;
    return (j.pool || []).map(fromCompact);
  } catch (e) { return []; }
})();

async function joinPool(d) {
  if (!ON_WEB) return;
  try {
    const r = await fetch(`${location.origin}/api/gitrishta`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(toCompact(d)),
    });
    const j = await r.json();
    if (j.ok) { joined = d.login; if (j.count) poolCount = j.count; showLeave(); updateCount(); }
  } catch (e) {}
}

async function leavePool() {
  if (!joined) return;
  try { await fetch(`${location.origin}/api/gitrishta?login=${encodeURIComponent(joined)}`, { method: 'DELETE' }); } catch (e) {}
  joined = null; showLeave(); toast(T('Pool se naam hata diya', 'Removed from the pool'));
}

function showLeave() {
  const box = $('leave'); box.innerHTML = '';
  if (!joined) return;
  const a = el('a', null, T('Pool se naam hatao', 'Remove me from the pool'));
  a.onclick = leavePool; box.append(a);
}

function updateCount() {
  const c = $('count');
  c.hidden = poolCount < 50;
  c.querySelector('span').textContent = T(`${num(poolCount)} developers ka biodata ban chuka hai`, `${num(poolCount)} developers have made their biodata`);
}

/* ---------- your GitHub circle ---------- */
function sessionGet(k) {
  try { const v = JSON.parse(sessionStorage.getItem(k)); if (v && Date.now() - v.t < 3600e3) return v.data; } catch (e) {}
  return null;
}
function sessionSet(k, data) { try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), data })); } catch (e) {} }

// People who follow you back come first (real friends), then people you follow, then followers.
async function loadCircle(a, onProgress) {
  const key = 'gr-circle-' + a.login.toLowerCase();
  const hit = sessionGet(key);
  if (hit) return hit.map(fromCompact);
  const [following, followers] = await Promise.all([
    gh(`/users/${a.login}/following?per_page=100`).catch(() => []),
    gh(`/users/${a.login}/followers?per_page=100`).catch(() => []),
  ]);
  const me = a.login.toLowerCase();
  const fol = new Set(followers.map(x => x.login.toLowerCase()));
  const ing = new Set(following.map(x => x.login.toLowerCase()));
  const ordered = [
    ...following.filter(x => fol.has(x.login.toLowerCase())),
    ...following.filter(x => !fol.has(x.login.toLowerCase())),
    ...followers.filter(x => !ing.has(x.login.toLowerCase())),
  ].filter(x => x.type === 'User' && x.login.toLowerCase() !== me);
  const picks = [];
  const seen = new Set();
  for (const p of ordered) {
    const k = p.login.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); picks.push(p);
    if (picks.length >= CIRCLE_MAX) break;
  }
  const out = await analyzePeople(picks, onProgress);
  sessionSet(key, out.map(toCompact));
  return out;
}

// GitHub-wide: developers who share your top language (and country, when you list one) with a
// follower count in your league, so the match is a peer, not a celebrity.
const NOT_A_STACK = new Set(['Makefile', 'Dockerfile', 'HTML', 'CSS', 'Shell', 'Batchfile', 'PowerShell', 'CMake', 'Roff', 'TeX', 'Nix', 'Procfile']);
const searchLang = a => a.langs.find(l => !NOT_A_STACK.has(l)) || a.langs[0];

async function loadSearch(a, skip, onProgress) {
  const lang = searchLang(a);
  if (!lang) return [];
  const key = 'gr-search-' + a.login.toLowerCase();
  const hit = sessionGet(key);
  if (hit) return hit.map(fromCompact);
  const place = (a.location || '').split(',').pop().trim().replace(/[^\w\s.-]/g, '');
  const lo = Math.max(1, Math.floor(a.followers / 4)), hi = Math.max(60, a.followers * 4);
  const query = where => [`language:"${lang}"`, where ? `location:"${where}"` : '', `followers:${lo}..${hi}`, 'repos:>4', 'type:user'].filter(Boolean).join(' ');
  const search = async where => (await gh(`/search/users?q=${encodeURIComponent(query(where))}&per_page=40`)).items || [];
  let found = [];
  try {
    found = place ? await search(place) : [];
    if (found.length < 8) found = found.concat(await search('')); // too local or no location: go worldwide
  } catch (e) { if (!found.length) return []; }
  const me = a.login.toLowerCase();
  const seen = new Set([me, ...skip]);
  const picks = found.filter(p => { const k = p.login.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, SEARCH_MAX);
  const out = await analyzePeople(picks, onProgress);
  sessionSet(key, out.map(toCompact));
  return out;
}

// One repos call per person; famous devs come straight from the snapshot. Stops early on rate limit.
async function analyzePeople(picks, onProgress) {
  const out = [];
  let done = 0, limited = false, next = 0;
  const work = async p => {
    const k = p.login.toLowerCase();
    try {
      if (SNAP[k]) { out.push(famous(k)); return; }
      if (limited) return;
      const repos = await gh(`/users/${p.login}/repos?per_page=100&sort=pushed`);
      const own = repos.filter(r => !r.fork);
      if (!own.length) return;
      const first = own.reduce((m, r) => (r.created_at < m ? r.created_at : m), own[0].created_at);
      const d = analyze({ login: p.login, avatar_url: p.avatar_url, created_at: first }, repos, []);
      d.lite = true; // name, followers and X handle get filled in later for the top matches
      out.push(d);
    } catch (e) {
      if (e.message === 'rate') limited = true;
    } finally {
      onProgress(++done, picks.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, picks.length) }, async () => {
    while (next < picks.length) await work(picks[next++]);
  }));
  return out;
}

// circle entries come from the repos list alone; fetch the real profile only for people we show
async function upgrade(d) {
  if (!d.lite) return d;
  try {
    const u = await gh(`/users/${d.login}`);
    d.name = u.name || u.login; d.followers = u.followers || 0; d.twitter = u.twitter_username || null;
    d.location = u.location || ''; d.since = new Date(u.created_at).getFullYear();
    d.age = Math.max(0, new Date().getFullYear() - d.since);
  } catch (e) {}
  d.lite = false;
  return d;
}

/* ---------- matching ---------- */
const ratio = (a, b) => { a += 1; b += 1; return Math.min(a, b) / Math.max(a, b); };
const hourDiff = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };
const isNight = h => h !== null && (h >= 22 || h <= 4);
const fmtHour = h => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

function kundli(a, b) {
  const la = a.langs.slice(0, 5), lb = b.langs.slice(0, 5);
  const inter = la.filter(x => lb.includes(x)).length, uni = new Set([...la, ...lb]).size || 1;
  const k = [];
  const same = la[0] && la[0] === lb[0];
  k.push(['Varna', T('top language', 'top language'), same ? 1 : 0, 1, same
    ? T(`Dono ${la[0]} wale. Same gotra`, `Both ${la[0]}. Same clan`)
    : T(`${la[0] || '?'} vs ${lb[0] || '?'}. Ghar wale samjha lenge`, `${la[0] || '?'} vs ${lb[0] || '?'}. The family will adjust`)]);
  const ad = Math.abs(a.since - b.since);
  k.push(['Vashya', 'GitHub age', ad <= 1 ? 2 : ad <= 3 ? 1 : 0, 2, ad <= 1 ? 'Same batch' : T(`${ad} saal ka farak`, `${ad} years apart`)]);
  k.push(['Tara', 'stars', Math.round(3 * ratio(a.stars, b.stars)), 3, `${num(a.stars)}★ vs ${num(b.stars)}★`]);
  let yoni, yn;
  if (a.peak === null || b.peak === null) { yoni = 1; yn = T('Ek ka schedule hi nahi pata', 'One schedule is a mystery'); }
  else { const hd = hourDiff(a.peak, b.peak); yoni = hd <= 2 ? 4 : hd <= 5 ? 2 : 0; yn = `${fmtHour(a.peak)} vs ${fmtHour(b.peak)}`; }
  k.push(['Yoni', 'sleep schedule', yoni, 4, yn]);
  k.push(['Graha Maitri', 'shared stack', Math.round(5 * inter / uni), 5, inter
    ? `${inter} common language${inter > 1 ? 's' : ''}`
    : T('Koi common language nahi. Translator chahiye', 'No common language. Need a translator')]);
  const na = isNight(a.peak), nb = isNight(b.peak);
  k.push(['Gana', T('ullu vs sanskari', 'owl vs early bird'), na === nb ? 6 : 2, 6, na && nb
    ? T('Dono ullu. 2 AM dates', 'Both night owls. 2 AM dates')
    : !na && !nb ? T('Dono sanskari, raat ko sote hain', 'Both sanskari, asleep by midnight') : T('Ek ullu, ek sanskari', 'One night owl, one early bird')]);
  k.push(['Bhakoot', 'repo count', Math.round(7 * ratio(a.own, b.own)), 7, `${a.own} vs ${b.own} repos`]);
  const wa = a.weekendRatio > 0.25, wb = b.weekendRatio > 0.25;
  k.push(['Nadi', 'weekend commits', wa === wb ? 8 : 0, 8, wa === wb
    ? (wa ? T('Dono weekend pe bhi code karte hain', 'Both code on weekends') : T('Dono weekends pe offline', 'Both offline on weekends'))
    : T('Nadi dosh: ek weekend pe bhi code, ek ki life hai', 'Nadi dosh: one codes on weekends, one has a life')]);
  return { k, total: k.reduce((s, x) => s + x[2], 0) };
}

function verdict(total) {
  if (total >= 32) return ['', T('Janam janam ka saath', 'Soulmates for 7 lifetimes'), 'merge to main. delete the branch'];
  if (total >= 25) return ['', T('Shaadi pakki', "Shaadi pakki (it's a match)"), 'merge without review'];
  if (total >= 18) return ['mid', T('Chalega', 'Chalega (it will do)'), 'needs one round of code review'];
  return ['bad', T('Pandit ji ne mana kiya', 'Pandit ji said no'), T('merge conflict. dono branch alag rakho', 'merge conflict. keep the branches apart')];
}

const SRC_RANK = { circle: 0, github: 1, pool: 2, famous: 3, manual: 4 };
const byScore = (x, y) => y.total - x.total || SRC_RANK[x.src] - SRC_RANK[y.src] || (y.other.followers || 0) - (x.other.followers || 0);

function candidates(a, circle, search, pool) {
  const me = a.login.toLowerCase();
  const map = new Map();
  const add = (d, src) => { const k = d.login.toLowerCase(); if (k !== me && !map.has(k)) map.set(k, { other: d, src }); };
  circle.forEach(d => add(d, 'circle'));
  search.forEach(d => add(d, 'github'));
  pool.forEach(d => add(d, 'pool'));
  famousList().forEach(d => add(d, 'famous'));
  return [...map.values()].map(c => ({ ...c, total: kundli(a, c.other).total })).sort(byScore);
}

/* ---------- biodata fields ---------- */
const EXPECT = {
  JavaScript: ['Should not switch frameworks every week'],
  TypeScript: ["Strictly typed. No 'any' in this relationship"],
  Python: ['Must respect indentation and personal space'],
  Go: ['Simple, no drama. If err != nil, talk it out'],
  Rust: ['Memory safe and emotionally borrow-checked'],
  Java: ['Stable, long term support. Thoda verbose chalega', 'Stable, long-term support. A little verbose is fine'],
  'C++': ['No undefined behaviour please'],
  C: ['Should manage own memory. And feelings'],
  'C#': ['Okay with Visual Studio taking 4 minutes to open'],
  PHP: ['Accepts me as I am'],
  Swift: ['iPhone wale only. Android wale maaf karein', 'iPhone people only. Sorry, Android'],
  Kotlin: ['Null-safe. Will never leave me hanging'],
  Ruby: ['Happy, optimistic, convention over configuration'],
  Dart: ['Cross-platform family. Flutter chalega', 'Cross-platform family. Flutter is fine'],
  HTML: ['Must not say HTML is not a programming language'],
  CSS: ['Can center a div. Non-negotiable'],
  Shell: ['Comfortable in the terminal. No GUI expectations'],
  'Jupyter Notebook': ['Must restart the kernel without complaining'],
  Vue: ['Gentle and progressive'],
  Svelte: ['Less code, more love'],
  Lua: ['Lightweight, no heavy family expectations'],
  'Vim Script': ['Must know how to exit. Mandatory'],
};
function expectation(d) {
  const e = EXPECT[d.langs[0]];
  if (!e) return T('Light mode users maaf karein', 'Light mode users need not apply');
  return T(e[0], e[1] || e[0]);
}

const daysAgo = t => Math.floor((Date.now() - t) / 864e5);

function umar(d) {
  const n = d.age >= 5 ? T('shaadi ki umar ho gayi', 'ripe for marriage') : d.age <= 1 ? T('abhi bachcha hai', 'still a kid') : T('abhi settle ho rahe hain', 'still settling down');
  return [T(`${d.age} saal`, `${d.age} years`), `${T('GitHub pe since', 'on GitHub since')} ${d.since} · ${n}`];
}
function height(d) {
  const s = d.stars;
  const n = s === 0 ? T('abhi growing phase mein', 'still growing') : s < 25 ? 'average height' : s < 300 ? T('lambi height', 'tall')
    : s < 3000 ? T('6 foot, model type', '6 feet, model material') : T('celebrity. rishta mushkil hai', 'a celebrity. tough match');
  return [`${num(s)} ★`, n];
}
function rashi(d) {
  if (d.peak === null) return [T('Pata nahi', 'Unknown'), T('commits ka koi record nahi', 'no commit history')];
  const h = d.peak, n = `most active at ${fmtHour(h)}`;
  if (h <= 4) return [T('Ullu 🦉', 'Night owl 🦉'), n];
  if (h <= 8) return [T('Brahma muhurat coder', 'Up before sunrise'), n];
  if (h <= 17) return [T('Office hours only. Sanskari', 'Office hours only. Sanskari'), n];
  return [T('Shaam ki shift, chai ke baad', 'Evening shift, after chai'), n];
}
function manglik(d) {
  if (d.lateFri >= 2) return [T('Haan ji', 'Yes (unlucky)'), T('Friday raat ko push karte hain', 'pushes on Friday nights')];
  if (d.weekendRatio > 0.3) return [T('Thoda sa', 'A little'), T('weekends pe bhi commit', 'commits on weekends too')];
  if (!d.acts) return [T('Nahi', 'No'), T('push ka koi record nahi', 'no push history')];
  return [T('Nahi', 'No'), T('deploys only on weekdays', 'deploys on weekdays only')];
}
function occupation(d) {
  const rel = T("relatives: 'computer ka kaam'", "relatives: 'something with computers'");
  if (d.company) return [d.company, rel];
  const bio = d.bio;
  if (!bio) return [T('Bio khaali hai', 'Empty bio'), T('mysterious. family worried', 'mysterious. family is worried')];
  if (/founder|co-?founder|ceo/i.test(bio)) return ['Founder', T("relatives: 'naukri kab lagegi?'", "relatives: 'when will you get a real job?'")];
  if (/student|undergrad|b\.?tech|college/i.test(bio)) return ['Student', T("relatives: 'abhi padhai chal rahi hai'", "relatives: 'still studying'")];
  const first = bio.split(/[·|,\n•]/)[0].trim();
  if (first && first.length <= 34) return [first, rel];
  return [T('Computer ka kaam', 'Something with computers'), T('exact details family ko bhi nahi pata', 'even the family does not know')];
}
function sampatti(d) {
  const note = d.dead.length
    ? `${d.dead.length} untouched for a year, incl. '${d.dead[0].name}'`
    : T(`${d.forks} adopted (forks), sab active`, `${d.forks} adopted (forks), all active`);
  return [`${d.own} repos`, note];
}
function status(d) {
  if (!d.lastPush) return ['Unknown', T('GitHub pe sirf profile pic hai', 'just a profile pic on GitHub')];
  const n = daysAgo(d.lastPush), where = d.latest ? `last seen in '${d.latest.name}'` : '';
  if (n <= 7) return ['Available. Active this week', where];
  if (n <= 60) return ['Available', T(`${where}, ${n} din pehle`, `${where}, ${n} days ago`)];
  if (n <= 365) return [T('Shayad engaged hai', 'Probably engaged'), T(`${n} din se koi commit nahi`, `no commits in ${n} days`)];
  const y = Math.floor(n / 365);
  return [T('Shaadi ho chuki hai', 'Already married'), T(`GitHub chhod diya, ${y} saal se gayab`, `left GitHub ${y} years ago`)];
}
function habits(d) {
  if (d.following > d.followers * 2 && d.following > 20) return [`Follows ${num(d.following)}, followed by ${num(d.followers)}`, T('bhavuk insaan', 'the emotional type')];
  if (d.dead.length > d.own * 0.6 && d.own > 5) return ['Starts projects, finishes none', T(`${d.dead.length} of ${d.own} repos chhod diye`, `${d.dead.length} of ${d.own} repos abandoned`)];
  if (d.peak !== null && d.peak <= 4) return ['Chai, 2 AM commits, 47 tabs', T('neend se rishta toot chuka hai', 'has broken up with sleep')];
  return ['Chai, side projects, 47 tabs', T('smoking nahi, drinking sirf chai', 'no smoking, only chai')];
}
function contact(d) {
  if (d.twitter) return [`@${d.twitter} on X`, 'DMs open, replies in 2 to 3 sprints'];
  return [T('Mummy ji via LinkedIn', 'Via mom, on LinkedIn'), 'serious inquiries only'];
}
// the relative who compares you to "Sharma ji ka beta": a famous dev in your stack with more stars
function sharmaJi(d) {
  const richer = famousList().filter(o => o.login.toLowerCase() !== d.login.toLowerCase() && o.stars > d.stars);
  if (!richer.length) return [T('"Ab Sharma ji apne bete ko tumhara example dete hain"', '"Now Sharma ji tells his son to be like you"'), null];
  // Sharma ji's kid should be desi when the user is
  const desi = /india|bharat|bangalore|bengaluru|delhi|mumbai|pune|hyderabad|chennai|kolkata|noida|gurgaon|jaipur/i;
  const local = desi.test(d.location) ? richer.filter(o => desi.test(o.location)) : [];
  const base = local.length ? local : richer;
  const sameStack = base.filter(o => o.langs[0] === d.langs[0]);
  const s = (sameStack.length ? sameStack : base).sort((a, b) => b.stars - a.stars)[0];
  return [
    T(`"Sharma ji ka beta @${s.login} ke ${num(s.stars)} stars hain"`, `"Sharma ji's son @${s.login} has ${num(s.stars)} stars"`),
    T(`aur tumhare sirf ${num(d.stars)}? · Mausi ji`, `and you have only ${num(d.stars)}? · your aunt`),
  ];
}

const UPAY = {
  Varna: ['Ek dusre ki language mein hello world likho, 7 din tak', "Write hello world in each other's language, 7 days straight"],
  Vashya: ['Senior wala junior ke PRs bina nitpick approve karega', "The senior approves the junior's PRs without nitpicks"],
  Tara: ['Kam stars wale ke 3 repos ko star karo. Abhi. Isi waqt', 'Star 3 repos of the one with fewer stars. Right now'],
  Yoni: ['Standup 3 PM rakho, dono ki neend bach jayegi', 'Move standup to 3 PM. Saves both your sleep'],
  'Graha Maitri': ['Ek common side project shuru karo. Aur khatam bhi karo', 'Start one side project together. And finish it'],
  Gana: ['Ullu wala 2 AM ke baad commit nahi karega, 11 Mondays tak', 'The night owl stops committing after 2 AM, for 11 Mondays'],
  Bhakoot: ['Zyada repos wala 5 purane repos archive karega', 'The one with more repos archives 5 old ones'],
  Nadi: ['Weekend pe laptop band. Dono ka. No exceptions', 'Laptops shut on weekends. Both. No exceptions'],
};

/* ---------- cards ---------- */
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function avatar(url, size) { const i = el('img'); i.crossOrigin = 'anonymous'; i.src = url + (url.includes('?') ? '&' : '?') + 's=' + size; i.alt = ''; return i; }
function rowsTable(rows) {
  const t = el('table', 'rows');
  rows.forEach(([k, v, note]) => {
    const tr = el('tr'); tr.append(el('td', 'k', k));
    const td = el('td', null, v); if (note) td.append(el('small', null, note));
    tr.append(td); t.append(tr);
  });
  return t;
}
const pair = (k, f, d) => { const [v, n] = f(d); return [k, v, n]; };
function section(title, ...kids) { const s = el('div', 'sec'); s.append(el('h3', null, title), ...kids); return s; }
function frameShell(cls = 'card') {
  const card = el('div', cls); const frame = el('div', 'frame'); card.append(frame);
  ['tl', 'tr', 'bl', 'br'].forEach(c => frame.insertAdjacentHTML('beforeend', `<svg class="corner ${c}"><use href="#corner"/></svg>`));
  frame.append(el('div', 'shubh', '॥ शुभ विवाह ॥'));
  return { card, frame };
}
function ornament() { const o = el('div', 'orn'); o.innerHTML = '<i></i>❦<i></i>'; return o; }
function watermark(text) {
  const m = el('div', 'mark');
  const left = el('span'); left.append(el('b', null, 'gitrishta'), document.createTextNode(` · ${text}`));
  m.append(left, el('span', null, `by @${CREATOR}`));
  return m;
}

function biodataCard(d, match) {
  const { card, frame } = frameShell();
  frame.append(el('div', 'title', 'Biodata'), ornament(), el('div', 'of', `of a developer · github.com/${d.login}`));
  const personal = el('div', 'personal');
  personal.append(section('Personal details', rowsTable([
    [T('Naam', 'Name'), d.name, `@${d.login}${d.location ? ' · ' + d.location : ''}`],
    pair(T('Umar', 'Age'), umar, d),
    pair(T('Kad', 'Height'), height, d),
    [T('Rang', 'Complexion'), 'Dark mode only', null],
    [T('Gotra', 'Gotra (clan)'), d.langs[0] || 'Markdown', d.langs[1] ? T(`upgotra: ${d.langs[1]}`, `sub-clan: ${d.langs[1]}`) : null],
    pair(T('Rashi', 'Rashi (sign)'), rashi, d),
    pair('Manglik', manglik, d),
  ])));
  const photo = el('div', 'photo'); photo.append(avatar(d.avatar, 300));
  personal.append(photo);
  frame.append(personal);
  frame.append(section('Career & property', rowsTable([
    pair(T('Vyavsay', 'Occupation'), occupation, d),
    ['Package', `${num(d.followers)} followers`, 'not in-hand'],
    pair(T('Sampatti', 'Property'), sampatti, d),
    [T('Shaan', 'Pride'), d.best && d.best.stargazers_count > 0 ? `${d.best.name} (${num(d.best.stargazers_count)}★)` : T('Abhi mehnat chal rahi hai', 'Still working on it'), null],
    pair('Status', status, d),
  ])));
  frame.append(section('Lifestyle & expectations', rowsTable([
    [T('Shauk', 'Hobbies'), d.langs.slice(0, 3).join(', ') || T('README likhna', 'Writing READMEs'), null],
    pair(T('Aadat', 'Habits'), habits, d),
    [T('Ummeed', 'Expects'), expectation(d), null],
    pair(T('Sampark', 'Contact'), contact, d),
    pair(T('Rishtedaar', 'Relatives'), sharmaJi, d),
  ])));
  if (match) {
    const m = el('div', 'match');
    const mid = el('div');
    mid.append(el('div', 'lbl', T('Rishta aaya hai', 'Rishta arrived')), el('b', null, match.other.name));
    mid.append(el('small', null, `@${match.other.login} · ${verdict(match.total)[1].toLowerCase()}`));
    const sc = el('div', 'sc', String(match.total)); sc.append(el('span', null, '/36'));
    m.append(avatar(match.other.avatar, 120), mid, sc);
    frame.append(m);
  }
  frame.append(el('div', 'note', T('Note: Serious inquiries only. Recruiters door rahein 🙏', 'Note: Serious inquiries only. No recruiters please 🙏')));
  frame.append(watermark('make yours'));
  return card;
}

function kundliCard(a, b) {
  const { card, frame } = frameShell();
  frame.append(el('div', 'title', T('Kundli Milan', 'Kundli Match')), ornament(),
    el('div', 'of', T('ashtakoot guna milan · for developers', 'the 36-guna horoscope match · for developers')));
  const pr = el('div', 'kpair');
  [a, b].forEach((p, i) => {
    const box = el('div', 'p'); box.append(avatar(p.avatar, 160), el('b', null, p.name), el('small', null, '@' + p.login));
    pr.append(box); if (i === 0) pr.append(el('div', 'heart', '❤'));
  });
  frame.append(pr);
  const { k, total } = kundli(a, b);
  const t = el('table', 'koota');
  k.forEach(([n, sub, s, max, c]) => {
    const tr = el('tr');
    const tn = el('td', 'n', n); tn.append(el('small', null, sub));
    const ts = el('td', 's', String(s)); ts.append(el('span', null, ` / ${max}`));
    tr.append(tn, el('td', 'c', c), ts); t.append(tr);
  });
  frame.append(t);
  const weakest = k.slice().sort((x, y) => x[2] / x[3] - y[2] / y[3])[0];
  const up = el('div', 'upay');
  up.append(el('b', null, T('Pandit ji ka upay', "Pandit ji's remedy")), document.createTextNode(weakest[2] === weakest[3]
    ? T('Koi upay nahi chahiye. Seedha mandap book karo', 'No remedy needed. Book the wedding hall')
    : T(...UPAY[weakest[0]])));
  frame.append(up);
  const tot = el('div', 'total');
  const n = el('div', 'num', String(total)); n.append(el('span', null, ' / 36'));
  const [cls, head, sub] = verdict(total);
  const stamp = el('div', 'stamp ' + cls, head); stamp.append(el('small', null, sub));
  tot.append(n, stamp);
  frame.append(tot);
  const wm = watermark('match yours'); wm.style.marginTop = '14px'; frame.append(wm);
  return { card, total };
}

function kicker(total, src, a) {
  if (total < 18) return T('Pandit ji ne bahut dhoondha. Yahi mila. Adjust kar lena', 'Pandit ji searched everywhere. This is the best he found. Adjust.');
  if (src === 'circle') return T('Tumhare apne GitHub circle se rishta aaya hai', 'A rishta from your own GitHub circle');
  if (src === 'github') return T(`Pandit ji ne poore GitHub pe ${searchLang(a)} wale dhoondhe. Ye mile`, `Pandit ji searched all of GitHub for ${searchLang(a)} devs like you`);
  if (src === 'pool') return T(`gitrishta ke ${num(poolCount)} developers mein se, Pandit ji ki pasand`, `Pandit ji's pick from ${num(poolCount)} developers on gitrishta`);
  return T('Pandit ji ki bhavishyavani ke anusaar, aapko sadar amantrit kiya jaata hai', 'As foretold by Pandit ji, you are cordially invited');
}

function weddingCard(a, b, total, src) {
  const { card, frame } = frameShell('wcard');
  frame.append(el('div', 'kicker', kicker(total, src, a)));
  const row = el('div', 'wrow');
  const av = p => { const d = el('div', 'av'); d.append(avatar(p.avatar, 240)); return d; };
  const mid = el('div');
  const names = el('div', 'wnames', a.name); names.append(el('em', null, 'weds')); names.append(document.createTextNode(b.name));
  mid.append(names, el('div', 'whandles', `@${a.login}  ·  @${b.login}`));
  row.append(av(a), mid, av(b));
  frame.append(row);
  const gun = el('div', 'wgun');
  gun.append(el('b', null, `${total}/36`), document.createTextNode(`${T('gun mile', 'gunas matched')} · ${verdict(total)[1]}`));
  frame.append(gun);
  let muhurat = T('Jab dono online hon', 'When both are online');
  if (a.peak !== null && b.peak !== null) {
    let h = Math.round((a.peak + b.peak) / 2);
    if (hourDiff(a.peak, b.peak) !== Math.abs(a.peak - b.peak)) h = (h + 12) % 24; // average across midnight
    muhurat = `${a.lateFri || b.lateFri ? 'Friday' : 'Tuesday'}, ${fmtHour(h)}`;
  }
  const det = el('div', 'wdet');
  [[T('Muhurat', 'Muhurat (lucky hour)'), muhurat], ['Venue', 'main branch, GitHub'],
   [T('Baraat', 'Baraat (procession)'), T(`${a.own + b.own} repos ke saath`, `arriving with ${a.own + b.own} repos`)],
   ['Dress code', 'Dark mode only'], [T('Khana', 'Food'), T('Chai aur Maggi, unlimited', 'Unlimited chai and Maggi')], ['RSVP', 'Open a PR']].forEach(([k, v]) => {
    const d = el('div', null, v); d.prepend(el('small', null, k)); det.append(d);
  });
  frame.append(det);
  const wm = watermark(T('apna soulmate dhoondo', 'find your soulmate')); wm.style.marginTop = '12px'; frame.append(wm);
  return card;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// slot-machine shuffle through the candidates, landing on the soulmate
async function reveal(stage, pool, winner, src) {
  const box = el('div', 'reveal');
  box.append(el('div', 'rv-t', T(`Pandit ji ${num(pool.length)} developers ki kundli mila rahe hain`, `Pandit ji is matching you with ${num(pool.length)} developers`)),
    el('div', 'rv-s', T('tumhara circle · poora GitHub · rishta pool · celebrities', 'your circle · all of GitHub · the rishta pool · celebrities')));
  const ring = el('div', 'ring'); const img = avatar(winner.avatar, 200); ring.append(img);
  const nm = el('b'); box.append(ring, nm);
  stage.innerHTML = ''; stage.append(box);
  const faces = pool.slice(0, 40).map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
  const srcs = faces.map(p => p.avatar + (p.avatar.includes('?') ? '&' : '?') + 's=200');
  srcs.forEach(s => { const i = new Image(); i.src = s; });
  let delay = 55, i = 0;
  const end = performance.now() + 2600;
  while (performance.now() < end && faces.length) {
    const k = i++ % faces.length;
    img.src = srcs[k]; nm.textContent = faces[k].name;
    if (playable()) slap(ac.currentTime, 0.05);
    await sleep(delay); delay *= 1.09;
  }
  img.src = winner.avatar + (winner.avatar.includes('?') ? '&' : '?') + 's=200';
  nm.textContent = winner.name;
  box.querySelector('.rv-t').textContent = T('Rishta mil gaya!', 'Rishta found!');
  box.querySelector('.rv-s').textContent = src === 'circle' ? T('tumhare apne circle se', 'from your own circle')
    : src === 'github' ? T('poore GitHub mein se', 'found across all of GitHub')
    : src === 'pool' ? T('rishta pool se', 'from the rishta pool') : T('celebrity rishta', 'a celebrity rishta');
  box.classList.add('won');
  await sleep(1000);
}

/* ---------- export + sharing ---------- */
function waitImages(node) {
  return Promise.all([...node.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
}
let fontCSS = null; // embedded once, reused for every export
async function renderPng(card) {
  const ex = el('div', 'export');
  const clone = card.cloneNode(true);
  ex.append(clone);
  const foot = el('div', 'exfoot'); foot.append(document.createTextNode(T('apna banao →', 'make yours →')), el('b', null, SITE));
  ex.append(foot);
  document.body.append(ex);
  const w = clone.classList.contains('wcard') ? 840 : 640;
  ex.style.width = w + 'px';
  await waitImages(ex);
  try {
    if (!fontCSS) fontCSS = await htmlToImage.getFontEmbedCSS(ex);
    return await htmlToImage.toPng(ex, { pixelRatio: 2, width: w, height: ex.offsetHeight, fontEmbedCSS: fontCSS, style: { opacity: '1', position: 'relative', zIndex: 'auto' } });
  } finally { ex.remove(); }
}
const toBlob = url => fetch(url).then(r => r.blob());
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }
const xIntent = text => window.open('https://x.com/intent/post?text=' + encodeURIComponent(text), '_blank', 'noopener');

function actions(card, file, share, extra) {
  const row = el('div', 'actions');
  const btn = (label, cls, fn) => {
    const b = el('button', cls, label);
    b.onclick = async () => { const o = b.textContent; b.textContent = '...'; try { await fn(); } catch (e) { toast(T('Nahi hua, screenshot le lo', "Didn't work, take a screenshot")); } b.textContent = o; };
    row.append(b);
  };
  if (extra) btn(extra.label, 'send', async () => xIntent(extra.text));
  btn('⬇ Download', '', async () => { const a = document.createElement('a'); a.href = await renderPng(card); a.download = file; a.click(); });
  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    btn('Copy image', '', async () => {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPng(card).then(toBlob) })]);
      toast(T('Copied. X pe paste kar do', 'Copied. Paste it on X'));
    });
  }
  btn('Share on X', 'x', async () => xIntent(share.x));
  btn(T('Family group mein bhejo', 'Send to the family group'), 'wa', async () => {
    const f = new File([await toBlob(await renderPng(card))], file, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) await navigator.share({ files: [f], text: share.wa });
    else window.open('https://wa.me/?text=' + encodeURIComponent(share.wa), '_blank', 'noopener');
  });
  return row;
}

function pageUrl(u, m) {
  const q = new URLSearchParams({ u }); if (m) q.set('m', m);
  return `https://${SITE}?${q}`;
}
const tagOf = p => (p.twitter ? '@' + p.twitter : p.name);

/* ---------- celebration: petals, stamp thud, dhol ---------- */
let soundOn = true;
try { soundOn = localStorage.getItem('gr-sound') !== 'off'; } catch (e) {}
let ac = null;
function unlockAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch (e) {}
}
function drum(t, f0, f1, dur, gain) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
}
function slap(t, gain) {
  const len = Math.floor(ac.sampleRate * 0.08), buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.8; g.gain.value = gain;
  src.connect(f).connect(g).connect(ac.destination); src.start(t);
  drum(t, 420, 300, 0.07, gain * 0.5);
}
function playable() { return soundOn && ac && ac.state === 'running'; }
function thud() { if (!playable()) return; const t = ac.currentTime; drum(t, 160, 38, 0.4, 0.9); slap(t, 0.25); }
function dhol() {
  if (!playable()) return;
  const t0 = ac.currentTime + 0.05, step = 60 / 150 / 2; // bhangra-ish 8ths at 150 bpm
  const bar = ['B', 'S', '', 'S', 'B', 'S', 'B', 'S'];
  for (let r = 0; r < 3; r++) bar.forEach((x, i) => {
    const t = t0 + (r * 8 + i) * step;
    if (x === 'B') { drum(t, 130, 52, 0.32, 0.8); slap(t, 0.12); }
    if (x === 'S') slap(t, 0.32);
  });
  drum(t0 + 24 * step, 140, 45, 0.6, 1); slap(t0 + 24 * step, 0.4);
}
function petals(n) {
  const box = el('div', 'petals'); document.body.append(box);
  const colors = ['#f59e0b', '#ea580c', '#fbbf24', '#f97316', '#e11d48', '#fde68a'];
  for (let i = 0; i < n; i++) {
    const p = el('i'), s = 8 + Math.random() * 12;
    p.style.cssText = `left:${Math.random() * 100}vw;width:${s}px;height:${s * 0.8}px;background:${colors[i % colors.length]};` +
      `animation-duration:${3 + Math.random() * 3.5}s;animation-delay:${Math.random() * 1.2}s;--dx:${(Math.random() - 0.5) * 240}px;--r:${Math.random() * 900 - 450}deg`;
    box.append(p);
  }
  setTimeout(() => box.remove(), 8500);
}
function celebrate(total) {
  if (total >= 25) { petals(total >= 32 ? 160 : 100); dhol(); }
  else if (total >= 18) { petals(35); thud(); }
  else thud();
}

/* ---------- page ---------- */
let last = null; // { a, b, total, src, cands }

function render() {
  const { a, b, total, src, cands } = last;
  const stage = $('stage'), more = $('more');
  stage.innerHTML = ''; more.innerHTML = '';
  if (b) {
    const url = pageUrl(a.login, b.login);
    const solo = el('div', 'solo'); const wc = weddingCard(a, b, total, src);
    solo.append(wc, actions(wc, `shaadi-${a.login}-${b.login}.png`, {
      x: T(`github ne mera rishta pakka kar diya 😭\n\n${a.name} weds ${b.name}, ${total}/36 gun mile\n\napna soulmate dhoondo: ${url}`,
        `github found my soulmate 😭\n\n${a.name} weds ${b.name}, ${total}/36 gunas matched\n\nfind yours: ${url}`),
      wa: T(`Mummy rishta pakka 😭 ${a.name} weds ${b.name}, ${total}/36 gun mile. ${url}`,
        `Mom, I found someone 😭 ${a.name} weds ${b.name}, ${total}/36 gunas matched. ${url}`),
    }, {
      label: b.twitter ? T(`💌 @${b.twitter} ko rishta bhejo`, `💌 Send rishta to @${b.twitter}`) : T('💌 Rishta bhejo', '💌 Send the rishta'),
      text: T(`${tagOf(b)} tumhare liye rishta aaya hai 😭\n\n${a.name} weds ${b.name}, ${total}/36 gun mile\n\n${url}`,
        `${tagOf(b)} you just got a rishta (a marriage proposal) 😭\n\n${a.name} weds ${b.name}, ${total}/36 gunas matched\n\n${url}`),
    }));
    stage.append(solo);
  }
  const c1 = el('div', 'col'); const bio = biodataCard(a, b ? { other: b, total } : null);
  const url1 = pageUrl(a.login);
  c1.append(bio, actions(bio, `biodata-${a.login}.png`, {
    x: T(`meri github ka rishta biodata ban gaya 😭\n\napna banao: ${url1}`, `github made my desi marriage biodata 😭\n\nmake yours: ${url1}`),
    wa: T(`Mummy ye dekho mera biodata 😭 ${url1}`, `Mom, look at my marriage biodata 😭 ${url1}`),
  }));
  stage.append(c1);
  if (b) {
    const c2 = el('div', 'col'); const { card } = kundliCard(a, b);
    const url2 = pageUrl(a.login, b.login);
    c2.append(card, actions(card, `kundli-${a.login}-${b.login}.png`, {
      x: T(`meri aur ${tagOf(b)} ki kundli milayi. ${total}/36, ${verdict(total)[1].toLowerCase()} 😭\n\napni milao: ${url2}`,
        `matched kundlis (horoscopes) with ${tagOf(b)}. ${total}/36, ${verdict(total)[1].toLowerCase()} 😭\n\nmatch yours: ${url2}`),
      wa: T(`Kundli mil gayi 😭 ${total}/36 ${url2}`, `Our kundli matched 😭 ${total}/36 ${url2}`),
    }));
    stage.append(c2);
  }
  more.append(moreSection(a, cands, b && b.login));
}

function moreSection(a, cands, current) {
  const wrap = el('div', 'more');
  const chip = c => {
    const btn = el('button', 'chip');
    btn.append(avatar(c.other.avatar, 56), document.createTextNode(c.other.name + ' '), el('em', null, `${c.total}/36`));
    btn.onclick = () => { unlockAudio(); showMatch(c); scrollTo({ top: 0, behavior: 'smooth' }); };
    return btn;
  };
  [['circle', T('Tumhare circle se rishte', 'Rishtas from your circle')],
   ['github', T('Poore GitHub se', 'From all of GitHub')],
   ['pool', T('Rishta pool se', 'From the rishta pool')],
   ['famous', T('Celebrity rishte', 'Celebrity rishtas')]].forEach(([src, title]) => {
    const list = cands.filter(c => c.src === src && c.other.login !== current).slice(0, 10);
    if (!list.length) return;
    const chips = el('div', 'chips'); list.forEach(c => chips.append(chip(c)));
    wrap.append(el('h4', null, title), chips);
  });
  const worst = cands[cands.length - 1];
  if (worst && cands.length > 8 && worst.other.login !== current) {
    const chips = el('div', 'chips'); const c = chip(worst); c.classList.add('bad'); chips.append(c);
    wrap.append(el('h4', null, T('Pandit ji ne door rehne bola', 'Pandit ji says stay away')), chips);
  }
  return wrap;
}

async function showMatch(c) {
  await upgrade(c.other);
  c.total = kundli(last.a, c.other).total;
  Object.assign(last, { b: c.other, total: c.total, src: c.src });
  render();
  celebrate(c.total);
  history.replaceState(null, '', '?' + new URLSearchParams({ u: last.a.login, m: c.other.login }));
}

const STEPS = () => [
  T('Pandit ji GitHub khol rahe hain', 'Pandit ji is opening your GitHub'),
  T('Repos gin rahe hain', 'Counting your repos'),
  T('Commit ka time dekh ke rashi nikal rahe hain', 'Reading your rashi from your commit hours'),
];

async function run(u, m, opts = {}) {
  const stage = $('stage');
  $('err').textContent = ''; $('more').innerHTML = '';
  document.body.classList.add('searching');
  stage.innerHTML = '<div class="loading"><b></b><span></span></div>';
  const lb = stage.querySelector('b'), sub = stage.querySelector('span');
  let i = 0; lb.textContent = STEPS()[0] + '...';
  sub.textContent = T('ek minute, kundli ban rahi hai', 'one sec, casting your kundli');
  let tick = setInterval(() => { i = Math.min(i + 1, STEPS().length - 1); lb.textContent = STEPS()[i] + '...'; }, 450);
  const minWait = sleep(m ? 1700 : 1000);
  try {
    const a = await load(u);
    let circle = [], search = [];
    if (!m) {
      circle = await loadCircle(a, (done, n) => {
        if (tick) { clearInterval(tick); tick = null; }
        lb.textContent = T(`Tumhare circle ke ${done}/${n} logon ki kundli ban gayi`, `Checked ${done} of ${n} people from your circle`);
      }).catch(() => []);
      if (tick) { clearInterval(tick); tick = null; }
      lb.textContent = T(`Ab poore GitHub pe ${searchLang(a) || ''} wale dhoondh rahe hain...`, `Now searching all of GitHub for ${searchLang(a) || ''} devs like you...`);
      search = await loadSearch(a, new Set(circle.map(d => d.login.toLowerCase())), (done, n) => {
        lb.textContent = T(`Poore GitHub se ${done}/${n} rishte check ho gaye`, `Checked ${done} of ${n} developers from across GitHub`);
      }).catch(() => []);
    }
    const pool = await poolPromise;
    const cands = candidates(a, circle, search, pool);
    // real names and X handles for the people most likely to be shown
    const top = cands.slice(0, 3).filter(c => c.other.lite);
    if (top.length) {
      await Promise.all(top.map(c => upgrade(c.other)));
      top.forEach(c => { c.total = kundli(a, c.other).total; });
      cands.sort(byScore);
    }
    let b = null, src = 'manual', total = 0;
    if (m) { b = await load(m); total = kundli(a, b).total; }
    else if (cands[0]) { b = cands[0].other; src = cands[0].src; total = cands[0].total; }
    await minWait;
    if (tick) clearInterval(tick);
    if (!m && b) await reveal(stage, cands.map(c => c.other), b, src);
    last = { a, b, total, src, cands };
    render();
    if (b) celebrate(total);
    if (opts.join) joinPool(a);
    history.replaceState(null, '', '?' + new URLSearchParams(m ? { u: a.login, m: b.login } : { u: a.login }));
  } catch (e) {
    if (tick) clearInterval(tick);
    if (last) render(); else renderLanding();
    $('err').textContent = e.message === 'notfound' ? T('Ye username GitHub pe nahi mila', 'That username is not on GitHub')
      : e.message === 'rate' ? T('GitHub ne thoda rukne bola hai (rate limit). 10 min baad try karo', 'GitHub asked us to slow down (rate limit). Try again in 10 minutes')
        : T('Kuch gadbad ho gayi, dobara try karo', 'Something broke, try again');
  }
}

function applyStatic() {
  document.documentElement.lang = LANG === 'en' ? 'en' : 'hi-Latn';
  $('lang-desi').classList.toggle('on', LANG === 'desi');
  $('lang-en').classList.toggle('on', LANG === 'en');
  $('h1').innerHTML = T('Apna GitHub <em>soulmate</em> dhoondo', 'Find your GitHub <em>soulmate</em>');
  $('tag').textContent = T('Pandit ji tumhara public GitHub padhenge, tumhare circle aur poore GitHub mein rishta dhoondhenge, 36 gun milayenge, aur shaadi ka card chhaap denge.',
    'Pandit ji, the matchmaker, reads your public GitHub, searches your circle and all of GitHub, matches your kundli (horoscope) across 36 gunas, then prints the wedding card.');
  $('mtoggle').textContent = $('mrow').hidden ? T('+ kisi specific se kundli milao', '+ match with someone specific') : T('− sirf mera rishta dhoondo', '− just find my rishta');
  $('u').placeholder = 'your github username';
  $('m').placeholder = T('kisi se kundli milao (optional)', 'match with someone (optional)');
  $('go').textContent = T('Rishta dhoondo', 'Find my rishta');
  const jt = $('joinTxt'); jt.textContent = T('Mujhe bhi rishta pool mein daalo ', 'Add me to the rishta pool ');
  jt.append(el('small', null, T('(sirf public GitHub stats, kabhi bhi hata sakte ho)', '(public GitHub stats only, remove anytime)')));
  if (!last) renderLanding();
  $('foot').textContent = T('for fun, not for actual shaadi. sirf public GitHub stats, pool mein jaana optional hai.',
    'For fun, not for an actual wedding. Public GitHub stats only, joining the pool is optional.');
  $('snd').textContent = soundOn ? '🔊' : '🔇';
  updateCount(); showLeave();
}

// what a first-time visitor sees: where Pandit ji looks, a sample card, how it works
function renderLanding() {
  const stage = $('stage'); stage.innerHTML = ''; $('more').innerHTML = '';
  const land = el('div', 'landing');
  const src = el('div', 'sources');
  [['🫂', T('Tumhara circle', 'Your GitHub circle')], ['🌍', T('Poora GitHub', 'All of GitHub')],
   ['💌', T('Rishta pool', 'The rishta pool')], ['⭐', 'Celebrities']].forEach(([icon, label]) => {
    const s = el('span'); s.append(el('b', null, icon), document.createTextNode(label)); src.append(s);
  });
  land.append(src);
  if (SNAP.gaearon && SNAP.yyx990803) {
    const a = famous('gaearon'), b = famous('yyx990803'), total = kundli(a, b).total;
    const demo = el('div', 'demo');
    demo.append(el('div', 'ribbon', T('Sample rishta · click karo', 'Sample match · tap it')), weddingCard(a, b, total, 'famous'));
    demo.onclick = () => { unlockAudio(); $('u').value = 'gaearon'; $('m').value = 'yyx990803'; showMatchRow(true); run('gaearon', 'yyx990803'); };
    const cap = el('div', 'democap');
    cap.innerHTML = T(`<b>React</b> wale Dan aur <b>Vue</b> wale Evan: ${total}/36. Pandit ji ne haan bol diya.`,
      `Dan from <b>React</b> and Evan from <b>Vue</b>: ${total}/36. Pandit ji approves.`);
    land.append(demo, cap);
  }
  const how = el('div', 'how');
  [[1, T('Biodata', 'Your biodata'), T('Stars ban jaate hain kad, top language gotra, aur commit ka time rashi.',
      'Your stars become your height, your top language your clan, your commit hours your star sign.')],
   [2, T('Kundli milan', 'Kundli match'), T('8 gun: stack, neend ka time, weekend commits aur stars. 36 mein se score.',
      '8 gunas from your stack, sleep schedule, weekend commits and stars, scored out of 36.')],
   [3, T('Shaadi ka card', 'The wedding card'), T('Download karo, family group mein bhejo, ya seedha rishta bhejo.',
      'Download it, post it, or send the rishta straight to your match on X.')]].forEach(([n, title, text]) => {
    const d = el('div'); d.append(el('i', null, String(n)), el('b', null, title), el('p', null, text)); how.append(d);
  });
  land.append(how);
  stage.append(land);
}

function showMatchRow(on) {
  $('mrow').hidden = !on;
  if (!on) $('m').value = '';
  $('mtoggle').textContent = on ? T('− sirf mera rishta dhoondo', '− just find my rishta') : T('+ kisi specific se kundli milao', '+ match with someone specific');
}

function setLang(l) {
  LANG = l;
  try { localStorage.setItem('gr-lang', l); } catch (e) {}
  applyStatic();
  if (last) render();
}

const clean = s => s.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?github\.com\//, '').split(/[/?#]/)[0];

$('f').addEventListener('submit', e => {
  e.preventDefault();
  unlockAudio();
  const u = clean($('u').value), m = clean($('m').value);
  try { localStorage.setItem('gr-join', $('join').checked ? 'on' : 'off'); } catch (e) {}
  if (u) run(u, m, { join: $('join').checked });
});
$('lang-desi').onclick = () => setLang('desi');
$('lang-en').onclick = () => setLang('en');
$('snd').onclick = () => {
  soundOn = !soundOn; $('snd').textContent = soundOn ? '🔊' : '🔇';
  try { localStorage.setItem('gr-sound', soundOn ? 'on' : 'off'); } catch (e) {}
  if (soundOn) unlockAudio();
};
try { if (localStorage.getItem('gr-join') === 'off') $('join').checked = false; } catch (e) {}

$('mtoggle').onclick = () => { showMatchRow($('mrow').hidden); if (!$('mrow').hidden) $('m').focus(); };

const tryRow = $('try');
tryRow.append('try: ');
['torvalds', 'karpathy', 'hiteshchoudhary', 'ThePrimeagen', 't3dotgg'].filter(x => SNAP[x.toLowerCase()]).forEach(x => {
  const s = SNAP[x.toLowerCase()].user;
  const a = el('a'); a.append(avatar(s.avatar_url, 44), document.createTextNode(s.name || s.login));
  a.onclick = () => { unlockAudio(); $('u').value = s.login; showMatchRow(false); run(s.login); };
  tryRow.append(a);
});

applyStatic();
poolPromise.then(updateCount);

const q = new URLSearchParams(location.search);
if (q.get('u')) {
  $('u').value = q.get('u');
  if (q.get('m')) { $('m').value = q.get('m'); showMatchRow(true); }
  run(q.get('u'), q.get('m'));
}
