// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { usePassword } from "./App";
import { SearchableSelect } from "./SearchableSelect";

type PersonLite = { id: string; name: string };

type ApiNode =
  | { type: "person"; id: string; name: string; sex?: string; children?: ApiNode[] }
  | { type: "family"; id: string; husb?: string | null; wife?: string | null; children?: ApiNode[] };

type ExtraLink = { from_fam: string; to_person: string };

type ApiResponse = { tree: ApiNode; extra_links: ExtraLink[]; spouse_families?: { [key: string]: { id: string; husb?: string | null; wife?: string | null } } };

type Link = { from?: string; to?: string; kind: string; sx: number; sy: number; tx: number; ty: number; fromKey?: string; toKey?: string };

function drawAncestryTree(opts: {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  rootNode: ApiNode;
  extraLinks?: ExtraLink[];
  spouse_families?: { [key: string]: { id: string; husb?: string | null; wife?: string | null } };
  nameById: Map<string, string>;
  displayNameById?: Map<string, string>;
  translateX: number;
  translateY: number;
  direction: "up" | "down";
  onPersonClick: (id: string) => void;
  skipRootPersonBox?: boolean;
  connectTo?: { x: number; y: number };
  showDuplicates?: boolean;
}) {
  const {
    g,
    rootNode,
    extraLinks = [],
    spouse_families = {},
    nameById,
    displayNameById,
    translateX,
    translateY,
    direction,
    onPersonClick,
    skipRootPersonBox,
    connectTo,
    showDuplicates = false,
  } = opts;

  const group = g.append("g").attr("transform", `translate(${translateX},${translateY})`);

  // Sizing (used for edge targeting and layout)
  const SPOUSE_OFFSET_X = 220;
  const BOX_W = 240;
  const BOX_H = 50;
  const BOX_RX = 12;
  const TRUNK_H = 28;

  const root = d3.hierarchy<ApiNode>(rootNode as any, (d) => d.children ?? []);
  
  const personNodes = root.descendants().filter((d) => d.data.type === "person");

  // Increase horizontal spacing if spouse boxes will be displayed
  const nodeSpacing = 300;
  // Double vertical spacing for descendants tree, keep normal for ancestors
  const verticalSpacing = direction === "down" ? 150 : 75;
  const layout = d3.tree<ApiNode>().nodeSize([nodeSpacing, verticalSpacing]);
  layout(root);

  // Flip ancestors upward
  if (direction === "up") {
    root.each((d) => {
      d.y = -d.y;
    });
  }

  // Anchor on the root node's x so both trees share the same vertical axis
  const shiftX = translateX - root.x;
  const shiftY = translateY;
  group.attr("transform", `translate(${shiftX},${shiftY})`);

  const pos = new Map<string, { x: number; y: number; data: ApiNode }>();
  root.descendants().forEach((d) => pos.set(`${d.data.type}:${d.data.id}`, { x: d.x, y: d.y, data: d.data }));

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
      .attr("stroke", "#333")
      .attr("stroke-opacity", 0.4);

    sel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 16)
      .text(label);
  }

  const spouseBoxes: { pid: string; name: string; x: number; y: number; forceLocal?: boolean }[] = [];
  const junctions: { fid: string; x: number; y: number }[] = [];
  const links: Link[] = [];

  // For ancestor trees (direction="up") with showDuplicates=false, group family nodes by fid.
  // When the same family appears multiple times (siblings who are both ancestors of the root),
  // the primary occurrence draws a trunk+bar+stems pattern; secondaries are skipped entirely.
  const famSiblingGroups = new Map<string, d3.HierarchyNode<ApiNode>[]>();
  if (direction === "up" && !showDuplicates) {
    root.descendants().forEach((nd) => {
      if (nd.data.type !== "family") return;
      if (!famSiblingGroups.has(nd.data.id)) famSiblingGroups.set(nd.data.id, []);
      famSiblingGroups.get(nd.data.id)!.push(nd);
    });
  }

  // Normal links based on the hierarchy
  root.descendants().forEach((d) => {
    if (d.data.type !== "family") return;

    // For ancestor trees without duplicates: skip secondary occurrences of the same family.
    // The primary occurrence will draw the trunk+bar+stems covering all siblings.
    if (direction === "up" && !showDuplicates) {
      const sibGroup = famSiblingGroups.get(d.data.id);
      if (sibGroup && sibGroup.length > 1 && sibGroup[0] !== d) return;
    }

    // For descendant trees without duplicates: skip family junctions that have no real
    // children nodes (all children were duplicates and became extra_links). These would
    // render as empty junctions with only dashed cross-links, which is confusing.
    if (direction === "down" && !showDuplicates) {
      const realChildren = (d.children ?? []).filter((c) => c.data.type === "person");
      if (realChildren.length === 0) return;
    }

    // Use the d3 node's own coordinates directly — avoids stale pos-map values
    // when duplicate person nodes have been injected (showDuplicates mode).
    const jx = d.x;
    const jy = d.y;

    junctions.push({ fid: d.data.id, x: jx, y: jy });

    const husbId = d.data.husb ?? null;
    const wifeId = d.data.wife ?? null;

    if (husbId) {
      const husbChild = (d.children ?? []).find((c) => c.data.type === "person" && c.data.id === husbId);
      const ownerIsHusb = d.parent?.data.type === "person" && d.parent.data.id === husbId;
      const useLocalHusb = showDuplicates && direction === "down" && !ownerIsHusb && pos.has(`person:${husbId}`);
      // If the husband IS the parent node, use d.parent's coordinates directly (avoids pos-map collision with duplicates)
      const hpos = husbChild
        ? { x: husbChild.x, y: husbChild.y }
        : ownerIsHusb && d.parent
        ? { x: d.parent.x, y: d.parent.y }
        : useLocalHusb
        ? null
        : pos.get(`person:${husbId}`);
      const hx = hpos ? hpos.x : jx - SPOUSE_OFFSET_X;
      const hy = hpos ? hpos.y : jy;
      if (!hpos) {
        spouseBoxes.push({ pid: husbId, name: displayNameById?.get(husbId) ?? nameById.get(husbId) ?? "unknown", x: hx, y: hy, forceLocal: useLocalHusb });
      }
      links.push({ sx: hx, sy: hy, tx: jx, ty: jy, kind: "normal", fromKey: `person:${husbId}`, toKey: `fam:${d.data.id}` });
    }

    if (wifeId) {
      const wifeChild = (d.children ?? []).find((c) => c.data.type === "person" && c.data.id === wifeId);
      const ownerIsWife = d.parent?.data.type === "person" && d.parent.data.id === wifeId;
      const useLocalWife = showDuplicates && direction === "down" && !ownerIsWife && pos.has(`person:${wifeId}`);
      // If the wife IS the parent node, use d.parent's coordinates directly
      const wpos = wifeChild
        ? { x: wifeChild.x, y: wifeChild.y }
        : ownerIsWife && d.parent
        ? { x: d.parent.x, y: d.parent.y }
        : useLocalWife
        ? null
        : pos.get(`person:${wifeId}`);
      const wx = wpos ? wpos.x : jx + SPOUSE_OFFSET_X;
      const wy = wpos ? wpos.y : jy;
      if (!wpos) {
        spouseBoxes.push({ pid: wifeId, name: displayNameById?.get(wifeId) ?? nameById.get(wifeId) ?? "unknown", x: wx, y: wy, forceLocal: useLocalWife });
      }
      links.push({ sx: wx, sy: wy, tx: jx, ty: jy, kind: "normal", fromKey: `person:${wifeId}`, toKey: `fam:${d.data.id}` });
    }

    if (direction === "down") {
      // Descendants: junction -> trunk -> children
      const trunkEndX = jx;
      const trunkEndY = jy + TRUNK_H;
      links.push({ sx: jx, sy: jy, tx: trunkEndX, ty: trunkEndY, kind: "normal", fromKey: `fam:${d.data.id}`, toKey: `trunk:${d.data.id}` });

      (d.children ?? []).forEach((child) => {
        if (child.data.type !== "person") return;
        // Use d3 node's own position — correct even for duplicate-injected nodes
        links.push({ sx: trunkEndX, sy: trunkEndY, tx: child.x, ty: child.y - BOX_H / 2, kind: "normal", fromKey: `fam:${d.data.id}`, toKey: `person:${child.data.id}` });
      });
    } else {
      // Ancestors: parents-junction -> the child-person that owns this family (d.parent)
      const sibGroup = famSiblingGroups.get(d.data.id);
      if (sibGroup && sibGroup.length > 1) {
        // Multiple siblings share this family. Draw the junction+parents once (primary),
        // then draw individual bezier lines from the single junction to each sibling child.
        sibGroup.forEach((nd) => {
          if (!nd.parent || nd.parent.data.type !== "person") return;
          const sibId = nd.parent.data.id;
          if (connectTo && sibId === rootPersonId) {
            const targetLocal = { x: connectTo.x - shiftX, y: connectTo.y - shiftY };
            links.push({ sx: jx, sy: jy, tx: targetLocal.x, ty: targetLocal.y, kind: "normal", fromKey: `fam:${d.data.id}`, toKey: `person:${sibId}` });
          } else {
            links.push({ sx: jx, sy: jy, tx: nd.parent.x, ty: nd.parent.y + BOX_H / 2, kind: "normal", fromKey: `fam:${d.data.id}`, toKey: `person:${sibId}` });
          }
        });
      } else {
        // Single child: normal bezier junction → child
        const childPerson = d.parent;
        if (childPerson && childPerson.data.type === "person") {
          const childId = childPerson.data.id;
          if (connectTo && childId === rootPersonId) {
            const targetLocal = { x: connectTo.x - shiftX, y: connectTo.y - shiftY };
            links.push({ sx: jx, sy: jy, tx: targetLocal.x, ty: targetLocal.y, kind: "normal", fromKey: `fam:${d.data.id}`, toKey: `person:${childId}` });
          } else {
            links.push({ sx: jx, sy: jy, tx: childPerson.x, ty: childPerson.y + BOX_H / 2, kind: "normal", fromKey: `fam:${d.data.id}`, toKey: `person:${childId}` });
          }
        }
      }
    }
  });

  // Process leaf spouse families: render spouses as boxes beside each leaf node.
  // Iterate over actual d3 person nodes (not IDs) so duplicate injected nodes each
  // get their own spouse box at their own position.
  const leafSpouseBoxIndices = new Set<number>();
  if (direction === "down") {
    personNodes.forEach((d) => {
      // A leaf is a person node with no children in the d3 hierarchy
      if (d.children && d.children.length > 0) return;
      const personId = d.data.id;
      Object.values(spouse_families).forEach((fam) => {
        const husbId = fam.husb ?? null;
        const wifeId = fam.wife ?? null;
        let spouseId: string | null = null;
        if (husbId === personId) spouseId = wifeId;
        else if (wifeId === personId) spouseId = husbId;
        if (!spouseId) return;
        // Place spouse box below-right of this specific leaf occurrence
        const spouseX = d.x + 20;
        const spouseY = d.y + BOX_H / 2 + 15;
        const boxIndex = spouseBoxes.length;
        spouseBoxes.push({ pid: spouseId, name: displayNameById?.get(spouseId) ?? nameById.get(spouseId) ?? "unknown", x: spouseX, y: spouseY });
        leafSpouseBoxIndices.add(boxIndex);
      });
    });
  }

  // Links
  const linkG = group.append("g");

  const linkPaths = linkG
    .selectAll("path.link")
    .data(links)
    .join("path")
    .attr("class", "link")
    .attr("fill", "none")
    .attr("stroke", (d) => (d.kind === "extra" ? "#888" : "#333"))
    .attr("stroke-opacity", (d) => (d.kind === "extra" ? 0.5 : 0.6))
    .attr("stroke-width", (d) => (d.kind === "extra" ? 1.75 : 2))
    .attr("stroke-dasharray", (d) => (d.kind === "extra" ? "5 5" : null))
    .attr("d", (d) => {
      const s = d.ty >= d.sy ? 1 : -1;
      const midY1 = d.sy + 50 * s;
      const midY2 = d.ty - 50 * s;
      return `M${d.sx},${d.sy} C${d.sx},${midY1} ${d.tx},${midY2} ${d.tx},${d.ty}`;
    });

  // Invisible wide stroke to make edges easy to hover (only when showDuplicates=false)
  if (!showDuplicates) {
    const resetAll = () => {
      linkPaths
        .attr("stroke", (d) => (d.kind === "extra" ? "#888" : "#333"))
        .attr("stroke-opacity", (d) => (d.kind === "extra" ? 0.5 : 0.6))
        .attr("stroke-width", (d) => (d.kind === "extra" ? 1.75 : 2));
      group.selectAll<SVGGElement, unknown>("g.person,g.spouse")
        .each(function () {
          d3.select(this).select("rect")
            .attr("stroke", "#333")
            .attr("stroke-opacity", 0.4)
            .attr("stroke-width", 1);
        });
      group.selectAll<SVGCircleElement, { fid: string }>("circle.junction")
        .each(function () {
          d3.select(this).attr("fill", "currentColor").attr("fill-opacity", 0.55).attr("r", 4);
        });
    };

    linkG
      .selectAll("path.link-hover")
      .data(links)
      .join("path")
      .attr("class", "link-hover")
      .attr("fill", "none")
      .attr("stroke", "transparent")
      .attr("stroke-width", 16)
      .attr("d", (_, i) => linkPaths.nodes()[i]?.getAttribute("d") ?? "")
      .style("cursor", "default")
      .on("mouseenter", function (_, linkDatum) {
        resetAll();

        // Collect junction keys touched by the hovered link
        const hoveredJunctionKeys = new Set(
          [linkDatum.fromKey, linkDatum.toKey].filter((k) => k?.startsWith("fam:")) as string[]
        );

        // Find all links that share any of those junction keys
        const relatedLinks = new Set<Link>([linkDatum]);
        const relatedNodeKeys = new Set<string>();
        links.forEach((l) => {
          const sharesJunction =
            (l.fromKey && hoveredJunctionKeys.has(l.fromKey)) ||
            (l.toKey && hoveredJunctionKeys.has(l.toKey));
          if (sharesJunction) {
            relatedLinks.add(l);
            if (l.fromKey) relatedNodeKeys.add(l.fromKey);
            if (l.toKey) relatedNodeKeys.add(l.toKey);
          }
        });

        // Highlight all related links
        linkPaths
          .filter((ld) => relatedLinks.has(ld))
          .attr("stroke", "#e67e00")
          .attr("stroke-opacity", 1)
          .attr("stroke-width", 3);

        // Highlight all connected person/spouse boxes
        group.selectAll<SVGGElement, unknown>("g.person,g.spouse")
          .each(function () {
            const nk = (this as SVGGElement).getAttribute("data-nkey");
            if (nk && relatedNodeKeys.has(nk)) {
              d3.select(this).select("rect")
                .attr("stroke", "#e67e00")
                .attr("stroke-opacity", 1)
                .attr("stroke-width", 2.5);
            }
          });

        // Highlight junction dots for all involved junctions
        group.selectAll<SVGCircleElement, { fid: string }>("circle.junction")
          .each(function (jd) {
            if (hoveredJunctionKeys.has(`fam:${jd.fid}`)) {
              d3.select(this).attr("fill", "#e67e00").attr("fill-opacity", 1).attr("r", 6);
            }
          });
      })
      .on("mouseleave", resetAll);
  }

  // Person nodes
  const filteredPersonNodes =
    skipRootPersonBox && rootPersonId ? personNodes.filter((d) => d.data.id !== rootPersonId) : personNodes;

  const pn = group
    .append("g")
    .selectAll("g.person")
    .data(filteredPersonNodes)
    .join("g")
    .attr("class", "person")
    .attr("data-nkey", (d) => `person:${d.data.id}`)
    .attr("data-scalable", "1")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (_, d) => onPersonClick(d.data.id));

  pn.each(function (d) {
    const displayName = displayNameById?.get(d.data.id) ?? d.data.name;
    drawPersonBox(d3.select(this) as any, displayName);
  });

  // Spouse boxes only when spouse person isn't in this subtree (use filteredPersonNodes to account for root person filtering)
  const inTreePersons = new Set(filteredPersonNodes.map((d) => d.data.id));
  // Keep spouses not in tree, plus all leaf spouse boxes (even if they appear multiple times)
  const filteredSpouses = spouseBoxes.filter((s, index) => {
    if (leafSpouseBoxIndices.has(index)) return true;
    if (s.forceLocal) return true;
    return !inTreePersons.has(s.pid);
  });

  const sn = group
    .append("g")
    .selectAll("g.spouse")
    .data(filteredSpouses)
    .join("g")
    .attr("class", "spouse")
    .attr("data-nkey", (d) => `person:${d.pid}`)
    .attr("data-scalable", "1")
    .attr("transform", (d) => `translate(${d.x},${d.y})`)
    .style("cursor", "pointer")
    .on("click", (_, d) => onPersonClick(d.pid));

  sn.each(function (d) {
    const displayName = displayNameById?.get(d.pid) ?? d.name;
    drawPersonBox(d3.select(this) as any, displayName);
  });

  // Junction dots
  group
    .append("g")
    .selectAll("circle.junction")
    .data(junctions)
    .join("circle")
    .attr("class", "junction")
    .attr("data-scalable", "1")
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

