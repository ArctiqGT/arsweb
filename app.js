const API = "http://localhost:3000";
const tokenKey = "platform_token";
const refreshKey = "platform_refresh";

function getToken() {
  return localStorage.getItem(tokenKey) || new URLSearchParams(location.search).get("token");
}

function setTokens(access, refresh) {
  if (access) localStorage.setItem(tokenKey, access);
  if (refresh) localStorage.setItem(refreshKey, refresh);
  if (location.search.includes("token")) {
    history.replaceState({}, "", "/dashboard/");
  }
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };

  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;

  const res = await fetch(`${API}${path}`, { ...opts, headers });

  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await res.text();
    console.error("Expected JSON, got:", text);
    throw new Error("API did not return JSON");
  }

  if (res.status === 401) {
    localStorage.removeItem(tokenKey);
    renderLogin();
    throw new Error("Unauthorized");
  }

  return res.json();
}

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "className") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  });
  children.forEach((c) => n.append(c));
  return n;
}

async function renderLogin() {
  document.getElementById("user-bar").classList.add("hidden");
  const main = document.getElementById("main");
  main.innerHTML = "";
  const params = new URLSearchParams(location.search);
  if (params.get("token")) {
    setTokens(params.get("token"), params.get("refresh"));
    return renderApp();
  }
  main.append(
    el("div", { className: "card" }, [
      el("h2", { text: "Sign in" }),
      el("p", { className: "muted", text: "Use your Google account to access the developer platform." }),
      el("button", {
        text: "Sign in with Google",
        onClick: async () => {
          const res = await api("/api/platform/auth/google/url");
          console.log("GOOGLE URL RESPONSE:", res);
        
          location.href = res.url;
        }
      }),
    ])
  );
}

let state = { studios: [], studio: null, title: null, tab: "overview" };

async function renderApp() {
  const me = await api("/api/platform/auth/me");
  const bar = document.getElementById("user-bar");
  bar.classList.remove("hidden");
  document.getElementById("user-name").textContent = me.user.displayName;
  document.getElementById("avatar").src = me.user.picture || "";

  document.getElementById("logout-btn").onclick = () => {
    localStorage.clear();
    renderLogin();
  };

  const { studios } = await api("/api/platform/studios");
  state.studios = studios;
  if (!state.studio && studios[0]) {
    const detail = await api(`/api/platform/studios/${studios[0].studioId}`);
    state.studio = detail;
    state.title = detail.titles?.[0] || null;
  }
  renderMain();
}

function renderMain() {
  const main = document.getElementById("main");
  main.innerHTML = "";

  const studioSelect = el("select", {
    onChange: async (e) => {
      state.studio = await api(`/api/platform/studios/${e.target.value}`);
      state.title = state.studio.titles?.[0] || null;
      renderMain();
    },
  });
  state.studios.forEach((s) => {
    const o = el("option", { value: s.studioId, text: s.name });
    if (state.studio?.studio?.studioId === s.studioId) o.selected = true;
    studioSelect.append(o);
  });

  main.append(
    el("div", { className: "card" }, [
      el("h2", { text: "Studio" }),
      studioSelect,
      el("button", {
        className: "secondary",
        text: "New Studio",
        onClick: async () => {
          const name = prompt("Studio name?");
          if (!name) return;
          await api("/api/platform/studios", { method: "POST", body: JSON.stringify({ name }) });
          await renderApp();
        },
      }),
    ])
  );

  if (!state.studio) return;

  const titles = state.studio.titles || [];
  const titleGrid = el("div", { className: "grid" });
  titles.forEach((t) => {
    titleGrid.append(
      el("div", {
        className: `list-item ${state.title?.titleId === t.titleId ? "active" : ""}`,
        onClick: () => {
          state.title = t;
          state.tab = "overview";
          renderMain();
        },
      }, [
        el("strong", { text: t.name }),
        el("div", { className: "muted", text: t.publicId }),
        el("div", { className: "muted", text: t.environment }),
      ])
    );
  });

  main.append(
    el("div", { className: "card" }, [
      el("h2", { text: "Game Titles" }),
      titleGrid,
      el("button", {
        text: "Create Title",
        onClick: async () => {
          const name = prompt("Title name?");
          if (!name) return;
          const res = await api(`/api/platform/studios/${state.studio.studio.studioId}/titles`, {
            method: "POST",
            body: JSON.stringify({ name, environment: "development" }),
          });
          alert(`Save this secret key (shown once):\n\n${res.secretKey}`);
          state.studio = await api(`/api/platform/studios/${state.studio.studio.studioId}`);
          state.title = res.title;
          renderMain();
        },
      }),
    ])
  );

  if (!state.title) return;
  renderTitlePanel(main);
}

