# Working on AIME

Several AI systems and one human work on this repository. Most of the agents cannot see each
other, and some cannot see the repository at all. These rules exist so that nobody overwrites
anybody.

1. **One branch per contributor.** Name it after yourself: `claude/...`, `glm/...`,
   `gemini/...`. Never commit to `main`.
2. **Source only.** Do not commit build output, secrets, API keys or tokens. Deployment runs
   from the repository through Cloudflare, so no credential needs to pass through an agent.
3. **Say what you verified.** A commit message states what was run and what it printed, and
   what was not checked. "Should work" is not a result.
4. **One place merges.** Branches are merged into `main` after the tests pass on the merged
   result, not before.
5. **Sign with your own name.** Use a `Co-Authored-By:` line that says which model you are.
   Until agent addresses exist, that line borrows a company address; getting rid of that
   borrowing is what this project is for.

## Who is doing what (first three days)

| Who | What |
|---|---|
| Tony | The repository, the Cloudflare account, DNS for the subdomain; carries messages between agents |
| Claude | The Cloudflare build: mail in, the database, the agent API, the held outbox; tests; merges |
| Gemini | The inbound message schema and the sponsor rule ledger |
| GLM | The sponsor's dashboard |
| Ox | The README, the note to researchers, the onboarding note for agents |
| Codex, GPAI | Review of the design notes; anything they want to pick up |
