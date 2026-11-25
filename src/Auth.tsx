import { useState } from "react";
import {
  ArrowRight,
  Flask,
  LockKey,
  Database,
  CloudArrowUp,
} from "@phosphor-icons/react";
export type User = { id: string; username: string };
export default function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/auth/${register ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPassword("");
      onLogin(data.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <Flask size={26} />
          </span>
          <span>
            研笺<small>文献研究助手</small>
          </span>
        </div>
        <div>
          <span className="eyebrow">YOUR RESEARCH, CONNECTED</span>
          <h1>
            研究可以从这里开始，
            <br />
            <span>也能在另一台设备继续。</span>
          </h1>
          <p>
            找到文献，梳理证据，形成有出处的研究简报。
            <br />
            登录账号，让每一次探索都有记录。
          </p>
          <div className="auth-features">
            <span>
              <Database size={20} />
              账号研究库
            </span>
            <span>
              <CloudArrowUp size={20} />
              服务端文件存储
            </span>
            <span>
              <LockKey size={20} />
              个人记录隔离
            </span>
          </div>
        </div>
      </section>
      <section className="auth-form-wrap">
        <form onSubmit={submit}>
          <div className="eyebrow">RESEARCH WORKSPACE</div>
          <h2>{register ? "创建你的研究账号" : "欢迎回到研究空间"}</h2>
          <p>
            {register
              ? "注册后即可保存研究与导出文件。"
              : "登录后，继续你的文献研究。"}
          </p>
          <label>
            用户名
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              pattern={"[a-zA-Z0-9_\\-]+"}
              placeholder="3–32 位字母、数字、下划线或连字符"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              maxLength={128}
              placeholder="至少 10 个字符"
            />
          </label>
          {error && (
            <div role="alert" className="notice">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy} type="submit">
            {busy ? "正在处理…" : register ? "创建账号" : "登录"}
            <ArrowRight size={18} />
          </button>
          <button
            className="text-button auth-switch"
            type="button"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "已有账号？去登录" : "还没有账号？创建账号"}
          </button>
          <p className="footnote">
            用户名不区分大小写。首版暂不提供找回密码，请妥善保管。
          </p>
        </form>
      </section>
    </div>
  );
}
