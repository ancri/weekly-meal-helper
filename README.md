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

Email notices and Whole Foods cart automation are intentionally not part of this first local milestone; the finalized shopping-list data is ready for those integrations.

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
