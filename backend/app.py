from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any

import backend

GED_PATH = "family.ged"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

people, families = backend.parse_gedcom(GED_PATH)


def clean_name(name: Any, fallback: str) -> str:
    if name is None:
        return fallback
    if isinstance(name, (tuple, list)):
        parts = [str(x).strip().replace("/", "") for x in name if x]
        s = " ".join(parts).strip()
        return s if s else fallback
    s = str(name).replace("/", "").strip()
    return s if s else fallback


def person_json(pid: str):
    p = people[pid]
    return {"id": pid, "name": clean_name(p.name, pid), "sex": p.sex}
def build_fam_tree(root_person_id: str, depth: int = 6):
    if root_person_id not in people:
        raise HTTPException(status_code=404, detail="Unknown person")

    placed_people: set[str] = set()
    extra_links: list[dict] = []

    def rec_person(pid: str, gen: int):
        # Always create person node if not yet placed, else return None (handled by caller)
        node = {"type": "person", **person_json(pid), "children": []}

        if gen <= 0:
            return node

        # Mark placed here (first time only)
        placed_people.add(pid)

        for fid in people[pid].fams:
            fnode = rec_family(fid, gen)
            if fnode is not None:
                node["children"].append(fnode)

        return node

    def rec_family(fid: str, gen: int):
        next_gen = gen - 1
        if next_gen <= 0:
            return None  # no dangling junctions

        fam = families[fid]
        children_nodes = []

        for cid in fam.chil:
            if cid in placed_people:
                # Already rendered elsewhere -> add cross-link instead of duplicate node
                extra_links.append({"from_fam": fid, "to_person": cid})
                continue

            cnode = rec_person(cid, next_gen)
            if cnode:
                children_nodes.append(cnode)

        if not children_nodes and not any(l["from_fam"] == fid for l in extra_links):
            # nothing to show for this family at all
            return None

        return {
            "type": "family",
            "id": fid,
            "husb": fam.husb,
            "wife": fam.wife,
            "children": children_nodes,
        }

    tree = rec_person(root_person_id, depth)
    return {"tree": tree, "extra_links": extra_links}

def build_anc_tree(root_person_id: str, depth: int = 4):
    if root_person_id not in people:
        raise HTTPException(status_code=404, detail="Unknown person")

    placed_people: set[str] = set()
    extra_links: list[dict] = []

    def rec_person(pid: str, gen: int):
        node = {"type": "person", **person_json(pid), "children": []}

        if gen <= 0:
            return node

        placed_people.add(pid)

        famc = people[pid].famc
        if famc:
            fnode = rec_family(famc, gen)
            if fnode is not None:
                node["children"].append(fnode)

        return node

    def rec_family(fid: str, gen: int):
        next_gen = gen - 1
        if next_gen <= 0:
            return None

        fam = families[fid]
        parent_nodes = []

        for pid in (fam.husb, fam.wife):
            if not pid:
                continue

            if pid in placed_people:
                extra_links.append({"from_fam": fid, "to_person": pid})
                continue

            pnode = rec_person(pid, next_gen)
            if pnode:
                parent_nodes.append(pnode)

        if not parent_nodes and not any(l["from_fam"] == fid for l in extra_links):
            return None

        return {
            "type": "family",
            "id": fid,
            "husb": fam.husb,
            "wife": fam.wife,
            "children": parent_nodes,
        }

    tree = rec_person(root_person_id, depth)
    return {"tree": tree, "extra_links": extra_links}

graph = backend.build_graph(people)

@app.get("/api/connect")
def connect(a: str, b: str):
    if a not in people or b not in people:
        raise HTTPException(status_code=404, detail="Unknown person id")

    path = backend.find_relationship_path(graph, a, b)
    if not path:
        return {"path": [], "relationship": "no path found"}

    # Optional: reuse your existing relationship label if you want
    relationship = backend.find_relationship(people, a, b)

    return {"path": path, "relationship": relationship}
@app.get("/api/people")
def list_people():
    out = []
    for pid, p in people.items():
        out.append({"id": pid, "name": clean_name(p.name, pid), "sex": p.sex})
    out.sort(key=lambda x: x["name"])
    return out
@app.get("/api/ancestors")
def get_ancestors(root: str, depth: int = 4):
    return build_anc_tree(root, depth)

@app.get("/api/tree")
def get_tree(root: str, depth: int = 6):
    return build_fam_tree(root, depth)

@app.get("/api/person/{pid}")
def get_person(pid: str):
    if pid not in people:
        raise HTTPException(status_code=404, detail=f"Unknown person id: {pid}")

    p = people[pid]

    return {
        "id": pid,
        "name": clean_name(p.name, pid),
        "sex": p.sex,
        "parents": sorted(p.parents),
        "spouses": sorted(p.spouses),
        "children": sorted(p.children),
    }