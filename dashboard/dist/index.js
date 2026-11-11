(function () {
  "use strict";
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;

  const React = SDK.React;
  const script = document.currentScript;
  const base = script && script.src ? script.src : window.location.origin + "/dashboard-plugins/doom/dist/index.js";
  const frameUrl = new URL("doom.html", base).href;

  function DoomPage() {
    return React.createElement(
      "div",
      { className: "doom-tab" },
      React.createElement("iframe", {
        className: "doom-tab-frame",
        src: frameUrl,
        title: "Doom",
        allow: "fullscreen",
      })
    );
  }

  window.__HERMES_PLUGINS__.register("doom", DoomPage);
})();
