# SHJ3 — Python-side entry points.
#
# `make verify` is the Python half of the single verification command; the
# TypeScript half is `pnpm verify`. ADR-0008 declined CI, so between them these
# two commands are the only definition of "passing" that exists — one command,
# one meaning of green, so a reviewer never has to work out which subset of
# checks constitutes a pass.

AI := apps/ai
PY := $(AI)/.venv/Scripts/python.exe
BIN := $(AI)/.venv/Scripts

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "SHJ3 — Python targets (apps/ai)"
	@echo ""
	@echo "  make setup      create the venv and install with dev extras"
	@echo "  make format     ruff format"
	@echo "  make lint       ruff check"
	@echo "  make types      mypy --strict"
	@echo "  make arch       import-linter: layering + the swap test"
	@echo "  make test       pytest (unit)"
	@echo "  make test-int   pytest -m integration (needs docker compose up)"
	@echo "  make verify     everything above, in order"
	@echo ""
	@echo "TypeScript side: pnpm verify"

.PHONY: setup
setup:
	cd $(AI) && uv venv --python 3.12 && uv pip install -e ".[dev]"

.PHONY: format
format:
	cd $(AI) && .venv/Scripts/python.exe -m ruff format src tests

.PHONY: format-check
format-check:
	cd $(AI) && .venv/Scripts/python.exe -m ruff format --check src tests

.PHONY: lint
lint:
	cd $(AI) && .venv/Scripts/python.exe -m ruff check src tests

.PHONY: types
types:
	cd $(AI) && .venv/Scripts/python.exe -m mypy src

# The Python half of architecture.md §3 and §4.
#
# `lint-imports`, not `python -m importlinter.cli` — the module entry point
# exits 0 without running anything, which silently turns this gate off.
.PHONY: arch
arch:
	cd $(AI) && .venv/Scripts/lint-imports.exe

.PHONY: test
test:
	cd $(AI) && .venv/Scripts/python.exe -m pytest tests -q -m "not integration and not isolation"

.PHONY: test-int
test-int:
	cd $(AI) && .venv/Scripts/python.exe -m pytest tests -q -m integration

# The tenant isolation release gate (ADR-0002). Runs in the full pass, never
# skipped — a release with this suite unrun or failing is not a release.
.PHONY: test-isolation
test-isolation:
	cd $(AI) && .venv/Scripts/python.exe -m pytest tests -q -m isolation

.PHONY: verify
verify: format-check lint types arch test
	@echo ""
	@echo "PASSED — Python side."
	@echo "Run 'pnpm verify' for the TypeScript side, and 'make test-int' with the stack up."
