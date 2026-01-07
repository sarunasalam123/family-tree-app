import React, { useState, useRef, useEffect } from "react";
import * as d3 from "d3";

type PersonLite = { id: string; name: string };

type ApiNode = any;

export default function CommonAncestorTab({
  people,
  nameById,
  onOpenInTree,
}: {
  people: PersonLite[];
  nameById: Map<string, string>;
  onOpenInTree: (id: string) => void;
}) {
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<null | { lca: string | null; relationship: string; anc: any; desc: any }>(null);
  const [paths, setPaths] = useState<null | { nodes: any[]; links: any[] }>(null);
  const [prunedTree, setPrunedTree] = useState<any | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  async function find() {
    setError(null);
    setResult(null);
    if (!aId || !bId || aId === bId) {
      setError("Pick two different people.");
      return;
    }
    setLoading(true);
    try {
      const qs = `a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`;
      const r = await fetch(`http://localhost:8000/api/common_ancestor?${qs}`);
      if (!r.ok) throw new Error(`Request failed ${r.status}`);
      const data = await r.json();
      setResult(data);

      // Build pruned paths and a small pruned ApiNode tree from returned descendant tree
      if (data?.desc?.tree) {
        const descTree: ApiNode = data.desc.tree;

        function findPathTo(targetId: string, node: any): any[] | null {
          if (!node) return null;
          if (node.type === "person" && node.id === targetId) return [node];
          if (!node.children || node.children.length === 0) return null;
          for (const child of node.children) {
            const p = findPathTo(targetId, child);
            if (p) return [node, ...p];
          }
          return null;
        }

        const pathA = findPathTo(aId, descTree) || [];
        const pathB = findPathTo(bId, descTree) || [];

        // build pruned ApiNode tree: root person is descTree (LCA)
        const makePersonNode = (n: any) => ({ type: "person", id: n.id, name: n.name, sex: n.sex, children: [] as any[] });
        const makeFamilyNode = (n: any) => ({ type: "family", id: n.id, husb: n.husb, wife: n.wife, children: [] as any[] });

        const prunedRoot = makePersonNode(descTree);

        function mergePathInto(root: any, path: any[]) {
          let parent = root;
          for (let i = 1; i < path.length; i++) {
            const node = path[i];
            if (node.type === "family") {
              let f = parent.children.find((c: any) => c.type === "family" && c.id === node.id);
              if (!f) {
                f = makeFamilyNode(node);
                parent.children.push(f);
              }
              parent = f;
            } else if (node.type === "person") {
              let p = parent.children.find((c: any) => c.type === "person" && c.id === node.id);
              if (!p) {
                p = makePersonNode(node);
                parent.children.push(p);
              }
              parent = p;
            }
          }
        }

        mergePathInto(prunedRoot, pathA);
        mergePathInto(prunedRoot, pathB);

        setPrunedTree(prunedRoot);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  // Render pruned tree with D3 and provide pan/zoom similar to TreeView
  useEffect(() => {
    // clear any previous drawing errors
    setError(null);
    try {
      if (!prunedTree || !svgRef.current) return;

      const svgEl = svgRef.current;
      const svg = d3.select(svgEl);
      svg.selectAll("*").remove();

      const width = svgEl.clientWidth || 1200;
      const height = 480;
      svg.attr("viewBox", `0 0 ${width} ${height}`);

      const g = svg.append("g");

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.25, 2.5])
        .on("zoom", (event) => g.attr("transform", event.transform));

      svg.call(zoom as any);

      // Build hierarchy and layout
      const root = d3.hierarchy(prunedTree as any, (d: any) => d.children ?? []);
      const layout = d3.tree().nodeSize([220, 120]);
      layout(root as any);

      console.log('CommonAncestorTab: drawing prunedTree', prunedTree);
      console.log('descendants', root.descendants().length);

      // center horizontally
      const minX = d3.min(root.descendants(), (d) => d.x) ?? 0;
      const maxX = d3.max(root.descendants(), (d) => d.x) ?? 0;
      const contentW = maxX - minX + 240;
      const offsetX = (width - contentW) / 2 - minX + 120;
      const offsetY = 40;
      const gx = g.append("g").attr("transform", `translate(${offsetX},${offsetY})`);

      const pos = new Map<string, { x: number; y: number; data: any }>();
      root.descendants().forEach((d) => pos.set(`${d.data.type}:${d.data.id}`, { x: d.x, y: d.y, data: d.data }));
+      console.log('famNodes', root.descendants().filter((d) => d.data.type === 'family').length);



    const BOX_W = 180;
    const BOX_H = 34;
    const BOX_RX = 12;

    // links: draw parent->child (endpoints snap to person box edges and family junction centers)
    gx
      .append("g")
      .selectAll("path")
      .data(root.links())
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", "#333")
      .attr("stroke-width", 2)
      .attr("d", (d: any) => {
        const s = pos.get(`${d.source.data.type}:${d.source.data.id}`)!;
        const t = pos.get(`${d.target.data.type}:${d.target.data.id}`)!;

        // default to center
        let sx = s.x;
        let sy = s.y;
        let tx = t.x;
        let ty = t.y;

        // if source is a person, start at bottom edge
        if (d.source.data.type === "person") sy = s.y + BOX_H / 2;
        // if target is a person, end at top edge
        if (d.target.data.type === "person") ty = t.y - BOX_H / 2;

        const mx = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
      });

    // nodes
    const nodesG = gx.append("g");

    const personNodes = root.descendants().filter((d) => d.data.type === "person");
    const pn = nodesG
      .selectAll("g.person")
      .data(personNodes)
      .enter()
      .append("g")
      .attr("transform", (d: any) => `translate(${d.x - BOX_W / 2},${d.y - BOX_H / 2})`)
      .style("cursor", "pointer")
      .on("click", (_, d: any) => {
        if (d.data && d.data.id) onOpenInTree(d.data.id);
      });

    pn.append("rect").attr("width", BOX_W).attr("height", BOX_H).attr("rx", 10).attr("fill", "#fff").attr("stroke", "#111").attr("stroke-width", 1.5);
    pn
      .append("text")
      .attr("x", BOX_W / 2)
      .attr("y", BOX_H / 2 + 2)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 12)
      .text((d: any) => nameById.get(d.data.id) ?? d.data.id);

    // family junctions as small circles
    const famNodes = root.descendants().filter((d) => d.data.type === "family");
    gx
      .append("g")
      .selectAll("circle.junction")
      .data(famNodes)
      .enter()
      .append("circle")
      .attr("cx", (d: any) => d.x)
      .attr("cy", (d: any) => d.y)
      .attr("r", 5)
      .attr("fill", "#111")
      .attr("fill-opacity", 0.6);

    // spouse boxes using TreeView style (only when spouse person isn't in this subtree)
    const SPOUSE_OFFSET_X = 140;
    const SPOUSE_BOX_W = 180;
    const SPOUSE_BOX_H = 34;
    const SPOUSE_BOX_RX = 12;

    const spouseBoxes: { pid: string; name: string; x: number; y: number }[] = [];

    // compute root person position for aligning promoted spouses
    const rootPos = pos.get(`person:${prunedTree.id}`);

    for (const f of famNodes) {
      const jx = f.x;
      const jy = f.y;
      const husbId = f.data.husb ?? null;
      const wifeId = f.data.wife ?? null;
      const isRootFamily = f.parent && f.parent.data && f.parent.data.type === "person" && f.parent.data.id === prunedTree.id;

      if (husbId) {
        const ppos = pos.get(`person:${husbId}`);
        let ax = ppos ? ppos.x : jx - SPOUSE_OFFSET_X;
        let ay = ppos ? ppos.y : jy;
        // if this family's parent is the root person, align spouse with root Y and offset horizontally
        if (isRootFamily && rootPos) {
          ax = rootPos.x - SPOUSE_OFFSET_X;
          ay = rootPos.y;
        }
        if (!ppos) spouseBoxes.push({ pid: husbId, name: nameById.get(husbId) ?? husbId, x: ax, y: ay, promote: isRootFamily });
      }

      if (wifeId) {
        const ppos = pos.get(`person:${wifeId}`);
        let ax = ppos ? ppos.x : jx + SPOUSE_OFFSET_X;
        let ay = ppos ? ppos.y : jy;
        if (isRootFamily && rootPos) {
          ax = rootPos.x + SPOUSE_OFFSET_X;
          ay = rootPos.y;
        }
        if (!ppos) spouseBoxes.push({ pid: wifeId, name: nameById.get(wifeId) ?? wifeId, x: ax, y: ay, promote: isRootFamily });
      }
    }

    const inTreePersons = new Set(personNodes.map((d) => d.data.id));
    const filteredSpouses = spouseBoxes.filter((s) => !inTreePersons.has(s.pid));

    // Draw connectors from spouse box to family junction
    const linkG = gx.append("g");
    for (const f of famNodes) {
      const jx = f.x;
      const jy = f.y;
      const husbId = f.data.husb ?? null;
      const wifeId = f.data.wife ?? null;

      if (husbId && !inTreePersons.has(husbId)) {
        const p = filteredSpouses.find((s) => s.pid === husbId);
        if (!p) continue;
        linkG
          .append("path")
          .attr("fill", "none")
          .attr("stroke", "#333")
          .attr("stroke-width", 2)
          .attr("d", () => {
            const sx = p.x;
            const sy = p.y;
            const tx = jx;
            const ty = jy;
            const s = ty >= sy ? 1 : -1;
            const midY1 = sy + 50 * s;
            const midY2 = ty - 50 * s;
            return `M ${sx} ${sy} C ${sx} ${midY1}, ${tx} ${midY2}, ${tx} ${ty}`;
          });
      }

      if (wifeId && !inTreePersons.has(wifeId)) {
        const p = filteredSpouses.find((s) => s.pid === wifeId);
        if (!p) continue;
        linkG
          .append("path")
          .attr("fill", "none")
          .attr("stroke", "#333")
          .attr("stroke-width", 2)
          .attr("d", () => {
            const sx = p.x;
            const sy = p.y;
            const tx = jx;
            const ty = jy;
            const s = ty >= sy ? 1 : -1;
            const midY1 = sy + 50 * s;
            const midY2 = ty - 50 * s;
            return `M ${sx} ${sy} C ${sx} ${midY1}, ${tx} ${midY2}, ${tx} ${ty}`;
          });
      }
    }

    // Draw spouse boxes using TreeView's styling; promote to full person-box if requested
    const spG = gx
      .append("g")
      .selectAll("g.spouse")
      .data(filteredSpouses)
      .enter()
      .append("g")
      .attr("transform", (d: any) => {
        const w = d.promote ? BOX_W : SPOUSE_BOX_W;
        const h = d.promote ? BOX_H : SPOUSE_BOX_H;
        return `translate(${d.x - w / 2},${d.y - h / 2})`;
      })
      .style("cursor", "pointer")
      .on("click", (_, d: any) => onOpenInTree(d.pid));

    spG
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", (d: any) => (d.promote ? BOX_W : SPOUSE_BOX_W))
      .attr("height", (d: any) => (d.promote ? BOX_H : SPOUSE_BOX_H))
      .attr("rx", (d: any) => (d.promote ? BOX_RX : SPOUSE_BOX_RX))
      .attr("fill", "white")
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.25);

    spG
      .append("text")
      .attr("x", (d: any) => (d.promote ? BOX_W / 2 : SPOUSE_BOX_W / 2))
      .attr("y", (d: any) => (d.promote ? BOX_H / 2 + 2 : SPOUSE_BOX_H / 2 + 2))
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 12)
      .text((d: any) => d.name);

    // initial zoom/pan fit: translate so root is nicely visible
    // center at root
    const rootPersonKey = `person:${prunedTree.id}`;
    if (rootPos) {
      const initialTransform = d3.zoomIdentity.translate(width / 2 - rootPos.x, 20);
      svg.call(zoom.transform as any, initialTransform);
    }
  } catch (err:any) {
    console.error(err);
    setError(String(err));
  }
  }, [prunedTree, nameById, onOpenInTree]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <label>
          Person A
          <select value={aId} onChange={(e) => setAId(e.target.value)}>
            <option value="">Select…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Person B
          <select value={bId} onChange={(e) => setBId(e.target.value)}>
            <option value="">Select…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <button onClick={find} disabled={!aId || !bId || aId === bId || loading}>
          {loading ? "Finding…" : "Find common ancestor"}
        </button>
      </div>

      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}

      {result ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div>
            <b>Common ancestor:</b> {result.lca ? nameById.get(result.lca) ?? result.lca : "None"} ({result.lca})
          </div>
          <div>
            <b>Relationship:</b> {result.relationship}
          </div>

          {result.lca ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onOpenInTree(result.lca)}>Open in Tree view</button>
              <a
                href={`http://localhost:8000/api/person/${encodeURIComponent(result.lca)}`}
                target="_blank"
                rel="noreferrer"
              >
                View person JSON
              </a>
            </div>
          ) : null}

          <div style={{ opacity: 0.75, fontSize: 13 }}>
            The ancestor/descendant trees are available from the backend; use "Open in Tree view" to inspect visually.
          </div>
        </div>
      ) : null}

      {prunedTree ? (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 8, marginTop: 12 }}>
          <svg ref={svgRef} width="100%" height={480} />
        </div>
      ) : null}
    </div>
  );
}
