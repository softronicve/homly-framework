<?php

declare(strict_types=1);

namespace Homly;

/**
 * Server-side counterpart of homly.js's `data-*` directives — the SSR half of the
 * protocol in homly.js (Homly.initial / bindList adoption). No dependencies: PHP 8.4's
 * `Dom\HTMLDocument` only, no build step, no Node.
 *
 * Fills `data-bind` (text), `data-if` (the `hidden` attribute), `data-bind-attr` and
 * `data-bind-class` (one or several `attr:key`/`class:key` pairs, comma-separated,
 * exactly like the client), and `data-for` (each row gets `data-homly-key` so
 * `Homly.bindList` adopts it instead of re-rendering it). `data-model` is left alone —
 * it is a two-way binding, nothing to pre-render.
 *
 * Only these two calls are public API; everything else is an implementation detail.
 */
final class Render
{
    /** Attributes whose value is a URL — same allowlist as `Homly._URL_ATTRS` in homly.js. */
    private const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'];

    /** Schemes accepted in a URL attribute — same as `Homly._SAFE_SCHEMES`. */
    private const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

    /**
     * Render $html (a component's inner markup — the same string that would otherwise
     * be its `templateUrl`/`template()` body) against $state, and prepend the
     * `<script type="application/json" data-homly-state>` seed island that
     * `Homly.initial(host, defaults)` reads on the client, so hydration adopts this
     * exact output with zero refetch and zero mismatch.
     *
     * @param string $html Inner markup of the component (no host tag around it).
     * @param array<string, mixed> $state Values for the directives above; the same
     *   shape as the component's initial store state.
     * @param bool $seed Whether to prepend the state island (default true — set it to
     *   false when an ancestor already seeds the store, same as {@see fragment()}).
     * @return string The rendered inner markup, ready to place inside the host tag.
     */
    public static function template(string $html, array $state, bool $seed = true): string
    {
        $doc = self::parse($html);
        $root = $doc->getElementById('homly-root');
        self::bind($root, $state, $doc);

        if ($seed) {
            $script = $doc->createElement('script');
            $script->setAttribute('type', 'application/json');
            $script->setAttribute('data-homly-state', '');
            $script->textContent = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP);
            $root->prepend($script);
        }

