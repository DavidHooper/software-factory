# Coding standards

How code in this repo is written. `code-review` checks every diff against these, and `/review-pr` fixes a breach only if it also breaks the flow (`docs/agents/review.md`). Rules a tool can enforce belong in ESLint instead.

- **Errors name the offending values.** A thrown error's message includes the input that caused it, e.g. `` `Invalid port: ${port}` ``.
- **Privileges trust only what agents can't write.** Code that grants a privilege (a review skip, a merge) reads its inputs from a record no agent run can forge: the dispatcher's own event, `main`. A PR body, a branch name, comment text, the bot's login and anything in a session's environment are agent-writable. Agents themselves are trusted (#161): the relay's labels and actions, and the harness supervisor's comments, are open to every agent run, and a merge still rests on the merge gate.
- **A privilege decision is a pure, tested function.** The CLI (e.g. `.harness/src/cli/`) gathers facts and applies the decision; the decision and every precondition live in a function with a test for each refusal.
- **Guards fail closed, on current state.** A lookup error refuses the privilege. The guard checks the state as it is now, never a historical fact that once held.
- **One check per trust fact.** When a format defines a fact that a privilege rests on, every reader uses the one function that checks it, and parsers reuse the writer's constants.
