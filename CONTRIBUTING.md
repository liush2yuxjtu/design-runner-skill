# Contributing

Keep runner adapters factual and policy checked.

1. Add or change capabilities in `runners/*.json`.
2. Add portable sequencing in `workflows.json` and `references/workflows.md`.
3. Add a focused test in `tests/test_runner.py`.
4. Run `python3 -m unittest discover tests -p 'test_*.py' -v`.

Never commit provider credentials or claim native support for an emulated capability.
