"""Generate the mapping for splitting src-tauri/src/commands.rs into feature modules (L7 part 2)."""
import json
import re
import sys

sys.path.insert(0, 'tools')
import split_rust_items as t

SRC = 'src-tauri/src/commands.rs'
lines = t.read_lines(SRC)
items = t.parse_items(lines)
top = [it for it in items if not it['container']]
tests = [it for it in items if it['container']]

# (module, doc, [(first_line, last_line)]) — 1-based start lines of items, inclusive ranges
MODULES = [
    ('files', 'Commands: where the data file lives, moving and exporting it, protected packages, and backups.',
     [(41, 246), (331, 422), (961, 961)]),
    ('system', 'Commands: tray, start-up, reminders, the legal notice, updates, app-wide switches and maintenance.',
     [(248, 330), (954, 954), (968, 968), (4135, 4209), (5068, 5075)]),
    ('profiles', 'Commands: profiles (list, create, switch, add, rename, delete) and their saved screen state.',
     [(517, 949)]),
    ('import', 'Commands: importing files (preview, settle, commit), the sign question, and the setup-data template.',
     [(1115, 1207), (1374, 1396), (1434, 1581), (1806, 1985)]),
    ('transactions', 'Commands: the ledger — listing, editing, splitting, tagging, transfers, bulk changes and review flags.',
     [(1040, 1070), (1308, 1308), (1361, 1361), (1416, 1422), (1759, 1759), (2191, 2467), (2660, 2748), (3348, 3376)]),
    ('categories', 'Commands: categories and categorization rules.',
     [(1103, 1103), (2510, 2652)]),
    ('accounts', 'Commands: accounts, household members, balance history and reconciling.',
     [(1078, 1078), (1109, 1109), (2029, 2185), (3722, 3855)]),
    ('budgets', 'Commands: budgets, goals (buckets), month reviews and budget alerts.',
     [(1217, 1217), (2754, 2930), (2970, 3251)]),
    ('reports', 'Commands: reports, insights, debt payoff, cash flow, forecasts and net worth.',
     [(1237, 1249), (2936, 2936), (3269, 3313), (3658, 3698), (4529, 5045)]),
    ('recurring', 'Commands: recurring bills and income, their matches and suggestions.',
     [(1274, 1298), (3390, 3588), (5708, 5708)]),
    ('investments', 'Commands: holdings, portfolio history, investment plans, allocation targets and live prices.',
     [(1257, 1257), (3598, 3633), (3865, 4118), (4210, 4292)]),
    ('assets', 'Commands: property and valuables.',
     [(4454, 4523)]),
]

FILES_TESTS = {'protected_store_for_package_test', 'exporting_a_protected_profile_writes_a_complete_package',
               'importing_a_protected_package_requires_its_password_and_intact_database',
               'relocating_an_encrypted_database_copies_its_key_file'}

owner = {}
for mod, _, ranges in MODULES:
    for it in top:
        line = it['start'] + 1
        if any(a <= line <= b for a, b in ranges) and it['kind'] != 'other' and it['kind'] != 'comment':
            if id(it) in owner:
                sys.exit(f'{it["name"]} assigned twice')
            owner[id(it)] = mod

text_of = lambda it: ''.join(lines[it['start']:it['end']])
first = lambda it: t.first_code_line(lines[it['start']:it['end']])
is_pub = lambda it: first(it).startswith('pub ')

# Private items a sibling module (or the root's remaining items) also uses stay in the root.
changed = True
while changed:
    changed = False
    for it in top:
        mod = owner.get(id(it))
        if mod is None or is_pub(it) or it['kind'] == 'impl':
            continue
        word = re.compile(r'\b' + re.escape(it['name']) + r'\b')
        users = set()
        for other in top:
            if other is it:
                continue
            if word.search(text_of(other)):
                users.add(owner.get(id(other), 'root'))
        for tst in tests:
            if word.search(text_of(tst)):
                users.add('files' if tst['name'] in FILES_TESTS else 'import')
        if users - {mod}:
            del owner[id(it)]
            changed = True
            print(f'stays in root: {it["kind"]} {it["name"]} (used by {sorted(users)})', file=sys.stderr)

mapping = {}
for mod, doc, _ in MODULES:
    names = [it['name'] for it in top if owner.get(id(it)) == mod]
    header = [f'//! {doc}', '', 'use super::*;', '']
    if mod in ('files', 'import'):
        header += ['#[cfg(test)]', 'mod tests;', '']
    mapping[mod] = [{
        'src': SRC, 'dest': f'src-tauri/src/commands/{mod}.rs', 'from': 'top', 'items': sorted(set(names)),
        'where': 'end', 'header': header, 'register': SRC, 'reexport': True,
    }]
    print(f'{mod}: {len(names)} items', file=sys.stderr)

files_tests = [it['name'] for it in tests if it['name'] in FILES_TESTS]
import_tests = [it['name'] for it in tests if it['name'] not in FILES_TESTS and not it['name'].startswith('use ')]
mapping['tests-files'] = [{'src': SRC, 'dest': 'src-tauri/src/commands/files/tests.rs', 'from': 'tests',
                           'items': files_tests, 'where': 'end', 'header': ['use super::*;']}]
mapping['tests-import'] = [{'src': SRC, 'dest': 'src-tauri/src/commands/import/tests.rs', 'from': 'tests',
                            'items': import_tests, 'where': 'end', 'header': ['use super::*;']}]
unassigned = [f"{it['kind']} {it['name']}" for it in top if id(it) not in owner and it['kind'] not in ('other', 'comment')]
print('root keeps:', ', '.join(unassigned), file=sys.stderr)
json.dump(mapping, open('docs/superpowers/plans/2026-10-04-split-commands-rs-mapping.json', 'w'), indent=1)
