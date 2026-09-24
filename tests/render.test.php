<?php

declare(strict_types=1);

/**
 * Direct assertions on Homly\Render — the behaviors conformance/run.php's golden files
 * prove by example (an exact expected.html), this proves by contract (an explicit
 * assert), so a future change that "still matches the golden file by coincidence" but
 * breaks the actual guarantee fails loud here instead.
 *
 * Corre sin dependencias ni build:  php tests/render.test.php
 */

require __DIR__ . '/../renderers/homly.php';

use Homly\Render;

$failures = [];
$total = 0;
function check(string $name, bool $ok): void
{
    global $failures, $total;
    $total++;
    if (!$ok) $failures[] = $name;
}

// --- template(): siembra la isla de estado, fragment() no ---------------------------
{
    $out = Render::template('<span data-bind="a"></span>', ['a' => 1]);
    check('template() antepone <script data-homly-state>', str_starts_with($out, '<script type="application/json" data-homly-state'));
    check('template() bindea el valor', str_contains($out, '<span data-bind="a">1</span>'));

    $frag = Render::fragment('<span data-bind="a"></span>', ['a' => 1]);
    check('fragment() NO trae isla de estado', !str_contains($frag, 'data-homly-state'));
    check('fragment() igual bindea', str_contains($frag, '<span data-bind="a">1</span>'));
}

// --- data-bind: null -> '', clave ausente no toca el contenido original -------------
{
    check('data-bind null -> texto vacío', str_contains(Render::fragment('<span data-bind="x"></span>', ['x' => null]), '<span data-bind="x"></span>'));
    $out = Render::fragment('<span data-bind="ausente">placeholder</span>', []);
    check('data-bind con clave ausente no toca el contenido', str_contains($out, '>placeholder<'));
}

// --- data-if: hidden sigue la verdad del estado -------------------------------------
{
    check('data-if true quita hidden', !str_contains(Render::fragment('<div data-if="v" hidden></div>', ['v' => true]), 'hidden'));
    check('data-if false pone hidden', str_contains(Render::fragment('<div data-if="v"></div>', ['v' => false]), 'hidden'));
}

// --- data-bind-attr: mismo allowlist de URL que el cliente --------------------------
{
    $safe = Render::fragment('<a data-bind-attr="href:u"></a>', ['u' => '/casa/1']);
    check('href relativo pasa el allowlist', str_contains($safe, 'href="/casa/1"'));

    $blocked = Render::fragment('<a data-bind-attr="href:u"></a>', ['u' => 'javascript:alert(1)']);
    check('javascript: NO escribe el atributo', !str_contains($blocked, 'href='));

    $onattr = Render::fragment('<div data-bind-attr="onclick:u"></div>', ['u' => 'alert(1)']);
    check('un atributo on* nunca se escribe, sea cual sea attrAllowed', !str_contains($onattr, 'onclick='));
}

// --- data-bind-attr: semántica booleana igual a la del cliente ----------------------
{
    check('true en un atributo no-aria escribe \'\'', str_contains(Render::fragment('<button data-bind-attr="disabled:v"></button>', ['v' => true]), 'disabled=""'));
    check('false en un atributo no-aria NO se escribe', !str_contains(Render::fragment('<button data-bind-attr="disabled:v"></button>', ['v' => false]), 'disabled='));
    check('false en aria-* SÍ se escribe, como texto literal', str_contains(Render::fragment('<button data-bind-attr="aria-pressed:v"></button>', ['v' => false]), 'aria-pressed="false"'));
}

// --- varios pares en un solo data-bind-attr / data-bind-class -----------------------
{
    $img = Render::fragment('<img data-bind-attr="src:foto, alt:t">', ['foto' => '/a.webp', 't' => 'Casa']);
    check('data-bind-attr: dos pares, los dos aplicados', str_contains($img, 'src="/a.webp"') && str_contains($img, 'alt="Casa"'));

    $div = Render::fragment('<div data-bind-class="a:x, b:y"></div>', ['x' => true, 'y' => false]);
    check('data-bind-class: solo la clase con valor truthy se agrega', str_contains($div, 'class="a"'));
}

// --- data-for: cada fila marcada con data-homly-key, el <template> se conserva -----
{
    $out = Render::fragment(
        '<template data-for="items" data-key="id"><li data-bind="n"></li></template>',
        ['items' => [['id' => 5, 'n' => 'x'], ['id' => 6, 'n' => 'y']]],
    );
    check('el <template> sigue en la salida', str_contains($out, '<template data-for="items" data-key="id">'));
    check('cada fila trae su data-homly-key', str_contains($out, 'data-homly-key="5"') && str_contains($out, 'data-homly-key="6"'));
    check('el orden de las filas respeta el del array', strpos($out, 'data-homly-key="5"') < strpos($out, 'data-homly-key="6"'));
}

// --- data-for: un ítem sin la clave declarada se salta sin romper el resto ----------
{
    $out = Render::fragment(
        '<template data-for="items" data-key="id"><li data-bind="n"></li></template>',
        ['items' => [['id' => 1, 'n' => 'ok'], ['n' => 'sin id'], ['id' => 2, 'n' => 'ok2']]],
    );
    check('el ítem sin "id" no aparece', !str_contains($out, 'sin id'));
    check('los ítems válidos alrededor sí se renderizan', str_contains($out, 'ok') && str_contains($out, 'ok2'));
}

// --- data-for sin data-key: falla alto y claro, no a mitad de render ----------------
{
    $threw = false;
    try {
        Render::fragment('<template data-for="items"><li></li></template>', ['items' => []]);
    } catch (\InvalidArgumentException $e) {
        $threw = true;
    }
    check('data-for sin data-key lanza InvalidArgumentException', $threw);
}

// --- data-for anidado: cada fila se bindea contra SU PROPIO ítem, no el de afuera ---
{
    $out = Render::fragment(
        '<template data-for="casas" data-key="id"><li><span data-bind="n"></span>'
        . '<ul><template data-for="amenidades" data-key="id"><li data-bind="n"></li></template></ul>'
        . '</li></template>',
        ['casas' => [['id' => 1, 'n' => 'Casa A', 'amenidades' => [['id' => 'p', 'n' => 'Piscina']]]]],
    );
    check('la fila externa se bindeó con su propio campo', str_contains($out, '>Casa A<'));
    check('la fila anidada se bindeó con SU propio campo, no "Casa A"', str_contains($out, '>Piscina<'));
}

// --- FIX CORE-13b/P5: la fila ve las claves del padre (gana la fila) ----------------
{
    $out = Render::fragment(
        '<template data-for="items" data-key="id"><li>'
        . '<span class="nombre" data-bind="nombre"></span>'
        . '<span class="moneda" data-bind="moneda"></span></li></template>',
        [
            'moneda' => 'USD',
            'items' => [
                ['id' => 1, 'nombre' => 'Casa A'],                    // sin "moneda" propia
                ['id' => 2, 'nombre' => 'Casa B', 'moneda' => 'VES'], // con "moneda" propia: gana
            ],
        ],
    );
    check('una fila sin "moneda" propia cae al valor del padre (paridad con el cliente)',
        str_contains($out, '<span class="moneda" data-bind="moneda">USD</span>'));
    check('...pero una fila CON su propia "moneda" gana (no la pisa el padre)',
        str_contains($out, '<span class="moneda" data-bind="moneda">VES</span>'));
}

printf("%s render: %d checks%s\n", $failures === [] ? '✓' : '✗', $total, $failures === [] ? ' OK' : '');
foreach ($failures as $f) echo "  ✗ $f\n";
if ($failures !== []) exit(1);
