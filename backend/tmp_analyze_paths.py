import urllib.request, urllib.parse, json
params = urllib.parse.urlencode({'a':'@I10@','b':'@I1@'})
url = f'http://localhost:8000/api/common_pair?{params}'
with urllib.request.urlopen(url) as r:
    data = json.load(r)

cand = data['candidates'][0]
desc_tree = cand['desc']['tree']

# Find familyRoot in our buildPrunedFromDesc semantics: if desc_tree.type=='person' and it has child family
# and one of them is the canonical family for the pair, we use that matched family node as root.
# For simplicity we mimic the JS: identify a matched child family that has both lca and spouse
lca = cand['lca']
spouse = cand['spouse']

familyRoot = None
if desc_tree['type']=='person' and 'children' in desc_tree:
    pair = set([lca, spouse])
    for c in desc_tree['children']:
        if c['type']=='family':
            if (c.get('husb') in pair and c.get('wife') in pair) or (c.get('husb') in pair and c.get('husb') in pair):
                familyRoot = c
                break
if not familyRoot:
    # virtual family
    familyRoot = {'type':'family','id':f"pair:{lca}:{spouse or 'none'}", 'husb': lca, 'wife': spouse, 'children':[desc_tree]}

# find all paths to target

def find_all_paths(node, target):
    out = []
    def rec(cur, path):
        if cur['type']=='person' and cur['id']==target:
            out.append(path + [cur])
            return
        if 'children' not in cur or not cur['children']:
            return
        for ch in cur['children']:
            rec(ch, path + [cur])
    rec(node, [])
    return out

# Inject extra_links: if a family mentioned in extra_links exists in the tree, add the missing person
for l in cand['desc'].get('extra_links', []):
    from_fam = l['from_fam']
    to_person = l['to_person']
    def find_and_inject(node):
        found = False
        if node.get('type') == 'family' and node.get('id') == from_fam:
            # ensure person child exists
            if not any(ch.get('type') == 'person' and ch.get('id') == to_person for ch in node.get('children', [])):
                node.setdefault('children', []).append({'type':'person','id':to_person,'name':to_person,'sex':None,'children':[]})
            found = True
        for ch in node.get('children', []):
            if find_and_inject(ch):
                found = True
        return found
    found = find_and_inject(familyRoot)
    print('injected', found)

# dump family nodes with id @F1@
def find_all_families(node, acc, path=None):
    if path is None:
        path = []
    if node.get('type') == 'family' and node.get('id') == '@F1@':
        acc.append((node, path.copy()))
    for ch in node.get('children', []):
        find_all_families(ch, acc, path + [node])

acc = []
find_all_families(familyRoot, acc)
print('found family nodes F1:', len(acc))
for f, p in acc:
    print('F1 children count', len(f.get('children', [])), 'path:', ' -> '.join([f"{n.get('type')}:{n.get('id')}" for n in p]))

# print subtree under person @I7@
def find_person(node, pid):
    if node.get('type') == 'person' and node.get('id') == pid:
        return node
    for ch in node.get('children', []):
        r = find_person(ch, pid)
        if r:
            return r
    return None

p7 = find_person(familyRoot, '@I7@')
print('\nPerson @I7@ subtree:')
import pprint
pprint.pprint(p7)


paths_to_b = find_all_paths(familyRoot, '@I1@')
paths_to_a = find_all_paths(familyRoot, '@I10@')
print('paths_to_b count:', len(paths_to_b))
for p in paths_to_b:
    print(' -> '.join([f"{n['type']}:{n.get('id')}" for n in p]))
print('paths_to_a count:', len(paths_to_a))