export default function TreeView({ initialRootId, firstNameById }: { initialRootId?: string; firstNameById?: Map<string, string> } = {}) {
  const password = usePassword();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [people, setPeople] = useState<PersonLite[]>([]);
  const [rootId, setRootId] = useState<string>(initialRootId ?? "");

  const [ancDepth, setAncDepth] = useState<number>(4);
  const [descDepth, setDescDepth] = useState<number>(6);
  const [showDuplicates, setShowDuplicates] = useState<boolean>(true);

  const [anc, setAnc] = useState<ApiResponse | null>(null);
  const [desc, setDesc] = useState<ApiResponse | null>(null);

  // Build a flat name lookup for use in the relatives panel
  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name.split(",")[0]])), [people]);

  // Categorise people visible in the current tree by their relationship to rootId
  const relativeCategories = useMemo(() => {
    if (!anc || !desc || !rootId) return [];
    type Entry = { id: string; name: string };
    type Category = { label: string; people: Entry[] };
    const categories: Category[] = [];

    const display = (id: string) => firstNameById?.get(id) ?? nameById.get(id) ?? id;
    // Return null for people with no real name (raw GEDCOM id or blank)
    const displayOrNull = (id: string): string | null => {
      const n = firstNameById?.get(id) ?? nameById.get(id);
      if (!n || n.trim() === "" || /^@?I\d+@?$/.test(n.trim())) return null;
      return n;
    };

    // Traverse a tree and collect person nodes keyed by their hierarchy depth.
    // Root person is depth 0, person nodes appear at even depths (0, 2, 4, …).
    function collectByDepth(tree: ApiNode): Map<number, Entry[]> {
      const map = new Map<number, Entry[]>();
      function walk(node: ApiNode, d: number) {
        if (node.type === "person" && d > 0 && d % 2 === 0) {
          const gen = d / 2;
          const name = displayOrNull(node.id);
          if (name) {
            if (!map.has(gen)) map.set(gen, []);
            map.get(gen)!.push({ id: node.id, name });
          }
        }
        for (const ch of node.children ?? []) walk(ch, d + 1);
      }
      walk(tree, 0);
      return map;
    }

    const ancLabels = (g: number) => {
      if (g === 1) return "Parents";
      if (g === 2) return "Grandparents";
      return "Great-".repeat(g - 2) + "Grandparents";
    };
    const descLabels = (g: number) => {
      if (g === 1) return "Children";
      if (g === 2) return "Grandchildren";
      return "Great-".repeat(g - 2) + "Grandchildren";
    };
    const inLawLabels = (g: number) => {
      if (g === 1) return "Children-in-law";
      if (g === 2) return "Grandchildren-in-law";
      return "Great-".repeat(g - 2) + "Grandchildren-in-law";
    };

    // Ancestors — oldest generation first
    const ancMap = collectByDepth(anc.tree);
    for (let g = ancDepth; g >= 1; g--) {
      const ppl = ancMap.get(g) ?? [];
      if (ppl.length > 0) categories.push({ label: ancLabels(g), people: ppl });
    }

    // Build spouse lookup from all spouse_families — skip unknowns
    const spouseOf = new Map<string, Entry[]>();
    const allFams = { ...(anc.spouse_families ?? {}), ...(desc.spouse_families ?? {}) };
    Object.values(allFams).forEach((fam) => {
      const h = fam.husb, w = fam.wife;
      if (!h || !w) return;
      const hn = displayOrNull(h), wn = displayOrNull(w);
      if (!spouseOf.has(h)) spouseOf.set(h, []);
      if (!spouseOf.has(w)) spouseOf.set(w, []);
      if (wn) spouseOf.get(h)!.push({ id: w, name: wn });
      if (hn) spouseOf.get(w)!.push({ id: h, name: hn });
    });

    // Descendants + in-laws
    const descMap = collectByDepth(desc.tree);
    for (let g = 1; g <= descDepth; g++) {
      const ppl = descMap.get(g) ?? [];
      if (ppl.length > 0) {
        categories.push({ label: descLabels(g), people: ppl });
        // Collect spouses of this generation (in-laws), excluding root and people already in tree
        const inTreeIds = new Set([...ancMap.values(), ...descMap.values()].flat().map((e) => e.id));
        inTreeIds.add(rootId);
        const seen = new Set<string>();
        const inLaws: Entry[] = [];
        ppl.forEach((p) => {
          (spouseOf.get(p.id) ?? []).forEach((sp) => {
            if (!seen.has(sp.id) && !inTreeIds.has(sp.id)) {
              seen.add(sp.id);
              inLaws.push(sp);
            }
          });
        });
        if (inLaws.length > 0) categories.push({ label: inLawLabels(g), people: inLaws });
      }
    }

    return categories;
  }, [anc, desc, rootId, ancDepth, descDepth, nameById, firstNameById]);

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const toggleCategory = (label: string) =>
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/people`, {
      headers: { Authorization: `Bearer ${password}` },
    })
      .then((r) => r.json())
      .then((data: PersonLite[]) => {
        setPeople(data);
        if (data.length && !rootId) setRootId(data[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  // If parent component supplies an initial root, keep in sync
  useEffect(() => {
    if (initialRootId) setRootId(initialRootId);
  }, [initialRootId]);

  useEffect(() => {
    if (!rootId) return;

    fetch(`${import.meta.env.VITE_API_URL}/api/ancestors?root=${encodeURIComponent(rootId)}&depth=${ancDepth + 1}`, {
      headers: { Authorization: `Bearer ${password}` },
    })
      .then((r) => r.json())
      .then(setAnc);

    fetch(`${import.meta.env.VITE_API_URL}/api/tree?root=${encodeURIComponent(rootId)}&depth=${descDepth + 1}`, {
      headers: { Authorization: `Bearer ${password}` },
    })
      .then((r) => r.json())
      .then(setDesc);
  }, [rootId, ancDepth, descDepth, password]);

  // Inject duplicate person nodes into families referenced by extra_links so the
  // tree has a stable shape without cross-link dashes (used when showDuplicates=true).
  function injectDuplicates(tree: ApiNode, extraLinks: ExtraLink[], nameById: Map<string, string>, direction: "up" | "down"): ApiNode {
    const cloned: ApiNode = JSON.parse(JSON.stringify(tree));

    function findPerson(node: ApiNode, id: string): ApiNode | null {
      if (node.type === "person" && node.id === id) return node;
      for (const ch of (node.children ?? [])) {
        const f = findPerson(ch, id);
        if (f) return f;
      }
      return null;
    }

    function inject(node: ApiNode, fromFam: string, person: ApiNode): void {
      if (node.type === "family" && node.id === fromFam) {
        if (!node.children) node.children = [];
        const exists = node.children.some((ch) => ch.type === "person" && ch.id === person.id);
        if (!exists) {
          const dup: any = JSON.parse(JSON.stringify(person));
          node.children.push(dup);
          // For ancestor trees the injected person is a parent (husb/wife) of the family —
          // update those fields so the junction→person link is drawn by the spouse-box code.
          // For descendant trees the injected person is a child, so leave husb/wife alone;
          // the trunk→child link is drawn by iterating d.children directly.
          if (direction === "up" && person.type === "person") {
            const fam = node as any;
            const sex = (person as any).sex;
            if (sex === "M" || (!fam.husb && sex !== "F")) {
              fam.husb = person.id;
            } else {
              fam.wife = person.id;
            }
          }
        }
        // Continue traversal — catch ALL occurrences of this family id in the tree
      }
      for (const ch of (node.children ?? [])) {
        inject(ch, fromFam, person);
      }
    }

    for (const link of extraLinks) {
      const personNode = findPerson(cloned, link.to_person) ?? {
        type: "person" as const,
        id: link.to_person,
        name: nameById.get(link.to_person) ?? "unknown",
        children: [],
      };
      inject(cloned, link.from_fam, personNode);
    }
    return cloned;
  }

  useEffect(() => {
    if (!svgRef.current || !anc || !desc) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 1600;
    const height = 900;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const g = svg.append("g");

    // Set up zoom behavior
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 2.5])
      .on("zoom", (event) => {
        const { k } = event.transform;
        g.attr("transform", event.transform);

        // Semantic zoom: scale nodes inversely so they stay legible when zoomed out.
        // Visual size = 1/k, clamped so nodes don't grow too large when very zoomed out.
        const nodeScale = Math.min(1 / k, 3);
        svg.selectAll<SVGGElement, unknown>("[data-scalable]").each(function () {
          const el = d3.select(this);
          const tag = (this as Element).tagName.toLowerCase();
          if (tag === "circle") {
            // Junction dot: scale radius
            const baseR = 4;
            el.attr("r", baseR * nodeScale);
          } else {
            // Person/spouse group: apply inverse scale transform around its own origin
            const tx = el.attr("transform") ?? "";
            // Extract existing translate
            const m = tx.match(/translate\(([^,]+),([^)]+)\)/);
            if (m) {
              el.attr("transform", `translate(${m[1]},${m[2]}) scale(${nodeScale})`);
            }
          }
        });
      });

    svg.call(zoomBehavior);

    const centerX = width / 2;
    const centerY = height / 2;

    const descTree = showDuplicates ? injectDuplicates(desc.tree, desc.extra_links ?? [], nameById, "down") : desc.tree;
    const descExtraLinks = showDuplicates ? [] : (desc.extra_links ?? []);
    const ancTree = showDuplicates ? injectDuplicates(anc.tree, anc.extra_links ?? [], nameById, "up") : anc.tree;
    const ancExtraLinks = showDuplicates ? [] : (anc.extra_links ?? []);

    // Descendants first
    const descResult = drawAncestryTree({
      g,
      rootNode: descTree,
      extraLinks: descExtraLinks,
      spouse_families: desc.spouse_families,
      nameById,
      displayNameById: firstNameById,
      translateX: centerX,
      translateY: centerY + 40,
      direction: "down",
      onPersonClick: setRootId,
      showDuplicates,
    });

    // Ancestors, connect to descendant root edge
    drawAncestryTree({
      g,
      rootNode: ancTree,
      extraLinks: ancExtraLinks,
      spouse_families: anc.spouse_families,
      nameById,
      displayNameById: firstNameById,
      translateX: centerX,
      translateY: centerY - 40,
      direction: "up",
      onPersonClick: setRootId,
      skipRootPersonBox: true,
      connectTo: descResult.rootBox?.top ?? undefined,
      showDuplicates,
    });

    // Center on the root person
    if (descResult.rootBox) {
      const rootScreenX = descResult.rootBox.center.x;
      const rootScreenY = descResult.rootBox.center.y;
      
      // Calculate transform to center the root person in the viewport
      const scale = 1;
      const tx = width / 2 - rootScreenX * scale;
      const ty = height / 2 - rootScreenY * scale;
      
      const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
      svg.call(zoomBehavior.transform, transform);
    }
  }, [people, anc, desc, firstNameById, showDuplicates]);

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", gap: 12, height: "80vh", width: "80vw", padding: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>Family Tree</div>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Root:
          <SearchableSelect
            options={people.map(p => ({ id: p.id, name: p.name }))}
            value={rootId}
            onChange={setRootId}
            placeholder="Search person…"
          />
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

        <label
          style={{ display: "flex", gap: 8, alignItems: "center", cursor: "default" }}
          title={"Recommended: keep this ON. When a person appears multiple times in the tree (e.g. via cousin marriage or multiple ancestry paths), duplicates are shown so all connections are visible.\n\nTurn OFF to collapse duplicates into a single node — this lets you see how different branches of the tree connect to each other."}>
          <input
            type="checkbox"
            checked={showDuplicates}
            onChange={(e) => setShowDuplicates(e.target.checked)}
          />
          Show duplicates
        </label>

        <div style={{ opacity: 0.7, fontSize: 12 }}>Tip: scroll to zoom, drag to pan, click a person to re-center.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 270px", gap: 12, overflow: "hidden" }}>
        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 16, overflow: "hidden" }}>
          <svg ref={svgRef} style={{ width: "100%", height: "100%", background: "white", color: "#333", touchAction: "none" }} />
        </div>

        {/* Relatives side panel */}
        <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 16, overflowY: "auto", padding: "12px 14px", background: "#fafafa", fontSize: 13 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
            {rootId ? (firstNameById?.get(rootId) ?? nameById.get(rootId) ?? rootId) : "—"}'s Relatives
          </div>
          {relativeCategories.length === 0 && <div style={{ opacity: 0.5 }}>No data</div>}
          {relativeCategories.map((cat) => {
            const collapsed = collapsedCategories.has(cat.label);
            return (
              <div key={cat.label} style={{ marginBottom: 8 }}>
                <div
                  onClick={() => toggleCategory(cat.label)}
                  style={{ fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em",
                    opacity: 0.65, marginBottom: collapsed ? 0 : 4, cursor: "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    userSelect: "none", padding: "2px 0" }}
                >
                  <span>{cat.label} ({cat.people.length})</span>
                  <span style={{ fontSize: 10, opacity: 0.7 }}>{collapsed ? "▶" : "▼"}</span>
                </div>
                {!collapsed && cat.people.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setRootId(p.id)}
                    style={{ cursor: "pointer", padding: "3px 6px", borderRadius: 6, marginBottom: 2, lineHeight: 1.4 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#e8f0fe")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}