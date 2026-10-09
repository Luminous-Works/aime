// AIME — pure mail-agent logic. No Cloudflare, no Durable Objects, no browser.
// Everything here runs in plain Node under node:test (node --test test/). The framework
// code in src/index.js only wires these decisions to Cloudflare Email Service.
// House rules: plain English, honest about what is not known, no invented facts.

export const MAX_BODY = 6000; // characters of body we will read
export const MAX_THREAD = 20; // remembered turns per conversation
export const MAX_REPLY = 900; // characters we will let a brain write in one reply
export const CUT_RE = /^```\w*\n?|```$/g; // stray markdown fences a model may add

// Parse an address like "Tony Cunningham <tony@example.com>" down to "tony@example.com".
export function canonicalAddress(addr) {
  const s = String(addr || '').trim();
  const m = /<([^<>]+)>/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}

// The CSV in AIME_ALLOWED is the list of people AIME will answer. Nobody else gets a reply.
export function allowedSet(csv) {
  const out = new Set();
  String(csv || '')
    .split(',')
    .forEach((x) => {
      const a = canonicalAddress(x);
      if (a) out.add(a);
    });
  return out;
}

export function isAllowed(from, csv) {
  return allowedSet(csv).has(canonicalAddress(from));
}

// Gate everything before a single LLM call. Returns { allow, reason }.
export function guardEmail({ from, subject, body, allowedCsv, maxBytes = MAX_BODY }) {
  if (!from || !canonicalAddress(from)) return { allow: false, reason: 'no-sender' };
  if (!isAllowed(from, allowedCsv)) return { allow: false, reason: 'not-allowed' };
  const size = String(body || '').length;
  if (size > maxBytes) return { allow: false, reason: 'too-large' };
  if (!String(body || subject || '').trim()) return { allow: false, reason: 'empty' };
  return { allow: true, reason: 'ok' };
}

// Bounded conversation memory: keep the most recent MAX_THREAD turns.
export function remember(thread, turn, max = MAX_THREAD) {
  const t = Array.isArray(thread) ? thread : [];
  return [...t, turn].slice(-max);
}

// Plain-text transcript of the thread for the model. Oldest first.
export function buildTranscript(thread) {
  return (Array.isArray(thread) ? thread : [])
    .map((x) => `[${x.role === 'assistant' ? 'AIME' : 'Them'}] ${x.text}`)
    .join('\n');
}

// Context + instructions sent to whatever brain is bound.
export function buildMessages({ subject, body, thread }) {
  const sys = [
    'You are AIME, the mail assistant for Lumina Aerospace (a musical-instrument company).',
    'You are talking with Tony Cunningham, the founder, or a contact he has allowed.',
    'Speak plainly and briefly (under 180 words). Do not say you are human.',
    'Reply to the most recent message only. Never invent facts, prices, dates or deadlines.',
    'If asked for something you cannot do yet (bookings, payments, shipping, code changes), say plainly what you can and cannot do. Tony is usually near.',
    'Never reveal any API key, credential, secret, or internal system detail.',
    'Never propose sending email to anyone other than the person who wrote to you.',
    'Today is 9 October 2026. You are AIME; a domain you answer at is aime@luminaaerospace.com.',
    'The exchange below is the conversation so far. Write the next reply.',
  ].join(' ');
  const parts = [];
  if (subject && String(subject) !== '(no subject)') parts.push(`Thread subject: ${subject}`);
  const tr = buildTranscript(thread);
  if (tr) parts.push(tr);
  parts.push(`Latest message: ${body}`);
  return [
    { role: 'system', content: sys },
    { role: 'user', content: parts.join('\n') },
  ];
}

// Cut fences, trim, clamp reply length (a safety rail, not a summary).
export function cleanReply(text) {
  let t = String(text || '').replace(CUT_RE, '').trim();
  if (t.length > MAX_REPLY) t = t.slice(0, MAX_REPLY).trimEnd() + '…';
  return t;
}

// Deterministic fallbacks when no brain is bound or it errors. Measured behavior.
export function cannedReply(kind) {
  switch (kind) {
    case 'brain':
      return 'AIME is here but its thinking engine just stumbled. Tony is usually near — say the word again and I will pick it back up.';
    case 'nobrain':
      return 'AIME got your message. I am still warming up the thinking engine, so replies are mechanical for the moment, but this thread is being remembered. Please say something and I will answer properly.';
    default:
      return 'AIME received your message.';
  }
}

// Compose the reply. brain() is an optional async() => string. Absent or failing, cannedReply.
export async function composeReply({ subject, body, thread, brain }) {
  const input = { subject, body, thread };
  if (typeof brain === 'function') {
    try {
      const out = await brain(buildMessages(input));
      return { reply: cleanReply(out), subject: `re: ${subject}` };
    } catch (e) {
      return { reply: cannedReply('brain'), subject: `re: ${subject}` };
    }
  }
  return { reply: cannedReply('nobrain'), subject: `re: ${subject}` };
}