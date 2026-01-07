from collections import deque, defaultdict
from ged4py.parser import GedcomReader

class Person:
    def __init__(self, pid, name, sex):
        self.id = pid
        self.name = name
        self.sex = sex
        self.parents = set()
        self.children = set()
        self.spouses = set()

        # ✅ Track family ids
        self.fams = set()   # families where person is spouse/parent
        self.famc = None    # family where person is a child

    def __repr__(self):
        return f"{self.name} ({self.id})"


class Family:
    def __init__(self, fid):
        self.id = fid
        self.husb = None
        self.wife = None
        self.chil = []

    def to_dict(self):
        return {
            "id": self.id,
            "husb": self.husb,
            "wife": self.wife,
            "chil": list(self.chil),
        }

import tempfile

def _clean_ged_for_ged4py(src_path: str) -> str:
    """
    Writes a sanitized GED file:
    - drops lines that are empty or whitespace-only
    - strips trailing newline weirdness
    - removes BOM if present
    Returns path to temp cleaned file.
    """
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".ged", mode="w", encoding="utf-8", newline="\n")
    with open(src_path, "r", encoding="utf-8-sig", errors="replace") as f:
        for line in f:
            # Remove null bytes and weird whitespace; keep content lines
            cleaned = line.replace("\x00", "").strip("\r\n")
            if cleaned.strip() == "":
                continue
            tmp.write(cleaned + "\n")
    tmp.close()
    return tmp.name

def parse_gedcom(filepath):
    people: dict[str, Person] = {}
    families: dict[str, Family] = {}
    clean_path = _clean_ged_for_ged4py(filepath)

    with GedcomReader(clean_path) as gr:
        # Create all people
        for indi in gr.records0("INDI"):
            pid = indi.xref_id
            name = indi.sub_tag_value("NAME")
            sex = indi.sub_tag_value("SEX")
            people[pid] = Person(pid, name, sex)

        # Create families + wire relationships (using real FAM ids)
        for fam in gr.records0("FAM"):
            fid = fam.xref_id
            f = families.get(fid) or Family(fid)

            husband = fam.sub_tag("HUSB")
            wife = fam.sub_tag("WIFE")
            children = fam.sub_tags("CHIL")

            f.husb = husband.xref_id if husband else None
            f.wife = wife.xref_id if wife else None
            f.chil = [c.xref_id for c in children] if children else []

            families[fid] = f

            # Track fams on spouses
            if f.husb and f.husb in people:
                people[f.husb].fams.add(fid)
            if f.wife and f.wife in people:
                people[f.wife].fams.add(fid)

            # Track famc on kids + parent/child links
            for cid in f.chil:
                if cid in people:
                    people[cid].famc = fid

                if f.husb and f.husb in people and cid in people:
                    people[cid].parents.add(f.husb)
                    people[f.husb].children.add(cid)
                if f.wife and f.wife in people and cid in people:
                    people[cid].parents.add(f.wife)
                    people[f.wife].children.add(cid)

            # Spouses (bidirectional)
            if f.husb and f.wife and f.husb in people and f.wife in people:
                people[f.husb].spouses.add(f.wife)
                people[f.wife].spouses.add(f.husb)

    return people, families


def build_graph(people):
    graph = defaultdict(list)
    for pid, person in people.items():
        for p in person.parents:
            graph[pid].append((p, "parent"))
            graph[p].append((pid, "child"))
        for s in person.spouses:
            graph[pid].append((s, "spouse"))
    return graph


def get_ancestors(people, pid):
    ancestors = {pid: 0}
    queue = deque([(pid, 0)])

    while queue:
        current, depth = queue.popleft()
        for parent in people[current].parents:
            if parent not in ancestors:
                ancestors[parent] = depth + 1
                queue.append((parent, depth + 1))

    return ancestors

def relationship_name(depth_a, depth_b):
    if depth_a == 0 and depth_b == 0:
        return "same person"

    if depth_a == 0:
        if depth_b == 1:
            return "parent"
        return "ancestor"

    if depth_b == 0:
        if depth_a == 1:
            return "child"
        return "descendant"

    if depth_a == 1 and depth_b == 1:
        return "sibling"

    cousin_level = min(depth_a, depth_b) - 1
    removed = abs(depth_a - depth_b)

    name = f"{cousin_level + 1} cousin"
    if removed == 1:
        name += " once removed"
    elif removed > 1:
        name += f" {removed} times removed"

    return name

def find_relationship(people, pid1, pid2):
    ancestors1 = get_ancestors(people, pid1)
    ancestors2 = get_ancestors(people, pid2)

    common = set(ancestors1) & set(ancestors2)
    if not common:
        return "no relation found"

    lca = min(common, key=lambda x: ancestors1[x] + ancestors2[x])

    depth1 = ancestors1[lca]
    depth2 = ancestors2[lca]

    return relationship_name(depth1, depth2)

def find_relationship_path(graph, start_id: str, end_id: str):
    """
    Returns the shortest path from start_id -> end_id as a list of steps:
    [
      {"id": "@I1@", "via": None},
      {"id": "@I3@", "via": "parent"},
      ...
    ]
    """
    if start_id == end_id:
        return [{"id": start_id, "via": None}]

    q = deque([start_id])
    prev = {start_id: (None, None)}  # node -> (prev_node, edge_label)

    while q:
        cur = q.popleft()
        for nxt, label in graph.get(cur, []):
            if nxt in prev:
                continue
            prev[nxt] = (cur, label)
            if nxt == end_id:
                q.clear()
                break
            q.append(nxt)

    if end_id not in prev:
        return []

    # Reconstruct
    out = []
    node = end_id
    while node is not None:
        p, via = prev[node]
        out.append({"id": node, "via": via})
        node = p
    out.reverse()
    out[0]["via"] = None
    return out



if __name__ == "__main__":
    gedfile = r"C:/Users/sarun/OneDrive/Documents/family tree/family.ged"
    people = parse_gedcom(gedfile)
    graph = build_graph(people)

    print("Loaded People:")
    for pid, p in people.items():
        print(f"  {p}")

    # Example relationship checks
    pairs = [
        ("@I1@", "@I3@"),
        ("@I3@", "@I6@"),
        ("@I4@", "@I6@"),
    ]

    for a, b in pairs:
        if a in people and b in people:
            path = find_relationship_path(graph, a, b)
            rel = find_relationship(people, a, b)
            print(f"\nRelationship between {people[a]} and {people[b]}:")
            print("  Path:", path)
            print("  Relationship:", rel)
        else:
            print(f"\nIDs {a} or {b} not found in GEDCOM.")
