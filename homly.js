/**
 * homly.js — a tiny reactive Web Components framework.
 *
 * Vanilla JavaScript, zero dependencies and no build step: it runs straight in
 * the browser. State is reactive through fine-grained signals, the DOM is wired
 * with `data-*` attributes, and each component is a Custom Element that loads
 * its HTML and CSS from sibling files.
 *
 * @version 1.10.0
 * @license MIT
 */

/**
 * Static helpers that power the framework: template loading, the reactive store,
 * DOM binding and the click dispatcher.
 */
export class Homly {
  /**
   * Cache of fetched templates/stylesheets, keyed by resolved URL.
   * @type {Map<string, string>}
   */
  static templateCache = new Map();

  /**
   * In-flight requests, keyed by URL. Lets simultaneous callers for the same URL
   * share a single `fetch` (request collapsing) instead of each firing its own.
   * @type {Map<string, Promise<string>>}
   */
  static pendingRequests = new Map();

  /**
   * Row store for each node rendered by a `data-for`, so a `data-action` fired from
   * inside a row can tell which item it belongs to. A WeakMap, so removing the row is
   * enough to drop the entry — no bookkeeping on teardown.
   * @type {WeakMap<HTMLElement, Object>}
   */
  static listItems = new WeakMap();

  /**
   * Events a `homly:action-error` was already dispatched for / events a nested
   * dispatcher already handled — see {@link Homly.attachDispatcher} ("gana el host
   * más interno"). A WeakSet keyed by the Event object itself, so it needs no cleanup:
   * once the event is garbage-collected, so is its entry.
   * @type {WeakSet<Event>}
   */
  static _dispatched = new WeakSet();

  /** Event types the dispatcher delegates, per `data-action="evento->acción"`. */
  static _DISPATCH_EVENTS = ['click', 'submit', 'change', 'input', 'keydown'];

  /** User-facing strings the runtime shows; override to translate or reword. */
  static messages = { loadError: 'No se pudo cargar este contenido. Intenta recargar la página.' };

  /**
   * `'inline'` reverts the scoped-CSS injection to the pre-1.10 behaviour — one
   * `<style data-homly-scope>` per component INSTANCE — for a site that can't yet
   * serve `style-src 'self'`. Default (`null`): one shared stylesheet per component
   * CLASS via `document.adoptedStyleSheets` (CSP-1) — see {@link Homly._installSheet}.
   * @type {?'inline'}
   */
  static styleMode = null;

  /** Nonce written on the fallback `<style>` tag (inline mode, or no adoptedStyleSheets). */
  static styleNonce = null;

  /** Component tags (or `'*'` for the shared base rules) whose stylesheet is already installed. */
  static _stylesInstalled = new Set();

  /**
   * Rules every 1.10+ page needs once, regardless of any single component:
   * `[hidden]` must win even inside a component's own `@scope`'d CSS (P13/CSP-1 — an
   * author selector like `p { display: flex }` can otherwise out-cascade the UA
   * default), and `renderError`'s placeholder (CSP-1: no more inline `style=`).
   */
  static _BASE_CSS = '[data-if][hidden]{display:none!important}'
    + '[data-homly-error]{padding:12px 14px;border:1px solid #d9534f;border-radius:8px;'
    + 'color:#d9534f;font:14px/1.45 system-ui,sans-serif}';

  /**
   * Fetch a text resource (an HTML template or a CSS file), cached by URL.
   *
   * Three layers, in order:
   *  1. Cache hit  — returns the stored text (so re-mounting a component never refetches).
   *  2. In-flight  — returns the pending promise, so N components asking for the same
   *                  URL at once trigger a single network request (request collapsing).
   *  3. New        — fetches, stores the result in the cache and clears the pending entry.
   *
   * On a network/HTTP error the pending entry is cleared (so a later call can retry)
   * and the error propagates to the caller (handled by the component's error boundary).
   *
   * @param {string} url - URL of the resource to fetch.
   * @returns {Promise<string>} The resource body as text.
   */
  static loadTemplate(url) {
    if (this.templateCache.has(url)) {
      if (Homly._level()) Homly._log('✓', 'cache HIT ' + url);
      return Promise.resolve(this.templateCache.get(url));
    }
    if (this.pendingRequests.has(url)) {
      if (Homly._level()) Homly._log('⇉', 'collapse ' + url);
      return this.pendingRequests.get(url);
    }
    if (Homly._level()) Homly._log('↓', 'fetch ' + url);

    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status} al cargar ${url}`);
        return response.text();
      })
      .then((text) => {
        // FIX ROUTER-19/ROUTER-22: una plantilla que en realidad es un documento HTML
        // completo (SPA fallback del server, redirect a un login, un 404 servido como
        // 200…) se ve fatal al meterse dentro de otro <html> — y con `loader` intentando
        // de nuevo en cada click, sin este chequeo el error se repite en silencio y sin
        // pista de la causa. Se rechaza aquí, con el porqué, en vez de romper más adelante.
        if (/^\s*<!doctype\s+html|^\s*<html[\s>]/i.test(text)) {
          throw new Error(`loadTemplate: ${url} devolvió un documento HTML completo, no una `
            + 'plantilla — revisa la ruta (¿apunta a una página en vez de a un fragmento?)');
        }
        this.templateCache.set(url, text);
        this.pendingRequests.delete(url);
        return text;
      })
      .catch((err) => {
        this.pendingRequests.delete(url);   // permitir reintento en el próximo montaje
        throw err;
      });

    this.pendingRequests.set(url, request);
    return request;
  }

  /**
   * Create a reactive store with one signal per key of the initial state.
   *
   * Each signal keeps its own set of subscribers and notifies them synchronously
   * when its value changes. The returned `state` is a Proxy, so you can read and
   * write values directly (`store.state.key = value`).
   *
   * @param {Object<string, *>} initialState - Initial keys and values.
   * @returns {{ state: Object, signals: Object<string, { subscribe: Function, set: Function, get: Function }>, computed: Function }}
   *   `state` (the reactive proxy), `signals` (the raw per-key signals), and
   *   `computed(name, depKeys, fn)` to register a derived signal as a store key.
   */
  static createStore(initialState) {
    // FIX CORE-20/PROTO-1: a plain `{}` inherits from `Object.prototype`, so
    // `signals['constructor']` (or 'toString', 'hasOwnProperty', …) resolves to a
    // function from the prototype chain instead of `undefined` — every `if
    // (store.signals[key])` guard in this file would then treat a key like
    // `data-bind="constructor"` as an existing signal and crash calling `.subscribe`
    // on a plain `Function`. `Object.create(null)` has no prototype, so those lookups
    // come back `undefined` like any other unknown key.
    const signals = Object.create(null);

    /**
     * Create a writable signal under `key`. Used for the initial state and by
     * `store.resource`, which registers its own keys after the store exists.
     *
     * @param {string} key - Store key the signal is exposed under.
     * @param {*} initial - Starting value.
     * @returns {{ subscribe: Function, set: Function, get: Function }}
     */
    const addSignal = (key, initial) => {
      const subscribers = new Set();
      let value = initial;

      return (signals[key] = {
        /**
         * Subscribe to changes of this key. Runs immediately with the current value.
         * @param {(value: *) => void} fn - Callback invoked on every change.
         * @param {AbortSignal} [abortSignal] - When aborted, removes the subscription.
         */
        subscribe: (fn, abortSignal) => {
          subscribers.add(fn);
          if (abortSignal) {
            abortSignal.addEventListener('abort', () => subscribers.delete(fn), { once: true });
          }
          fn(value);
        },
        /**
         * Update the value and notify subscribers. No-op if the value is unchanged.
         * @param {*} newVal - The new value.
         */
        set: (newVal) => {
          // FIX CORE-8a: `Object.is` instead of `===`, so setting `NaN` twice in a row
          // (an invalid `?pagina=abc` cast, see `bindQuery`) is recognized as "unchanged"
          // — `NaN === NaN` is `false`, which made `set` re-notify subscribers forever.
          if (Object.is(value, newVal)) return;
          if (Homly._level() === 'verbose') Homly._log('✎', 'signal ' + key + ': ' + Homly._fmt(key, value) + ' → ' + Homly._fmt(key, newVal));
          value = newVal;
          // FIX CORE-18: each subscriber is notified in isolation — one throwing (a bug
          // in that particular view) must not stop the rest from hearing about the
          // change. The first error is rethrown after everyone's been notified, so it
          // still surfaces instead of being silently swallowed.
          let firstError, hasError = false;
          subscribers.forEach((fn) => {
            try { fn(value); } catch (err) { if (!hasError) { hasError = true; firstError = err; } }
          });
          if (hasError) throw firstError;
        },
        /** @returns {*} The current value. */
        get: () => value,
      });
    };

    for (const key in initialState) addSignal(key, initialState[key]);

    // Proxy so the store can be read/written as `store.state.key`.
    //
    // FIX CORE-20/PROTO-1: `get`/`set` alone make `store.state.key` work, but without
    // `has`/`ownKeys`/`getOwnPropertyDescriptor` the proxy still answers `'a' in state`,
    // `JSON.stringify(state)` and `{...state}` from its (empty) target — silently
    // returning `false`/`{}`/`{}` instead of the real keys. The three extra traps route
    // those through the same `signals` object `get`/`set` already use.
    const stateProxy = new Proxy(Object.create(null), {
      get(_, prop) { return signals[prop] ? signals[prop].get() : undefined; },
      set(_, prop, val) {
        if (signals[prop]) {
          signals[prop].set(val);
        } else if (Homly._level()) {
          Homly._warn('[homly H201] store.state.' + String(prop) + ': clave no declarada — se ignora');
        }
        return true;
      },
      has(_, prop) { return Object.hasOwn(signals, prop); },
      ownKeys() { return Reflect.ownKeys(signals); },
      getOwnPropertyDescriptor(_, prop) {
        if (!Object.hasOwn(signals, prop)) return undefined;
        return { value: signals[prop].get(), enumerable: true, configurable: true };
      },
    });

    const store = { state: stateProxy, signals };

    /**
     * Register a computed signal as a key of this store. Its dependencies are
     * other keys of the same store, so `data-bind="name"`, `store.state.name`
     * and `globalStores` pick it up like any plain signal.
     *
     * @param {string} name - Key under which the computed is exposed.
     * @param {string[]} depKeys - Keys of this store the computed derives from.
     * @param {(...values: *[]) => *} fn - Pure function of the deps' values.
     * @returns {{ subscribe: Function, get: Function, set: Function }} The computed.
     */
    store.computed = (name, depKeys, fn) => {
      const derived = Homly.computed(depKeys.map((key) => signals[key]), fn, undefined, name);
      signals[name] = derived;
      return derived;
    };

