// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useState, useRef, useEffect } from "react";
import * as d3 from "d3";
import { usePassword } from "./App";
import { SearchableSelect } from "./SearchableSelect";

type PersonLite = { id: string; name: string };

type ApiNode = any;

export default function CommonAncestorPairTab({
  people,
  nameById,
  aId,
  setAId,
  bId,
  setBId,
  result,
  setResult,
  loading,
  setLoading,
  error,
  setError,
  candidates,
  setCandidates,
  prunedTrees,
  setPrunedTrees,
  onOpenInTree,
}: {
  people: PersonLite[];
  nameById: Map<string, string>;
  aId: string;
  setAId: (id: string) => void;
  bId: string;
  setBId: (id: string) => void;
  result: any;
  setResult: (result: any) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  error: string | null;
  setError: (error: string | null) => void;
  candidates: any;
  setCandidates: (candidates: any) => void;
  prunedTrees: any;
  setPrunedTrees: (trees: any) => void;
  onOpenInTree: (id: string) => void;
}) {
  const password = usePassword();
  const [selectedCandidate, setSelectedCandidate] = useState<number>(0);
  const [prunedTree, setPrunedTree] = useState<any | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState<boolean>(false);
  const [debugData, setDebugData] = useState<any | null>(null);
  const [showDuplicates, setShowDuplicates] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const makePersonNode = (n: any) => ({ type: "person", id: n.id, name: n.name, sex: n.sex, children: [] as any[] });
  const makeFamilyNode = (n: any) => ({ type: "family", id: n.id, husb: n.husb, wife: n.wife, children: [] as any[] });

  function buildPrunedFromDesc(descTree: any, lca: string | null, spouse: string | null, extraLinks: any[] = [], allowDuplicates: boolean = false) {
    if (!descTree) return [];

    // Inject extra_links into the live descendant tree so path discovery can traverse
    // cross-links that were elided to avoid duplicate nodes in the backend tree.
    if (extraLinks && extraLinks.length) {
      function findAndInject(node: any, fromFam: string, toPerson: string): boolean {
        let found = false;
        if (node.type === "family" && node.id === fromFam) {
          const exists = (node.children || []).some((ch: any) => ch.type === "person" && ch.id === toPerson);
          if (!exists) {
            node.children = node.children || [];
            node.children.push({ type: "person", id: toPerson, name: nameById.get(toPerson) ?? "unknown", sex: null, children: [] });
          }
          found = true;
        }
        for (const ch of node.children || []) {
          if (findAndInject(ch, fromFam, toPerson)) found = true;
        }
        return found;
      }

      for (const l of extraLinks) {
        findAndInject(descTree, l.from_fam, l.to_person);
      }
    }

    // Choose the family root. If the returned descendant tree is a person whose
    // child family actually represents the pair (husb+wife), use that real family
    // node as the root; otherwise create a virtual family pair root and attach the
    // returned descendant tree as its child.
    let familyRoot: any;
    if (
      descTree.type === "person" &&
      descTree.children &&
      Array.isArray(descTree.children)
    ) {
      const pairSet = new Set([lca, spouse]);
      const matched = descTree.children.find((c: any) => {
        return (
          c.type === "family" &&
          ((pairSet.has(c.husb) && pairSet.has(c.wife)) || (pairSet.has(c.husb) && !c.wife && pairSet.has(c.husb)))
        );
      });
      if (matched) {
        // Clone to avoid mutating original API objects
        familyRoot = makeFamilyNode(matched);
        // copy its children (persons) so pruning works from this node
        familyRoot.children = (matched.children || []).map((ch: any) => ({ ...ch, children: Array.isArray(ch.children) ? ch.children : [] }));
      }
    }

    if (!familyRoot) {
      familyRoot = {
        type: "family",
        id: `pair:${lca}:${spouse ?? "none"}`,
        husb: lca,
        wife: spouse ?? null,
        children: [descTree],
      };
    }

    function findAllPathsTo(targetId: string, node: any): any[][] {
      const out: any[][] = [];
      if (!node) return out;
      function rec(cur: any, path: any[]) {
        if (cur.type === "person" && cur.id === targetId) {
          out.push([...path, cur]);
          return;
        }
        if (!cur.children || cur.children.length === 0) return;
        for (const child of cur.children) {
          rec(child, [...path, cur]);
        }
      }
      rec(node, []);
      return out;
    }

    const pathsA = findAllPathsTo(aId, familyRoot);
    const pathsB = findAllPathsTo(bId, familyRoot);

    // If no paths found for either, fall back to single null path so we still return something
    if (pathsA.length === 0) pathsA.push([]);
    if (pathsB.length === 0) pathsB.push([]);

    // For each combination of A-path and B-path, build a pruned tree and return all
    // combinations so the UI can show alternate trees side-by-side.
    const prunedTrees: any[] = [];

    for (const pa of pathsA) {
      for (const pb of pathsB) {
        // Deduplicate nodes across both paths to avoid showing the same person twice
        const prunedRoot = makeFamilyNode(familyRoot);
        const personMap = new Map<string, any>();
        const familyMap = new Map<string, any>();
        familyMap.set(prunedRoot.id, prunedRoot);

        function mergePathInto(root: any, path: any[] | null) {
          if (!path || path.length === 0) return;
          let parent = root;
          // path contains sequence of nodes excluding the root family; we will place them
          for (let i = 0; i < path.length; i++) {
            const node = path[i];
            if (node.type === "family") {
              let f = allowDuplicates ? null : familyMap.get(node.id);
              if (!f) {
                f = makeFamilyNode(node);
                parent.children.push(f);
                if (!allowDuplicates) familyMap.set(node.id, f);
              }
              parent = f;
            } else if (node.type === "person") {
              let p = allowDuplicates ? null : personMap.get(node.id);
              if (!p) {
                p = makePersonNode(node);
                parent.children.push(p);
                if (!allowDuplicates) personMap.set(node.id, p);
              } else {
                if (!parent.children.find((c: any) => c.type === "person" && c.id === node.id)) {
                  parent.children.push(p);
                }
              }
              parent = p;
            }
          }
        }

        mergePathInto(prunedRoot, pa);
        mergePathInto(prunedRoot, pb);

        // Normalize family nodes: if a family in the pruned subtree references one member of the pair
        // but is missing the other, add the missing partner from the identified pair. This ensures
        // the junction shown is the pair-family (Kulaveerasingham + Bhuvaneshwari) instead of a
        // solo-family under one spouse.
        const pairMembers = new Set<string>();
        if (lca) pairMembers.add(lca);
        if (spouse) pairMembers.add(spouse);

        function normalizeFamilies(node: any) {
          if (!node || !node.children) return;
          for (const child of node.children) {
            if (child.type === "family") {
              // if family references exactly one member of the pair, fill in the other
              if (pairMembers.size === 2) {
                const [m1, m2] = Array.from(pairMembers);
                if ((!child.husb || child.husb === "") && child.wife && pairMembers.has(child.wife)) {
                  child.husb = child.wife === m1 ? m2 : m1;
                }
                if ((!child.wife || child.wife === "") && child.husb && pairMembers.has(child.husb)) {
                  child.wife = child.husb === m1 ? m2 : m1;
                }
              }
              normalizeFamilies(child);
            } else {
              normalizeFamilies(child);
            }
          }
        }

        normalizeFamilies(prunedRoot);

        prunedTrees.push(prunedRoot);
      }
    }

    return prunedTrees;
  }

  // Small component that renders a single pruned tree using D3. We render multiple
  // instances side-by-side when there are multiple alternative candidate trees.
  function PrunedTreeSVG({ tree, nameById, onOpenInTree, height = 420, onError }: { tree: any; nameById: Map<string,string>; onOpenInTree: (id:string)=>void; height?: number; onError?: (e:string)=>void }) {
    const ref = useRef<SVGSVGElement | null>(null);

    useEffect(() => {
      try {
        if (!tree || !ref.current) return;
        const svgEl = ref.current;
        const svg = d3.select(svgEl);
        svg.selectAll("*").remove();
        const width = svgEl.clientWidth || 800;
        const h = height;
        svg.attr("viewBox", `0 0 ${width} ${h}`);
        const g = svg.append("g");

        const zoom = d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.25, 2.5])
          .on("zoom", (event) => g.attr("transform", event.transform));

        svg.call(zoom as any);

        const root = d3.hierarchy(tree as any, (d: any) => d.children ?? []);
        const layout = d3.tree().nodeSize([220, 120]);
        layout(root as any);

        // center horizontally
        const minX = d3.min(root.descendants(), (d) => d.x) ?? 0;
        const maxX = d3.max(root.descendants(), (d) => d.x) ?? 0;
        const contentW = maxX - minX + 240;
        const offsetX = (width - contentW) / 2 - minX + 120;
        const offsetY = 40;
        const gx = g.append("g").attr("transform", `translate(${offsetX},${offsetY})`);

        const pos = new Map<string, { x: number; y: number; data: any }>();
        root.descendants().forEach((d) => pos.set(`${d.data.type}:${d.data.id}`, { x: d.x, y: d.y, data: d.data }));

        const BOX_W = 180;
        const BOX_H = 34;
        const BOX_RX = 12;

        // links
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

            let sx = s.x;
            let sy = s.y;
            let tx = t.x;
            let ty = t.y;

            if (d.source.data.type === "person") sy = s.y + BOX_H / 2;
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
          .text((d: any) => nameById.get(d.data.id) ?? "unknown");

        // family junctions
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

        // spouse boxes & connectors
        const SPOUSE_OFFSET_X = 140;
        const SPOUSE_BOX_W = 180;
        const SPOUSE_BOX_H = 34;
        const SPOUSE_BOX_RX = 12;

        const spouseBoxes: { pid: string; name: string; x: number; y: number; promote?: boolean }[] = [];

        const rootFamilyPos = pos.get(`family:${tree.id}`);

        for (const f of famNodes) {
          const jx = f.x;
          const jy = f.y;
          const husbId = f.data.husb ?? null;
          const wifeId = f.data.wife ?? null;
          const isRootFamily = f.data && f.data.id === tree.id;

          if (husbId) {
            const ppos = pos.get(`person:${husbId}`);
            let ax = ppos ? ppos.x : jx - SPOUSE_OFFSET_X;
            let ay = ppos ? ppos.y : jy;
            if (isRootFamily && rootFamilyPos) {
              ax = rootFamilyPos.x - SPOUSE_OFFSET_X;
              ay = rootFamilyPos.y - (BOX_H + 20);
            }
            if (!ppos) spouseBoxes.push({ pid: husbId, name: nameById.get(husbId) ?? "unknown", x: ax, y: ay, promote: isRootFamily });
          }

          if (wifeId) {
            const ppos = pos.get(`person:${wifeId}`);
            let ax = ppos ? ppos.x : jx + SPOUSE_OFFSET_X;
            let ay = ppos ? ppos.y : jy;
            if (isRootFamily && rootFamilyPos) {
              ax = rootFamilyPos.x + SPOUSE_OFFSET_X;
              ay = rootFamilyPos.y - (BOX_H + 20);
            }
            if (!ppos) spouseBoxes.push({ pid: wifeId, name: nameById.get(wifeId) ?? "unknown", x: ax, y: ay, promote: isRootFamily });
          }
        }

        const inTreePersons = new Set(personNodes.map((d) => d.data.id));
        const filteredSpouses = spouseBoxes.filter((s) => !inTreePersons.has(s.pid));

        // Draw connectors
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

        // spouse boxes
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

        // initial zoom/pan: center entire tree content and zoom out to fit
        const allDescendants = root.descendants();
        const treeMinX = d3.min(allDescendants, (d) => d.x) ?? 0;
        const treeMaxX = d3.max(allDescendants, (d) => d.x) ?? 0;
        const treeCenter = (treeMinX + treeMaxX) / 2;
        const initialTransform = d3.zoomIdentity.scale(0.75).translate(width / 2 - (offsetX + treeCenter), 20);
        svg.call(zoom.transform as any, initialTransform);
      } catch (err: any) {
        console.error(err);
        if (onError) onError(String(err));
      }
    }, [tree, nameById, onOpenInTree, height, onError]);

    return <svg ref={ref} width="100%" height={height} />;
  }

  async function find() {
    setError(null);
    setRenderError(null);
    setResult(null);
    setPrunedTree(null);
    if (!aId || !bId || aId === bId) {
      setError("Pick two different people.");
      return;
    }
    setLoading(true);
    try {
      const qs = `a=${encodeURIComponent(aId)}&b=${encodeURIComponent(bId)}`;
      const r = await fetch(`${import.meta.env.VITE_API_URL}/api/common_pair?${qs}`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (!r.ok) throw new Error(`Request failed ${r.status}`);
      const data = await r.json();
      setResult(data);

      // support multiple candidates returned by the API
      const candList = data.candidates ?? (data.lca ? [ { lca: data.lca, spouse: data.spouse, relationship: data.relationship, anc: data.anc, desc: data.desc } ] : []);
      setCandidates(candList);
      setSelectedCandidate(0);

      // Build pruned trees for all candidates immediately
      if (candList.length === 0) {
        setPrunedTrees(null);
        setPrunedTree(null);
      } else {
        const trees = candList.map((c: any) => buildPrunedFromDesc(c.desc.tree, c.lca, c.spouse, c.desc.extra_links || [], showDuplicates));
        setPrunedTrees(trees);
        setDebugData({ candidates: candList, prunedTrees: trees });
        setRenderError(null);
        // buildPrunedFromDesc now returns an array of alternate trees per candidate; take the first
        setPrunedTree(trees[0]?.[0] ?? null);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  // Render pruned tree with D3
  useEffect(() => {
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

      const root = d3.hierarchy(prunedTree as any, (d: any) => d.children ?? []);
      const layout = d3.tree().nodeSize([220, 120]);
      layout(root as any);

      // center horizontally
      const minX = d3.min(root.descendants(), (d) => d.x) ?? 0;
      const maxX = d3.max(root.descendants(), (d) => d.x) ?? 0;
      const contentW = maxX - minX + 240;
      const offsetX = (width - contentW) / 2 - minX + 120;
      const offsetY = 40;
      const gx = g.append("g").attr("transform", `translate(${offsetX},${offsetY})`);

      const pos = new Map<string, { x: number; y: number; data: any }>();
      root.descendants().forEach((d) => pos.set(`${d.data.type}:${d.data.id}`, { x: d.x, y: d.y, data: d.data }));

      const BOX_W = 180;
      const BOX_H = 34;
      const BOX_RX = 12;

      // links
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

          let sx = s.x;
          let sy = s.y;
          let tx = t.x;
          let ty = t.y;

          if (d.source.data.type === "person") sy = s.y + BOX_H / 2;
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
        .text((d: any) => nameById.get(d.data.id) ?? "unknown");

      // family junctions
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

      // spouse boxes
      const SPOUSE_OFFSET_X = 140;
      const SPOUSE_BOX_W = 180;
      const SPOUSE_BOX_H = 34;
      const SPOUSE_BOX_RX = 12;

      const spouseBoxes: { pid: string; name: string; x: number; y: number; promote?: boolean }[] = [];

      // compute root family position
      const rootFamilyPos = pos.get(`family:${prunedTree.id}`);

      for (const f of famNodes) {
        const jx = f.x;
        const jy = f.y;
        const husbId = f.data.husb ?? null;
        const wifeId = f.data.wife ?? null;
        // promote if this family is the root family
        const isRootFamily = f.data && f.data.id === prunedTree.id;

        if (husbId) {
          const ppos = pos.get(`person:${husbId}`);
          let ax = ppos ? ppos.x : jx - SPOUSE_OFFSET_X;
          let ay = ppos ? ppos.y : jy;
          if (isRootFamily && rootFamilyPos) {
            ax = rootFamilyPos.x - SPOUSE_OFFSET_X;
            // place parent above the family junction
            ay = rootFamilyPos.y - (BOX_H + 20);
          }
          if (!ppos) spouseBoxes.push({ pid: husbId, name: nameById.get(husbId) ?? "unknown", x: ax, y: ay, promote: isRootFamily });
        }

        if (wifeId) {
          const ppos = pos.get(`person:${wifeId}`);
          let ax = ppos ? ppos.x : jx + SPOUSE_OFFSET_X;
          let ay = ppos ? ppos.y : jy;
          if (isRootFamily && rootFamilyPos) {
            ax = rootFamilyPos.x + SPOUSE_OFFSET_X;
            // place parent above the family junction
            ay = rootFamilyPos.y - (BOX_H + 20);
          }
          if (!ppos) spouseBoxes.push({ pid: wifeId, name: nameById.get(wifeId) ?? "unknown", x: ax, y: ay, promote: isRootFamily });
        }
      }

      const inTreePersons = new Set(personNodes.map((d) => d.data.id));
      const filteredSpouses = spouseBoxes.filter((s) => !inTreePersons.has(s.pid));

      // Draw connectors
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

      // spouse boxes
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

      // initial zoom/pan: center entire tree content and zoom out to fit
      const allDescendants = root.descendants();
      const treeMinX = d3.min(allDescendants, (d) => d.x) ?? 0;
      const treeMaxX = d3.max(allDescendants, (d) => d.x) ?? 0;
      const treeCenter = (treeMinX + treeMaxX) / 2;
      const initialTransform = d3.zoomIdentity.scale(0.75).translate(width / 2 - (offsetX + treeCenter), 20);
      svg.call(zoom.transform as any, initialTransform);
    } catch (err: any) {
      console.error(err);
      setError(String(err));
    }
  }, [prunedTree, nameById, onOpenInTree]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto", flex: 1, width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", position: "relative", zIndex: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Person A
          <SearchableSelect
            options={people}
            value={aId}
            onChange={setAId}
            placeholder="Search person…"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Person B
          <SearchableSelect
            options={people}
            value={bId}
            onChange={setBId}
            placeholder="Search person…"
          />
        </label>

        <button onClick={find} disabled={!aId || !bId || aId === bId || loading}>
          {loading ? "Finding…" : "Find common ancestor pair"}
        </button>


      </div>

      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}

      {(candidates && candidates.length > 0) || result ? (
        <div style={{ display: "grid", gap: 8, overflow: "auto", flex: 1 }}>
          {candidates && candidates.length > 1 ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => { setSelectedCandidate(i); const t = buildPrunedFromDesc(c.desc.tree, c.lca, c.spouse, c.desc.extra_links || [], showDuplicates); setPrunedTree(t?.[0] ?? null); }}
                  style={{ fontWeight: i === selectedCandidate ? 800 : 400 }}
                >
                  {nameById.get(c.lca) ?? "unknown"} {c.spouse ? `+ ${nameById.get(c.spouse) ?? "unknown"}` : ''}
                </button>
              ))}
            </div>
          ) : null}

          {(() => {
            const active = (candidates && candidates.length > 0) ? candidates[selectedCandidate] : result;
            if (!active) return null;
            return (
              <>
                <div>
                  <b>Common ancestor pair:</b> {active.lca ? nameById.get(active.lca) ?? "unknown" : "None"}
                  {active.spouse ? ` + ${nameById.get(active.spouse) ?? "unknown"}` : ""}
                </div>
                <div>
                  <b>Relationship:</b> {active.relationship}
                </div>

                {active.lca ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => onOpenInTree(active.lca)}>Open person in Tree view</button>
                    {active.spouse ? (
                      <button onClick={() => onOpenInTree(active.spouse!)}>Open spouse in Tree view</button>
                    ) : null}
                    <a href={`${import.meta.env.VITE_API_URL}/api/person/${encodeURIComponent(active.lca)}`} target="_blank" rel="noreferrer">
                      View person JSON
                    </a>
                  </div>
                ) : null}

                <div style={{ opacity: 0.75, fontSize: 13 }}>
                  The ancestor pair is shown as a family at the top; descendants are pruned to relevant paths.
                </div>
              </>
            );
          })()}
        </div>
      ) : null}

      {(() => {
        const showMultiple = (candidates && candidates.length > 1 && prunedTrees && prunedTrees.length === candidates.length && candidates.every((c: any) => c.relationship === candidates[0].relationship));
        if (showMultiple) {
          return (
            <div style={{ display: 'flex', gap: 12, marginTop: 12, width: '100%' }}>
              {candidates!.map((c: any, i: number) => (
                <div key={i} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8, flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{nameById.get(c.lca) ?? "unknown"}{c.spouse ? ` + ${nameById.get(c.spouse) ?? "unknown"}` : ''}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {prunedTrees![i] && prunedTrees![i].length > 1 ? (
                      prunedTrees![i].map((t: any, j: number) => (
                        <div key={j} style={{ flex: 1 }}>
                          <PrunedTreeSVG tree={t} nameById={nameById} onOpenInTree={onOpenInTree} onError={(e)=>setRenderError(e)} height={360} />
                          <div style={{ textAlign: 'center', fontSize: 12, marginTop: 6 }}>Option {j + 1}</div>
                        </div>
                      ))
                    ) : (
                      <PrunedTreeSVG tree={prunedTrees![i]?.[0]} nameById={nameById} onOpenInTree={onOpenInTree} onError={(e)=>setRenderError(e)} height={420} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        // Single-candidate: if there are multiple alternative pruned subtrees for the selected candidate,
        // show them side-by-side; otherwise show the single tree.
        if (prunedTrees && candidates && candidates.length > 0) {
          const arr = prunedTrees[selectedCandidate] ?? [];
          if (arr.length > 1) {
            return (
              <div style={{ display: 'flex', gap: 12, marginTop: 12, width: '100%' }}>
                {arr.map((t: any, i: number) => (
                  <div key={i} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8, flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{nameById.get(candidates[selectedCandidate].lca) ?? candidates[selectedCandidate].lca}{candidates[selectedCandidate].spouse ? ` + ${nameById.get(candidates[selectedCandidate].spouse) ?? candidates[selectedCandidate].spouse}` : ''} — Option {i + 1}</div>
                    <PrunedTreeSVG tree={t} nameById={nameById} onOpenInTree={onOpenInTree} onError={(e)=>setRenderError(e)} height={420} />
                  </div>
                ))}
              </div>
            );
          }

          if (arr.length === 1) {
            return (
              <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 8, marginTop: 12, width: '100%' }}>
                <PrunedTreeSVG tree={arr[0]} nameById={nameById} onOpenInTree={onOpenInTree} onError={(e)=>setRenderError(e)} height={480} />
              </div>
            );
          }
        }

        return null;
      })()}

      {/* Debug / error panel */}
      <div style={{ marginTop: 12 }}>
        {renderError ? (
          <div style={{ border: '1px solid #f5c6cb', background: '#fff5f6', padding: 8, borderRadius: 6 }}>
            <div style={{ color: '#721c24', fontWeight: 700 }}>Render error</div>
            <div style={{ color: '#721c24', whiteSpace: 'pre-wrap', fontSize: 13 }}>{renderError}</div>
          </div>
        ) : null}

        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setDebugOpen(!debugOpen)} style={{ fontSize: 12 }}>{debugOpen ? 'Hide debug' : 'Show debug'}</button>
          <div style={{ color: '#666', fontSize: 12 }}>{debugData ? `Candidates: ${debugData.candidates?.length ?? 0}, PrunedTrees: ${Array.isArray(debugData.prunedTrees) ? debugData.prunedTrees.length : 0}` : 'No debug data'}</div>
        </div>

        {debugOpen && debugData ? (
          <pre style={{ marginTop: 8, background: '#f7f7f7', padding: 8, borderRadius: 6, maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(debugData, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}
