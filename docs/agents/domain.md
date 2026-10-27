# Domain docs

How skills and agents use this repo's domain documentation.

## Before exploring, read these

- **`GLOSSARY-MAP.md`** at the repo root, if it exists: it points to one `GLOSSARY.md` per context. Read each one
  relevant to your work.
- Otherwise **`GLOSSARY.md`** at the repo root, if it exists.
- **`docs/adr/`**: read the ADRs that touch the area you're working in. A context may also have its own ADRs
  next to its `GLOSSARY.md` (e.g. `apps/api/docs/adr/`).

If any of these don't exist, **carry on without them**. Don't flag their absence or create them up front:
`/grill-with-docs` creates them once real terms and decisions are resolved.

## Layout

Single context:

```
/
├── GLOSSARY.md
├── docs/adr/
│   └── 0001-agent-harness.md
├── apps/
└── libs/
```

Multiple contexts (signalled by `GLOSSARY-MAP.md` at the root):

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                ← system-wide decisions
└── apps/
    ├── api/
    │   ├── GLOSSARY.md
    │   └── docs/adr/        ← decisions scoped to this context
    └── web/
        └── GLOSSARY.md
```

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a test name, a type, a PR description), use the
term exactly as `GLOSSARY.md` defines it, and not the synonyms it lists under _Avoid_.

If the concept you need isn't in the glossary, either you're inventing language the project doesn't use
(reconsider), or there's a real gap. If your work settles the term, add it to the glossary in the same change;
otherwise record the gap as a `missing-context` event in your retro.

## Flag ADR conflicts

If your work contradicts an ADR, say so explicitly in the PR description rather than silently overriding it:

> _Contradicts ADR-0003 (…) — but worth reopening because…_
