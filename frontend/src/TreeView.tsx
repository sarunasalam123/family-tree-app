import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

type PersonLite = { id: string; name: string };

type ApiNode =
  | { type: "person"; id: string; name: string; sex?: string; children?: ApiNode[] }
  | { type: "family"; id: string; husb?: string | null; wife?: string | null; children?: ApiNode[] };

type ExtraLink = { from_fam: string; to_person: string };

type ApiResponse = { tree: ApiNode; extra_links: ExtraLink[] };

function drawAncestryTree(opts: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  rootNode: ApiNode;
  extraLinks?: ExtraLink[];
  nameById: Map<string, string>;
  translateX: number;
  translateY: number;
  direction: "up" | "down";
  onPersonClick: (id: string) => void;
  skipRootPersonBox?: boolean;
  connectTo?: { x: number; y: number };
}) {
  const {
    g,
    rootNode,
    extraLinks = [],
    nameById,
    translateX,
    translateY,
    direction,
    onPersonClick,
    skipRootPersonBox,
    connectTo,
  } = opts;

  const group = g.append("g").attr("transform", `translate(${translateX},${translateY})`);

  const root = d3.hierarchy<ApiNode>(rootNode as any, (d) => d.children ?? []);
  const layout = d3.tree<ApiNode>().nodeSize([240, 150]);
  layout(root);

  // Flip ancestors upward
  if (direction === "up") {
    root.each((d) => {
      d.y = -d.y;
    });
  }

  // Center by X
  const minX = d3.min(root.descendants(), (d) => d.x) ?? 0;
  const maxX = d3.max(root.descendants(), (d) => d.x) ?? 0;
  const xRange = maxX - minX || 1;

  const shiftX = translateX - (minX + xRange / 2);
  const shiftY = translateY;
  group.attr("transform", `translate(${shiftX},${shiftY})`);

  const pos = new Map<string, { x: number; y: number; data: ApiNode }>();
  root.descendants().forEach((d) => pos.set(`${d.data.type}:${d.data.id}`, { x: d.x, y: d.y, data: d.data }));

  // Sizing (used for edge targeting)
  const SPOUSE_OFFSET_X = 140;
  const BOX_W = 180;
  const BOX_H = 34;
  const BOX_RX = 12;
  const TRUNK_H = 28;

  const rootPersonId = rootNode.type === "person" ? rootNode.id : "";
  const rootLocal = pos.get(`person:${rootPersonId}`) ?? null;

  function toScreen(p: { x: number; y: number }) {
    return { x: p.x + shiftX, y: p.y + shiftY };
  }

  function drawPersonBox(sel: d3.Selection<SVGGElement, unknown, null, undefined>, label: string) {
    sel
      .append("rect")
      .attr("x", -BOX_W / 2)
      .attr("y", -BOX_H / 2)
      .attr("width", BOX_W)
      .attr("height", BOX_H)
      .attr("rx", BOX_RX)
      .attr("fill", "white")
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.25);

    sel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 12)
      .text(label);
  }

  const spouseBoxes: { pid: string; name: string; x: number; y: number }[] = [];
  const junctions: { fid: string; x: number; y: number }[] = [];
  const links: Link[] = [];

  // Normal links based on the hierarchy
  root.descendants().forEach((d) => {
    if (d.data.type !== "family") return;

    const familyPos = pos.get(`family:${d.data.id}`);
    if (!familyPos) return;

    const jx = familyPos.x;
    const jy = familyPos.y;

    junctions.push({ fid: d.data.id, x: jx, y: jy });

    const husbId = d.data.husb ?? null;
    const wifeId = d.data.wife ?? null;

    if (husbId) {
      const ppos = pos.get(`person:${husbId}`);
      const ax = ppos ? ppos.x : jx - SPOUSE_OFFSET_X;
      const ay = ppos ? ppos.y : jy;
      if (!ppos) spouseBoxes.push({ pid: husbId, name: nameById.get(husbId) ?? husbId, x: ax, y: ay });
      links.push({ sx: ax, sy: ay, tx: jx, ty: jy, kind: "normal" });
    }

    if (wifeId) {
      const ppos = pos.get(`person:${wifeId}`);
      const ax = ppos ? ppos.x : jx + SPOUSE_OFFSET_X;
      const ay = ppos ? ppos.y : jy;
      if (!ppos) spouseBoxes.push({ pid: wifeId, name: nameById.get(wifeId) ?? wifeId, x: ax, y: ay });
      links.push({ sx: ax, sy: ay, tx: jx, ty: jy, kind: "normal" });
    }

    if (direction === "down") {
      // Descendants: junction -> trunk -> children
      const trunkEndX = jx;
      const trunkEndY = jy + TRUNK_H;
      links.push({ sx: jx, sy: jy, tx: trunkEndX, ty: trunkEndY, kind: "normal" });

      (d.children ?? []).forEach((child) => {
        if (child.data.type !== "person") return;
        const cpos = pos.get(`person:${child.data.id}`);
        if (!cpos) return;

        links.push({ sx: trunkEndX, sy: trunkEndY, tx: cpos.x, ty: cpos.y - BOX_H / 2, kind: "normal" });
      });
    } else {
      // Ancestors: parents-junction -> the child-person that owns this family (d.parent)
      const childPerson = d.parent;
      if (childPerson && childPerson.data.type === "person") {
        const childId = childPerson.data.id;

        if (connectTo && childId === rootPersonId) {
          const targetLocal = { x: connectTo.x - shiftX, y: connectTo.y - shiftY };
          links.push({ sx: jx, sy: jy, tx: targetLocal.x, ty: targetLocal.y, kind: "normal" });
        } else {
          const cpos = pos.get(`person:${childId}`);
          if (cpos) {
            links.push({ sx: jx, sy: jy, tx: cpos.x, ty: cpos.y + BOX_H / 2, kind: "normal" });
          }
        }
      }
    }
  });


  // Links
  group
    .append("g")
    .selectAll("path.link")
    .data(links)
    .join("path")
    .attr("fill", "none")
    .attr("stroke", "currentColor")
    .attr("stroke-opacity", (d) => (d.kind === "extra" ? 0.35 : 0.25))
    .attr("stroke-width", (d) => (d.kind === "extra" ? 1.75 : 2))
    .attr("stroke-dasharray", (d) => (d.kind === "extra" ? "5 5" : null))
    .attr("d", (d) => {
      const s = d.ty >= d.sy ? 1 : -1;
      const midY1 = d.sy + 50 * s;
      const midY2 = d.ty - 50 * s;
      return `M${d.sx},${d.sy} C${d.sx},${midY1} ${d.tx},${midY2} ${d.tx},${d.ty}`;
    });

  // Person nodes
  const personNodes = root.descendants().filter((d) => d.data.type === "person");
  const filteredPersonNodes =
    skipRootPersonBox && rootPersonId ? personNodes.filter((d) => d.data.id !== rootPersonId) : personNodes;

  const pn = group
    .append("g")
    .selectAll("g.person")
    .data(filteredPersonNodes)
    .join("g")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (_, d) => onPersonClick(d.data.id));

  pn.each(function (d) {
    drawPersonBox(d3.select(this) as any, d.data.name);
  });

  // Spouse boxes only when spouse person isn't in this subtree
  const inTreePersons = new Set(personNodes.map((d) => d.data.id));
  const filteredSpouses = spouseBoxes.filter((s) => !inTreePersons.has(s.pid));

  const sn = group
    .append("g")
    .selectAll("g.spouse")
    .data(filteredSpouses)
    .join("g")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (_, d) => onPersonClick(d.pid));

  sn.each(function (d) {
    drawPersonBox(d3.select(this) as any, d.name);
  });

  // Junction dots
  group
    .append("g")
    .selectAll("circle.junction")
    .data(junctions)
    .join("circle")
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", 4)
    .attr("fill", "currentColor")
    .attr("fill-opacity", 0.55);

  // Return root box edge points in SCREEN coords
  let rootBox: null | {
    center: { x: number; y: number };
    top: { x: number; y: number };
    bottom: { x: number; y: number };
    left: { x: number; y: number };
    right: { x: number; y: number };
  } = null;

  if (rootLocal) {
    const c = toScreen(rootLocal);
    rootBox = {
      center: c,
      top: { x: c.x, y: c.y - BOX_H / 2 },
      bottom: { x: c.x, y: c.y + BOX_H / 2 },
      left: { x: c.x - BOX_W / 2, y: c.y },
      right: { x: c.x + BOX_W / 2, y: c.y },
    };
  }

  return { rootBox };
}

