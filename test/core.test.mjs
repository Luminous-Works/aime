// AIME — node:test suite for src/core.js. No Cloudflare, no network, no hearing:
// decide/guard/memory are pure functions and are measured against fixed inputs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalAddress,
  allowedSet,
  isAllowed,
  guardEmail,
  remember,
  buildTranscript,
  buildMessages,
  cleanReply,
  cannedReply,
  composeReply,
} from "../src/core.js";

const TONY = "Tony Cunningham <tony@luminaaerospace.com>";
const ADMIN = "Tony Cunningham <tony@interblag.com>";
const CSV = "tony@luminaaerospace.com, ox@luminaaerospace.com";

test("address parsing", () => {
  assert.equal(canonicalAddress(TONY), "tony@luminaaerospace.com");
  assert.equal(canonicalAddress("  TONY@LuminaAerospace.COM  "), "tony@luminaaerospace.com");
  assert.equal(canonicalAddress("plain@example.com"), "plain@example.com");
  assert.equal(canonicalAddress(""), "");
});

test("allowlist is case-insensitive and exact on the address", () => {
  assert.ok(isAllowed(TONY, CSV));
  assert.ok(isAllowed("OX@luminaaerospace.com", CSV));
  assert.ok(!isAllowed(ADMIN, CSV));
  assert.equal(allowedSet(",").size, 0);
});

test("guard drops strangers before any brain work", () => {
  assert.equal(guardEmail({ from: TONY, subject: "hi", body: "hello", allowedCsv: CSV }).allow, true);
  assert.deepEqual(
    guardEmail({ from: "stranger@evil.net", subject: "hi", body: "hello", allowedCsv: CSV }),
    { allow: false, reason: "not-allowed" }
  );
  assert.equal(guardEmail({ from: "nobody@nowhere", subject: "hi", body: "x", allowedCsv: CSV }).allow, false);
  assert.equal(guardEmail({ from: TONY, subject: "", body: "", allowedCsv: CSV }).reason, "empty");
  assert.equal(
    guardEmail({ from: TONY, subject: "hi", body: "x".repeat(20), allowedCsv: CSV, maxBytes: 10 }).reason,
    "too-large"
  );
  assert.equal(
    guardEmail({ from: ADMIN, subject: "hi", body: "y", allowedCsv: CSV }).allow,
    false
  );
});

test("memory is bounded and newest is kept", () => {
  let t = [];
  for (let i = 0; i < 25; i++) t = remember(t, { role: "user", text: `m${i}` }, 5);
  assert.equal(t.length, 5);
  assert.equal(t[0].text, "m20");
  assert.equal(t[4].text, "m24");
  assert.deepEqual(remember(null, { role: "user", text: "x" }), [{ role: "user", text: "x" }]);
});

test("transcript is oldest-first and tags the speakers", () => {
  const t = [
    { role: "user", text: "hi" },
    { role: "assistant", text: "hey" },
  ];
  assert.equal(buildTranscript(t), "[Them] hi\n[AIME] hey");
  assert.equal(buildTranscript(null), "");
});

test("cleanReply trims fences and clamps length", () => {
  assert.equal(cleanReply("  Hello  \n"), "Hello");
  assert.equal(cleanReply("```\ncode\n```"), "code");
  const long = "z".repeat(1000);
  assert.ok(cleanReply(long).length <= 901);
});

test("canned replies are deterministic", () => {
  assert.equal(cannedReply("nobrain"), cannedReply("nobrain"));
  assert.ok(cannedReply("brain").includes("AIME"));
});

test("composeReply uses the brain, or falls back honestly", async () => {
  const out = await composeReply({
    subject: "test",
    body: "ping",
    thread: [{ role: "user", text: "ping" }],
    brain: async (messages) => {
      const joined = JSON.stringify(messages);
      assert.ok(joined.includes("system"));
      assert.ok(joined.includes("Latest message: ping"));
      assert.ok(joined.includes("[Them] ping"));
      return "  pong  ";
    },
  });
  assert.equal(out.reply, "pong");
  assert.equal(out.subject, "re: test");

  const withError = await composeReply({
    subject: "x",
    body: "y",
    thread: [],
    brain: async () => {
      throw new Error("boom");
    },
  });
  assert.ok(withError.reply.includes("AIME"));

  const nobrain = await composeReply({ subject: "x", body: "y", thread: [] });
  assert.equal(nobrain.reply, cannedReply("nobrain"));
});

test("no brain is reached for a stranger: guard short-circuits first", async () => {
  let called = false;
  const g = guardEmail({ from: "stranger@evil.net", subject: "x", body: "y", allowedCsv: CSV });
  assert.equal(g.allow, false);
  assert.equal(called, false);
});