    /**
     * Register an async resource as **three** keys of this store: `name` (the value),
     * `name + 'Loading'` (boolean) and `name + 'Error'` (the thrown error, or null).
     * They are plain signals, so `data-for="items"`, `data-if="itemsLoading"` and
     * `data-bind="itemsError"` work with no new directives.
     *
     * The fetcher re-runs whenever a dep changes. Each run aborts the previous one and
     * carries a token, so **a late response can never overwrite a newer one** — the
     * classic bug of a slow first request landing after a fast second one.
     *
     * On failure the error is published and the last good value is kept, so a flaky
     * refresh doesn't blank out a list that is already on screen.
     *
     * @param {string} name - Key for the value; `${name}Loading` / `${name}Error` come along.
     * @param {string[]} depKeys - Keys of this store the fetcher depends on. `[]` loads once.
     * @param {(...values: *[]) => Promise<*>} fetcher - Receives the deps' values plus a
     *   trailing `{ signal }` to hand to `fetch`. Throw to populate `${name}Error`
     *   (`fetch` does not throw on a 4xx/5xx — check `response.ok` yourself).
     * @param {{ debounce?: number, initial?: *, sync?: boolean }} [opts] - `debounce` in ms
     *   groups rapid dep changes into a single request (typing in a filter). `initial`, when
     *   present (even `null`), seeds `name` with it and skips the first, automatic fetch —
     *   SSR: pass the value already rendered by the server (see {@link Homly.initial}) so
     *   hydration doesn't refetch data the page already shipped. Later dep changes still
     *   fetch normally. `sync: true` opts out of the microtask batching below (a dep change
     *   re-runs the fetcher immediately, like before 1.10 — `${name}Loading` flips to `true`
     *   in the same tick instead of one microtask later).
     * @returns {{ refresh: () => Promise<void> }} `refresh` re-runs it by hand (retry buttons).
     */
    store.resource = (name, depKeys, fetcher, opts = {}) => {
      const { debounce = 0, sync = false } = opts;
      const hasInitial = Object.hasOwn(opts, 'initial');

      // FIX CORE-22a: validate deps *before* registering `name`/`Loading`/`Error` — a
      // typo'd dep used to leave those three signals half-wired (declared but backed by
      // a fetcher that would throw synchronously on `signals[key].get()`) instead of
      // failing loudly at the call site with a message that names the missing key.
      for (const key of depKeys) {
        if (!signals[key]) {
          throw new Error('[homly H202] store.resource("' + name + '"): no existe la dependencia "' + key + '"');
        }
      }

      const data = addSignal(name, hasInitial ? opts.initial : null);
      const loading = addSignal(name + 'Loading', false);
      const error = addSignal(name + 'Error', null);

      let controller = null;
      let timer = null;
      let token = 0;

      const run = async () => {
        // FIX CORE-22a: cancel a pending debounced re-run — otherwise a manual
        // `refresh()` fired while one is queued left it to fire again right after,
        // wasting a request with (by then) stale args.
        clearTimeout(timer);
        controller?.abort();
        controller = new AbortController();
        const mine = ++token;
        const { signal } = controller;

        loading.set(true);
        let value;
        try {
          value = await fetcher(...depKeys.map((key) => signals[key].get()), { signal });
        } catch (err) {
          if (mine !== token || signal.aborted) return;   // abortado por nosotros, no es un fallo
          if (Homly._level()) Homly._warn('[homly H301] resource ' + name + ': ' + err.message);
          error.set(err);
          loading.set(false);
          return;
        }
        if (mine !== token) return;              // llegó tarde: ya hay otro run en curso
        error.set(null);
        try {
          // FIX CORE-18: `data.set` runs OUTSIDE the fetch's try/catch — a subscriber
          // that throws while reacting to a successful value (a bug in the view, not in
          // the fetch) must not be mistaken for the fetch itself having failed and land
          // in `${name}Error`.
          data.set(value);
        } catch (err) {
          console.error('[homly] resource ' + name + ': un subscriber lanzó al recibir el valor', err);
        } finally {
          loading.set(false);
        }
      };

      // FIX PERF-5/CORE-9: N deps changed in the same tick (a "clear filters" click that
      // resets q/orden/pagina at once) used to fire N runs, N-1 of them aborted a beat
      // later — the server sees every one of those before Chrome's abort catches up.
      // Coalescing trailing-edge into a microtask collapses them into a single run with
      // the FINAL values. `sync: true` (or a `debounce`, which already coalesces) opts out.
      let queued = false;
      const trigger = debounce
        ? () => { clearTimeout(timer); timer = setTimeout(run, debounce); }
        : sync
          ? run
          : () => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; run(); }); } };

      // subscribe() es eager, así que dispararía un run por cada dep al registrarse.
      // Se ignoran esas primeras llamadas y se hace un único run inicial, sin debounce.
      let primed = false;
      depKeys.forEach((key) => signals[key].subscribe(() => { if (primed) trigger(); }));
      primed = true;
      // FIX SSR-1: a value already sembrado (SSR) skips the first, automatic fetch — the
      // page already shipped it. A later dep change still fetches normally.
      if (!hasInitial) run();

      // ponytail: un fetch en vuelo no se aborta al desmontar. El store local muere con el
      // componente y la respuesta cae en el vacío; si algún día hace falta cortarlo antes,
      // el hook es pasar this.signal aquí y encadenarlo al controller.
      return { refresh: run };
    };

    return store;
  }

  /**
   * Create a read-only signal derived from other signals. Dependencies are
   * explicit: pass the source signals and a pure function of their values. The
   * computed re-evaluates whenever any dependency changes and notifies its own
   * subscribers only if the result actually changed (=== check), so it composes
   * with `bindView` and `state` like any other signal.
   *
   * @param {Array<{ subscribe: Function, get: Function }>} deps - Source signals.
   * @param {(...values: *[]) => *} fn - Pure function of the deps' current values.
   * @param {AbortSignal} [abortSignal] - When aborted, unsubscribes from the deps.
   * @param {string} [label] - Optional name for verbose dev logs (set by store.computed).
   * @returns {{ subscribe: Function, get: Function, set: Function }} A read-only
   *   signal — its `set` throws, since computeds are derived, not written by hand.
   */
  static computed(deps, fn, abortSignal, label) {
    const subscribers = new Set();
    const evaluate = () => fn(...deps.map((dep) => dep.get()));
    let value = evaluate();

    const recompute = () => {
      const next = evaluate();
      if (next === value) return;
      if (Homly._level() === 'verbose') Homly._log('↳', 'computed ' + (label ? label + ' ' : '') + 'recompute: ' + Homly._fmt(label || '', value) + ' → ' + Homly._fmt(label || '', next));
      value = next;
      subscribers.forEach((notify) => notify(value));
    };
    deps.forEach((dep) => dep.subscribe(recompute, abortSignal));

    return {
      subscribe: (notify, signal) => {
        subscribers.add(notify);
        if (signal) signal.addEventListener('abort', () => subscribers.delete(notify), { once: true });
        notify(value);
      },
      get: () => value,
      set: () => { throw new Error('Las computed signals son de solo lectura'); },
    };
  }

  /**
   * Nearest ancestor of `el` (inclusive, stopping at `boundary`) that is a mounted
   * `HomlyComponent` — the **component limit** (FIX CORE-6a/PERF-6a, bug #5). A
   * container's `bindView`/`bindList` must not reach into a nested component's own
   * markup: two components sharing the light DOM (homly has no Shadow DOM) means a
   * naive `container.querySelectorAll(...)` would otherwise also match elements that
   * belong to a child component's own store — most visibly with SSR, where the child
   * is prerendered and its element already exists when the parent binds.
   *
   * @param {Element} el - Candidate element.
   * @param {Element} boundary - The call's own container; never disqualifies itself.
   * @returns {Element} `boundary` when no nested component sits between `el` and it.
   */
  static _owner(el, boundary) {
    for (let n = el; n && n !== boundary; n = n.parentElement) {
      if (n instanceof HomlyComponent) return n;
    }
    return boundary;
  }

  /**
   * Wire a container's DOM to a store using declarative `data-*` attributes:
   *
   * - `data-bind="key"` — write the value as the element's text content.
   * - `data-if="key"` — toggle the `hidden` attribute from the value's truthiness.
   * - `data-bind-class="class:key, class2:key2"` — add/remove one or more classes.
   * - `data-bind-attr="attr:key, attr2:key2"` — bind one or more attributes.
   * - `data-model="key"` — two-way binding for input/textarea/select/checkbox.
   *
   * Every subscription/listener is tied to `signal`, so it is cleaned up when the
   * component disconnects.
   *
   * @param {HTMLElement} container - Root element to scan for bindings.
   * @param {{ signals: Object, state: Object }} store - Store from {@link Homly.createStore}.
   * @param {AbortSignal} signal - Abort signal used to tear down listeners/subscriptions.
   * @param {?Element} [ownRow] - SSR adoption only ({@link Homly.bindList}): the single
   *   `[data-homly-key]` row this call is allowed to bind into. Every other row under
   *   `container` is left untouched — it belongs to its own item store.
   * @param {?Object} [fallback] - `data-for` rows only ({@link Homly.bindList}): the
   *   enclosing store's `signals`, consulted for a key the row's OWN store doesn't
   *   declare — "the row sees the parent's keys, but the row wins" (a field the item
   *   also has shadows the outer one; a `data-model` inside a row falls back the same
   *   way, and writes straight to the fallback signal since there's no row copy of it).
   */
  static bindView(container, store, signal, ownRow = null, fallback = null) {
    // SSR: a prerendered row's directives belong to the ROW's store, not the host's —
    // skipped here unless this is the one call binding that exact row (ownRow).
    // Component limit: an element owned by a nested HomlyComponent belongs to ITS own
    // bindView call, never to an ancestor's.
    const mine = (el) => {
      const row = el.closest('[data-homly-key]');
      if (row && row !== ownRow) return false;
      return Homly._owner(el, container) === container;
    };
    const all = (sel) => (ownRow ? [ownRow, ...ownRow.querySelectorAll(sel)] : [...container.querySelectorAll(sel)])
      .filter((el) => el.matches(sel) && mine(el));
    // FIX CORE-13b/P5: the row's own signal wins; only missing there does a directive
    // reach into the enclosing store (never the other way around).
    const sig = (key) => store.signals[key] || (fallback && fallback[key]);

    all('[data-bind]').forEach(el => {
      const s = sig(el.getAttribute('data-bind'));
      if (s) {
        s.subscribe((val) => {
          // FIX CORE-21: `null` (a cleared field, an absent optional value) used to
          // render as the literal text "null" — `String(null) === 'null'` — instead of
          // blank. `undefined` already fell through to '' here; `null` now does too.
          const newVal = val != null ? String(val) : '';
          if (el.textContent !== newVal) el.textContent = newVal;
        }, signal);
      }
    });

    all('[data-if]').forEach(el => {
      const s = sig(el.getAttribute('data-if'));
      if (s) {
        s.subscribe((val) => {
          if (!!val) el.removeAttribute('hidden');
          else el.setAttribute('hidden', '');
        }, signal);
      }
    });

    // Several pairs in one attribute: "class:key, class2:key2" — same for data-bind-attr.
    all('[data-bind-class]').forEach(el => {
      for (const pair of el.getAttribute('data-bind-class').split(',')) {
        const [className, key] = pair.trim().split(':');
        const s = sig(key);
        if (s) {
          s.subscribe((val) => {
            el.classList.toggle(className, !!val);
          }, signal);
        }
      }
    });

    all('[data-bind-attr]').forEach(el => {
      for (const pair of el.getAttribute('data-bind-attr').split(',')) {
        const [attr, key] = pair.trim().split(':');
        const s = sig(key);
        if (s) {
          s.subscribe((val) => {
            if (val === undefined || val === null || val === '') return el.removeAttribute(attr);
            // FIX CORE-15a: a boolean follows normal HTML boolean-attribute semantics —
            // `false` removes it (`disabled="false"` is still disabled in HTML, since
            // presence is what counts) and `true` writes `''`. `aria-*` is the documented
            // exception: ARIA wants the literal string 'true'/'false', not presence.
            const isAria = attr.startsWith('aria-');
            if (val === false && !isAria) return el.removeAttribute(attr);
            const toWrite = typeof val === 'boolean' ? (isAria ? String(val) : '') : val;
            // FIX BIND-1/CORE-16 (seguridad): bloquear los sinks clásicos de un script gadget
            // antes de escribir. Ver Homly._attrAllowed.
            if (!Homly._attrAllowed(attr, toWrite)) {
              if (Homly._level()) Homly._warn('[homly H401] data-bind-attr ' + attr + ': valor bloqueado — ' + String(toWrite).slice(0, 60));
              return el.removeAttribute(attr);
            }
            el.setAttribute(attr, toWrite);
          }, signal);
        }
      }
    });

    // Two-way binding: data-model="key" on input / textarea / select / checkbox.
    //
    // FIX CORE-3: dispatches on the control's type *and* the key's initial value,
    // instead of only distinguishing checkbox vs. everything-else:
    // - radio: checked follows `String(val) === el.value`; only a checked radio writes.
    // - number/range: cast back to `Number` **only if the key started out as a number**
    //   (Hyrum's law — a data-model'd number input used to always give back a string,
    //   and some existing markup may rely on that). A cleared field becomes `null`, not
    //   `Number('') === 0`, which would silently turn "empty" into a real zero.
    // - `<select multiple>`: array of the selected options' values.
    // - a checkbox whose key started out as an *array* is a checkbox group: checking
    //   one appends its value, unchecking removes it — a lone boolean checkbox is
    //   untouched (that's the `Array.isArray(initial)` branch below).
    all('[data-model]').forEach(el => {
      const s = sig(el.getAttribute('data-model'));
      if (!s) return;
      const initial = s.get();
      const isRadio = el.type === 'radio';
      const isCheckbox = el.type === 'checkbox';
      const isCheckboxGroup = isCheckbox && Array.isArray(initial);
      const isMultiSelect = el.tagName === 'SELECT' && el.multiple;
      const isNumberish = (el.type === 'number' || el.type === 'range') && typeof initial === 'number';

      // State -> UI
      s.subscribe((val) => {
        if (isRadio) el.checked = String(val) === el.value;
        else if (isCheckboxGroup) el.checked = Array.isArray(val) && val.includes(el.value);
        else if (isCheckbox) el.checked = !!val;
        else if (isMultiSelect) {
          const arr = Array.isArray(val) ? val : [];
          for (const opt of el.options) opt.selected = arr.includes(opt.value);
        } else if (el.value !== val) el.value = val != null ? val : ''; // guard: keep the caret in place
      }, signal);

      // UI -> State. Writes go straight through the resolved signal's `set` — for a
      // row falling back to the host's key (CORE-13b/P5), `store.state[key] =` would
      // hit the row's own Proxy, which doesn't have this key and would just warn.
      const evt = (el.tagName === 'SELECT' || isCheckbox || isRadio) ? 'change' : 'input';
      const handler = (e) => {
        if (isRadio) {
          if (e.target.checked) s.set(e.target.value);
        } else if (isCheckboxGroup) {
          const current = Array.isArray(s.get()) ? s.get() : [];
          s.set(e.target.checked
            ? [...current, e.target.value]
            : current.filter((v) => v !== e.target.value));
        } else if (isCheckbox) {
          s.set(e.target.checked);
        } else if (isMultiSelect) {
          s.set([...e.target.selectedOptions].map((o) => o.value));
        } else if (isNumberish) {
          s.set(e.target.value === '' ? null : Number(e.target.value));
        } else {
          s.set(e.target.value);
        }
      };
      el.addEventListener(evt, handler);
      signal?.addEventListener('abort', () => el.removeEventListener(evt, handler), { once: true });
    });
  }

  /**
   * Render a keyed list from a `<template data-for="arrayKey" data-key="field">`.
   * For each item in the store's array signal it clones the template, gives the
   * clone its own store (so the inner `data-*` bindings resolve against the item's
   * fields) and reconciles by key on every array change: existing items reuse their
   * node (updating only changed fields), new keys are created and gone keys removed.
   * An optional `data-index="name"` exposes the 0-based position as a reactive field.
   *
   * @param {HTMLElement} container - Element to scan for `template[data-for]`.
   * @param {{ signals: Object }} store - Store whose array signals back the lists.
   * @param {AbortSignal} signal - Aborted on disconnect; tears down all item bindings.
   */
  static bindList(container, store, signal) {
    if (!store) return;
    // FIX CORE-6a/PERF-6a (component limit): a <template data-for> that belongs to a
    // nested HomlyComponent is that component's own job to bind, not this container's.
    [...container.querySelectorAll('template[data-for]')]
      .filter((tpl) => Homly._owner(tpl, container) === container)
      .forEach((tpl) => {
      const arrayKey = tpl.getAttribute('data-for');
      const keyField = tpl.getAttribute('data-key');
      const indexName = tpl.getAttribute('data-index');
      if (!keyField) throw new Error(`data-for="${arrayKey}" requiere data-key`);
      const arraySignal = store.signals[arrayKey];
      if (!arraySignal) {
        if (Homly._level()) Homly._warn('[homly H105] data-for="' + arrayKey + '": no existe la señal \'' + arrayKey + '\' en el store');
        return;
      }
      // Each item's markup must have a single root element: only firstElementChild is
      // mounted, so extra top-level siblings are silently dropped. Warn under HOM_DEBUG.
      if (Homly._level() && tpl.content.childElementCount > 1) {
        Homly._warn('[homly H106] data-for="' + arrayKey + '": el <template> debe tener un solo elemento raíz por ítem; se ignoran los demás');
      }

      const rendered = new Map();   // keyValue -> entry { key, node, itemStore, item }
      // FIX PERF-8: no per-row AbortController. A row's OWN bindings subscribe to its
      // OWN store, which dies with the node once it drops out of `rendered`/`order` —
      // nothing external keeps it alive, so there's nothing to explicitly abort. A
      // directive that falls back to the PARENT's store (CORE-13b/P5, below) still
      // passes THIS `signal` — the host's — so that subscription unsubscribes exactly
      // when the host itself does, same as any other binding on it.
      let order = [];   // entries in current DOM order, for the reconciliation below
      const parent = tpl.parentNode;
      // FIX PERF-2: moveBefore (Chrome 133+) relocates a node without disconnecting it
      // — the row's Custom Elements, if any, are never re-hydrated by a reorder.
      const place = (node, ref) => (node.isConnected && parent.moveBefore)
        ? parent.moveBefore(node, ref) : parent.insertBefore(node, ref);

      // SSR adoption: sibling rows the server already rendered, each marked
      // data-homly-key="<key>" right after the <template>, in the same order as the
      // array's initial value. Adopted AS-IS (same nodes, no clone): the item store is
      // seeded from the initial array (not read back from the DOM) and bound with
      // ownRow so its own directives resolve against it — zero mutation on hydration.
      // `item` is kept as the very SAME reference from the initial array, so the first
      // (eager) run of the reconciliation below recognizes it via PERF-9 and never
      // touches these rows at all.
      const initialItems = arraySignal.get();
      if (Array.isArray(initialItems)) {
        const byKey = new Map(initialItems.filter((it) => it != null).map((it) => [String(it[keyField]), it]));
        for (let n = tpl.nextElementSibling; n && n.hasAttribute('data-homly-key'); n = n.nextElementSibling) {
          const item = byKey.get(n.getAttribute('data-homly-key'));
          if (!item) continue;
          const itemStore = Homly.createStore({ ...item });
          Homly.bindView(n.parentNode, itemStore, undefined, n, store.signals);
          Homly.bindList(n, itemStore, undefined);
          Homly.listItems.set(n, itemStore);
          const entry = { key: item[keyField], node: n, itemStore, item };
          rendered.set(entry.key, entry);
          order.push(entry);
        }
      }

      arraySignal.subscribe((items) => {
        const list = Array.isArray(items) ? items : [];
        const seen = new Set();
        // FIX CORE-19a/LIST-1: warn once per duplicated key per pass, not once per repeat.
        const warnedDup = new Set();
        const h104 = (msg) => { if (Homly._level()) Homly._warn('[homly H104] data-for="' + arrayKey + '": ' + msg); };
        const valid = [];   // [{ item, i }], en orden, sin null/sin key/duplicados
        list.forEach((item, i) => {
          // FIX CORE-19a/LIST-1: a `null` in the array (a gap left by a filter, a
          // still-loading placeholder) used to throw reading `item[keyField]` off it and
          // abort the whole render. Skip it — and warn under HOM_DEBUG — instead.
          if (item == null) { h104('item ' + i + ' es null'); return; }
          const k = item[keyField];
          if (k === undefined || k === null) { h104('item ' + i + ' sin "' + keyField + '"'); return; }
          if (seen.has(k)) {
            if (!warnedDup.has(k)) { h104('clave "' + k + '" duplicada'); warnedDup.add(k); }
            return;
          }
          seen.add(k);
          valid.push({ item, i });
        });

        // FIX PERF-2/PERF-8: the rows that are leaving go FIRST — otherwise every row
        // that stays looks "displaced" by one still sitting where it shouldn't, and
        // the placement pass below would move it for nothing.
        const gone = order.filter((e) => !seen.has(e.key));
        if (gone.length && gone.length === order.length && order.length > 1) {
          const r = document.createRange();   // wipe: a single deleteContents, not N removes
          r.setStartBefore(order[0].node); r.setEndAfter(order[order.length - 1].node);
          r.deleteContents();
        } else for (const e of gone) e.node.remove();
        for (const e of gone) rendered.delete(e.key);
        if (gone.length) order = order.filter((e) => seen.has(e.key));
        const endRef = order.length ? order[order.length - 1].node.nextSibling : tpl.nextSibling;

        const pos = new Map(order.map((e, i) => [e, i]));
        const next = valid.map(({ item, i }) => {
          const k = item[keyField];
          let entry = rendered.get(k);
          if (entry) {
            // FIX PERF-9: the same object reference has nothing new to copy — this is
            // what makes SSR adoption's first pass, above, a true no-op.
            if (entry.item !== item) {
              // FIX CORE-12/PERF-10: iterate the row's OWN declared keys (from the item
              // that created it), not the incoming item's keys — a field the template
              // binds that has since disappeared from `item` (e.g. `foto`) now writes
              // `undefined` (→ '' per CORE-21) instead of keeping its last, stale value.
              for (const field in entry.itemStore.signals) {
                if (field === indexName) continue;
                entry.itemStore.state[field] = item[field];
              }
              entry.item = item;
            }
            if (indexName) entry.itemStore.state[indexName] = i;
          } else {
            const itemStore = Homly.createStore(indexName ? { ...item, [indexName]: i } : { ...item });
            // Bind through a throwaway wrapper so the item's ROOT element directives
            // count too: bindView scans descendants, so a directive on the root node
            // (e.g. data-bind-attr on the <article>) would be skipped if we bound the
            // node directly. As a descendant of the wrapper, the root gets bound.
            const wrapper = document.createElement('div');
            wrapper.appendChild(tpl.content.cloneNode(true));
            // FIX CORE-13b/P5: `store.signals` (the host/enclosing row) as fallback —
            // a key the row's own item doesn't have still resolves, read AND write.
            Homly.bindView(wrapper, itemStore, undefined, null, store.signals);
            // FIX CORE-4: a nested `<template data-for>` inside this row's own markup
            // (a list of amenities per property, say) needs the row's OWN store — bindView
            // never touched it because it only wires `data-bind`-style attributes.
            Homly.bindList(wrapper, itemStore, undefined);
            const node = wrapper.firstElementChild;
            Homly.listItems.set(node, itemStore);   // para que las acciones sepan de qué fila salieron
            entry = { key: k, node, itemStore, item };
            rendered.set(k, entry);
          }
          return entry;
        });

        // FIX PERF-2: the rows whose OLD position forms the longest increasing
        // subsequence (LIS) stay put; only the rest gets moved/inserted, walking back
        // to front so each `place()` has an already-settled node as its reference.
        const src = next.map((e) => (pos.has(e) ? pos.get(e) : -1));
        const stay = new Set();
        {
          const tails = [], prev = new Array(src.length);
          for (let i = 0; i < src.length; i++) {
            if (src[i] < 0) continue;
            let lo = 0, hi = tails.length;
            while (lo < hi) { const m = (lo + hi) >> 1; if (src[tails[m]] < src[i]) lo = m + 1; else hi = m; }
            prev[i] = lo ? tails[lo - 1] : -1; tails[lo] = i;
          }
          for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) stay.add(i);
        }
        let ref = endRef;
        for (let i = next.length - 1; i >= 0; i--) {
          const node = next[i].node;
          if (!stay.has(i)) place(node, ref);
          ref = node;
        }
        order = next;
      }, signal);
    });
  }

  /**
   * Keep a set of store keys in sync with the URL's query string, so a filtered list
   * has a shareable address and survives a reload.
   *
   * Runs URL → store immediately, so call it **before** `store.resource(...)`: that way
   * the first request already uses the filters from the URL instead of fetching with the
   * defaults and then refetching.
   *
   * The value written back is typed after the store's initial value: a key that starts
   * as a number comes back as a number, and one that starts as a boolean comes back as a
   * boolean. Without that, `pagina` would return from the URL as the string `'2'` and
   * `pagina + 1` would quietly produce `'21'`.
   *
   * Keys sitting at their default are dropped from the URL, so a pristine view stays a
   * clean `/propiedades` instead of `/propiedades?q=&orden=precio`.
   *
   * Updates use `replaceState`: typing in a filter must not stack one history entry per
   * keystroke. Navigating away and coming back still restores the filters, because the
   * URL was replaced in place and `popstate` re-reads it.
   *
   * @param {{ signals: Object, state: Object }} store - Store from {@link Homly.createStore}.
   * @param {string[]} keys - Store keys to mirror in the query string.
   * @param {AbortSignal} [signal] - Aborted on disconnect; drops the listeners.
   */
  static bindQuery(store, keys, signal) {
    const defaults = {};
    for (const key of keys) {
      if (store.signals[key]) defaults[key] = store.signals[key].get();
      else if (Homly._level()) Homly._warn("[homly H501] bindQuery: no existe la señal '" + key + "' en el store");
    }
    // FIX CORE-8b/QUERY-1: a key whose initial value is an array is a repeated param
    // (`?tipo=casa&tipo=apto`), read/written with getAll/append instead of get/set.
    const isArr = (key) => Array.isArray(defaults[key]);

    const cast = (key, raw) => {
      const def = defaults[key];
      // FIX CORE-8a: a hand-edited or garbled URL (`?pagina=abc`) used to become `NaN`
      // — which then never matched `defaults[key]` in `write()` below (`NaN !==
      // anything`, itself), so it stuck in the URL as the literal string "NaN" and,
      // combined with `Object.is` in `set`, re-notified subscribers on every read().
      // Falling back to the default makes an invalid value behave like an absent one.
      // `Number('')` is `0`, not `NaN` — an empty `?precioMax=` would otherwise silently
      // become a real zero instead of falling back to the default like any other
      // unparseable value.
      if (typeof def === 'number') { const n = raw === '' ? NaN : Number(raw); return Number.isNaN(n) ? def : n; }
      if (typeof def === 'boolean') return raw !== 'false' && raw !== '0';
      return raw;
    };

    // URL → store. Una clave ausente vuelve a su default (así el botón atrás limpia
    // un filtro que ya no está en la URL, en vez de dejarlo pegado).
    const read = () => {
      const qs = new URLSearchParams(location.search);
      for (const key in defaults) {
        if (isArr(key)) store.signals[key].set(qs.has(key) ? qs.getAll(key) : defaults[key]);
        else store.signals[key].set(qs.has(key) ? cast(key, qs.get(key)) : defaults[key]);
      }
    };

    // store → URL.
    const write = () => {
      const qs = new URLSearchParams(location.search);
      for (const key in defaults) {
        const value = store.signals[key].get();
        if (isArr(key)) {
          qs.delete(key);
          if (Array.isArray(value)) for (const v of value) qs.append(key, v);
        } else if (value === defaults[key] || value === '' || value == null || value === false) {
          qs.delete(key);
        } else {
          qs.set(key, value);
        }
      }
      const search = qs.toString();
      const next = location.pathname + (search ? '?' + search : '') + location.hash;
      if (next !== location.pathname + location.search + location.hash) {
        history.replaceState(history.state, '', next);
      }
    };

    read();
    // FIX CORE-8a: an invalid value in the URL (`?pagina=abc`) falls back to its default
    // in the store (see `cast`, above) but was still sitting in the address bar verbatim
    // — this `write()` folds it back in immediately, the same way any at-default key
    // already gets dropped, instead of leaving a stale/bogus param until the next filter
    // change happens to touch it.
    write();

    // FIX PERF-5: N keys changed in the same tick (one "apply filters" click setting
    // q/orden/pagina at once) used to `replaceState` N times — coalesced into a single
    // microtask write with the final values, same rationale as `resource`, above.
    let queuedWrite = false;
    const scheduleWrite = () => { if (!queuedWrite) { queuedWrite = true; queueMicrotask(() => { queuedWrite = false; write(); }); } };
    let primed = false;   // subscribe es eager: la primera llamada no es un cambio real
    for (const key in defaults) store.signals[key].subscribe(() => { if (primed) scheduleWrite(); }, signal);
    primed = true;

    // FIX ROUTER-2/CORE-7 (bug #2): 'popstate' solo dispara con atrás/adelante — un
    // `router.navigate(...)` programático (pushState/replaceState) nunca lo emite, así
    // que sin `homly:navigate` esta URL quedaba desincronizada del store hasta el próximo
    // back/forward. HomlyRouter.navigate() emite ese evento después de tocar la URL.
    addEventListener('popstate', read);
    addEventListener('homly:navigate', read);
    signal?.addEventListener('abort', () => {
      removeEventListener('popstate', read);
      removeEventListener('homly:navigate', read);
    }, { once: true });
  }

  /**
   * SSR: read the seed left by the server in `<script type="application/json"
   * data-homly-state>`, a direct child of `host`, and overlay it onto `defaults` — the
   * initial state a component would otherwise use — so the client's first paint reuses
   * the server's data instead of re-fetching it. Only keys already present in
   * `defaults` are overlaid: the island can't sneak in a store key the component never
   * declared. Call it while building `store`: `Homly.createStore(Homly.initial(this, {…}))`.
   * With no island, or one that fails to parse, `defaults` comes back untouched.
   *
   * @param {Element} host - The component; the island must be its direct child.
   * @param {Object<string, *>} defaults - The state the component would start with.
   * @returns {Object<string, *>} `defaults`, overlaid with any matching seeded values.
   */
  static initial(host, defaults = {}) {
    const island = host.querySelector(':scope > script[data-homly-state]');
    if (!island) return defaults;
    let seeded;
    try { seeded = JSON.parse(island.textContent); } catch { return defaults; }
    if (!seeded || typeof seeded !== 'object') return defaults;
    const merged = { ...defaults };
    for (const key in defaults) {
      if (Object.hasOwn(seeded, key)) merged[key] = seeded[key];
    }
    return merged;
  }

  /**
   * Set the document title and `<meta>` tags, creating each tag the first time and
   * updating it afterwards (so calling this on every navigation never duplicates them).
   * A key with an empty or null value removes its tag.
   *
   * ⚠️ **This is not an SEO feature.** Social scrapers (WhatsApp, Twitter, Slack) don't
   * run JavaScript, so a tag written here after hydration doesn't exist for them. For
   * link previews and indexing, the tags have to be in the HTML the server sends — which
   * is what the router's prerender adoption is for. What this *does* fix is the browser
   * tab and the history entry saying the right thing while you move around the SPA.
   *
   * Three keys get their own tag instead of a `<meta>`: `title` (as before),
   * `canonical` (a `<link rel="canonical">`) and `jsonld` (an object, serialized into a
   * `<script type="application/ld+json">`). Every other key becomes a `<meta>`, written
   * as `property` for the Open Graph-style prefixes (`og:`, `article:`, `product:`,
   * `profile:`, `fb:`) and as `name` otherwise, matching what those specs expect.
   *
   * FIX HEAD-1: the key is run through `CSS.escape` before it goes into the selector
   * that finds an existing tag, so one with a stray `"` can't break out of it.
   *
   * @param {Object<string, ?string>} tags - `title`/`canonical`/`jsonld` as above; every
   *   other key becomes a `<meta>`, e.g. `{ title, description, 'og:image' }`.
   */
  static head(tags) {
    for (const key in tags) {
      const value = tags[key];

      if (key === 'title') {
        if (value != null) document.title = value;
        continue;
      }
      // FIX ROUTER-21: canonical and JSON-LD get their own tag, not a <meta>.
      if (key === 'canonical' || key === 'jsonld') {
        const isCanon = key === 'canonical';
        let el = document.head.querySelector(isCanon ? 'link[rel="canonical"]' : 'script[data-homly-head="jsonld"]');
        if (value == null || value === '') { el?.remove(); continue; }
        if (!el) {
          el = document.createElement(isCanon ? 'link' : 'script');
          if (isCanon) el.rel = 'canonical';
          else { el.type = 'application/ld+json'; el.setAttribute('data-homly-head', 'jsonld'); }
          document.head.appendChild(el);
        }
        el[isCanon ? 'href' : 'textContent'] = isCanon ? value : JSON.stringify(value);
        continue;
      }

      const attr = /^(og|article|product|profile|fb):/.test(key) ? 'property' : 'name';
      let tag = document.head.querySelector('meta[' + attr + '="' + CSS.escape(key) + '"]');

      if (value == null || value === '') {
        tag?.remove();
        continue;
      }
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', value);
    }
  }

  /** Attributes whose value is a URL: writing one unfiltered is the sink of BIND-1/CORE-16. */
  static _URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);

  /** Schemes `data-bind-attr` accepts in a URL attribute (plus a scheme-less relative path). */
  static _SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

  /**
   * Whether `data-bind-attr` may write `val` into `attr`. Additive, no dependencies: a
   * plain denylist (`on*`, `srcdoc`) plus a scheme allowlist for URL attributes.
   *
   * - `on*` and `srcdoc` are refused outright: both turn data into code, and no legitimate
   *   use of `data-bind-attr` needs them (an event handler is wired with `actions`, not a
   *   bound attribute).
   * - A URL attribute (`href`, `src`, `action`, `formaction`, `poster`, `xlink:href`) is
   *   resolved against the document and only let through with `http:`, `https:`, `mailto:`,
   *   `tel:` or a scheme-less relative path (`/casa/42`, `img/x.png` — those resolve to the
   *   page's own scheme, so they pass too). `data:image/…` is allowed only in `src`, where
   *   it can render a picture but never run.
   * - Every other attribute (`class`, `aria-*`, `data-*`, …) is unrestricted, same as before.
   *
   * @param {string} attr - Attribute name from `data-bind-attr="attr:key"`.
   * @param {*} val - Value about to be written.
   * @returns {boolean}
   */
  static _attrAllowed(attr, val) {
    if (/^on/i.test(attr) || attr === 'srcdoc') return false;
    if (!Homly._URL_ATTRS.has(attr)) return true;
    const str = String(val);
    if (attr === 'src' && /^data:image\//i.test(str)) return true;
    try {
      return Homly._SAFE_SCHEMES.has(new URL(str, document.baseURI).protocol);
    } catch {
      return false;   // ni un esquema seguro ni algo que el navegador pueda resolver
    }
  }

  /**
   * Install `css` once for `tag` (a component's `localName`, or `'*'` for the shared
   * base rules) — FIX CSP-1: a `CSSStyleSheet` built and `adoptedStyleSheets`-attached
   * from script is not an inline style resource, so it works under a CSP as strict as
   * `style-src 'self'` with no nonce/hash. Falls back to a single `<style
   * data-homly-scope="tag">` in `<head>` (one per tag, not per instance) when
   * constructable stylesheets aren't available — that fallback DOES need `style-src
   * 'unsafe-inline'` or `Homly.styleNonce` matching a nonce in the CSP.
   *
   * @param {string} tag - Component tag, or `'*'` for the shared rules.
   * @param {string} css - Already-scoped CSS text.
   */
  static _installSheet(tag, css) {
    if (typeof CSSStyleSheet !== 'undefined' && document.adoptedStyleSheets) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        return;
      } catch { /* algún navegador viejo con el constructor pero sin replaceSync */ }
    }
    if (document.head.querySelector('style[data-homly-scope="' + tag + '"]')) return;
    const el = document.createElement('style');
    el.setAttribute('data-homly-scope', tag);
    if (Homly.styleNonce) el.nonce = Homly.styleNonce;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /** Install the page-wide `[hidden]`/error rules exactly once (any styleMode). */
  static _ensureBaseStyle() {
    if (Homly._stylesInstalled.has('*')) return;
    Homly._stylesInstalled.add('*');
    Homly._installSheet('*', Homly._BASE_CSS);
  }

  /**
   * Find the `data-for` row a node belongs to: the nearest ancestor (the node itself
   * included) that {@link Homly.bindList} registered. Nearest wins, so a click inside a
   * nested list resolves to the inner row, not the outer one.
   *
   * @param {HTMLElement} el - Node the event came from.
   * @returns {?Object} The row's store, or undefined when the node isn't inside a list.
   */
  static _itemFor(el) {
    for (let node = el; node; node = node.parentElement) {
      const item = Homly.listItems.get(node);
      if (item) return item;
    }
  }

  /**
   * Current dev-logging level, read live from `globalThis.HOM_DEBUG`.
   * Returns null (off), 'basic' or 'verbose'. Off returns immediately, so guarding
   * a call-site with `if (Homly._level())` costs ~nothing when logging is disabled.
   * @returns {null | 'basic' | 'verbose'}
   */
  static _level() {
    const v = globalThis.HOM_DEBUG;
    if (!v) return null;
    return v === 'verbose' ? 'verbose' : 'basic';
  }

  /** Dev log line: `[homly] <glyph> <msg>`. Call guarded by `_level()`. */
  static _log(glyph, msg) { console.log('[homly] ' + glyph + ' ' + msg); }

  /** Dev warning: `[homly] ⚠ <msg>`. Call guarded by `_level()`. */
  static _warn(msg) { console.warn('[homly] ⚠ ' + msg); }

  /** Signal/computed keys whose value never gets printed, even in verbose mode. */
  static _SENSITIVE_KEY = /pass|token|secret/i;

  /**
   * Compact value formatter for verbose logs (avoids dumping big objects).
   *
   * FIX DEBUG-1: verbose logs every signal change with its value — useful for
   * debugging, dangerous for a `password` field. `key` is the signal/computed name;
   * when it looks sensitive the value is redacted instead of printed, whatever it is.
   *
   * @param {string} key - Store key the value belongs to (e.g. `'password'`).
   * @param {*} v - The value to format.
   */
  static _fmt(key, v) {
    if (Homly._SENSITIVE_KEY.test(key)) return '«redactado»';
    if (Array.isArray(v)) return '[' + v.length + ']';
    if (v && typeof v === 'object') return '{…}';
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  }

  /**
   * Parse a `data-action` value into its event, optional key modifier and action name.
   * `"guardar"` (no arrow) is shorthand for `"click->guardar"`, so every 1.9 template
   * keeps working unchanged. `"keydown.enter->enviar"` only matches that one key.
   *
   * @param {string} raw - The attribute's raw value.
   * @returns {{ event: string, mod: ?string, name: string }}
   */
  static _parseAction(raw) {
    const m = /^(?:([a-zA-Z]+)(?:\.([\w-]+))?->)?(.+)$/.exec(raw.trim());
    return { event: (m[1] || 'click').toLowerCase(), mod: m[2] ? m[2].toLowerCase() : null, name: m[3] };
  }

  /**
   * Attach a single delegated listener (per {@link Homly._DISPATCH_EVENTS} event type)
   * that maps `data-action="evento->nombre"` to a handler in `actions`. `evento->` is
   * optional and defaults to `click`; `keydown.tecla->nombre` only fires for that key.
   * The listeners are removed when `context.signal` aborts.
   *
   * FIX DISPATCH-1: when the event bubbles through more than one component's own
   * dispatcher (a ♥ button inside a card inside a page, both with a `guardar` action),
   * only the INNERMOST one — whichever's listener the browser reaches first, since
   * it's the nearer ancestor — runs; a shared `WeakSet` keyed by the `Event` itself
   * marks it handled so an outer dispatcher steps aside.
   *
   * A matched action gets `e.preventDefault()` UNLESS the element carries
   * `data-action-default` (a form's own submit, a link's own navigation): this is what
   * lets `keydown.enter->guardar` on a text field, or `submit->guardar` on a `<form>`,
   * replace the page reload with the handler instead of racing it.
   *
   * The framework only shows the loading state (disable, `.is-loading`,
   * `data-loading-text`) when the handler returns a `Promise` — a synchronous handler
   * never flashes it. A handler that throws (sync or async) fires `homly:action-error`
   * on `container` instead of throwing into the browser's own event dispatch.
   *
   * When the event came from inside a `data-for` row, the row's store is added to the
   * context as `item`. A `submit` also gets `ctx.formData` (`new FormData(target)`).
   *
   * @param {HTMLElement} container - Element the listeners are attached to.
   * @param {Object<string, (target: HTMLElement, context: Object) => *>} actions - Handlers by action name.
   * @param {{ signal?: AbortSignal, host?: HTMLElement }} [context] - Passed as the second argument to each handler.
   */
  static attachDispatcher(container, actions, context = {}) {
    const handler = async (e) => {
      if (Homly._dispatched.has(e)) return;   // ya lo atendió un host más interno
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const parsed = Homly._parseAction(target.getAttribute('data-action'));
      if (parsed.event !== e.type || (parsed.mod && e.key?.toLowerCase() !== parsed.mod)) return;
      // FIX CORE-20/PROTO-1: `Object.hasOwn` — `actions` is normally a plain object
      // literal, so `actions['constructor']` used to resolve to `Object` (via the
      // prototype chain) instead of `undefined`, and `data-action="constructor"` would
      // call it as if it were a real handler.
      if (!Object.hasOwn(actions, parsed.name)) return;
      Homly._dispatched.add(e);
      if (!target.hasAttribute('data-action-default')) e.preventDefault();
      // FIX CORE-25a: a target already mid-action ignores a second trigger instead of
      // running the handler again concurrently — three fast clicks on an async action
      // (double-submit on a slow network) used to fire it three times in parallel.
      if (target.classList.contains('is-loading')) return;

      const item = Homly._itemFor(target);
      const ctx = { ...context, event: e };
      if (item) ctx.item = item;
      if (e.type === 'submit') ctx.formData = new FormData(target);

      const onError = (err) => {
        container.dispatchEvent(new CustomEvent('homly:action-error',
          { bubbles: true, detail: { name: parsed.name, error: err } }));
      };

      let result;
      try {
        result = actions[parsed.name](target, ctx);
      } catch (err) { onError(err); return; }
      // FIX DISPATCH-1/P9: the loading UI (disable, is-loading, loading text) only
      // applies to an ASYNC action — a synchronous handler is done by the time we'd
      // even show it.
      if (!(result instanceof Promise)) return;

      const loadingText = target.getAttribute('data-loading-text');
      // FIX CORE-17: save/restore actual child NODES, not just text — `textContent =`
      // used to also erase a target's icon (`<svg>` + `<span>`), leaving it gone for
      // good once the label was restored as plain text.
      const originalNodes = loadingText !== null ? [...target.childNodes] : null;
      const isControl = target.tagName === 'BUTTON' || target.tagName === 'INPUT';

      if (loadingText !== null) target.replaceChildren(document.createTextNode(loadingText));
      if (isControl) target.disabled = true;
      target.classList.add('is-loading');

      try {
        await result;
      } catch (err) {
        onError(err);
      } finally {
        if (isControl) target.disabled = false;
        target.classList.remove('is-loading');
        // Restaurar solo si la acción no cambió el contenido ella misma.
        if (loadingText !== null && target.textContent === loadingText) {
          target.replaceChildren(...originalNodes);
        }
      }
    };
    for (const type of Homly._DISPATCH_EVENTS) container.addEventListener(type, handler);
    if (context.signal) {
      context.signal.addEventListener('abort', () => {
        for (const type of Homly._DISPATCH_EVENTS) container.removeEventListener(type, handler);
      }, { once: true });
    }
  }
}

