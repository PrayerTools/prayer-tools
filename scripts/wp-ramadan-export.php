<?php
// Exports a Pray4Movement "ramadan-<year>" WordPress plugin as a content pack
// zip (pack.json plus images/) for the operator Libraries import, or for
// scripts/import-library.ts: one entry per day and fully translated language,
// as Tiptap JSON. Each language is rendered by the plugin's own code
// (with WordPress stubbed and translations read from its .mo files) in a
// separate process, because older plugins declare global functions on render.
//
// Usage: php scripts/wp-ramadan-export.php <plugin-dir> <out.zip>

// ── Pack ────────────────────────────────────────────────────────────────

// WordPress locales the plugins ship, mapped to prayer.tools language codes.
// The first locale listed for a code wins when a plugin has several.
const LOCALES = [
    'en_US' => 'en', 'es_ES' => 'es', 'es_419' => 'es', 'fr_FR' => 'fr', 'pt_BR' => 'pt', 'de_DE' => 'de',
    'it_IT' => 'it', 'nl_NL' => 'nl', 'ro_RO' => 'ro', 'ru_RU' => 'ru', 'uk' => 'uk', 'tr_TR' => 'tr',
    'ar' => 'ar', 'fa_IR' => 'fa', 'ur' => 'ur', 'hi_IN' => 'hi', 'bn_BD' => 'bn', 'ne_NP' => 'ne',
    'id_ID' => 'id', 'sw' => 'sw', 'am_ET' => 'am', 'zh_Hans' => 'zh-hans', 'zh_Hant' => 'zh-hant',
    'ko_KR' => 'ko', 'ko' => 'ko', 'ja' => 'ja', 'vi' => 'vi',
];

// Scripture quoted at length under a publisher's permission, by year.
const SCRIPTURE_PERMISSIONS = [
    2026 => 'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.',
];

const PACKS = [
    2023 => 'Each day: our treasure in Jesus, testimonies from around the world, biblical prayers, a prayer walk with a photo, and an inspirational quote.',
    2024 => 'Thirty ways Muslims encounter Christ, prayers for believers from a Muslim background (inspired by Liberty to the Captives), and praying Scripture.',
    2025 => 'A verse to pray through each day, prayer with insight into Muslim life, and prayer for believers.',
    2026 => 'Thirty Bible stories from Creation to the Resurrection (the Waha story sets), with what each teaches about God and people and how to pray for Muslims and the Christians reaching them.',
];

function export_pack( string $dir, string $out ): void {
    if ( ! preg_match( '/ramadan-(\d{4})$/', $dir, $m ) ) {
        fail( "Not a ramadan-<year> plugin directory: $dir" );
    }
    $year = (int) $m[1];
    $locales = [ 'en_US' ];
    foreach ( glob( "$dir/languages/ramadan-$year-*.mo" ) as $mo ) {
        $locales[] = preg_replace( "/^ramadan-$year-|\.mo$/", '', basename( $mo ) );
    }

    $entries = [];
    $report = [];
    $taken = [];
    foreach ( array_keys( LOCALES ) as $locale ) {
        if ( ! in_array( $locale, $locales, true ) ) continue;
        $code = LOCALES[ $locale ];
        if ( isset( $taken[ $code ] ) ) continue;
        $cmd = escapeshellarg( PHP_BINARY ) . ' ' . escapeshellarg( __FILE__ ) . ' --render ' . escapeshellarg( $dir ) . ' ' . escapeshellarg( $locale );
        $json = shell_exec( $cmd );
        $result = $json ? json_decode( $json, true ) : null;
        if ( ! is_array( $result ) ) fail( "Rendering $locale failed:\n$json" );
        if ( $result['missing'] > 0 ) {
            $report[] = "$locale: skipped, {$result['missing']} strings untranslated";
            continue;
        }
        $taken[ $code ] = true;
        foreach ( $result['days'] as $i => $html ) {
            $entries[] = [ 'day' => $i + 1, 'language' => $code, 'doc' => html_to_doc( $html, $code, $i + 1 ) ];
        }
        $report[] = "$locale → $code: " . count( $result['days'] ) . ' days';
    }
    foreach ( array_diff( $locales, array_keys( LOCALES ) ) as $locale ) {
        $report[] = "$locale: skipped, not a prayer.tools language";
    }

    $pack = [
        'title' => "Ramadan $year",
        'description' => PACKS[ $year ] ?? "Thirty days of prayer for Ramadan $year.",
        'cadence' => 'daily',
        'source_language' => 'en',
        'license' => isset( SCRIPTURE_PERMISSIONS[ $year ] ) ? 'permission' : 'own',
        'license_note' => SCRIPTURE_PERMISSIONS[ $year ] ?? null,
        'credit' => 'Prayer.Tools',
        'topics' => [ 'ramadan' ],
        'template_keys' => [ 'ramadan' ],
        'entries' => $entries,
    ];
    $zip = new ZipArchive();
    if ( $zip->open( $out, ZipArchive::CREATE | ZipArchive::OVERWRITE ) !== true ) fail( "Can't write $out" );
    $zip->addFromString( 'pack.json', json_encode( $pack, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ) );
    foreach ( $GLOBALS['pt_images'] ?? [] as $name => $path ) $zip->addFile( $path, "images/$name" );
    $zip->close();
    $report[] = count( $GLOBALS['pt_images'] ?? [] ) . ' images';
    fwrite( STDERR, "Ramadan $year → $out\n  " . implode( "\n  ", $report ) . "\n" );
}

