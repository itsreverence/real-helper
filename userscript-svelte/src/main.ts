import App from "./ui/App.svelte";

function mount() {
  const id = "rsdh-svelte-root";
  let host = document.getElementById(id);
  if (!host) {
    host = document.createElement("div");
    host.id = id;
    document.documentElement.appendChild(host);
  }

  // Use Shadow DOM to avoid style collisions with the site.
  const shadow = (host as HTMLElement).shadowRoot ?? (host as HTMLElement).attachShadow({ mode: "open" });

  // App container inside shadow
  const appRootId = "app";
  let appRoot = shadow.getElementById?.(appRootId) as HTMLElement | null;
  if (!appRoot) {
    appRoot = document.createElement("div");
    appRoot.id = appRootId;
    shadow.appendChild(appRoot);
  }

  new App({
    target: appRoot,
  });
}

mount();