export default function TreeView() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [people, setPeople] = useState<PersonLite[]>([]);
  const [rootId, setRootId] = useState<string>("");

  const [ancDepth, setAncDepth] = useState<number>(4);
  const [descDepth, setDescDepth] = useState<number>(6);

  const [anc, setAnc] = useState<ApiResponse | null>(null);
  const [desc, setDesc] = useState<ApiResponse | null>(null);

  useEffect(() => {
    fetch("http://localhost:8000/api/people")
      .then((r) => r.json())
      .then((data: PersonLite[]) => {
        setPeople(data);
        if (data.length && !rootId) setRootId(data[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!rootId) return;

    fetch(`http://localhost:8000/api/ancestors?root=${encodeURIComponent(rootId)}&depth=${ancDepth}`)
      .then((r) => r.json())
      .then(setAnc);

    fetch(`http://localhost:8000/api/tree?root=${encodeURIComponent(rootId)}&depth=${descDepth}`)
      .then((r) => r.json())
      .then(setDesc);
  }, [rootId, ancDepth, descDepth]);

  useEffect(() => {
    if (!svgRef.current || !anc || !desc) return;

    const nameById = new Map(people.map((p) => [p.id, p.name]));

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 1600;
    const height = 900;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg.append("g");

    svg.call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.25, 2.5])
        .on("zoom", (event) => g.attr("transform", event.transform))
    );

    const centerX = width / 2;
    const centerY = height / 2;

    // Descendants first
    const descResult = drawAncestryTree({
      g,
      rootNode: desc.tree,
      extraLinks: desc.extra_links,
      nameById,
      translateX: centerX,
      translateY: centerY + 40,
      direction: "down",
      onPersonClick: setRootId,
    });

    // Ancestors, connect to descendant root edge
    drawAncestryTree({
      g,
      rootNode: anc.tree,
      extraLinks: anc.extra_links,
      nameById,
      translateX: centerX,
      translateY: centerY - 40,
      direction: "up",
      onPersonClick: setRootId,
      skipRootPersonBox: true,
      connectTo: descResult.rootBox?.top ?? undefined,
    });
  }, [people, anc, desc]);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 12, height: "100vh", padding: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Family Tree</div>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Root:
          <select value={rootId} onChange={(e) => setRootId(e.target.value)} style={{ padding: 6, borderRadius: 10 }}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          Ancestors depth: <strong>{ancDepth}</strong>
          <input type="range" min={1} max={10} value={ancDepth} onChange={(e) => setAncDepth(Number(e.target.value))} />
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          Descendants depth: <strong>{descDepth}</strong>
          <input
            type="range"
            min={1}
            max={12}
            value={descDepth}
            onChange={(e) => setDescDepth(Number(e.target.value))}
          />
        </label>

        <div style={{ opacity: 0.7, fontSize: 12 }}>Tip: scroll to zoom, drag to pan, click a person to re-center.</div>
      </div>

      <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 16, overflow: "hidden" }}>
        <svg ref={svgRef} style={{ width: "100%", height: "100%", background: "white" }} />
      </div>
    </div>
  );
}