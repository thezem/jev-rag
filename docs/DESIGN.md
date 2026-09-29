# Jev Retrieval v1 design

## Goal and acceptance

Provide a portable Node.js retrieval primitive for agents and people. Import source text or a directory, split long documents into attributable passages, ask a natural-language query, choose minimum and maximum return counts, and receive original passages with source metadata. Jev must make semantic retrieval decisions. No embeddings, vector index, database server, text-generating model, or heuristic relevance fallback.

The first use is agent memory, but the API treats all material as documents with stable IDs and arbitrary scalar metadata. A memory is one document; an article, runbook, or long report may produce many chunks.

## Data model and flow

1. `import` accepts an application-owned stable ID, source URI/path, verbatim UTF-8 text, optional title, and scalar metadata. `importFile` and `importDirectory` are adapters for common plain-text formats. Other formats can use a caller-provided extractor and the same `import` API.
2. A paragraph-aware splitter keeps Markdown headings with each resulting chunk's metadata. Oversized paragraphs are sliced. Each chunk records UTF-16 offsets back into the imported text. Reimporting an ID replaces it; an unchanged hash is a no-op.
3. A versioned JSON store holds documents and chunks. It is easy to inspect, back up, copy, or delete. It needs no service to run.
4. `retrieve` applies a hard metadata filter in code, then gives the eligible chunks to `jev.recommend`. Jev sees a bounded page and can select an item or browse. The underlying loop uses up to 22 candidate items per page so navigation and finish controls fit within Jev's 25 choice limit.
5. The return object contains the selected chunks verbatim, `minimumMet`, a stop reason, eligible count, pages fetched, and decision count. A caller can inspect citation metadata and decide whether to use a passage.

## Why this shape

The conventional vectorless design is lexical search followed by semantic reranking. That is fast, but a strict lexical shortlist can omit the exact passage an agent needs when its wording differs from the query. The standalone package lets Jev browse every eligible page within explicit budgets. That uses Jev One's existing navigation behavior and has no hidden alternate selector. Jev Cortex chose this option over a BM25 shortlist for the first version; that choice was advisory, and the live E2E run verifies the implementation separately.

The API keeps ingestion independent from the retrieval operator. A future large-corpus implementation can introduce deterministic directory or topic navigation, indexed manifests, and source adapters without changing the result contract. Any such pruning must make coverage and skipped partitions visible. The v1 implementation deliberately returns budget stop reasons rather than claiming a complete search when it stops early.

## Boundaries

- This is evidence retrieval, not answer generation. The calling agent or human decides what a passage means.
- Jev can make a weak choice. `minimumMet` reports count, not relevance. For high precision, the next version should add an explicit Jev relevance judgment per selected passage with a user-tuned threshold and keep the raw judgment available.
- Browsing a large corpus may use many paid Jev calls. `maxPages`, `maxDecisions`, and `signal` bound it. The package reports when those budgets stop a search.
- The JSON store supports one writer at a time. A production multi-process service should add a lock or interchangeable transactional store. Do not share one file among concurrent writers.
- Directory import skips hidden entries and symlinks, but reads all supported plain-text files into memory. It is not a sandbox for untrusted input. Applications should set import roots, file limits, and extraction policy.
- A single JSON file is practical for small to medium corpora. Partitioned stores and lazy page loading are future work for large repositories.

## Verification performed for v1

The standalone package imports Jev One as a peer dependency; its E2E examples check compatibility. `examples/basic.js` makes a live Gateway query against three unrelated documents and checks the chosen passage and metadata. `examples/paged.js` makes a live query where the relevant passage is on page three; it also checks long-document offsets, a hard metadata filter, replacement, and removal. Both examples use a temporary corpus and print the location for inspection. They need `AI_GATEWAY_API_KEY` in the Node process.
