<?php

declare(strict_types=1);

/**
 * Conformance runner: re-renders every fixture under conformance/fixtures/ through
 * Homly\Render and diffs the result against that fixture's committed expected.html —
 * a regression in renderers/homly.php shows up here, against a byte-exact, reviewed
 * golden file, instead of only being caught by eye.
 *
 * Each fixture is a directory with:
 *   template.html  - inner markup fed to Render::template()/::fragment()
 *   state.json     - the state object (a JSON object; {} for "no keys")
 *   expected.html  - the committed, reviewed output
 *   meta.json      - optional; {"mode": "fragment"} to call ::fragment() instead of
 *                    the default ::template()
 *
 * Usage: php conformance/run.php   (exits 1 if any fixture doesn't match)
 */

require __DIR__ . '/../renderers/homly.php';

use Homly\Render;

$fixturesDir = __DIR__ . '/fixtures';
$names = array_values(array_filter(scandir($fixturesDir) ?: [], function ($name) use ($fixturesDir) {
    return $name !== '.' && $name !== '..' && is_dir("$fixturesDir/$name");
}));
sort($names);

if ($names === []) {
    fwrite(STDERR, "[conformance] no hay fixtures en $fixturesDir — nada que correr.\n");
    exit(1);
}

// Self-healing manifest for the browser oracle (tests/dom/conformance.html): it can't
// list a directory over the static test server, so it reads this instead. Rewritten on
// every run from the same $names scan, so it can never drift from the fixtures on disk.
$manifest = [];

$failed = 0;
foreach ($names as $name) {
    $dir = "$fixturesDir/$name";
    $template = file_get_contents("$dir/template.html");
    $state = json_decode(file_get_contents("$dir/state.json"), true);
    $expected = file_get_contents("$dir/expected.html");
    $meta = is_file("$dir/meta.json") ? json_decode(file_get_contents("$dir/meta.json"), true) : [];
    $mode = $meta['mode'] ?? 'template';
    $action = is_file("$dir/actions.json") ? json_decode(file_get_contents("$dir/actions.json"), true) : null;
    $manifest[] = array_filter(['name' => $name, 'mode' => $mode, 'action' => $action], fn($v) => $v !== null);

    try {
        $actual = $mode === 'fragment' ? Render::fragment($template, $state) : Render::template($template, $state);
    } catch (\Throwable $e) {
        echo "✗ $name: excepción — " . $e->getMessage() . "\n";
        $failed++;
        continue;
    }

    if ($actual === $expected) {
        echo "✓ $name\n";
    } else {
        echo "✗ $name: la salida no coincide con expected.html\n";
        echo "  --- esperado ---\n  " . $expected . "\n  --- obtenido ---\n  " . $actual . "\n";
        $failed++;
    }
}

file_put_contents("$fixturesDir/index.json", json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");

$total = count($names);
echo "\n[conformance] total: $total fixtures, $failed fallos\n";
if ($failed > 0) exit(1);