function fail( string $message ): void {
    fwrite( STDERR, $message . "\n" );
    exit( 1 );
}

// ── Rendering one language with the plugin's code ───────────────────────

function render_language( string $dir, string $locale ): void {
    preg_match( '/ramadan-(\d{4})$/', $dir, $m );
    $year = $m[1];
    $GLOBALS['pt_dir'] = $dir;
    $GLOBALS['pt_strings'] = $locale === 'en_US' && ! file_exists( "$dir/languages/ramadan-$year-en_US.mo" )
        ? []
        : read_mo( "$dir/languages/ramadan-$year-$locale.mo" );
    $GLOBALS['pt_check'] = $locale !== 'en_US';
    $GLOBALS['pt_missing'] = [];

    define( 'ABSPATH', $dir . '/' );
    eval( "class Ramadan_$year { public static \$plugin_dir = " . var_export( $dir . '/', true ) . '; }' );
    require "$dir/admin/prayer-field-content.php";
    $class = "P4_Ramadan_{$year}_Content";
    $days = array_map( fn ( $d ) => implode( '', $d['content'] ), $class::content( $locale, [], $locale ) );
    echo json_encode( [ 'days' => $days, 'missing' => count( $GLOBALS['pt_missing'] ) ] );
}

function read_mo( string $path ): array {
    $data = @file_get_contents( $path );
    if ( $data === false ) return [];
    $le = unpack( 'V', substr( $data, 0, 4 ) )[1] === 0x950412de;
    $int = fn ( $offset ) => unpack( $le ? 'V' : 'N', substr( $data, $offset, 4 ) )[1];
    $count = $int( 8 );
    $originals = $int( 12 );
    $translations = $int( 16 );
    $strings = [];
    for ( $i = 0; $i < $count; $i++ ) {
        $key = substr( $data, $int( $originals + $i * 8 + 4 ), $int( $originals + $i * 8 ) );
        $value = substr( $data, $int( $translations + $i * 8 + 4 ), $int( $translations + $i * 8 ) );
        $key = explode( "\0", $key )[0];
        $value = explode( "\0", $value )[0];
        if ( $key !== '' && $value !== '' ) $strings[ $key ] = $value;
    }
    return $strings;
}

