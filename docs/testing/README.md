# Testing SmartFinora

| File | Use |
| --- | --- |
| `SmartFinora-Test-Checklist.xlsx` | Quick tick list before each release (69 lines: every web and phone menu, daily flow, languages, security). |
| `SmartFinora-Test-Cases.xlsx` | 88 step-by-step test cases with expected results, a Status drop-down, a Summary sheet, a role-by-menu access table and the latest automated results. |

Automated tests (run before handing a build to testers):

```bash
pnpm install && pnpm build:shared
pnpm typecheck                              # API, web and phone
pnpm --filter @localfinance/shared test     # unit tests (loan maths, AI helpers, all six language files)
pnpm --filter @localfinance/api build
pnpm --filter @localfinance/api test        # API end-to-end; needs PostgreSQL (TEST_DATABASE_SERVER, default postgres:postgres@localhost:5432)
```

Last run, 13 Nov 2026: unit tests 37 of 37 pass, API end-to-end tests 70 of 70 pass, type check and builds pass, and a browser check opened every web menu for all 7 roles plus all 6 languages (120 of 120 pass). Phone screens are tested by hand from the sheets.
