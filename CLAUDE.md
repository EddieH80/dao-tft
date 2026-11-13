@AGENTS.md

## AI assistant work

- Before any AI assistant work, read `docs/ml-plan.md` in full.
- Treat its **Project rules** as binding.
- At the end of each job, update its **Steps**, **Decision log** and **Experiment log**.
- Never invent results for GPU or browser runs (training, conversion, WebLLM loading, evals).
  If a run wasn't actually executed and observed, record it as not run or pending.
