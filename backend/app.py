from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Optional
import secrets

import backend

GED_PATH = "family.ged"
PASSWORD = "Viknarasah"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def verify_password(authorization: Optional[str] = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization format")
    
    token = authorization[7:]
    if not secrets.compare_digest(token, PASSWORD):
        raise HTTPException(status_code=401, detail="Invalid password")
    return True

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
def connect(a: str, b: str, _: bool = Depends(verify_password)):
    if a not in people or b not in people:
        raise HTTPException(status_code=404, detail="Unknown person id")

    path = backend.find_relationship_path(graph, a, b)
    if not path:
        return {"path": [], "relationship": "no path found"}

    # Optional: reuse your existing relationship label if you want
    relationship = backend.find_relationship(people, a, b)

    return {"path": path, "relationship": relationship}
@app.get("/api/people")
def list_people(_: bool = Depends(verify_password)):
    out = []
    for pid, p in people.items():
        name = clean_name(p.name, pid)
        if name.lower() != "unknown":
            # Build display name with spouse or parent info
            display_name = name
            
            # Check if person has spouse(s) and spouse is not "unknown"
            spouse_shown = False
            if p.spouses:
                # Get first spouse (assuming one primary spouse)
                spouse_id = next(iter(p.spouses))
                spouse_obj = people.get(spouse_id)
                if spouse_obj:
                    spouse_name = clean_name(spouse_obj.name, spouse_id)
                    # Only show spouse if they're not "unknown"
                    if spouse_name.lower() != "unknown":
                        sex = p.sex or "unknown"
                        if sex.lower() in ["m", "male"]:
                            display_name = f"{name}, husband of {spouse_name}"
                        else:
                            display_name = f"{name}, wife of {spouse_name}"
                        spouse_shown = True
            
            # If no spouse shown, use father if available
            if not spouse_shown and p.famc:
                fam = families.get(p.famc)
                if fam and fam.husb:
                    father_obj = people.get(fam.husb)
                    if father_obj:
                        father_name = clean_name(father_obj.name, fam.husb)
                        display_name = f"{name}, child of {father_name}"
            
            out.append({"id": pid, "name": display_name, "sex": p.sex})
    out.sort(key=lambda x: x["name"])
    return out
@app.get("/api/ancestors")
def get_ancestors(root: str, depth: int = 4, _: bool = Depends(verify_password)):
    return build_anc_tree(root, depth)

@app.get("/api/tree")
def get_tree(root: str, depth: int = 6, _: bool = Depends(verify_password)):
    return build_fam_tree(root, depth)

@app.get("/api/person/{pid}")
def get_person(pid: str, _: bool = Depends(verify_password)):
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


@app.get("/api/common_ancestor")
def common_ancestor(a: str, b: str, anc_depth: int = 100, desc_depth: int = 100, _: bool = Depends(verify_password)):
    # Validate
    if a not in people or b not in people:
        raise HTTPException(status_code=404, detail="Unknown person id")

    # Use backend helper to compute ancestor distances
    anc_map_a = backend.get_ancestors(people, a)
    anc_map_b = backend.get_ancestors(people, b)

    common = set(anc_map_a) & set(anc_map_b)
    if not common:
        return {"lca": None, "relationship": "no relation found", "anc": None, "desc": None}

    # Choose lowest-common ancestor minimizing sum of depths
    lca = min(common, key=lambda x: anc_map_a[x] + anc_map_b[x])
    rel = backend.relationship_name(anc_map_a[lca], anc_map_b[lca])

    anc_tree = build_anc_tree(lca, anc_depth)
    desc_tree = build_fam_tree(lca, desc_depth)

    return {"lca": lca, "relationship": rel, "anc": anc_tree, "desc": desc_tree}


@app.get("/api/common_pair")
def common_pair(a: str, b: str, anc_depth: int = 100, desc_depth: int = 100, _: bool = Depends(verify_password)):
    """Find lowest common ancestor person (LCA) and return that person plus their spouse (if any).
    Returns the same ancestor/descendant trees centered on the LCA person; the frontend can render the pair as a family.
    """
    if a not in people or b not in people:
        raise HTTPException(status_code=404, detail="Unknown person id")

    anc_map_a = backend.get_ancestors(people, a)
    anc_map_b = backend.get_ancestors(people, b)
    common = set(anc_map_a) & set(anc_map_b)
    if not common:
        return {"lca": None, "spouse": None, "relationship": "no relation found", "anc": None, "desc": None}

    # compute minimal combined depth and return ALL common ancestors that achieve it
    sums = {x: anc_map_a[x] + anc_map_b[x] for x in common}
    min_sum = min(sums.values())
    candidates = []
    seen_pairs: set[frozenset] = set()
    for x, s in sums.items():
        if s == min_sum:
            spouse = next(iter(people[x].spouses), None)
            # canonicalize pair (unordered) to avoid duplicate pairings shown twice in reverse
            pair_key = frozenset([x, spouse]) if spouse else frozenset([x])
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            rel = backend.relationship_name(anc_map_a[x], anc_map_b[x])
            anc_tree = build_anc_tree(x, anc_depth)
            desc_tree = build_fam_tree(x, desc_depth)
            candidates.append({"lca": x, "spouse": spouse, "relationship": rel, "anc": anc_tree, "desc": desc_tree})

    # keep backwards compat: return first candidate at top-level plus full list
    first = candidates[0]
    return {"lca": first["lca"], "spouse": first["spouse"], "relationship": first["relationship"], "anc": first["anc"], "desc": first["desc"], "candidates": candidates}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)