        return $root->innerHTML;
    }

    /**
     * Same rendering as {@see template()}, without the state island — for a piece
     * embedded inside a page or a larger component whose own seed already covers it
     * (e.g. a list of cards rendered into a region of an already-seeded page).
     *
     * @param string $html Inner markup to render.
     * @param array<string, mixed> $state Values for the directives.
     */
    public static function fragment(string $html, array $state): string
    {
        return self::template($html, $state, seed: false);
    }

    /** Parse $html inside a throwaway wrapper so it can be queried/mutated as a fragment. */
    private static function parse(string $html): \Dom\HTMLDocument
    {
        return \Dom\HTMLDocument::createFromString(
            '<!doctype html><body><div id="homly-root">' . $html . '</div></body>',
            LIBXML_NOERROR,
        );
    }

    /**
     * Bind every directive under $scope against $state. Order matters: scalars first
     * (data-bind/data-if/data-bind-attr/data-bind-class) — the rows a data-for is about
     * to create don't exist yet, so a row-only key never gets confused with an outer one
     * of the same name — then lists, each row bound recursively against its OWN item
     * (never the outer $state), same as the client's per-row store.
     *
     * A `<template>`'s content lives in its own fragment: `querySelectorAll` here never
     * reaches inside one, exactly like in a browser — so a row-only `data-bind` is only
     * ever touched once, when its row is built below.
     */
    private static function bind(\Dom\Element $scope, array $state, \Dom\HTMLDocument $doc): void
    {
        foreach ($scope->querySelectorAll('[data-bind]') as $el) {
            $key = $el->getAttribute('data-bind');
            if (array_key_exists($key, $state)) $el->textContent = self::text($state[$key]);
        }

        foreach ($scope->querySelectorAll('[data-if]') as $el) {
            $key = $el->getAttribute('data-if');
            if (!array_key_exists($key, $state)) continue;
            if ($state[$key]) $el->removeAttribute('hidden');
            else $el->setAttribute('hidden', '');
        }

        foreach ($scope->querySelectorAll('[data-bind-class]') as $el) {
            foreach (self::pairs($el->getAttribute('data-bind-class')) as [$class, $key]) {
                if (array_key_exists($key, $state) && $state[$key]) $el->classList->add($class);
            }
        }

        foreach ($scope->querySelectorAll('[data-bind-attr]') as $el) {
            foreach (self::pairs($el->getAttribute('data-bind-attr')) as [$attr, $key]) {
                if (array_key_exists($key, $state)) self::applyAttr($el, $attr, $state[$key]);
            }
        }

        // iterator_to_array: cada fila crea nodos nuevos entre medio (después del
        // <template>), y no queremos que una lista live NodeList se reevalúe a mitad
        // de camino — se congela el conjunto de <template> antes de insertar nada.
        foreach (iterator_to_array($scope->querySelectorAll('template[data-for]')) as $tpl) {
            $arrayKey = $tpl->getAttribute('data-for');
            $keyField = $tpl->getAttribute('data-key');
            if ($keyField === null || $keyField === '') {
                throw new \InvalidArgumentException("data-for=\"$arrayKey\" requiere data-key");
            }
            $ref = $tpl;
            foreach (($state[$arrayKey] ?? []) as $item) {
                if (!is_array($item) || !array_key_exists($keyField, $item)) continue;
                // En PHP 8.4 el contenido del <template> se expone por innerHTML —
                // clonarlo así en un <div> descartable evita tocar el <template> mismo,
                // que debe seguir en el documento (el cliente lo necesita para las filas
                // que agregue después).
                $wrap = $doc->createElement('div');
                $wrap->innerHTML = $tpl->innerHTML;
                // FIX CORE-13b/P5: the row sees the parent's keys too, same as the client
                // (Homly.bindView's `fallback`) — $item's own keys win over $state's.
                self::bind($wrap, $item + $state, $doc);
                $node = $wrap->firstElementChild;
                if ($node === null) continue;
                $node->setAttribute('data-homly-key', self::text($item[$keyField]));
                $ref->after($node);
                $ref = $node;
            }
        }
    }

    /** Split "a:b, c:d" into [['a','b'], ['c','d']] — one or several pairs, comma-separated. */
    private static function pairs(string $spec): array
    {
        return array_map(
            fn($pair) => array_map('trim', explode(':', $pair, 2)),
            explode(',', $spec),
        );
    }

    /**
     * Same semantics as the client's data-bind-attr: null/'' never write the attribute
     * (there is nothing to "remove" on a fresh render); `false` is absent (except
     * `aria-*`, which gets the literal string); `true` writes `''`; everything else
     * goes through the same URL allowlist as {@see \Homly\Render} runs no script.
     */
    private static function applyAttr(\Dom\Element $el, string $attr, mixed $val): void
    {
        if ($val === null || $val === '') return;
        $isAria = str_starts_with($attr, 'aria-');
        if ($val === false && !$isAria) return;
        $text = is_bool($val) ? ($isAria ? self::text($val) : '') : self::text($val);
        if (!self::attrAllowed($attr, $text)) return;
        $el->setAttribute($attr, $text);
    }

    /** Same allowlist as `Homly._attrAllowed` in homly.js — see its doc comment there. */
    private static function attrAllowed(string $attr, string $val): bool
    {
        if (preg_match('/^on/i', $attr) === 1 || $attr === 'srcdoc') return false;
        if (!in_array($attr, self::URL_ATTRS, true)) return true;
        if ($attr === 'src' && preg_match('#^data:image/#i', $val) === 1) return true;
        $parts = parse_url($val);
        if ($parts === false) return false;
        if (!isset($parts['scheme'])) return true;   // ruta relativa: resuelve al esquema de la página
        return in_array(strtolower($parts['scheme']), self::SAFE_SCHEMES, true);
    }

    /** Same conversion as `String(val)` on the client: null → '', bool → 'true'/'false'. */
    private static function text(mixed $v): string
    {
        if ($v === null) return '';
        if (is_bool($v)) return $v ? 'true' : 'false';
        return (string) $v;
    }
}
