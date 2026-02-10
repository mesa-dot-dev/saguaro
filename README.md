# Mesa Code Review CLI

A lightweight code review.

## Install

```bash
brew install mesa-dot-dev/homebrew-tap/code-review
```

## Usage

```bash
mesa --help
mesa init
mesa review
```

## Configuration

- Run `mesa init` inside your repository.
- Set provider key in your environment:
  - `ANTHROPIC_API_KEY`
- Optional: set `MESA_CONFIG` to point to a custom config file.

## License

This CLI is licensed under `Apache-2.0`. See `LICENSE` for details.

## Releasing

Release workflow docs (including dry-run and Homebrew formula update steps):

- `packages/code-review/RELEASING.md`
