import React, { useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { usePassword } from "./App";
import { SearchableSelect } from "./SearchableSelect";

type PersonLite = { id: string; name: string };

type ConnectStep = { id: string; via: string | null };
type ConnectResult = { relationship?: string; paths: ConnectStep[][] };

type MiniNode = { id: string; label: string; x: number; y: number };
type MiniLink = { source: string; target: string; label?: string | null };

export function ConnectMiniGraphTab({
  people,
  nameById,
  aId,
  setAId,
  bId,
  setBId,
  result,
  setResult,
  error,
  setError,
}: {
  people: PersonLite[];
  nameById: Map<string, string>;
  aId: string;
  setAId: (id: string) => void;
  bId: string;
  setBId: (id: string) => void;
  result: ConnectResult | null;
  setResult: (result: ConnectResult | null) => void;
  error: string | null;
  setError: (error: string | null) => void;
}) {
  const password = usePassword();

  async function findConnection() {
    setError(null);
    setResult(null);

    if (!aId || !bId || aId === bId) {
      setError("Pick two different people.");
      return;
    }

    const url = `http://localhost:8000/api/connect?a=${encodeURIComponent(
      aId
    )}&b=${encodeURIComponent(bId)}`;

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${password}` },
    });
    if (!r.ok) {
      setError(`Request failed (${r.status})`);
      return;
    }
    const data = (await r.json()) as ConnectResult;

    if (!data.paths || data.paths.length === 0) {
      setError("No connection found.");
      return;
    }

    setResult(data);
  }

  const graph = useMemo(() => {
    if (!result?.paths?.length) return null;

    // Display all paths stacked vertically
    const spacingX = 220;
    const pathSpacingY = 150; // Vertical spacing between different paths
    const startY = 60;

    const nodes: MiniNode[] = [];
    const links: MiniLink[] = [];
    let pathIndex = 0;

    for (const path of result.paths) {
      const y = startY + pathIndex * pathSpacingY;

      for (let i = 0; i < path.length; i++) {
        const step = path[i];
        // Create unique node ID by combining person ID and path index
        const nodeKey = `${step.id}_path${pathIndex}`;
        
        nodes.push({
          id: nodeKey,
          label: nameById.get(step.id) ?? "unknown",
          x: i * spacingX,
          y,
        });

        // Add links between consecutive steps in this path
        if (i > 0) {
          links.push({
            source: `${path[i - 1].id}_path${pathIndex}`,
            target: nodeKey,
            label: step.via ?? undefined,
          });
        }
      }

      pathIndex++;
    }

    return { nodes, links };
  }, [result, nameById]);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 10, height: "80vh", width: "80vw", padding: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Person A{" "}
          <SearchableSelect
            options={people}
            value={aId}
            onChange={setAId}
            placeholder="Search person…"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Person B{" "}
          <SearchableSelect
            options={people}
            value={bId}
            onChange={setBId}
            placeholder="Search person…"
          />
        </label>

        <button onClick={findConnection} disabled={!aId || !bId || aId === bId}>
          Find connection
        </button>

        {result?.relationship ? (
          <div style={{ opacity: 0.85 }}>
            <b>Relationship:</b> {result.relationship}
          </div>
        ) : null}
      </div>

      {error ? <div style={{ color: "crimson" }}>{error}</div> : null}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 8,
          width: "100%",
          height: "100%",
          overflow: "auto",
        }}
      >
        {graph ? <MiniGraph graph={graph} /> : <div style={{ opacity: 0.6 }}>Select two people to see the mini graph.</div>}
      </div>
    </div>
  );
}

function MiniGraph({
  graph,
}: {
  graph: { nodes: MiniNode[]; links: MiniLink[] };
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  React.useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    const width = svgEl.clientWidth || 800;
    const height = svgEl.clientHeight || 320;

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // Root group for zoom/pan
    const g = svg.append("g");

    // Zoom
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 2.5])
      .on("zoom", (event) => g.attr("transform", event.transform));

    svg.call(zoom as any);

    // Center the path nicely
    const minX = d3.min(graph.nodes, (d) => d.x) ?? 0;
    const maxX = d3.max(graph.nodes, (d) => d.x) ?? 0;
    const contentW = maxX - minX + 180;
    const contentH = 200;

    const offsetX = (width - contentW) / 2 - minX + 80;
    const offsetY = (height - contentH) / 2;

    const gx = g.append("g").attr("transform", `translate(${offsetX},${offsetY})`);

    // Draw links
    const linkG = gx.append("g");

    linkG
      .selectAll("path")
      .data(graph.links)
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", "#333")
      .attr("stroke-width", 2)
      .attr("d", (d) => {
        const s = graph.nodes.find((n) => n.id === d.source)!;
        const t = graph.nodes.find((n) => n.id === d.target)!;
        const sx = s.x + 160; // right edge of node box
        const sy = s.y + 20;
        const tx = t.x; // left edge
        const ty = t.y + 20;

        // Simple smooth curve
        const mx = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
      });

    // Link labels
    linkG
      .selectAll("text")
      .data(graph.links)
      .enter()
      .append("text")
      .attr("font-size", 12)
      .attr("opacity", 0.75)
      .attr("text-anchor", "middle")
      .attr("x", (d) => {
        const s = graph.nodes.find((n) => n.id === d.source)!;
        const t = graph.nodes.find((n) => n.id === d.target)!;
        return (s.x + 160 + t.x) / 2;
      })
      .attr("y", (d) => {
        const s = graph.nodes.find((n) => n.id === d.source)!;
        const t = graph.nodes.find((n) => n.id === d.target)!;
        return (s.y + 20 + t.y + 20) / 2 - 8;
      })
      .text((d) => d.label ?? "");

    // Draw nodes
    const nodeG = gx.append("g");

    const node = nodeG
      .selectAll("g")
      .data(graph.nodes)
      .enter()
      .append("g")
      .attr("transform", (d) => `translate(${d.x},${d.y})`);

    node
      .append("rect")
      .attr("rx", 10)
      .attr("ry", 10)
      .attr("width", 160)
      .attr("height", 40)
      .attr("fill", "#fff")
      .attr("stroke", "#111")
      .attr("stroke-width", 2);

    node
      .append("text")
      .attr("x", 80)
      .attr("y", 24)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 13)
      .text((d) => truncate(d.label, 22));
  }, [graph]);

  return <svg ref={svgRef} width="100%" height="100%" />;
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}