async function renderTitlePanel(main) {
  const t = state.title;
  const tabs = el("div", { className: "tabs" });
  ["overview", "users", "analytics", "audit"].forEach((tab) => {
    tabs.append(
      el("button", {
        className: state.tab === tab ? "active" : "",
        text: tab,
        onClick: () => {
          state.tab = tab;
          renderMain();
        },
      })
    );
  });

  const panel = el("div", { className: "card" });
  panel.append(el("h2", { text: t.name }), tabs);

  if (state.tab === "overview") {
    panel.append(
      el("p", { className: "muted", text: `Title ID: ${t.publicId}` }),
      el("div", { className: "secret-box", text: "Secret key is only shown at creation or rotation." }),
      el("button", {
        text: "Rotate Secret Key",
        onClick: async () => {
          if (!confirm("Rotate secret? Unity builds must be updated.")) return;
          const res = await api(
            `/api/platform/studios/titles/${t.titleId}/rotate-secret`,
            { method: "POST", body: "{}" }
          );
          alert(`New secret:\n${res.secretKey}`);
        },
      }),
      el("button", {
        className: "secondary",
        text: t.enabled ? "Disable Title" : "Enable Title",
        onClick: async () => {
          await api(`/api/platform/dashboard/titles/${t.titleId}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: !t.enabled }),
          });
          state.title.enabled = !t.enabled;
          renderMain();
        },
      })
    );
  }

  if (state.tab === "users") {
    const search = el("input", { placeholder: "Search UserID, Oculus ID, username..." });
    const results = el("div");
    const runSearch = async () => {
      const q = search.value.trim();
      const res = await api(
        `/api/platform/dashboard/titles/${t.titleId}/users/search?q=${encodeURIComponent(q)}`
      );
      results.innerHTML = "";
      res.users.forEach((u) => {
        results.append(
          el("div", { className: "list-item" }, [
            el("strong", { text: u.username }),
            el("div", { className: "muted", text: u.userId }),
            el("div", { className: "muted", text: u.oculusUserId }),
            el("button", {
              className: "danger",
              text: "Ban",
              onClick: async () => {
                const reason = prompt("Ban reason?");
                if (!reason) return;
                await api(`/api/platform/dashboard/titles/${t.titleId}/users/${u.userId}/ban`, {
                  method: "POST",
                  body: JSON.stringify({ reason, permanent: false, durationSeconds: 86400 }),
                });
                alert("Banned");
              },
            }),
          ])
        );
      });
    };
    search.addEventListener("input", () => void runSearch());
    panel.append(search, results);
    void runSearch();
  }

  if (state.tab === "analytics") {
    const res = await api(`/api/platform/dashboard/titles/${t.titleId}/analytics`);
    const a = res.analytics;
    panel.append(
      el("div", { className: "stats" }, [
        el("div", { className: "stat" }, [el("strong", { text: String(a.totalLogins) }), el("span", { className: "muted", text: "Total logins" })]),
        el("div", { className: "stat" }, [el("strong", { text: String(a.totalBans) }), el("span", { className: "muted", text: "Bans" })]),
      ])
    );
  }

  if (state.tab === "audit") {
    const res = await api("/api/platform/dashboard/audit?limit=50");
    const table = el("table");
    table.append(el("tr", {}, [
      el("th", { text: "Time" }),
      el("th", { text: "Action" }),
      el("th", { text: "Resource" }),
    ]));
    res.logs.forEach((log) => {
      table.append(el("tr", {}, [
        el("td", { text: new Date(log.timestamp).toLocaleString() }),
        el("td", { text: log.action }),
        el("td", { text: `${log.resourceType}:${log.resourceId}` }),
      ]));
    });
    panel.append(table);
  }

  main.append(panel);
}

if (getToken()) renderApp().catch(renderLogin);
else renderLogin();
