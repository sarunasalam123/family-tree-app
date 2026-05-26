// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useEffect, useState, createContext, useContext } from "react";
import TreeView from "./TreeView";
import { ConnectMiniGraphTab } from "./ConnectMiniGraphTab";
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
  const [loginError, setLoginError] = useState<string | null>(null);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [tab, setTab] = useState<"tree" | "connect" | "commonpair">("tree");
  const [rootId, setRootId] = useState<string>("");
  
  // Persist search selections and results across tab switches
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
    setLoginError(null);
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
          setPassword("");
          localStorage.removeItem("password");
          setLoginError("Incorrect password. Please try again.");
          return undefined;
        }
        return r.json();
      })
      .then((data: PersonLite[] | undefined) => {
        if (!data) return;
        setPeople(data);
        if (data.length && !rootId) setRootId("@I6@");
      })
      .catch((err) => {
        console.error("Network error:", err);
        // Don't logout on network errors — backend may just not be reachable yet
      });
  }, [password, rootId]);

  if (!password) {
    return <Login onLogin={handleLogin} error={loginError} />;
  }

  // Build a smart display label for the dropdown:
  // 1. "Firstname Lastname"  — if a /Lastname/ is present
  // 2. "Name, son/daughter of X"  — if the name contains ", child of X"
  // 3. "Name, husband/wife of X"  — if the name contains ", husband/wife of X"
  // 4. Raw name as fallback
  const getDropdownLabel = (raw: string): string => {
    // Strip any trailing GEDCOM slash-surname for the given-name part
    const commaIdx = raw.indexOf(",");
    const namePart = (commaIdx >= 0 ? raw.slice(0, commaIdx) : raw).trim();
    const givenName = namePart.split("/")[0].trim();
    const lastName = (() => {
      const m = namePart.match(/\/([^/]+)\//);
      return m ? m[1].trim() : null;
    })();

    if (lastName) return `${givenName} ${lastName}`;

    const rel = commaIdx >= 0 ? raw.slice(commaIdx + 1).trim() : "";

    const childMatch = rel.match(/^(?:child|son|daughter) of (.+)$/i);
    if (childMatch) {
      // No sex field in PersonLite, so keep gender-neutral "child of"
      return `${givenName}, ${rel}`;
    }

    const husbMatch = rel.match(/^husband of (.+)$/i);
    if (husbMatch) return `${givenName}, husband of ${husbMatch[1].trim()}`;

    const wifeMatch = rel.match(/^wife of (.+)$/i);
    if (wifeMatch) return `${givenName}, wife of ${wifeMatch[1].trim()}`;

    return givenName || raw;
  };

  // Helper to extract just the name (without relationship info like ", husband of X")
  const getBaseName = (displayName: string) => displayName.split(",")[0];
  // Extract first name (given name) from GEDCOM format: "FirstName /LastName/"
  const getFirstName = (displayName: string) => {
    const baseNamePart = displayName.split(",")[0].trim(); // Remove relationship context
    const firstNameOnly = baseNamePart.split("/")[0].trim(); // Get everything before the "/"
    return firstNameOnly;
  };

  const nameById = new Map(people.map((p) => [p.id, getBaseName(p.name)]));
  const firstNameById = new Map(people.map((p) => [p.id, getFirstName(p.name)]));
  // Dropdown label map: smart labels for search dropdowns
  const dropdownLabelById = new Map(people.map((p) => [p.id, getDropdownLabel(p.name)]));
  // People array for dropdowns — uses the smart labels as display names
  const peopleForDropdown = people.map((p) => ({ id: p.id, name: dropdownLabelById.get(p.id) ?? p.name }));

  return (
    <PasswordContext.Provider value={password}>
      <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 8, padding: 12, alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setTab("tree")} style={{ fontWeight: tab === "tree" ? 800 : 400 }}>Tree</button>
            <button onClick={() => setTab("connect")} style={{ fontWeight: tab === "connect" ? 800 : 400 }}>Connect</button>
            <button onClick={() => setTab("commonpair")} style={{ fontWeight: tab === "commonpair" ? 800 : 400 }}>Common Ancestor Pair</button>
          </div>
          <button onClick={handleLogout} style={{ padding: "6px 12px", cursor: "pointer" }}>Logout</button>
        </div>

        <div style={{ flex: 1, width: "100%" }}>
          {tab === "tree" ? <TreeView key={rootId} initialRootId={rootId} firstNameById={firstNameById} /> : null}
          {tab === "connect" ? <div style={{ padding: 16, display: "flex", flexDirection: "column", overflow: "auto", flex: 1 }}><ConnectMiniGraphTab people={peopleForDropdown} nameById={firstNameById} aId={connectAId} setAId={setConnectAId} bId={connectBId} setBId={setConnectBId} result={connectResult} setResult={setConnectResult} error={connectError} setError={setConnectError} /></div> : null}

          {tab === "commonpair" ? (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", overflow: "auto", flex: 1 }}>
              <CommonAncestorPairTab
                people={peopleForDropdown}
                nameById={firstNameById}
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
