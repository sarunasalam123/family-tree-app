import React, { useEffect, useState } from "react";
import TreeView from "./TreeView";
import { ConnectMiniGraphTab } from "./ConnectMiniGraphTab";
import CommonAncestorTab from "./CommonAncestorTab";
import CommonAncestorPairTab from "./CommonAncestorPairTab";

type PersonLite = { id: string; name: string };

export default function App() {
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [tab, setTab] = useState<"tree" | "connect" | "common" | "commonpair">("tree");
  const [rootId, setRootId] = useState<string>("");

  useEffect(() => {
    fetch("http://localhost:8000/api/people")
      .then((r) => r.json())
      .then((data: PersonLite[]) => {
        setPeople(data);
        if (data.length && !rootId) setRootId(data[0].id);
      });
  }, []);

  const nameById = new Map(people.map((p) => [p.id, p.name]));

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 8, padding: 12, alignItems: "center" }}>
        <button onClick={() => setTab("tree")} style={{ fontWeight: tab === "tree" ? 800 : 400 }}>Tree</button>
        <button onClick={() => setTab("connect")} style={{ fontWeight: tab === "connect" ? 800 : 400 }}>Connect</button>
        <button onClick={() => setTab("common")} style={{ fontWeight: tab === "common" ? 800 : 400 }}>Common Ancestor</button>
        <button onClick={() => setTab("commonpair")} style={{ fontWeight: tab === "commonpair" ? 800 : 400 }}>Common Ancestor Pair</button>
      </div>

      <div style={{ flex: 1 }}>
        {tab === "tree" ? <TreeView key={rootId} initialRootId={rootId} /> : null}
        {tab === "connect" ? <div style={{ padding: 16 }}><ConnectMiniGraphTab people={people} nameById={nameById} /></div> : null}
        {tab === "common" ? (
          <div style={{ padding: 16 }}>
            <CommonAncestorTab
              people={people}
              nameById={nameById}
              onOpenInTree={(id) => {
                setRootId(id);
                setTab("tree");
              }}
            />
          </div>
        ) : null}

        {tab === "commonpair" ? (
          <div style={{ padding: 16 }}>
            <CommonAncestorPairTab
              people={people}
              nameById={nameById}
              onOpenInTree={(id) => {
                setRootId(id);
                setTab("tree");
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