// Seed HOM_DEBUG once at load from the URL (?homly-debug[=verbose]) or localStorage
// (HOM_DEBUG), unless it's already set on the global (an inline script wins). Priming
// it here lets the very first hydration see the flag; everything else reads it live
// via Homly._level().
(() => {
  if (globalThis.HOM_DEBUG !== undefined) return;
  let raw;
  let fromUrl = false;
  try {
    const qs = new URLSearchParams(globalThis.location?.search || '');
    if (qs.has('homly-debug')) { raw = qs.get('homly-debug') || 'true'; fromUrl = true; }
    else raw = globalThis.localStorage?.getItem('HOM_DEBUG') ?? undefined;
  } catch (_) { /* sandboxed / no DOM: stay off */ }
  if (raw == null) return;
  const v = String(raw).toLowerCase();
  // FIX DEBUG-1: verbose loguea el valor de cada señal (contraseñas incluidas), así que
  // un enlace compartido no puede prenderlo — solo HOM_DEBUG global o localStorage. Por
  // URL, como mucho llega el nivel 'basic' (sin valores).
  if (v === 'verbose') globalThis.HOM_DEBUG = fromUrl ? true : 'verbose';
  else if (v === 'false' || v === '0' || v === '') { /* explicit off */ }
  else globalThis.HOM_DEBUG = true;
})();

