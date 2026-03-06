# Contributing to Mesa Code Review

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/mesa-dot-dev/code-review.git
cd code-review

# Install dependencies (requires Bun)
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Lint (auto-fix)
bun run lint

# Build
bun run build
```

## Making Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Run `bun test` and `bun run lint` to verify
5. Open a pull request

## Writing Rules

See [plans/writing-rules.md](plans/writing-rules.md) for guidance on writing effective review rules.

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. Run `bun run lint` to auto-fix issues.

## Reporting Bugs

Open an issue at [github.com/mesa-dot-dev/code-review/issues](https://github.com/mesa-dot-dev/code-review/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- `mesa --version` output
- OS and Node.js/Bun version

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 license.
