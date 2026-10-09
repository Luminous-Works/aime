// AIME — Cloudflare Email Service wrapper. The decisions live in src/core.js;
// this file only wires them to Cloudflare (Email Service in, send_email out).
import { Agent, routeAgentEmail, routeAgentRequest } from "agents";
import {
  createCatchAllEmailResolver,
  isAutoReplyEmail,
} from "agents/email";
import PostalMime from "postal-mime";
import { guardEmail, remember, composeReply, cannedReply } from "./core.js";

export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_BODY = 6000;

// Call whatever brain is configured. Prefer an external OpenAI-compatible endpoint
// (open reply/draft engines later), else Workers AI, else no brain (canned replies).
async function callBrain(env, messages) {
  if (env.AIME_LLM_URL) {
    if (!env.AIME_LLM_API_KEY) throw new Error("AIME_LLM_URL set but no AIME_LLM_API_KEY");
    const r = await fetch(String(env.AIME_LLM_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.AIME_LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AIME_LLM_MODEL || "default",
        messages,
      }),
    });
    if (!r.ok) throw new Error(`llm http ${r.status}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content ?? "";
  }
  if (env.AI) {
    const out = await env.AI.run(env.AIME_LLM_MODEL || DEFAULT_MODEL, { messages });
    if (typeof out === "string") return out;
    return (out && (out.response || (out.result && out.result.text))) || "";
  }
  throw new Error("no brain");
}

export class EmailAgent extends Agent {
  initialState = { thread: [], dropped: 0, lastAt: null };

  async onEmail(email) {
    const raw = await email.getRaw();
    const parsed = await PostalMime.parse(raw);
    const from = String(email.from || "");
    const subject = String(parsed.subject || "(no subject)");
    const body = (parsed.text || parsed.html || "").slice(0, MAX_BODY);

    // Loop guard: never answer a machines' auto-reply/auto-notify/out-of-office.
    if (isAutoReplyEmail(email.headers)) {
      console.log(`[aime] skipped auto-reply from ${from}`);
      return;
    }

    // Allowlist + size gate, before any model call.
    const g = guardEmail({
      from,
      subject,
      body,
      allowedCsv: this.env.AIME_ALLOWED || "",
      maxBytes: MAX_BODY,
    });
    if (!g.allow) {
      const dropped = (this.state.dropped || 0) + 1;
      this.setState({ ...this.state, dropped });
      console.log(`[aime] dropped <${from}>: ${g.reason}`);
      return;
    }

    // Remember the inbound turn, bounded.
    const thread1 = remember(this.state.thread, {
      role: "user",
      text: body,
      at: new Date().toISOString(),
    });
    this.setState({ ...this.state, thread: thread1, lastAt: new Date().toISOString() });

    // Compose the reply. A brain failure degrades to a canned, honest reply.
    let result;
    try {
      result = await composeReply({
        subject,
        body,
        thread: thread1,
        brain: (messages) => callBrain(this.env, messages),
      });
    } catch (e) {
      console.error(`[aime] brain error: ${e && e.message}`);
      result = { reply: cannedReply("brain"), subject: `re: ${subject}` };
    }

    // Remember the outbound turn too, so the next message has context.
    const thread2 = remember(thread1, {
      role: "assistant",
      text: result.reply,
      at: new Date().toISOString(),
    });
    this.setState({ ...this.state, thread: thread2, lastAt: new Date().toISOString() });

    // replyToEmail is structurally bound to the original sender: we never compose
    // to a sender-instructed address, only back to the person who wrote to us.
    await this.replyToEmail(email, {
      fromName: this.env.AIME_FROM_NAME || "AIME",
      subject: result.subject,
      body: result.reply,
      secret: this.env.EMAIL_SECRET,
    });
    console.log(`[aime] replied to <${from}>`);
  }
}

// One mailbox. aime@luminaaerospace.com lands here; the local part is the inbox id.
export default {
  email: (message, env, ctx) =>
    routeAgentEmail(message, env, ctx, {
      resolver: createCatchAllEmailResolver("EmailAgent", "aime"),
    }),
  fetch: (request, env, ctx) =>
    routeAgentRequest(request, env, ctx) ??
    new Response("AIME worker online. Inbound: aime@luminaaerospace.com.", {
      headers: { "content-type": "text/plain" },
    }),
};