/**
 * Base class for Homly components. Extend it and override the getters
 * (`templateUrl`, `styleUrl`/`styles`, `basePath`, `store`, `actions`) and the
 * lifecycle hooks (`onMount`, `onUnmount`).
 *
 * On connect it performs "smart hydration": if the element already has content
 * (e.g. server-rendered), it is kept; otherwise the template is loaded. Scoped
 * CSS is injected only once (marked with `data-homly-scope`), and the DOM is
 * then wired to the store and the action dispatcher.
 *
 * @extends HTMLElement
 */
export class HomlyComponent extends HTMLElement {
  constructor() {
    super();
    this._arm();
  }

  /**
   * (Re)arm the teardown controller. Called from the constructor and, on a real
   * remount (see `connectedCallback`), whenever the previous controller is already
   * aborted — an aborted `AbortSignal` never fires 'abort' again, so reusing it would
   * leak every subscription/listener this mount creates. FIX CORE-1/ROUTER-1.
   */
  _arm() {
    this.controller = new AbortController();
    /** @type {AbortSignal} Aborted on disconnect; tears down bindings and listeners. */
    this.signal = this.controller.signal;
    /** @type {Promise<void>} Resolves once this mount finishes hydrating (or fails). */
    this.ready = new Promise((res) => { this._readyResolve = res; });
  }

