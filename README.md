# js-code-analyzer

[![tests](https://github.com/dguywhoknows/js-code-analyzer/actions/workflows/tests.yml/badge.svg)](https://github.com/dguywhoknows/js-code-analyzer/actions/workflows/tests.yml)

Paste JavaScript and get a live call graph, complexity metrics, and AI explanations, refactors and unit tests.

Live: https://dguywhoknows.github.io/js-code-analyzer/

## Overview

Code Atlas parses your code into a real AST with acorn and maps it: every function, method, arrow function and export; who calls whom; and cyclomatic complexity, nesting depth, Halstead volume and a maintainability index for each. The call graph is laid out with a hand-written force-directed simulation. Pick any function and an AI reviewer can explain it, propose a lower-complexity refactor, write a Jest test suite, or hunt for bugs, with the metrics fed into its context.

## Pages

- **Analyze**
- **Project**
- **Report**
- **History**
- **Settings**

## Features

- AST-based function discovery: declarations, arrows, class methods, object methods, exports
- Per-function cyclomatic complexity, max nesting, params, returns, LOC, Halstead volume, maintainability index
- Call-graph resolution (direct, method and this.* calls) rendered as a force-directed SVG graph
- Local lint: high complexity, deep nesting, long functions, too many params, never-called code
- Token-accurate syntax highlighting with line focus on the selected function
- AI: explain, refactor, Jest tests, bug hunt, plus a whole-module architecture summary
- Project page: analyze many files at once (paste, upload or edit), with a layered import graph and cross-file call resolution through ES module imports
- Report page: A-F health grade with score breakdown, complexity histogram, size-weighted hotspots, issue list, Markdown export and an AI refactoring summary
- History page: snapshot the project over time and chart health score and average complexity trends

## How it works

LLM calls are used for:

- Function-level prompts enriched with static-analysis context (complexity, callers, callees)
- Module-level architecture summary from metrics + source

Everything else (parsing, metrics, call-graph resolution, force layout, highlighting) runs locally in the browser.

## Getting started

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/dguywhoknows/js-code-analyzer.git
cd js-code-analyzer
python -m http.server 8000
```

Then open http://localhost:8000.

### Configuration

Without an API key the app runs in demo mode with sample model output. To use a live model, open
**Settings → Configure provider** and paste a key for [Groq](https://console.groq.com/keys) or
[OpenRouter](https://openrouter.ai/keys). The key is stored in this browser's `localStorage` (namespaced to
this app) and is sent only to the selected provider.

## Testing

`src/core.js` holds the app's logic as pure functions and is covered by 12 unit tests.

```bash
node tests/run-node.js        # CI runs this on every push
```

Or open `tests/index.html` in a browser ([live](https://dguywhoknows.github.io/js-code-analyzer/tests/)).

## Project structure

```
index.html           markup for every page
src/app.js           UI, page wiring and event handlers
src/core.js          pure logic with no DOM access (unit-tested)
src/demo.js          sample responses used when no API key is configured
src/lib/ai.js        LLM client: Groq / OpenRouter, streaming, JSON mode, retries
src/lib/dom.js       DOM helpers, namespaced storage, markdown renderer
src/lib/router.js    hash router and the Settings page
styles/base.css      design tokens and shared components
styles/app.css       app-specific styles
tests/               unit tests (browser runner + Node runner for CI)
```

## Tech

- acorn parser + tokenizer (cdnjs)
- Custom AST walker, McCabe complexity, Halstead metrics, maintainability index
- Force-directed graph layout from scratch
- Analyzer, import resolution, health scoring, hotspots and snapshots in src/core.js; tests run against the real acorn parser in CI
- Vanilla JavaScript, no framework or bundler
- Deployed with GitHub Pages

## License

MIT
