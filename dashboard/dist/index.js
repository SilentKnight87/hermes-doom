(function () {
  "use strict";
  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) return;

  const React = SDK.React;
  const MIN_HEIGHT = 420;
  const BOTTOM_GAP = 24;
  const script = document.currentScript;
  const base = script && script.src ? script.src : window.location.origin + "/dashboard-plugins/doom/dist/index.js";
  const frameUrl = new URL("doom.html", base).href;

  function DoomPage() {
    const box = React.useRef(null);
    const [height, setHeight] = React.useState(MIN_HEIGHT);

    React.useEffect(function () {
      function fit() {
        if (!box.current) return;
        const room = window.innerHeight - box.current.getBoundingClientRect().top - BOTTOM_GAP;
        setHeight(Math.max(MIN_HEIGHT, Math.floor(room)));
      }
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(document.body);
      window.addEventListener("resize", fit);
      return function () {
        observer.disconnect();
        window.removeEventListener("resize", fit);
      };
    }, []);

    return React.createElement(
      "div",
      { className: "doom-tab", ref: box, style: { height: height + "px" } },
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
