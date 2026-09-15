# Fixtures

Each new endpoint arrives as a stub controller plus a JSON fixture here, named after the endpoint
(e.g. `items-list.json`), matching the exact shape the generated client's method returns — a page
can start against the fixture the day the contract lands and switch to the real endpoint once the
backend implements it, per `docs/FRONTEND_BRIEF.md` rule 3.

`items-list.json` is scaffolding only, establishing the naming/shape convention for the *next*
screen whose contract lands ahead of its implementation — `Items.tsx` already has a real, working
`ItemsController` endpoint, so it calls the generated client directly and does not read this file.
Nothing in `apps/web` currently imports it.