// WordPress functions the content files call.
function __( $text, $domain = 'default' ) {
    if ( isset( $GLOBALS['pt_strings'][ $text ] ) ) return $GLOBALS['pt_strings'][ $text ];
    if ( $GLOBALS['pt_check'] ) $GLOBALS['pt_missing'][ $text ] = true;
    return $text;
}
function esc_html( $text ) { return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' ); }
function wp_kses_post( $html ) { return $html; }
function wp_unslash( $value ) { return is_array( $value ) ? array_map( 'wp_unslash', $value ) : stripslashes( (string) $value ); }
function make_clickable( $text ) { return preg_replace( '#(?<![="\'>/])(https?://[^\s<]+[^\s<.,;:!?)"\'])#', '<a href="$1">$1</a>', $text ); }
function add_filter( ...$args ) { return true; }
function load_plugin_textdomain( ...$args ) { return true; }
function trailingslashit( $path ) { return rtrim( $path, '/' ) . '/'; }
function plugin_basename( $file ) { return basename( $file ); }
function plugins_url( $path, $file ) { return 'file://' . realpath( $GLOBALS['pt_dir'] . '/' . $path ); }
function dt_write_log( ...$args ) {}
function get_current_user_id() { return 0; }

// ── HTML to Tiptap ──────────────────────────────────────────────────────

// The plugins' location tokens, as prayer.tools placeholders.
const TOKENS = [
    '[in location]' => '{in_place}', '[of location]' => '{of_place}', '[location]' => '{place}', '[people_group]' => '{people_group}',
];

// Tokens some translators translated or mistyped, by prayer.tools language.
const TRANSLATED_TOKENS = [
    'es' => [ '[en el lugar]' => '{in_place}', '[del lugar]' => '{of_place}' ],
    'de' => [ '[am Ort]' => '{in_place}', '[vor Ort]' => '{in_place}', '[of locaion]' => '{of_place}', '[location ]' => '{place}' ],
    'fr' => [ '[le lieu]' => '{in_place}' ],
    'pt' => [ '[Location]' => '{place}', '[ in location]' => '{in_place}' ],
    'ar' => [ '[في المكان]' => '{in_place}', '[المكان]' => '{place}' ],
];

function html_to_doc( string $html, string $lang, int $day ): array {
    $GLOBALS['pt_tokens'] = [ ...TOKENS, ...( TRANSLATED_TOKENS[ $lang ] ?? [] ) ];
    $dom = new DOMDocument();
    libxml_use_internal_errors( true );
    $dom->loadHTML( '<?xml encoding="utf-8"?><body>' . $html . '</body>' );
    libxml_clear_errors();
    $body = $dom->getElementsByTagName( 'body' )->item( 0 );
    return [ 'type' => 'doc', 'content' => scripture( blocks( $body, $day ) ) ];
}

function blocks( DOMNode $parent, int $day ): array {
    $out = [];
    $run = [];
    $flush = function () use ( &$out, &$run ) {
        $para = paragraph( inlines( $run, [] ) );
        if ( $para ) $out[] = $para;
        $run = [];
    };
    foreach ( $parent->childNodes as $node ) {
        if ( $node instanceof DOMComment ) continue;
        $tag = $node instanceof DOMElement ? strtolower( $node->tagName ) : '';
        if ( $tag === 'p' ) {
            $flush();
            $para = paragraph( inlines( iterator_to_array( $node->childNodes ), [] ) );
            if ( $para ) $out[] = $para;
        } elseif ( preg_match( '/^h([1-6])$/', $tag, $m ) ) {
            $flush();
            $content = tidy( inlines( iterator_to_array( $node->childNodes ), [], true ) );
            if ( $content ) $out[] = [ 'type' => 'heading', 'attrs' => [ 'level' => max( 2, min( 4, (int) $m[1] ) ) ], 'content' => $content ];
        } elseif ( $tag === 'ul' || $tag === 'ol' ) {
            $flush();
            $items = [];
            foreach ( $node->childNodes as $li ) {
                if ( $li instanceof DOMElement && strtolower( $li->tagName ) === 'li' ) {
                    $inner = blocks( $li, $day );
                    if ( $inner ) $items[] = [ 'type' => 'listItem', 'content' => $inner ];
                }
            }
            if ( $items ) $out[] = [ 'type' => $tag === 'ul' ? 'bulletList' : 'orderedList', 'content' => $items ];
        } elseif ( $tag === 'blockquote' ) {
            $flush();
            $inner = blocks( $node, $day );
            if ( $inner ) $out[] = [ 'type' => 'blockquote', 'content' => $inner ];
        } elseif ( $tag === 'img' ) {
            $flush();
            $src = $node->getAttribute( 'src' );
            $path = str_starts_with( $src, 'file://' ) ? substr( $src, 7 ) : '';
            if ( $path && is_file( $path ) ) {
                $GLOBALS['pt_images'][ basename( $path ) ] = $path;
                $out[] = [ 'type' => 'image', 'attrs' => [ 'src' => 'images/' . basename( $path ), 'alt' => "Prayer walk photo for day $day" ] ];
            }
        } elseif ( in_array( $tag, [ 'figure', 'div', 'section' ], true ) ) {
            $flush();
            $out = array_merge( $out, blocks( $node, $day ) );
        } else {
            $run[] = $node;
        }
    }
    $flush();
    return $out;
}

function paragraph( array $inline ): ?array {
    $content = tidy( $inline );
    return $content ? [ 'type' => 'paragraph', 'content' => $content ] : null;
}

function inlines( array $nodes, array $marks, bool $plain = false ): array {
    $out = [];
    foreach ( $nodes as $node ) {
        if ( $node instanceof DOMText ) {
            $text = preg_replace( '/\s+/u', ' ', $node->data );
            if ( $text !== '' ) $out[] = text_node( strtr( $text, $GLOBALS['pt_tokens'] ), $marks );
            continue;
        }
        if ( ! $node instanceof DOMElement ) continue;
        $tag = strtolower( $node->tagName );
        $children = iterator_to_array( $node->childNodes );
        if ( $tag === 'br' ) {
            $out[] = [ 'type' => 'hardBreak' ];
        } elseif ( ! $plain && ( $tag === 'strong' || $tag === 'b' ) ) {
            $out = array_merge( $out, inlines( $children, [ ...$marks, [ 'type' => 'bold' ] ] ) );
        } elseif ( ! $plain && ( $tag === 'em' || $tag === 'i' ) ) {
            $out = array_merge( $out, inlines( $children, [ ...$marks, [ 'type' => 'italic' ] ] ) );
        } elseif ( $tag === 'a' && $node->getAttribute( 'href' ) ) {
            $out = array_merge( $out, inlines( $children, [ ...$marks, [ 'type' => 'link', 'attrs' => [ 'href' => $node->getAttribute( 'href' ) ] ] ], $plain ) );
        } else {
            $out = array_merge( $out, inlines( $children, $marks, $plain ) );
        }
    }
    return $out;
}

function text_node( string $text, array $marks ): array {
    return $marks ? [ 'type' => 'text', 'text' => $text, 'marks' => $marks ] : [ 'type' => 'text', 'text' => $text ];
}

// Trims spaces at the edges and around line breaks, drops leading, trailing and
// repeated breaks, and merges neighbouring text with the same marks.
function tidy( array $nodes ): array {
    $out = [];
    foreach ( $nodes as $n ) {
        $prev = $out ? $out[ count( $out ) - 1 ] : null;
        if ( $n['type'] === 'hardBreak' ) {
            if ( $prev && $prev['type'] === 'text' ) $out[ count( $out ) - 1 ]['text'] = rtrim( $prev['text'] );
            $out[] = $n;
            continue;
        }
        if ( ! $prev || $prev['type'] === 'hardBreak' ) $n['text'] = ltrim( $n['text'] );
        if ( $prev && $prev['type'] === 'text' && ( $prev['marks'] ?? [] ) == ( $n['marks'] ?? [] ) ) {
            $out[ count( $out ) - 1 ]['text'] .= $n['text'];
        } else {
            $out[] = $n;
        }
    }
    $out = array_values( array_filter( $out, fn ( $n ) => $n['type'] !== 'text' || $n['text'] !== '' ) );
    while ( $out && $out[0]['type'] === 'hardBreak' ) array_shift( $out );
    while ( $out && $out[ count( $out ) - 1 ]['type'] === 'hardBreak' ) array_pop( $out );
    if ( $out && $out[ count( $out ) - 1 ]['type'] === 'text' ) {
        $out[ count( $out ) - 1 ]['text'] = rtrim( $out[ count( $out ) - 1 ]['text'] );
        if ( $out[ count( $out ) - 1 ]['text'] === '' ) array_pop( $out );
    }
    $clean = [];
    foreach ( $out as $n ) {
        if ( $n['type'] === 'hardBreak' && $clean && $clean[ count( $clean ) - 1 ]['type'] === 'hardBreak' ) continue;
        $clean[] = $n;
    }
    return $clean;
}

// ── Scripture ───────────────────────────────────────────────────────────

// A Bible reference as the plugins write it in each language, e.g.
// "1 John 4:16", "Jean 3 :21", "Johannes 3,21", "متی ۳:۵", and a translation.
const NUM = '[0-9٠-٩۰-۹]+';
const VERSES = '\s?[:,]\s?' . NUM . '[ab]?(?:\s?[-–]\s?(?:' . NUM . ':)?' . NUM . '[ab]?)?(?:\s?[,.&+]\s?' . NUM . '[ab]?(?:[-–]' . NUM . '[ab]?)?)*';
const BOOK = '(?:[1-5]\.?\s?)?\p{L}[\p{L}\p{M}.-]*';
const REF = BOOK . '(?:\s\p{L}[\p{L}\p{M}.]*){0,2}\s*' . NUM . '(?:' . VERSES . ')?';
const TRANSLATION = '\p{Lu}[\p{Lu}0-9]{1,9}(?![\p{L}0-9])';
const OPEN_QUOTE = '[“"«„「『]';
const CLOSE_QUOTE = '[”"»“」』]';

// Turns quoted Bible passages into Scripture (`verse`) blocks:
// a reference block like "Genesis 1:1-25 (ESV)" followed by the passage, and
// a quotation followed by its reference within a paragraph line.
function scripture( array $blocks ): array {
    $out = [];
    for ( $i = 0; $i < count( $blocks ); $i++ ) {
        $b = $blocks[ $i ];
        $next = $blocks[ $i + 1 ] ?? null;
        if ( ( $ref = ref_block( $b ) ) && $next && ! ref_block( $next )
            && ( $next['type'] === 'paragraph' || $next['type'] === 'heading' && $next['attrs']['level'] === 4 ) ) {
            $out[] = verse( $ref[1], $ref[2], [ [ 'type' => 'paragraph', 'content' => $next['content'] ] ] );
            $i++;
        } elseif ( $b['type'] === 'paragraph' ) {
            array_push( $out, ...quoted_verses( $b['content'] ) );
        } else {
            $out[] = $b;
        }
    }
    return $out;
}

// The reference and translation of a block holding only those, or null.
function ref_block( array $b ): ?array {
    $ok = in_array( $b['type'], [ 'paragraph', 'heading' ], true )
        && preg_match( '/^(' . REF . ')\s*[(（](' . TRANSLATION . ')[)）]$/u', plain( $b['content'] ?? [] ), $m );
    return $ok ? $m : null;
}

// Splits a paragraph's lines into paragraphs and verses. A quotation followed
// by its reference, e.g. «…» (Luc 11 : 9), becomes a verse when it starts the
// line or a sentence; text around it stays in the paragraph. A quotation alone
// on a line takes its reference from the line before, as in "…from Romans 12:".
function quoted_verses( array $inline ): array {
    $lines = [ [] ];
    foreach ( $inline as $n ) {
        if ( $n['type'] === 'hardBreak' ) $lines[] = [];
        else $lines[ count( $lines ) - 1 ][] = $n;
    }
    $out = [];
    $run = [];
    $flush = function () use ( &$out, &$run ) {
        if ( $run ) $out[] = [ 'type' => 'paragraph', 'content' => array_merge( ...array_map( fn ( $l, $k ) => $k ? [ [ 'type' => 'hardBreak' ], ...$l ] : $l, $run, array_keys( $run ) ) ) ];
        $run = [];
    };
    foreach ( $lines as $k => $line ) {
        $text = unmarked( $line ) ? preg_replace( '/[\x{200E}\x{200F}]/u', '', plain( $line ) ) : null;
        $found = $text !== null ? cited( $text ) : null;
        if ( ! $found && $text !== null && $k > 0 && preg_match( '/^' . OPEN_QUOTE . '(.+)' . CLOSE_QUOTE . '\s*\.?$/us', $text, $m )
            && preg_match( '/(?:^|\s)((?:\p{Lu}[\p{L}\p{M}.-]*\s){0,2}' . BOOK . '\s' . NUM . '(?:' . VERSES . ')?)\s*[:：]$/u', plain( $lines[ $k - 1 ] ), $r ) ) {
            $found = [ '', $m[1], $r[1], '', '' ];
        }
        if ( ! $found ) {
            $run[] = $line;
            continue;
        }
        [ $lead, $body, $ref, $translation, $rest ] = $found;
        if ( trim( $lead ) !== '' ) $run[] = [ text_node( trim( $lead ), [] ) ];
        $flush();
        $out[] = verse( $ref, $translation, [ [ 'type' => 'paragraph', 'content' => [ text_node( trim( $body ), [] ) ] ] ] );
        if ( trim( $rest ) !== '' ) $run[] = [ text_node( trim( $rest ), [] ) ];
    }
    $flush();
    return $out;
}

// The first quotation in a line that starts the line or a sentence and is
// followed by a reference: [ text before, quotation, reference, translation, text after ].
function cited( string $text ): ?array {
    preg_match_all( '/(?:^|[.!?؟。！？](\s*))(' . OPEN_QUOTE . ')\s?(?![.,;:!?()]\s)/u', $text, $opens, PREG_OFFSET_CAPTURE );
    $ref = '/(?:' . CLOSE_QUOTE . '?\s*[.,]?\s*[(（]\s*(' . REF . ')(?:\s+(' . TRANSLATION . '))?\s*[)）]'
        . '|' . CLOSE_QUOTE . '\s*[.,]?\s*(' . BOOK . '(?:\s\p{L}[\p{L}\p{M}.]*){0,2}\s*' . NUM . VERSES . '))'
        . '\s*[.。۔]?\s*(' . TRANSLATION . ')?\s*\.?/u';
    foreach ( $opens[0] as $i => [ $match, $at ] ) {
        [ $open, $quote ] = $opens[2][ $i ];
        // A quote mark right after a full stop opens a quotation only if the quotes before it are paired.
        if ( $quote > 0 && ( $opens[1][ $i ][0] ?? '' ) === '' && preg_match_all( '/[“”"«»„「」『』]/u', substr( $text, 0, $quote ) ) % 2 ) continue;
        $start = $at + strlen( $match );
        $from = $start;
        do {
            if ( ! preg_match( $ref, $text, $r, PREG_OFFSET_CAPTURE, $from ) ) continue 2;
            $body = substr( $text, $start, $r[0][1] - $start );
            $from = $r[0][1] + max( 1, strlen( $r[0][0] ) );
        } while ( ! preg_match( '/\p{L}/u', $body ) );
        if ( closed_early( $open, $body ) ) continue;
        return [
            substr( $text, 0, $quote ),
            $body,
            ( $r[1][0] ?? '' ) !== '' ? $r[1][0] : $r[3][0],
            ( $r[2][0] ?? '' ) !== '' ? $r[2][0] : ( $r[4][0] ?? '' ),
            substr( $text, $r[0][1] + strlen( $r[0][0] ) ),
        ];
    }
    return null;
}

// Whether a quotation opened with $open closes partway through $body, so the
// reference after it belongs to a later quotation.
function closed_early( string $open, string $body ): bool {
    $close = [ '“' => '”', '"' => '"', '«' => '»', '„' => '“', '「' => '」', '『' => '』' ][ $open ];
    $chars = mb_str_split( $body );
    $depth = 1;
    foreach ( $chars as $i => $c ) {
        // A straight quote opens a nested quotation after a space or colon, and closes one otherwise.
        $opens = $open === $close
            ? preg_match( '/[\s:]/u', $chars[ $i - 1 ] ?? ' ' ) && ! preg_match( '/\s/u', $chars[ $i + 1 ] ?? ' ' )
            : true;
        if ( $c === $open && $opens ) $depth++;
        elseif ( $c === $close ) $depth--;
        if ( $depth === 0 && preg_match( '/\p{L}/u', mb_substr( $body, $i + 1 ) ) ) return true;
    }
    return false;
}

function verse( string $reference, string $translation, array $content ): array {
    return [ 'type' => 'verse', 'attrs' => [ 'reference' => trim( $reference ), 'translation' => $translation !== '' ? $translation : null ], 'content' => $content ];
}

function plain( array $inline ): string {
    return trim( implode( '', array_map( fn ( $n ) => $n['text'] ?? '', $inline ) ) );
}

function unmarked( array $inline ): bool {
    foreach ( $inline as $n ) if ( $n['type'] !== 'text' || ! empty( $n['marks'] ) ) return false;
    return (bool) $inline;
}

// ── Entry point ─────────────────────────────────────────────────────────

if ( $argc >= 4 && $argv[1] === '--render' ) {
    render_language( $argv[2], $argv[3] );
    exit( 0 );
}
if ( $argc < 3 ) {
    fwrite( STDERR, "Usage: php scripts/wp-ramadan-export.php <plugin-dir> <out.zip>\n" );
    exit( 1 );
}
export_pack( rtrim( $argv[1], '/' ), $argv[2] );
