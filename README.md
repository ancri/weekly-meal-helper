# Meal Helper

A small, single-household web app for choosing three weekly meals and producing a combined shopping list. It can import a private historical workbook on startup and stores application data in SQLite.

## Run locally

Python 3.10 or newer is the only runtime dependency.

```bash
python3 app.py
```

Open <http://127.0.0.1:8080>. The database is created at `data/meal_helper.sqlite3`.

The optional warm-start file `meals_history.xlsx` is intentionally excluded from version control because it contains private household data. When present at the repository root, dated sheets are imported automatically and idempotently. Without it, recipes can be created directly in the app.

## Test

```bash
python3 -m unittest discover -v
```

## Configuration

The default number of proposals per category and the required number of selected meals live in `meal_helper/config.py`. Runtime settings can be supplied with:

- `MEAL_HELPER_HOST` (default `127.0.0.1`)
- `MEAL_HELPER_PORT` (default `8080`)
- `MEAL_HELPER_DATABASE` (default `data/meal_helper.sqlite3`)

The app deliberately binds to localhost by default. Put an authenticated HTTPS reverse proxy in front of it before exposing it on an EC2 public interface.

## EC2 service

[`deploy/meal-helper.service`](deploy/meal-helper.service) is an example `systemd` unit. It assumes the repository is checked out at `/opt/meal-helper`, is owned by a dedicated `meal-helper` user, and that an HTTPS reverse proxy sends traffic to `127.0.0.1:8080`.

After installing the unit at `/etc/systemd/system/meal-helper.service`:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now meal-helper
sudo systemctl status meal-helper
```

Email notices are not part of the current application. An optional Chrome
extension can transfer a locked Whole Foods shopping list into a locally stored
product review plan and add mapped products to the Amazon Whole Foods cart. See
[`extension/whole-foods-cart-helper`](extension/whole-foods-cart-helper) for
installation, privacy, and current limitations.

## Suggestion Safety

Submitted suggestions are normalized, limited to 500 characters, parameterized
when written to SQLite, and stored as untrusted text. They have no public read
endpoint. Future automation must never concatenate suggestion text into a
system or developer prompt, use it as tool instructions, or treat it as trusted
configuration; any AI processing must pass it as clearly delimited user data.

## Recipe Ingredient Parsing

The recipe editor can turn pasted, unstructured ingredient text into editable
ingredient rows through an optional server-side OpenAI integration. The server
ranks the local catalog and sends at most 100 candidate ingredients, requests a
strict JSON-schema response, and validates every returned ID, quantity, and unit
before returning a draft to the browser. Model output never writes directly to
the database.

When an automatically proposed recipe has no ingredients, the server queues a
background enrichment attempt based on its recipe name. Enrichment runs
sequentially, reuses the same catalog validation and global request limit, and
waits 24 hours before retrying a failed or empty result. The weekly page does
not wait for OpenAI; refreshed data includes ingredients after enrichment
finishes.

Set `OPENAI_API_KEY` in the server environment to enable parsing. The optional
`OPENAI_RECIPE_MODEL` defaults to `gpt-4o-mini`. The application persistently
limits parsing and automatic recipe enrichment to 100 total attempts in a
rolling hour, limits pasted text to 4,000 characters, makes one non-retried
upstream call per attempt, and asks OpenAI not to store responses. Keep the
project's monthly budget alert low and configure conservative API billing or
prepaid-credit controls as a second line of protection. OpenAI project budgets
are soft notification thresholds, not hard spending caps.

## Ingredient Warm Start

The private workbook can produce a conservative, frequency-ranked ingredient
catalog without committing household data to Git:

```bash
python3 scripts/build_ingredient_candidates.py
```

This writes ignored candidate and unmatched-review CSV files under `data/`.
Candidate names, units, source classification, and the `include` column can be
reviewed before a dry run or import. Existing ingredients are never overwritten:

```bash
python3 scripts/import_ingredient_candidates.py \
  data/ingredient_candidates.csv \
  --database data/meal_helper.sqlite3

python3 scripts/import_ingredient_candidates.py \
  data/ingredient_candidates.csv \
  --database data/meal_helper.sqlite3 \
  --apply
```

Reviewed ingredient mappings for existing recipes can be applied with a private
JSON file. Matching is case-insensitive, populated recipes are never
overwritten, and omitting `--apply` performs a dry run:

```bash
python3 scripts/apply_recipe_backfills.py \
  data/recipe_backfills.private.json \
  --database data/meal_helper.sqlite3

python3 scripts/apply_recipe_backfills.py \
  data/recipe_backfills.private.json \
  --database data/meal_helper.sqlite3 \
  --apply
```

Files matching `data/recipe_backfills*.json` are excluded from Git because they
may contain household recipe history and research notes.

## Production operations

SSH can be used for remote diagnostics while keeping the development toolchain local:

```bash
ssh -i ~/.ssh/ancri -o IdentitiesOnly=yes ec2-user@INSTANCE_IP
```

To create a consistent online SQLite backup and download it into the ignored local `data/` directory:

```bash
MEAL_HELPER_HOST=INSTANCE_IP ./deploy/pull-production-db.sh
```

The helper uses SQLite's backup API, so the production service does not need to be stopped while copying data.
