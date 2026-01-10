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
  
  // Persist search selections and results across tab switches
  // Common Ancestor Tab
  const [commonAId, setCommonAId] = useState<string>("");
  const [commonBId, setCommonBId] = useState<string>("");
  const [commonResult, setCommonResult] = useState<any>(null);
  const [commonLoading, setCommonLoading] = useState(false);
  const [commonError, setCommonError] = useState<string | null>(null);
  const [commonPrunedTree, setCommonPrunedTree] = useState<any>(null);
  const [commonPaths, setCommonPaths] = useState<any>(null);
  
  // Connect Tab
  const [connectAId, setConnectAId] = useState<string>("");
  const [connectBId, setConnectBId] = useState<string>("");
  const [connectResult, setConnectResult] = useState<any>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  
  // Common Ancestor Pair Tab
  const [commonPairAId, setCommonPairAId] = useState<string>("");
  const [commonPairBId, setCommonPairBId] = useState<string>("");
  const [commonPairResult, setCommonPairResult] = useState<any>(null);
  const [commonPairLoading, setCommonPairLoading] = useState(false);
  const [commonPairError, setCommonPairError] = useState<string | null>(null);
  const [commonPairCandidates, setCommonPairCandidates] = useState<any>(null);
  const [commonPairPrunedTrees, setCommonPairPrunedTrees] = useState<any>(null);

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

  // Helper to extract just the name (without relationship info like ", husband of X")
  const getBaseName = (displayName: string) => displayName.split(",")[0];

  const nameById = new Map(people.map((p) => [p.id, getBaseName(p.name)]));

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
          {tab === "connect" ? <div style={{ padding: 16 }}><ConnectMiniGraphTab people={people} nameById={nameById} aId={connectAId} setAId={setConnectAId} bId={connectBId} setBId={setConnectBId} result={connectResult} setResult={setConnectResult} error={connectError} setError={setConnectError} /></div> : null}
          {tab === "common" ? (
            <div style={{ padding: 16 }}>
              <CommonAncestorTab
                people={people}
                nameById={nameById}
                aId={commonAId}
                setAId={setCommonAId}
                bId={commonBId}
                setBId={setCommonBId}
                result={commonResult}
                setResult={setCommonResult}
                loading={commonLoading}
                setLoading={setCommonLoading}
                error={commonError}
                setError={setCommonError}
                prunedTree={commonPrunedTree}
                setPrunedTree={setCommonPrunedTree}
                paths={commonPaths}
                setPaths={setCommonPaths}
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
                aId={commonPairAId}
                setAId={setCommonPairAId}
                bId={commonPairBId}
                setBId={setCommonPairBId}
                result={commonPairResult}
                setResult={setCommonPairResult}
                loading={commonPairLoading}
                setLoading={setCommonPairLoading}
                error={commonPairError}
                setError={setCommonPairError}
                candidates={commonPairCandidates}
                setCandidates={setCommonPairCandidates}
                prunedTrees={commonPairPrunedTrees}
                setPrunedTrees={setCommonPairPrunedTrees}
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
