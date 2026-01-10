// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useEffect, useState, createContext, useContext } from "react";
import TreeView from "./TreeView";
import { ConnectMiniGraphTab } from "./ConnectMiniGraphTab";
import CommonAncestorTab from "./CommonAncestorTab";
import CommonAncestorPairTab from "./CommonAncestorPairTab";
import { Login } from "./Login";

type PersonLite = { id: string; name: string };

// Create password context
const PasswordContext = createContext<string>("");

export function usePassword() {
  return useContext(PasswordContext);
}

export default function App() {
  const [password, setPassword] = useState<string>(() => localStorage.getItem("password") || "");
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [tab, setTab] = useState<"tree" | "connect" | "common" | "commonpair">("tree");
  const [rootId, setRootId] = useState<string>("");

  const handleLogin = (pwd: string) => {
    setPassword(pwd);
    localStorage.setItem("password", pwd);
  };

  const handleLogout = () => {
    setPassword("");
    localStorage.removeItem("password");
  };

  useEffect(() => {
    if (!password) return;

    fetch("http://localhost:8000/api/people", {
      headers: {
        Authorization: `Bearer ${password}`,
      },
    })
      .then((r) => {
        if (r.status === 401) {
          handleLogout();
          throw new Error("Invalid password");
        }
        return r.json();
      })
      .then((data: PersonLite[]) => {
        setPeople(data);
        if (data.length && !rootId) setRootId(data[0].id);
      })
      .catch((err) => {
        console.error(err);
        handleLogout();
      });
  }, [password, rootId]);

  if (!password) {
    return <Login onLogin={handleLogin} />;
  }

  const nameById = new Map(people.map((p) => [p.id, p.name]));

  return (
    <PasswordContext.Provider value={password}>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 8, padding: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTab("tree")} style={{ fontWeight: tab === "tree" ? 800 : 400 }}>Tree</button>
            <button onClick={() => setTab("connect")} style={{ fontWeight: tab === "connect" ? 800 : 400 }}>Connect</button>
            <button onClick={() => setTab("common")} style={{ fontWeight: tab === "common" ? 800 : 400 }}>Common Ancestor</button>
            <button onClick={() => setTab("commonpair")} style={{ fontWeight: tab === "commonpair" ? 800 : 400 }}>Common Ancestor Pair</button>
          </div>
          <button onClick={handleLogout} style={{ padding: "6px 12px", cursor: "pointer" }}>Logout</button>
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
    </PasswordContext.Provider>
  );
}
