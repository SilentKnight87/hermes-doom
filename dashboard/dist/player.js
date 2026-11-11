(function () {
  "use strict";

  const WIDTH = 640;
  const HEIGHT = 400;
  const prefix = window.location.pathname.split("/dashboard-plugins/")[0];
  const API = prefix + "/api/plugins/doom";

  const DOOM_KEY = {
    ArrowRight: 0xae,
    ArrowLeft: 0xac,
    ArrowUp: 0xad,
    ArrowDown: 0xaf,
    KeyW: 0xad,
    KeyS: 0xaf,
    KeyA: 0xa0,
    KeyD: 0xa1,
    KeyF: 0xa3,
    ControlLeft: 0xa3,
    ControlRight: 0xa3,
    Space: 0xa2,
    KeyE: 0xa2,
    ShiftLeft: 0xb6,
    ShiftRight: 0xb6,
    AltLeft: 0xb8,
    AltRight: 0xb8,
    Enter: 13,
    NumpadEnter: 13,
    Escape: 27,
    Tab: 9,
    Backspace: 0x7f,
    Equal: 0x3d,
    Minus: 0x2d,
    F1: 0xbb,
    F2: 0xbc,
    F3: 0xbd,
    F4: 0xbe,
    F5: 0xbf,
    F6: 0xc0,
    F7: 0xc1,
    F8: 0xc2,
    F9: 0xc3,
    F10: 0xc4,
    F11: 0xd7,
  };
  const FIRE = DOOM_KEY.ControlLeft;
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const ASCII_A = 97;
  const ASCII_0 = 48;
  const IWAD_MAGIC = [0x49, 0x57, 0x41, 0x44];

  const el = {
    stage: document.getElementById("stage"),
    screen: document.getElementById("screen"),
    menu: document.getElementById("menu"),
    wads: document.getElementById("wads"),
    freedoom: document.getElementById("freedoom"),
    own: document.getElementById("own"),
    ownFile: document.getElementById("own-file"),
    status: document.getElementById("status"),
    dataDir: document.getElementById("data-dir"),
    title: document.getElementById("game-title"),
    fullscreen: document.getElementById("fullscreen"),
    quit: document.getElementById("quit"),
    focusHint: document.getElementById("focus-hint"),
  };

  const context = el.screen.getContext("2d");
  const image = context.createImageData(WIDTH, HEIGHT);
  const pixels = new Uint32Array(image.data.buffer);
  const held = new Set();
  let engine = null;

  function hostFetch(url, options) {
    let sdk = null;
    try {
      sdk = window.parent.__HERMES_PLUGIN_SDK__ || null;
    } catch (error) {
      sdk = null;
    }
    if (sdk && typeof sdk.authedFetch === "function") return sdk.authedFetch(url, options);
    return fetch(url, Object.assign({ credentials: "include" }, options));
  }

  async function request(path, options) {
    const response = await hostFetch(API + path, options);
    if (!response.ok) {
      let detail = response.statusText;
      try {
        detail = (await response.json()).detail || detail;
      } catch (error) {
        detail = response.statusText;
      }
      throw new Error(detail || "Request failed (" + response.status + ")");
    }
    return response;
  }

  function megabytes(bytes) {
    return Math.round(bytes / 1048576) + " MB";
  }

  function say(message, isError) {
    el.status.textContent = message;
    el.status.classList.toggle("error", Boolean(isError));
  }

  function busy(isBusy) {
    for (const button of el.menu.querySelectorAll("button")) button.disabled = isBusy;
  }

  function wadButton(wad) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary";
    const label = wad.source === "freedoom" ? "Play Freedoom" : "Play " + wad.name;
    button.textContent = label;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = wad.name + " · " + megabytes(wad.bytes);
    button.appendChild(hint);
    button.addEventListener("click", function () {
      playStored(wad.name);
    });
    return button;
  }

  function renderLibrary(library) {
    el.wads.replaceChildren(...library.wads.map(wadButton));
    el.dataDir.textContent = library.data_dir;
    el.freedoom.hidden = library.freedoom.installed;
    el.freedoom.textContent = "Download Freedoom and play";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent =
      "Free game data, " + megabytes(library.freedoom.download_bytes) + " from github.com/freedoom, checksum verified";
    el.freedoom.appendChild(hint);
    el.freedoom.className = library.wads.length ? "secondary" : "primary";
  }

  async function loadLibrary() {
    try {
      renderLibrary(await (await request("/wads")).json());
      say("");
    } catch (error) {
      say("Could not reach the plugin backend: " + error.message + ". You can still open your own WAD file.", true);
    }
  }

  async function playStored(name) {
    busy(true);
    say("Loading " + name + "…");
    try {
      const response = await request("/wad/" + encodeURIComponent(name));
      await start(name, new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      say("Could not start " + name + ": " + error.message, true);
      busy(false);
    }
  }

  async function downloadFreedoom() {
    busy(true);
    say("Downloading Freedoom from its official release…");
    try {
      renderLibrary(await (await request("/freedoom", { method: "POST" })).json());
      await playStored("freedoom1.wad");
    } catch (error) {
      say(error.message, true);
      busy(false);
    }
  }

  async function playOwn(file) {
    busy(true);
    say("Reading " + file.name + "…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!IWAD_MAGIC.every((byte, index) => bytes[index] === byte)) throw new Error("that file is not a Doom IWAD");
      await start(file.name, bytes);
    } catch (error) {
      say("Could not start " + file.name + ": " + error.message, true);
      busy(false);
    }
  }

  function present(pointer, width, height) {
    const source = engine.HEAPU32.subarray(pointer >> 2, (pointer >> 2) + width * height);
    for (let i = 0; i < source.length; i++) {
      const value = source[i];
      pixels[i] = 0xff000000 | ((value & 0xff) << 16) | (value & 0xff00) | ((value >> 16) & 0xff);
    }
    context.putImageData(image, 0, 0);
  }

  async function start(name, bytes) {
    const module = {
      onFrame: present,
      onTitle: function (title) {
        el.title.textContent = title;
      },
      print: function () {},
      printErr: function (line) {
        console.warn("[doom]", line);
      },
      quit: function (status, reason) {
        window.setTimeout(function () {
          window.location.reload();
        }, 0);
        throw reason;
      },
    };
    engine = await window.createDoomEngine(module);
    const path = "/" + name.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
    engine.FS.writeFile(path, bytes);
    el.menu.hidden = true;
    el.fullscreen.hidden = false;
    el.quit.hidden = false;
    engine.callMain(["-iwad", path]);
    el.screen.focus();
  }

  function doomKey(event) {
    if (event.code in DOOM_KEY) return DOOM_KEY[event.code];
    const letter = /^Key([A-Z])$/.exec(event.code);
    if (letter) return ASCII_A + LETTERS.indexOf(letter[1]);
    const digit = /^Digit([0-9])$/.exec(event.code);
    if (digit) return ASCII_0 + Number(digit[1]);
    return 0;
  }

  function send(pressed, key) {
    if (!engine || !key) return;
    if (pressed) held.add(key);
    else held.delete(key);
    engine._hd_key(pressed ? 1 : 0, key);
  }

  function releaseAll() {
    for (const key of Array.from(held)) send(false, key);
  }

  function onKey(pressed) {
    return function (event) {
      if (!engine || event.metaKey) return;
      const key = doomKey(event);
      if (!key) return;
      event.preventDefault();
      if (pressed && event.repeat) return;
      send(pressed, key);
    };
  }

  el.screen.addEventListener("keydown", onKey(true));
  el.screen.addEventListener("keyup", onKey(false));
  el.screen.addEventListener("blur", function () {
    releaseAll();
    el.focusHint.hidden = !engine;
  });
  el.screen.addEventListener("focus", function () {
    el.focusHint.hidden = true;
  });
  el.screen.addEventListener("mousedown", function (event) {
    if (event.button === 0 && document.activeElement === el.screen) send(true, FIRE);
    el.screen.focus();
  });
  window.addEventListener("mouseup", function (event) {
    if (event.button === 0) send(false, FIRE);
  });
  el.screen.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  el.freedoom.addEventListener("click", downloadFreedoom);
  el.own.addEventListener("click", function () {
    el.ownFile.click();
  });
  el.ownFile.addEventListener("change", function () {
    if (el.ownFile.files.length) playOwn(el.ownFile.files[0]);
  });
  el.fullscreen.addEventListener("click", function () {
    el.stage.requestFullscreen().then(function () {
      el.screen.focus();
    });
  });
  el.quit.addEventListener("click", function () {
    window.location.reload();
  });

  loadLibrary();
})();
