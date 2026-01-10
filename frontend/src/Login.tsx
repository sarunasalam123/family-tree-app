import React, { useState } from "react";
import "./Login.css";

type LoginProps = {
  onLogin: (password: string) => void;
};

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError("Please enter a password");
      return;
    }
    onLogin(password);
    setPassword("");
    setError("");
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Family Tree</h1>
        <p>Enter password to access</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
          />
          <button type="submit">Login</button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  );
}
