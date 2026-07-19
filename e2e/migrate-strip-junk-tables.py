"""One-shot migration: strip LLM-generated "|---|---|" + "|…|…|" junk pairs
from every markdown report in the DB. The new sanitizeReport step 4
(commit 66ea5ba) no longer INJECTS these, but old reports persisted
before that fix still render as broken tables (an extra empty separator
row + a placeholder row of '…' cells appended after every table).

This script mimics the inline `s.replace(...)` that step 2.7 in
markdown-renderer.ts would do, applied directly to the DB rows so the
user doesn't have to re-run every evaluation to clean up.

Usage:
    python e2e/migrate-strip-junk-tables.py [--dry-run]

Default: dry run (print what would change). Pass any arg to commit.
"""
import sqlite3
import re
import sys

DB = 'db/my-pdb-tracker.db'

# (CRLF or LF) then a separator line then a placeholder line, with the
# placeholder line being all `---` / `:` / `…` cells.
PATTERN = re.compile(
    r'\r?\n[ \t]*\|[-:\s|]+\|[ \t]*\r?\n[ \t]*\|[\s…|]+\|[ \t]*'
)

# We replace the matched pair (2 lines) with a single LF so the table
# is properly terminated. Keep the surrounding content intact.
REPLACEMENT = '\n'

TARGETS = [
    # (table_name, markdown_column, primary_key_column)
    ('Evaluation',     'report',         'uniprotId'),
    ('WeeklyReport',    'content',        'id'),
    ('EvaluationBatch', 'combinedReport', 'batchId'),
]

def main() -> int:
    dry_run = '--dry-run' in sys.argv or len(sys.argv) == 1
    print('DRY-RUN mode — no changes will be written' if dry_run else 'WRITE mode — changes will be committed')

    c = sqlite3.connect(DB)
    cur = c.cursor()
    total_fixed = 0
    for t, col, key in TARGETS:
        cur.execute(f'SELECT {key}, {col} FROM {t} WHERE {col} IS NOT NULL AND {col} != ""')
        rows = cur.fetchall()
        fixed_in_table = 0
        for row_key, content in rows:
            new_content, n = PATTERN.subn(REPLACEMENT, content)
            if n > 0:
                if not dry_run:
                    cur.execute(f'UPDATE {t} SET {col} = ? WHERE {key} = ?', (new_content, row_key))
                print(f'  {t} [{col}] {row_key}: removed {n} junk pair(s), '
                      f'len {len(content)} → {len(new_content)} (Δ={len(new_content) - len(content)})')
                fixed_in_table += 1
        print(f'{t}.{col}: {fixed_in_table}/{len(rows)} row(s) affected')
        total_fixed += fixed_in_table
    if not dry_run:
        c.commit()
    c.close()
    print(f'\nTotal: {total_fixed} row(s) {"would be" if dry_run else ""} fixed')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