  /**
   * `Element.moveBefore()` (Chrome 133+) moves a node without disconnecting it —
   * defining this callback (even empty) opts the element into that: the browser calls
   * it instead of `disconnectedCallback`+`connectedCallback`, so a reorder never touches
   * this component's lifecycle at all. Without `moveBefore` (older browsers, or a plain
   * `insertBefore`/`appendChild` move), the guards below in `connectedCallback` and the
   * deferred teardown in `disconnectedCallback` cover the same case. FIX CORE-1/ROUTER-1.
   */
  connectedMoveCallback() {}

  /**
   * Lifecycle hook. Wraps hydration in an error boundary: if anything throws
   * (e.g. a template fails to load over the network), it logs the error and
   * renders a placeholder instead of leaving the component's DOM broken.
   *
   * FIX CORE-1/ROUTER-1: moving an already-mounted element (`insertBefore`/`appendChild`
   * of a node that's already connected) fires `disconnectedCallback` then
   * `connectedCallback` synchronously, in the same reordering call — before the deferred
   * teardown below even runs. The `_mounted`/`_hydrating` guard makes that a no-op instead
   * of a full re-hydration (which would re-subscribe every binding on top of the old ones).
   * A *real* remount (the element was actually gone and comes back later) is the case
   * where `this.signal` is still aborted here — that's when `_arm()` runs again.
   * @returns {Promise<void>}
   */
  async connectedCallback() {
    if (this._mounted || this._hydrating) return;
    if (this.signal.aborted) this._arm();
    this._hydrating = true;
    try {
      await this._hydrate();
      this._mounted = !this.signal.aborted;
    } catch (err) {
      console.error(`[homly] fallo montando <${this.localName}>`, err);
      this.renderError(err);
      this._readyResolve();   // así `await el.ready` no cuelga para siempre tras un fallo
    } finally {
      this._hydrating = false;
    }
  }

