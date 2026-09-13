import { renderRecipe } from "./render.js";

/*
  The cookbook client.

  A browser module that mounts the core visualization and wires the cookbook's
  timer controls. The server provides checked Recipe data, while core decides
  how that graph becomes DOM; this file only changes the active-step class.

  All of it is enhancement. With the script off, the page still has its recipe
  header, timer display, current-step strip, links and search.
*/
for (const target of document.querySelectorAll("[data-yumml-recipe]")) {
  const source = target.dataset.yummlRecipe;
  if (source === undefined) continue;
  try {
    renderRecipe(JSON.parse(source), target);
  } catch {
    // A stale page and a newer core bundle should leave the cookbook chrome usable.
  }
}

(() => {
  const timer = document.querySelector(".timer");
  const flow = document.querySelector(".flow-frame .yumml-vis");
  if (timer === null || flow === null) return;

  const dots = [...timer.querySelectorAll(".timer-dot")];
  if (dots.length === 0) return;

  const strips = new Map(
    [...document.querySelectorAll(".strip")].map((strip) => [strip.dataset.step, strip]),
  );

  /*
    The steps, in cooking order: the id off the dot, the rest off the strip that
    belongs to it. `seconds` is `null` for a step with no `time`, which is the one
    thing that turns the clock into `--:--` and disables play.
  */
  const steps = dots.map((dot) => {
    const id = dot.dataset.step ?? "";
    const strip = strips.get(id);
    const budget = strip?.dataset.seconds ?? "";
    return {
      id,
      dot,
      strip,
      seconds: budget === "" ? null : Number(budget),
    };
  });
  const count = steps.length;

  const el = {
    badge: timer.querySelector(".timer-badge"),
    position: timer.querySelector(".timer-position"),
    name: timer.querySelector(".timer-name"),
    digits: timer.querySelector(".timer-digits"),
    progress: timer.querySelector(".timer-progress"),
    prev: timer.querySelector(".timer-prev"),
    next: timer.querySelector(".timer-next"),
    play: timer.querySelector(".timer-play"),
    add: timer.querySelector(".timer-add"),
    mute: timer.querySelector(".timer-mute"),
  };

  const MUTE_KEY = "yumml-cookbook-chime";
  /** Four ticks a second is plenty for `mm:ss`, and the deadline does the counting. */
  const TICK_MS = 250;
  const ADD_SECONDS = 60;

  let index = 0;
  /** Seconds `+ 1:00` has added to this step, on top of the step's own time. */
  let added = 0;
  /** Seconds left, while paused. */
  let remaining = 0;
  /** The `Date.now()` deadline, while running. */
  let until = 0;
  let running = false;
  /** The countdown reached zero: the digits stay highlighted until something changes. */
  let finished = false;
  let ticking = 0;
  let audio = null;
  /** The chime state, remembered in the browser's own store. */
  let muted = rememberedMute();

  /**
   * The remembered choice. `localStorage` is the browser's, which is who owns it: a
   * browser that refuses storage simply keeps the chime on.
   */
  function rememberedMute() {
    try {
      return window.localStorage.getItem(MUTE_KEY) === "off";
    } catch {
      return false;
    }
  }

  /** `02:30`, or `1:30:00` — the server's own clock, so a reload changes nothing. */
  function clock(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = whole % 60;
    const pair = (value) => String(value).padStart(2, "0");
    return hours > 0
      ? `${hours}:${pair(minutes)}:${pair(rest)}`
      : `${pair(minutes)}:${pair(rest)}`;
  }

  /** The step's own time plus whatever has been added to it; `null` when it has none. */
  function budget() {
    const own = steps[index].seconds;
    return own === null ? null : own + added;
  }

  /** Seconds left. While it runs this is the wall clock, never an accumulated count. */
  function left() {
    if (running) return Math.max(0, (until - Date.now()) / 1000);
    return remaining;
  }

  /** The strip is where a step's words live, so the bar's name is read off it. */
  function titleOf(step) {
    return step.strip?.querySelector(".strip-title")?.textContent ?? step.id;
  }

  function setDigits(text) {
    // The tick runs four times a second and the seconds change once: writing only
    // on a change keeps the layout still.
    if (el.digits !== null && el.digits.textContent !== text)
      el.digits.textContent = text;
  }

  /** The clock, the track, and the one control whose label follows the countdown. */
  function renderClock() {
    const own = steps[index].seconds;
    const total = budget();
    const seconds = left();

    const untimed = own === null;
    if (el.add !== null) el.add.disabled = untimed;
    if (el.play !== null) {
      el.play.disabled = untimed;
      el.play.dataset.playing = running ? "true" : "false";
      el.play.setAttribute("aria-label", running ? "Pause the timer" : "Start the timer");
    }

    if (total === null) {
      setDigits("--:--");
      if (el.progress !== null) el.progress.style.width = "0%";
      el.digits?.classList.remove("timer-digits--done");
      return;
    }

    setDigits(clock(seconds));
    if (el.progress !== null) {
      const elapsed = total > 0 ? Math.max(0, Math.min(1, (total - seconds) / total)) : 0;
      el.progress.style.width = `${Math.round(elapsed * 100)}%`;
    }
    el.digits?.classList.toggle("timer-digits--done", finished);
  }

  /** Everything that follows the focused step: the numbers, the strips and the dots. */
  function renderStep() {
    const step = steps[index];
    if (el.badge !== null) el.badge.textContent = String(index + 1);
    if (el.position !== null) el.position.textContent = `STEP ${index + 1} OF ${count}`;
    if (el.name !== null) el.name.textContent = titleOf(step);
    if (el.prev !== null) el.prev.disabled = index === 0;
    if (el.next !== null) el.next.disabled = index === count - 1;

    steps.forEach((candidate, position) => {
      if (candidate.strip !== undefined) candidate.strip.hidden = position !== index;
      // Filled up to the current step, so the dots read as progress.
      candidate.dot.classList.toggle("timer-dot--on", position <= index);
    });

    renderClock();
  }

  function renderMute() {
    if (el.mute === null) return;
    // The control is the script's own: with no script there is nothing to silence.
    el.mute.disabled = false;
    el.mute.dataset.muted = muted ? "true" : "false";
    el.mute.setAttribute("aria-pressed", muted ? "false" : "true");
    el.mute.title = muted
      ? "The chime is off; click for it back"
      : "The chime when the countdown ends";
  }

  /** The core visualization owns its layout; the cookbook only marks the active step. */
  function moveFlowFocus(id) {
    for (const node of flow.querySelectorAll(".yv-stage, .yv-prep-item")) {
      node.classList.toggle("cookbook-flow-current", node.dataset.nodeId === id);
    }
  }

  /**
   * Brings the focused column into view, sideways, by moving a scroller's own
   * `scrollLeft` — never `scrollIntoView`, which walks up to the document as well
   * and scrolls the page too, dropping the reader down to the drawing on every
   * `Next step`. The page's own position is not this function's to change.
   *
   * Every ancestor that scrolls sideways gets an adjustment, so a nested scroller
   * cannot hide the column from the one around it.
   */
  function scrollToStep() {
    const element = flow.querySelector(`[data-node-id="${steps[index].id}"]`);
    if (element === null) return;

    for (
      let parent = element.parentElement;
      parent !== null;
      parent = parent.parentElement
    ) {
      if (!scrollsSideways(parent)) continue;
      // Read again per scroller: an inner one that has just moved takes the column
      // with it, and the numbers below are only true against where it is now.
      const column = element.getBoundingClientRect();
      const frame = parent.getBoundingClientRect();
      // The band the reader can see: the frame, clipped to the window when the
      // frame is wider than it.
      const left = Math.max(frame.left, 0);
      const right = Math.min(frame.right, window.innerWidth);
      if (column.left < left) parent.scrollLeft -= left - column.left;
      else if (column.right > right) parent.scrollLeft += column.right - right;
    }
  }

  /**
   * Whether an element can carry the column sideways: an `auto` or `scroll` box with
   * more in it than it shows. That leaves out the page itself (`visible`), which is
   * the point, and the clip around the drawing (`hidden`), which would only swallow
   * the move.
   */
  function scrollsSideways(element) {
    const overflow = window.getComputedStyle(element).overflowX;
    return (
      (overflow === "auto" || overflow === "scroll") &&
      element.scrollWidth > element.clientWidth
    );
  }

  /** The fragment, so a reload lands on the same step with the same countdown. */
  function writeHash() {
    const parameters = new URLSearchParams();
    parameters.set("step", String(index + 1));
    if (running) parameters.set("until", String(Math.round(until)));
    else if (steps[index].seconds !== null) {
      parameters.set("t", String(Math.max(0, Math.ceil(remaining))));
    }
    try {
      window.history.replaceState(null, "", `#${parameters.toString()}`);
    } catch {
      // A browser that refuses to rewrite the address of a `file://` page: the
      // page still works, it just forgets where you were.
    }
  }

  /** The step the fragment asks for, and the countdown it was in the middle of. */
  function restore() {
    const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const wanted = Number(parameters.get("step"));
    if (Number.isInteger(wanted) && wanted >= 1) {
      // Clamped, so a recipe that lost steps still lands on a step that exists.
      index = Math.min(wanted - 1, count - 1);
    }

    const own = steps[index].seconds;
    if (own === null) return;

    // A step nobody has started is at its own budget, and the fragment then says
    // whether the countdown was paused or running when the page went away.
    remaining = own;
    const deadline = Number(parameters.get("until"));
    const paused = Number(parameters.get("t"));
    if (parameters.has("until") && Number.isFinite(deadline)) {
      remaining = Math.max(0, (deadline - Date.now()) / 1000);
      if (remaining > 0) {
        until = deadline;
        running = true;
      }
    } else if (parameters.has("t") && Number.isFinite(paused)) {
      remaining = Math.max(0, paused);
    }

    // Whatever is left beyond the step's own time is time that was added to it,
    // which is how a reload keeps the track honest in both directions: sixty
    // seconds added before the reload, or sixty seconds already spent.
    added = Math.max(0, Math.ceil(remaining) - own);

    // A countdown that had already run out says `00:00`, highlighted, but it does
    // not chime on arrival: the page was not here to hear it.
    finished = remaining <= 0;
  }

  function startTicking() {
    if (ticking === 0) ticking = window.setInterval(tick, TICK_MS);
  }

  function stopTicking() {
    if (ticking !== 0) {
      window.clearInterval(ticking);
      ticking = 0;
    }
  }

  function tick() {
    if (running && left() <= 0) {
      running = false;
      finished = true;
      remaining = 0;
      stopTicking();
      chime();
      renderClock();
      writeHash();
      return;
    }
    renderClock();
  }

  /**
   * The chime at zero: three 880 Hz triangle beeps, 120 ms on and 40 ms
   * off, synthesised rather than loaded — no binary in the tarball, no licence to
   * read, and it still works from a `file://` export.
   */
  function chime() {
    if (muted || audio === null) return;
    const start = audio.currentTime;
    for (let beep = 0; beep < 3; beep += 1) {
      const at = start + beep * 0.16;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = "triangle";
      tone.frequency.value = 880;
      // Ramped at both ends: a gain that jumps clicks.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      tone.connect(gain);
      gain.connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.14);
    }
  }

  /** An audio context, made on a click rather than on a page load. */
  function ensureAudio() {
    if (audio !== null) return;
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (Context === undefined) return;
    audio = new Context();
  }

  /** Moves the focus to another step, and starts that step's clock over. */
  function focus(next, scroll) {
    const wanted = Math.max(0, Math.min(count - 1, next));
    if (wanted === index) return;
    index = wanted;
    added = 0;
    running = false;
    finished = false;
    stopTicking();
    remaining = steps[index].seconds ?? 0;
    renderStep();
    moveFlowFocus(steps[index].id);
    writeHash();
    if (scroll) scrollToStep();
  }

  function toggle() {
    // Both are gestures, and a context may only be made or resumed inside one.
    ensureAudio();
    if (audio !== null && audio.state === "suspended") {
      audio.resume().catch(() => {});
    }
    if (steps[index].seconds === null) return;

    if (running) {
      remaining = left();
      running = false;
      stopTicking();
    } else {
      // Play at zero restarts the step, which is what a timer with a knob does.
      if (left() <= 0) remaining = budget() ?? 0;
      until = Date.now() + remaining * 1000;
      running = true;
      finished = false;
      startTicking();
    }
    renderClock();
    writeHash();
  }

  function addMinute() {
    if (steps[index].seconds === null) return;
    added += ADD_SECONDS;
    if (running) until += ADD_SECONDS * 1000;
    else remaining += ADD_SECONDS;
    finished = false;
    renderClock();
    writeHash();
  }

  function toggleMute() {
    muted = !muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "off" : "on");
    } catch {
      // Storage that is not available: the choice lasts for this page only.
    }
    renderMute();
  }

  el.prev?.addEventListener("click", () => focus(index - 1, true));
  el.next?.addEventListener("click", () => focus(index + 1, true));
  el.play?.addEventListener("click", toggle);
  el.add?.addEventListener("click", addMinute);
  el.mute?.addEventListener("click", toggleMute);

  steps.forEach((step, position) => {
    step.dot.addEventListener("click", () => focus(position, false));
  });

  // A column, or a preparation card: the drawing is the other way to walk a recipe.
  flow.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const id = target.closest("[data-node-id]")?.getAttribute("data-node-id");
    const wanted = steps.findIndex((step) => step.id === id);
    if (wanted !== -1) focus(wanted, false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    // The nav holds a search box: typing in it is typing, not steering.
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select")) return;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      focus(index + 1, true);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focus(index - 1, true);
    } else if (event.key === "r" || event.key === "R") {
      // For the case where the watcher is off (`--no-watch`).
      window.location.reload();
    }
  });

  // The one class that says the page is being driven: a clickable column gets a
  // pointer only where clicking it does something.
  document.documentElement.classList.add("has-script");

  restore();
  renderMute();
  renderStep();
  moveFlowFocus(steps[index].id);
  if (running) startTicking();
})();
