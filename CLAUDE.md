# nailstar

Evolutionary YouTube thumbnail engine (TypeScript on Bun). Start with `PLAN.md`; deep specs are in `docs/`.

- Build phases in order (PLAN.md §6). Phase 0 spikes resolve every "verify" note before dependent code is written.
- Every model call goes through `src/providers` (`claude -p`, Opus). Never call `claude` elsewhere, and never use `--bare` (it forces API-key auth).
- Every CLI command supports `--json`, never prompts without a TTY, and uses the exit codes in `docs/cli.md`.
- Prompt templates live in `prompts/` and are versioned; bump `prompts/VERSION` when changing them.