  /**
   * Load/hydrate the template and scoped CSS, then wire reactivity. Called by
   * `connectedCallback` inside an error boundary.
   * @returns {Promise<void>}
   */
  async _hydrate() {
    const _t0 = performance.now();
    // Captured up front: if this exact mount gets torn down while awaiting below, THIS
    // signal aborts — even if `_arm()` later hands `this.signal` a fresh one for a new
    // mount. Checking the captured value (not `this.signal`) is what makes the guard
    // correct across that re-arm. FIX CORE-11/ROUTER-6.
    const signal = this.signal;
    const resolve = (path) => (this.basePath ? new URL(path, this.basePath).href : path);

    // Smart hydration: only fetch the HTML if the element is empty; if it already
    // has content (pre-render / SSR), leave it untouched. The scoped CSS is added
    // unless the content already shipped its own <style data-homly-scope>.
    // FIX SSR-1(e): `data-homly-ssr` overrides the `children.length` heuristic — the
    // server is stating it directly, so a host that ends up empty for some other reason
    // (a filtered-out list, a conditionally-empty template) is still never refetched.
    const needsTemplate = !this.hasAttribute('data-homly-ssr')
      && this.children.length === 0 && (this.templateUrl || this.template);
    // FIX CSP-1/PERF-11: the default ('shared') mode installs ONE stylesheet per
    // component CLASS (see `Homly._installSheet`, below) — a tag already installed
    // needs no fetch/build at all, regardless of how many instances mount. `styleMode
    // = 'inline'` opts back into 1.9's one-`<style>`-per-INSTANCE behaviour.
    const needsStyle = Homly.styleMode === 'inline'
      ? !this.querySelector(':scope > style[data-homly-scope]') && (this.styleUrl || this.styles)
      : !Homly._stylesInstalled.has(this.localName) && (this.styleUrl || this.styles);

    // Fetch HTML and CSS up front (in parallel) so we can apply both in a single
    // synchronous step. If we set innerHTML and then `await` the stylesheet, the
    // browser may paint the unstyled HTML in between — a flash of unstyled content
    // (e.g. a position:fixed modal showing for a frame). Awaiting both first and
    // applying them with no await in between guarantees the first paint is styled.
    const [tplText, cssFile] = await Promise.all([
      needsTemplate && this.templateUrl ? Homly.loadTemplate(resolve(this.templateUrl)) : Promise.resolve(null),
      needsStyle && this.styleUrl ? Homly.loadTemplate(resolve(this.styleUrl)) : Promise.resolve(null),
    ]);
    // FIX CORE-11/ROUTER-6: se sacó del DOM (o abortó por otra vía) mientras esto bajaba.
    // Sin este guard, onMount, el store y los bindings correrían igual sobre un nodo
    // desconectado, y quedarían timers/suscripciones vivos para siempre.
    if (signal.aborted || !this.isConnected) return;

    // innerHTML replaces children, so set it first and then prepend the <style>.
    if (needsTemplate) {
      this.innerHTML = this.templateUrl ? tplText : this.template();
    }
    if (needsStyle) {
      const cssText = this.styleUrl ? cssFile : this.styles;
      if (cssText) {
        // FIX ROUTER-8: sin soporte de @scope (CSSScopeRule ausente), envolver con el tag
        // como selector (CSS nesting, más compatible) en vez de dejar el CSS sin escopar.
        const supportsScope = typeof CSSScopeRule !== 'undefined';
        if (Homly.styleMode === 'inline') {
          const styleBlock = document.createElement('style');
          styleBlock.setAttribute('data-homly-scope', '');
          if (Homly.styleNonce) styleBlock.nonce = Homly.styleNonce;
          styleBlock.textContent = supportsScope ? `@scope {\n${cssText}\n}` : `${this.localName} {\n${cssText}\n}`;
          this.prepend(styleBlock);
        } else {
          Homly._stylesInstalled.add(this.localName);
          Homly._installSheet(this.localName,
            supportsScope ? `@scope (${this.localName}) {\n${cssText}\n}` : `${this.localName} {\n${cssText}\n}`);
        }
      }
    }
    Homly._ensureBaseStyle();

    if (Homly._level()) {
      const _s = this.store;
      if (_s !== undefined && _s !== this.store) {
        Homly._warn('[homly H601] ' + this.localName + ': store no memoizado (devuelve una instancia nueva por acceso) — usa get store(){ return this._store ??= … }');
      }
    }

    // Wire the DOM to reactivity: shared (global) stores first, then the local store.
    if (this.globalStores) {
      this.globalStores.forEach(gStore => Homly.bindView(this, gStore, this.signal));
    }
    if (this.store) Homly.bindView(this, this.store, this.signal);
    if (this.actions) Homly.attachDispatcher(this, this.actions, { signal: this.signal, host: this });
    if (this.store) Homly.bindList(this, this.store, this.signal);
    if (this.onMount) this.onMount();
    // First activation, after the template has rendered. Under a keep-alive router
    // `onMount` runs once but `onActivate` runs again every time the element is
    // shown back; here we fire the first one (re-activations come from the router).
    if (this.onActivate) this.onActivate();
    // Idea #8 (islands): a loader waiting to hydrate a region, or a test, can listen for
    // this instead of polling `children.length`; `await el.ready` is the promise form.
    this.dispatchEvent(new CustomEvent('homly:hydrated', { bubbles: true }));
    this._readyResolve();
    if (Homly._level()) Homly._log('⬆', this.localName + ' hydrated in ' + (performance.now() - _t0).toFixed(1) + 'ms');
  }

