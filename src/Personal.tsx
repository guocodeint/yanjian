import { useEffect, useState, type FormEvent } from "react";
export type Settings = {
  nickname: string;
  focus: string;
  model: string;
  aiConfigured: boolean;
};
async function request(path: string, method = "GET", data?: unknown) {
  const r = await fetch(path, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!r.ok) throw new Error((await r.json()).error || "设置暂时无法保存。");
  return r.json();
}
export default function Personal({
  username,
  onChange,
}: {
  username: string;
  onChange: (value: Settings) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [nickname, N] = useState(""),
    [focus, F] = useState(""),
    [model, M] = useState(""),
    [key, K] = useState("");
  const [old, O] = useState(""),
    [password, P] = useState(""),
    [confirm, C] = useState(""),
    [notice, S] = useState(""),
    [busy, B] = useState(false);
  useEffect(() => {
    let active = true;
    request("/api/settings")
      .then((v: Settings) => {
        if (active) {
          setSettings(v);
          N(v.nickname);
          F(v.focus);
          M(v.model);
        }
      })
      .catch((e) => S(e.message));
    return () => {
      active = false;
    };
  }, []);
  async function act(e: FormEvent | undefined, work: () => Promise<void>) {
    e?.preventDefault();
    B(true);
    S("");
    try {
      await work();
    } catch (err) {
      S(err instanceof Error ? err.message : "保存失败");
    } finally {
      B(false);
    }
  }
  function changed(v: Settings) {
    setSettings(v);
    onChange(v);
  }
  return (
    <section className="settings-page">
      <h1>个人设置</h1>
      <p role="status">{notice}</p>
      {settings && (
        <fieldset disabled={busy} className="content-fieldset">
          <form
            className="search-card"
            onSubmit={(e) =>
              act(e, async () => {
                changed(
                  await request("/api/settings/profile", "PUT", {
                    nickname,
                    focus,
                  }),
                );
                S("资料已保存。");
              })
            }
          >
            <h2>个人资料</h2>
            <label>
              登录用户名
              <input value={username} readOnly />
            </label>
            <label>
              昵称
              <input
                value={nickname}
                maxLength={48}
                onChange={(e) => N(e.target.value)}
              />
            </label>
            <label>
              研究方向
              <textarea
                value={focus}
                maxLength={240}
                onChange={(e) => F(e.target.value)}
              />
            </label>
            <button>保存资料</button>
          </form>
          <form
            className="search-card"
            onSubmit={(e) =>
              act(e, async () => {
                changed(
                  await request("/api/settings/ai", "PUT", {
                    model,
                    ...(key ? { key } : {}),
                  }),
                );
                K("");
                S("AI 设置已保存。下次使用 AI 时会验证密钥与模型。");
              })
            }
          >
            <h2>API 与 AI</h2>
            <p>
              服务商为
              DeepSeek。生成检索词或分析所选摘要时，将向该服务发送相应材料，并使用你自己的
              API 额度。
            </p>
            <label>
              模型 ID
              <input
                required
                value={model}
                maxLength={100}
                onChange={(e) => M(e.target.value)}
              />
            </label>
            <label>
              API 密钥
              <input
                type="password"
                autoComplete="off"
                required={!settings.aiConfigured}
                placeholder={
                  settings.aiConfigured
                    ? "已保存，留空保留现有密钥"
                    : "填写个人 DeepSeek API 密钥"
                }
                value={key}
                onChange={(e) => K(e.target.value)}
              />
            </label>
            <div className="toolbar">
              <button>保存 AI 设置</button>
              <button
                type="button"
                disabled={!settings.aiConfigured}
                onClick={() =>
                  act(undefined, async () => {
                    changed(await request("/api/settings/ai", "DELETE"));
                    K("");
                    S("已清除个人密钥。");
                  })
                }
              >
                清除密钥
              </button>
            </div>
          </form>
          <form
            className="search-card"
            onSubmit={(e) =>
              act(e, async () => {
                if (password !== confirm)
                  throw new Error("两次输入的新密码不一致。");
                await request("/api/auth/password", "POST", {
                  currentPassword: old,
                  newPassword: password,
                });
                O("");
                P("");
                C("");
                S("密码已更新，其他设备需要重新登录。");
              })
            }
          >
            <h2>登录与安全</h2>
            <label>
              当前密码
              <input
                type="password"
                required
                autoComplete="current-password"
                value={old}
                onChange={(e) => O(e.target.value)}
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(e) => P(e.target.value)}
              />
            </label>
            <label>
              确认新密码
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => C(e.target.value)}
              />
            </label>
            <button>修改密码</button>
          </form>
        </fieldset>
      )}
    </section>
  );
}