  /**
   * Lifecycle hook: abort all subscriptions/listeners and call `onUnmount` if defined.
   *
   * FIX CORE-1/ROUTER-1: teardown is deferred to a microtask. `insertBefore`/`appendChild`
   * on a node that's already connected fires `disconnectedCallback` then
   * `connectedCallback` synchronously, in that same call — a *move*, not a real removal.
   * By the time this microtask runs, a moved element is connected again (`connectedCallback`
   * already saw `_mounted` still true and returned early, so it never re-hydrated); a
   * removed one is not, and only then does teardown actually happen.
   */
  disconnectedCallback() {
    queueMicrotask(() => {
      if (this.isConnected || this.signal.aborted) return;
      const wasMounted = this._mounted;
      this._mounted = false;
      this.controller.abort();
      if (Homly._level()) Homly._log('✕', this.localName + ' unmount');
      if (wasMounted && this.onUnmount) this.onUnmount();
    });
  }

  /**
   * Render a fallback when hydration fails (the error boundary). Override this in a
   * subclass to customise the markup, or just set `Homly.messages.loadError` for the
   * text. FIX CSP-1: no inline `style=` — the placeholder's rules live in the shared
   * base stylesheet ({@link Homly._BASE_CSS}), same as everything else in 1.10+.
   * @param {Error} err - The error thrown during hydration.
   */
  renderError(err) {
    Homly._ensureBaseStyle();
    this.replaceChildren();
    const div = document.createElement('div');
    div.setAttribute('data-homly-error', '');
    div.setAttribute('role', 'alert');
    div.textContent = Homly.messages.loadError;
    this.appendChild(div);
  }

  /** @returns {?string} URL of the HTML template, resolved against `basePath` when set. */
  get templateUrl() { return null; }
  /** @returns {?string} URL of a CSS file; injected scoped with `@scope`. */
  get styleUrl() { return null; }
  /** @returns {?string} Inline CSS string (alternative to `styleUrl`). */
  get styles() { return null; }
  /** @returns {?string} Base URL for resolving relative paths (usually `import.meta.url`). */
  get basePath() { return null; }
  /** @returns {?(() => string)} Function returning an HTML string (alternative to `templateUrl`). */
  get template() { return null; }
  /** @returns {?{ state: Object, signals: Object }} The component's reactive store. */
  get store() { return null; }
  /** @returns {?Object<string, Function>} Map of action names to handlers. */
  get actions() { return null; }
  /** @returns {?Array<{ state: Object, signals: Object }>} Shared stores bound in addition to `store`. */
  get globalStores() { return null; }

  // Optional lifecycle hooks (define them as methods on your subclass):
  //   onMount()      — once, after the template renders.
  //   onActivate()   — when the element becomes visible (first mount + every time
  //                    a keep-alive router shows it again).
  //   onDeactivate() — when a keep-alive router hides it (navigating away).
  //   onUnmount()    — when the element is removed from the DOM.
}

/**
 * Minimal SPA router. It swaps the content of a root element on navigation,
 * intercepts `<a data-router-link>` clicks, and supports per-route lazy loading
 * (code splitting).
 *
 * Routes can carry `:param` segments (`/blog/:slug`). Static routes always win over
 * dynamic ones, and each matched param is handed to the component as an attribute
 * (`<blog-post slug="hola-mundo">`) — no new API to learn, just `this.getAttribute()`.
 *
 * With `{ keepAlive: true }` each visited route's element is kept mounted and
 * toggled with `display` instead of being destroyed: returning to a route is
 * instant, with its DOM, state and scroll preserved. The router calls the
 * component's `onActivate`/`onDeactivate` hooks on show/hide; use `evict(path)`
 * to drop a cached route (which fires its `onUnmount`).
 */
export class HomlyRouter {
  /**
   * @param {string} rootId - id of the element whose content is swapped per route.
   * @param {{ keepAlive?: boolean }} [opts] - keepAlive preserves each visited route's element.
   */
  constructor(rootId, { keepAlive = false } = {}) {
    this.root = document.getElementById(rootId);
    /** @type {Object<string, { tag: string, loader: ?Function }>} */
    this.routes = {};
    this.keepAlive = keepAlive;
    /** @type {Map<string, { el: HTMLElement, scrollY: number }>} */
    this.alive = new Map();
    /** @type {Set<Object>} Routes already prefetched, so a hover only downloads once. */
    this.prefetched = new Set();
    this.current = null;
    /** @type {number} Bumped on every navigation; guards a slow loader landing late. */
    this._nav = 0;
    // FIX ROUTER-9/ROUTER-19: fallar aquí, con un mensaje claro, en vez de que cada método
    // reviente más tarde con un "Cannot read properties of null" críptico.
    if (!this.root) throw new Error('HomlyRouter: no existe ningún elemento con id="' + rootId + '"');

    window.addEventListener('popstate', () => this.handleRoute(window.location.pathname));

    document.body.addEventListener('click', e => {
      const link = e.target.closest('a[data-router-link]');
      // FIX ROUTER-7a: un listener propio (confirm(), analytics con su propio destino…)
      // ya decidió que este click no navega — el router no debe pisarlo.
      if (!link || e.defaultPrevented || !HomlyRouter._handles(e, link)) return;
      e.preventDefault();
      // FIX ROUTER-2/CORE-7: `link.href` (resuelto por el navegador, respeta <base> y
      // rutas relativas) en vez del atributo crudo.
      this.navigate(link.href);
    });

    // Prefetch on hover (and on focus, so tabbing gets the same head start): by the
    // time the click lands, the route's chunk is usually already there. One delegated
    // listener each, not one per link — links come and go with every navigation.
    for (const type of ['pointerover', 'focusin']) {
      document.body.addEventListener(type, e => {
        const link = e.target.closest?.('a[data-router-link]');
        if (link && link.origin === location.origin) this.prefetch(link.pathname);
      });
    }
  }

  /**
   * Whether the router should take over this click, or step aside and let the browser
   * navigate on its own.
   *
   * It steps aside for:
   *  - **Another origin.** `pushState` to a different origin throws a SecurityError, so a
   *    shared nav that points at sibling sites has to fall through to a real navigation.
   *  - **`target` or `download`.** The author already said where this should open.
   *  - **A modified or non-primary click.** ⌘/Ctrl/Shift-click and middle-click mean
   *    "new tab/window", and swallowing them is the fastest way to feel broken.
   *
   * @param {MouseEvent} e - The click.
   * @param {HTMLAnchorElement} link - The `a[data-router-link]` that was hit.
   * @returns {boolean}
   */
  static _handles(e, link) {
    return link.origin === location.origin
      && !link.hasAttribute('target')
      && !link.hasAttribute('download')
      && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
      && (e.button ?? 0) === 0;
  }

  /**
   * Run a route's lazy loader ahead of time. Called on hover/focus, and safe to call by
   * hand for a route you know is coming next.
   *
   * Each route is prefetched at most once; templates and CSS are already deduped by
   * {@link Homly.loadTemplate}. A prefetch that fails is swallowed on purpose — it is
   * best-effort, and navigating there for real runs the loader again.
   *
   * @param {string} path - Path to warm up.
   */
  prefetch(path) {
    const { route } = this._resolve(path);
    if (!route.loader || this.prefetched.has(route)) return;

    this.prefetched.add(route);
    if (Homly._level()) Homly._log('⇢', 'prefetch ' + path);
    Promise.resolve(route.loader()).catch(() => {});
  }

  /**
   * Register a route. The path may contain `:param` segments (`/blog/:slug`), whose
   * values are passed to the component as attributes.
   *
   * @param {string} path - URL path (e.g. `/contact`, `/blog/:slug`).
   * @param {string} componentTag - Custom element tag to render (e.g. `homly-contact-page`).
   * @param {?(() => Promise<*>)} [loader] - Optional dynamic import run before render (code splitting).
   */
  add(path, componentTag, loader = null) {
    // HTML lowercases attribute names, so `:userId` would only be readable as
    // getAttribute('userid') — a silent miss. Warn once, at registration.
    if (Homly._level() && /:[^/]*[A-Z]/.test(path)) {
      Homly._warn('[homly H701] ruta "' + path + '": los params con mayúsculas se leen en minúscula '
        + "(getAttribute('userid'), no 'userId') — usa kebab-case");
    }
    // FIX ROUTER-4/ROUTER-12: registrar ya normalizado, para matchear igual sin importar
    // si quien navega escribió la barra final o no.
    this.routes[HomlyRouter._normalize(path)] = { tag: componentTag, loader };
  }

  /**
   * Match a path against a route pattern with `:param` segments. Pure and DOM-free
   * on purpose, so the matching rules can be unit-tested outside a browser.
   *
   * Segment counts must be equal, so `/blog/:slug` matches `/blog/hola` but neither
   * `/blog` nor `/blog/a/b`. An empty segment (`/blog/`) does not match either.
   *
   * @param {string} pattern - e.g. `/blog/:slug`.
   * @param {string} path - e.g. `/blog/hola-mundo`.
   * @returns {?Object<string, string>} Decoded params, or null when it doesn't match.
   */
  static matchRoute(pattern, path) {
    const pat = pattern.split('/');
    const seg = path.split('/');
    if (pat.length !== seg.length) return null;

    const params = {};
    for (let i = 0; i < pat.length; i++) {
      if (pat[i][0] === ':') {
        if (!seg[i]) return null;                        // `/blog/` no es un slug válido
        let value;
        // FIX ROUTER-4/ROUTE-1: un '%' suelto (no parte de un %XX válido) hace que
        // decodeURIComponent lance — sin el try, esa URL rompía toda la navegación en
        // vez de simplemente no matchear (y caer al 404, como cualquier otra ruta rara).
        try { value = decodeURIComponent(seg[i]); } catch { return null; }
        if (value.includes('/')) return null;             // un '%2F' decodificado no cuela un segmento extra
        params[pat[i].slice(1)] = value;
      } else if (pat[i] !== seg[i]) {
        return null;
      }
    }
    return params;
  }

  /**
   * Normalize a path the same way on both sides of matching: a trailing slash
   * (`/blog/` → `/blog`) and a literal `/index.html` suffix (`/blog/index.html` → `/blog`)
   * are the same route as the bare path. The root `/` is left alone. FIX ROUTER-4/ROUTER-12.
   * @param {string} path
   * @returns {string}
   */
  static _normalize(path) {
    let p = path.replace(/\/index\.html$/, '') || '/';
    if (p.length > 1) p = p.replace(/\/+$/, '') || '/';
    return p;
  }

  /**
   * Resolve a path: exact match first (so a static route always beats a dynamic one),
   * then the registered `:param` patterns in declaration order, then `/404`.
   *
   * @param {string} path
   * @returns {{ route: { tag: string, loader: ?Function }, params: Object<string, string>, pattern: ?string }}
   */
  _resolve(rawPath) {
    // FIX ROUTER-4/ROUTER-12: normalizar también del lado de la búsqueda, para que
    // '/blog/' resuelva igual que '/blog' sin tener que registrar las dos.
    const path = HomlyRouter._normalize(rawPath);
    // FIX ROUTER-23: `Object.hasOwn` en vez de `this.routes[path]` — una ruta llamada
    // "constructor" o "toString" no debe leer del prototipo de Object y matchear cualquier cosa.
    if (Object.hasOwn(this.routes, path)) return { route: this.routes[path], params: {}, pattern: path };

    for (const pattern in this.routes) {
      if (!pattern.includes(':')) continue;
      const params = HomlyRouter.matchRoute(pattern, path);
      if (params) return { route: this.routes[pattern], params, pattern };
    }

    return { route: this.routes['/404'] || { tag: 'div', loader: null }, params: {}, pattern: null };
  }

  /**
   * Build the route's element with its params as attributes. `setAttribute` never
   * parses HTML, so a path segment can't inject markup the way an interpolated
   * `innerHTML` string could.
   *
   * @param {string} tag
   * @param {Object<string, string>} params
   * @returns {HTMLElement}
   */
  static _create(tag, params) {
    const el = document.createElement(tag);
    for (const key in params) el.setAttribute(key, params[key]);
    return el;
  }

  /**
   * Navigate to a path with `pushState` (no full reload).
   *
   * FIX ROUTER-2/CORE-7 (bug #2): `to` is resolved with `new URL(to, location.href)`, so a
   * relative path (`'nuevo'`, `'../otro'`), a full absolute one and a bare `'#ancla'` all
   * land on the URL a browser would actually build — the previous version pushed whatever
   * string it got, verbatim, so a relative link ended up as a broken pathname.
   *
   * Navigating to the **exact same URL** (path, query and hash all unchanged — the classic
   * "double click on the link that's already open") uses `replaceState` instead of
   * `pushState`, so it doesn't pile up a dead entry in `history` that back/forward has to
   * step over.
   *
   * Dispatches `homly:navigate` on `window` after updating the URL, which
   * {@link Homly.bindQuery} listens for — without it, a filter bound to the query string
   * would only notice a `popstate` (back/forward), never a programmatic `navigate()`.
   *
   * @param {string} to - Path, relative reference or full URL.
   * @returns {Promise<void>}
   */
  navigate(to) {
    const url = new URL(to, location.href);
    const sameUrl = url.href === location.href;
    window.history[sameUrl ? 'replaceState' : 'pushState']({}, '', url.href);
    dispatchEvent(new Event('homly:navigate'));
    return this.handleRoute(url.pathname);
  }

  /**
   * Resolve a route: run its lazy loader (if any), then render its tag into root.
   * On the initial resolution, adopts a matching prerendered element already in
   * the outlet (hydrating it in place) instead of recreating it; locked to the
   * first call. Falls back to a `/404` route or an empty `<div>`.
   * @param {string} path
   * @returns {Promise<void>}
   */
  async handleRoute(rawPath) {
    // FIX ROUTER-4/ROUTER-12: normalizado desde aquí, así `_lastPath`, `this.current` y las
    // claves de `this.alive` son siempre la misma forma sin importar cómo llegó la URL.
    const path = HomlyRouter._normalize(rawPath);
    // In-page `#hash` links fire popstate with the *same* pathname. Re-rendering
    // and resetting scroll here would cancel the browser's native anchor scroll,
    // so bail when the resolved route hasn't changed (the first call always runs).
    if (this._lastPath === path) return;
    this._lastPath = path;
    // FIX ROUTER-3 (bug #3): token de esta navegación. Si una más nueva llega mientras
    // esta sigue esperando su loader, `nav !== this._nav` de más abajo la corta ahí: la
    // navegación vieja nunca pisa el resultado de la que ganó la carrera.
    const nav = ++this._nav;

    const { route, params, pattern } = this._resolve(path);
    if (Homly._level()) {
      Homly._log('⚡', 'route ' + (this.current ?? '∅') + ' → ' + path
        + (pattern && pattern !== path ? ' (' + pattern + ')' : ''));
    }
    if (route.loader) {
      try {
        await route.loader();
      } catch (err) {
        // FIX ROUTER-9/ROUTER-19: un chunk que falla no debe dejar la ruta "atascada" —
        // sin esto, `_lastPath` seguía apuntando ahí y el mismo link jamás volvía a
        // intentarlo (`if (this._lastPath === path) return;`, arriba, cortaba siempre).
        if (nav === this._nav) this._lastPath = null;
        console.error('[homly] no se pudo cargar la ruta ' + path, err);
        return;
      }
    }
    // FIX ROUTER-3 (bug #3): esta navegación quedó vieja mientras esperaba su loader.
    if (nav !== this._nav) return;

    // Adopt prerendered DOM on the initial route resolution: if the loader's
    // define() just upgraded an element already in the outlet (smart hydration
    // wired it), reuse it instead of wiping. Locked to the first call, and only if the
    // prerendered element's own params match the ones this navigation resolved — FIX
    // ROUTER-16: sin comparar los valores, una segunda navegación que gana la carrera de
    // arriba (mismo tag, otro :param) podía "adoptar" el nodo prerenderizado de la primera.
    const candidate = this.root.firstElementChild;
    const tagMatches = !this._hasHydrated && candidate && candidate.localName === route.tag;
    // The element was already upgraded (and onMount already ran) by the time we get here,
    // so a mismatched param can't be back-filled — prerendered markup has to carry them.
    const paramsMatch = tagMatches
      && Object.entries(params).every(([key, value]) => candidate.getAttribute(key) === value);
    const adopt = tagMatches && paramsMatch;
    this._hasHydrated = true;
    if (adopt && Homly._level()) Homly._log('⚓', 'adopt ' + route.tag);
    if (tagMatches && !paramsMatch && Homly._level()) {
      Homly._warn('[homly H702] adopt ' + route.tag + ': el HTML prerenderizado no tiene los mismos params '
        + 'que esta navegación — se recrea en vez de adoptarlo. Revisa que el prerender '
        + 'escriba cada :param como atributo.');
    }

    // Default: destroy and recreate (fires onUnmount → onMount on every navigation).
    if (!this.keepAlive) {
      if (adopt) return;                              // adopt: don't wipe, keep scroll
      this.root.replaceChildren(HomlyRouter._create(route.tag, params));
      window.scrollTo(0, 0);
      return;
    }

    // Keep-alive: hide the outgoing route (saving its scroll) and notify it.
    if (this.current && this.alive.has(this.current)) {
      const prev = this.alive.get(this.current);
      prev.scrollY = window.scrollY;
      prev.el.style.display = 'none';
      prev.el.onDeactivate?.();
      if (Homly._level()) Homly._log('⏸', prev.el.localName + ' deactivate');
    }

    // Show the incoming route: create it the first time, reuse it afterwards.
    let entry = this.alive.get(path);
    const isNew = !entry;
    if (Homly._level()) Homly._log(isNew ? '▷' : '▶', 'keep-alive ' + (isNew ? 'MISS' : 'HIT') + ' ' + path);
    if (isNew) {
      let el;
      if (adopt) {
        el = this.root.firstElementChild;             // adopt the prerendered element (already in the DOM)
      } else {
        el = HomlyRouter._create(route.tag, params);   // connectedCallback → onMount() → onActivate()
        this.root.appendChild(el);
      }
      entry = { el, scrollY: 0 };
      this.alive.set(path, entry);
    }
    entry.el.style.display = '';
    // Restore scroll on the next frame: scrolling synchronously right after the
    // display change clamps against a stale (not-yet-reflowed) document height.
    // On adoption we keep the entry scroll (deep-link / browser restore).
    if (!adopt) {
      const y = entry.scrollY;
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
    if (!isNew) entry.el.onActivate?.();               // re-activation (first one came from connectedCallback)
    if (!isNew && Homly._level()) Homly._log('▶', entry.el.localName + ' activate');
    this.current = path;
  }

  /**
   * Drop a cached keep-alive route, removing its element (fires its `onUnmount`).
   * Useful to bound memory (e.g. an LRU when there are many routes).
   * @param {string} path
   */
  evict(path) {
    const entry = this.alive.get(path);
    if (entry) {
      entry.el.remove();
      if (Homly._level()) Homly._log('✕', 'evict ' + path);
      this.alive.delete(path);
      if (this.current === path) this.current = null;
    }
  }

  /** Render the route matching the current `location.pathname`. */
  start() {
    this.handleRoute(window.location.pathname);
  }
}
