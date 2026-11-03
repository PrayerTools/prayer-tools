<?php
// Exports one campaign's prayer fuel from a WordPress export (WXR) of a
// prayer.tools campaigns site as a content pack zip (pack.json plus images/)
// for the operator Libraries import: one entry per day and language, as Tiptap
// JSON, with the images downloaded into the zip.
//
// Usage: php scripts/wp-fuel-export.php <export.xml> <campaign-slug> <out.zip>
// The campaign slug is the path segment in the fuel links, e.g.
// https://unreached.prayer.tools/<campaign-slug>/fuel/1?lang=en_US

const LOCALES = [
    'en_US' => 'en', 'es_ES' => 'es', 'es_419' => 'es', 'fr_FR' => 'fr', 'pt_BR' => 'pt', 'de_DE' => 'de',
    'ar' => 'ar', 'fa_IR' => 'fa', 'ur' => 'ur', 'hi_IN' => 'hi', 'bn_BD' => 'bn', 'ne_NP' => 'ne',
    'id_ID' => 'id', 'ru_RU' => 'ru', 'zh_Hans' => 'zh-hans', 'zh_Hant' => 'zh-hant',
];

const ESV = 'Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers. Used by permission. All rights reserved.';

const PACKS = [
    '10-days-for-the-unreached-2026' => [
        'title' => '10 Days for the Unreached',
        'description' => 'Ten countries with the most unreached people groups: fast facts, a key city, a video, one of the ten universal elements of church multiplication movements, a story, and one unreached people group to pray for each day.',
    ],
    'unreached_9e0' => [
        'title' => '10 Days for the Unreached 2025',
        'description' => 'Ten countries with the most unreached people groups: fast facts, a key city, a video, one of the ten universal elements of church multiplication movements, a story, and one unreached people group to pray for each day.',
    ],
];

function export_pack( string $xml, string $slug, string $out ): void {
    $meta = PACKS[ $slug ] ?? fail( "Unknown campaign slug: $slug (known: " . implode( ', ', array_keys( PACKS ) ) . ')' );
    $rss = simplexml_load_file( $xml, null, LIBXML_NOCDATA ) ?: fail( "Can't read $xml" );
    $ns = $rss->getNamespaces( true );

    $entries = [];
    $report = [];
    foreach ( $rss->channel->item as $item ) {
        $link = (string) $item->link;
        if ( ! preg_match( '#/' . preg_quote( $slug, '#' ) . '/fuel/#', $link ) ) continue;
        $wp = $item->children( $ns['wp'] );
        if ( (string) $wp->status !== 'publish' ) continue;
        $postmeta = [];
        foreach ( $wp->postmeta as $pm ) $postmeta[ (string) $pm->meta_key ] = (string) $pm->meta_value;
        $day = (int) ( $postmeta['day'] ?? 0 );
        $code = LOCALES[ $postmeta['post_language'] ?? 'en_US' ] ?? null;
        if ( $day < 1 || ! $code ) {
            $report[] = 'skipped "' . $item->title . '": no day or unknown language';
            continue;
        }
        $key = "$day:$code";
        if ( isset( $entries[ $key ] ) ) fail( "Day $day ($code) appears twice for $slug" );
        $title = trim( preg_replace( '/\s+/u', ' ', (string) $item->title ) );
        $html = (string) $item->children( $ns['content'] )->encoded;
        $doc = html_to_doc( $html );
        array_unshift( $doc['content'], [ 'type' => 'heading', 'attrs' => [ 'level' => 2 ], 'content' => [ [ 'type' => 'text', 'text' => $title ] ] ] );
        $entries[ $key ] = [ 'day' => $day, 'language' => $code, 'doc' => $doc ];
    }
    if ( ! $entries ) fail( "No published fuel found for $slug" );
    ksort( $entries, SORT_NATURAL );

    $pack = [
        'title' => $meta['title'],
        'description' => $meta['description'],
        'cadence' => 'daily',
        'source_language' => 'en',
        'license' => 'permission',
        'license_note' => ESV,
        'credit' => 'Prayer.Tools',
        'topics' => [ 'unreached' ],
        'template_keys' => [],
        'entries' => array_values( $entries ),
    ];
    $zip = new ZipArchive();
    if ( $zip->open( $out, ZipArchive::CREATE | ZipArchive::OVERWRITE ) !== true ) fail( "Can't write $out" );
    $zip->addFromString( 'pack.json', json_encode( $pack, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ) );
    foreach ( $GLOBALS['pt_images'] ?? [] as $name => $bytes ) $zip->addFromString( "images/$name", $bytes );
    $zip->close();
    $days = array_count_values( array_column( $pack['entries'], 'language' ) );
    foreach ( $days as $code => $n ) $report[] = "$code: $n days";
    $report[] = count( $GLOBALS['pt_images'] ?? [] ) . ' images';
    fwrite( STDERR, "{$meta['title']} → $out\n  " . implode( "\n  ", $report ) . "\n" );
}

function fail( string $message ): never {
    fwrite( STDERR, $message . "\n" );
    exit( 1 );
}

// ── Gutenberg HTML to Tiptap ────────────────────────────────────────────

function html_to_doc( string $html ): array {
    $dom = new DOMDocument();
    libxml_use_internal_errors( true );
    $dom->loadHTML( '<?xml encoding="utf-8"?><body>' . $html . '</body>' );
    libxml_clear_errors();
    $body = $dom->getElementsByTagName( 'body' )->item( 0 );
    return [ 'type' => 'doc', 'content' => scripture( blocks( $body ) ) ];
}

function classes( DOMElement $el ): array {
    return preg_split( '/\s+/', trim( $el->getAttribute( 'class' ) ) ) ?: [];
}

function blocks( DOMNode $parent ): array {
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
        $class = $tag ? classes( $node ) : [];
        if ( $tag === 'p' ) {
            $flush();
            $para = paragraph( inlines( iterator_to_array( $node->childNodes ), [] ) );
            if ( $para ) $out[] = $para;
        } elseif ( preg_match( '/^h([1-6])$/', $tag, $m ) ) {
            $flush();
            $content = tidy( inlines( iterator_to_array( $node->childNodes ), [], true ) );
            if ( ! $content ) continue;
            // Long headings are prompts set large, not section titles.
            if ( mb_strlen( plain( $content ) ) > 80 ) {
                $out[] = [ 'type' => 'paragraph', 'content' => tidy( inlines( iterator_to_array( $node->childNodes ), [ [ 'type' => 'bold' ] ] ) ) ];
            } else {
                $out[] = [ 'type' => 'heading', 'attrs' => [ 'level' => max( 2, min( 4, (int) $m[1] ) ) ], 'content' => $content ];
            }
        } elseif ( $tag === 'ul' || $tag === 'ol' ) {
            $flush();
            $items = [];
            foreach ( $node->childNodes as $li ) {
                if ( $li instanceof DOMElement && strtolower( $li->tagName ) === 'li' ) {
                    $inner = blocks( $li );
                    if ( $inner ) $items[] = [ 'type' => 'listItem', 'content' => $inner ];
                }
            }
            if ( $items ) $out[] = [ 'type' => $tag === 'ul' ? 'bulletList' : 'orderedList', 'content' => $items ];
        } elseif ( $tag === 'blockquote' ) {
            $flush();
            $inner = blocks( $node );
            if ( $inner ) $out[] = [ 'type' => 'blockquote', 'content' => $inner ];
        } elseif ( $tag === 'img' ) {
            $flush();
            $name = fetch_image( $node->getAttribute( 'src' ) );
            if ( $name ) $out[] = [ 'type' => 'image', 'attrs' => [ 'src' => "images/$name", 'alt' => $node->getAttribute( 'alt' ) ] ];
        } elseif ( $tag === 'hr' && in_array( 'wp-block-separator', $class, true ) ) {
            $flush();
            $out[] = [ 'type' => 'horizontalRule' ];
        } elseif ( $tag === 'hr' || in_array( 'wp-block-spacer', $class, true ) || in_array( 'gb-block-spacer', $class, true ) ) {
            $flush();
        } elseif ( $tag === 'figure' && in_array( 'wp-block-embed', $class, true ) ) {
            $flush();
            if ( preg_match( '#https?://\S+#', $node->textContent, $u ) ) $out[] = [ 'type' => 'youtube', 'attrs' => [ 'src' => $u[0] ] ];
        } elseif ( $tag === 'div' && in_array( 'gb-block-notice', $class, true ) ) {
            // A coloured notice box: its title becomes a heading, its body stays as blocks.
            $flush();
            foreach ( $node->childNodes as $part ) {
                if ( ! $part instanceof DOMElement ) continue;
                if ( in_array( 'gb-notice-title', classes( $part ), true ) ) {
                    $content = tidy( inlines( iterator_to_array( $part->childNodes ), [], true ) );
                    if ( $content ) $out[] = mb_strlen( plain( $content ) ) > 80
                        ? [ 'type' => 'paragraph', 'content' => tidy( inlines( iterator_to_array( $part->childNodes ), [ [ 'type' => 'bold' ] ] ) ) ]
                        : [ 'type' => 'heading', 'attrs' => [ 'level' => 3 ], 'content' => $content ];
                } else {
                    $out = array_merge( $out, blocks( $part ) );
                }
            }
        } elseif ( in_array( $tag, [ 'figure', 'div', 'section' ], true ) ) {
            $flush();
            $out = array_merge( $out, blocks( $node ) );
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
            $text = preg_replace( '/[\s\x{00A0}]+/u', ' ', $node->data );
            if ( $text !== '' ) $out[] = text_node( $text, $marks );
            continue;
        }
        if ( ! $node instanceof DOMElement ) continue;
        $tag = strtolower( $node->tagName );
        $children = iterator_to_array( $node->childNodes );
        $has = fn ( string $type ) => in_array( $type, array_column( $marks, 'type' ), true );
        if ( $tag === 'br' ) {
            $out[] = [ 'type' => 'hardBreak' ];
        } elseif ( ! $plain && ( $tag === 'strong' || $tag === 'b' ) ) {
            $out = array_merge( $out, inlines( $children, $has( 'bold' ) ? $marks : [ ...$marks, [ 'type' => 'bold' ] ] ) );
        } elseif ( ! $plain && ( $tag === 'em' || $tag === 'i' ) ) {
            $out = array_merge( $out, inlines( $children, $has( 'italic' ) ? $marks : [ ...$marks, [ 'type' => 'italic' ] ] ) );
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

function plain( array $inline ): string {
    return trim( implode( '', array_map( fn ( $n ) => $n['text'] ?? '', $inline ) ) );
}

// ── Scripture ───────────────────────────────────────────────────────────

// A passage written as `Colossians 4:2-4 (ESV) - "Continue steadfastly…"`
// becomes a Scripture (`verse`) block.
const PASSAGE = '/^((?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)? \d+:\s?\d+(?:\s?[-–]\s?\d+)?)\s*(?:\((ESV)\))?\s*[-–:]?\s*[“”"](.+?)[”"]?$/su';

function scripture( array $blocks ): array {
    return array_map( function ( array $b ) {
        if ( $b['type'] !== 'paragraph' ) return $b;
        $text = preg_replace( '/\s+/u', ' ', plain( $b['content'] ) );
        if ( ! preg_match( PASSAGE, $text, $m ) ) return $b;
        // "Act 6:1-7" is a typo for Acts.
        $ref = preg_replace( '/^Act (?=\d)/', 'Acts ', preg_replace( '/:\s/', ':', $m[1] ) );
        return [ 'type' => 'verse', 'attrs' => [ 'reference' => $ref, 'translation' => $m[2] ?: 'ESV' ],
            'content' => [ [ 'type' => 'paragraph', 'content' => [ [ 'type' => 'text', 'text' => trim( $m[3], ' ”"' ) ] ] ] ] ];
    }, $blocks );
}

// ── Images ──────────────────────────────────────────────────────────────

// Downloads an image once and returns its name in images/, keeping the file
// name and adding a suffix when two different images share one.
function fetch_image( string $src ): ?string {
    if ( ! preg_match( '#^https?://#', $src ) ) return null;
    $url = preg_replace( '#^http://#', 'https://', $src );
    if ( isset( $GLOBALS['pt_image_names'][ $url ] ) ) return $GLOBALS['pt_image_names'][ $url ];
    $bytes = @file_get_contents( $url );
    if ( $bytes === false || $bytes === '' ) {
        fwrite( STDERR, "  image not downloaded: $url\n" );
        return null;
    }
    $name = basename( parse_url( $url, PHP_URL_PATH ) );
    $base = pathinfo( $name, PATHINFO_FILENAME );
    $ext = pathinfo( $name, PATHINFO_EXTENSION );
    for ( $i = 2; isset( $GLOBALS['pt_images'][ $name ] ) && $GLOBALS['pt_images'][ $name ] !== $bytes; $i++ ) $name = "$base-$i.$ext";
    $GLOBALS['pt_images'][ $name ] = $bytes;
    return $GLOBALS['pt_image_names'][ $url ] = $name;
}

// ── Entry point ─────────────────────────────────────────────────────────

if ( $argc < 4 ) {
    fwrite( STDERR, "Usage: php scripts/wp-fuel-export.php <export.xml> <campaign-slug> <out.zip>\n" );
    exit( 1 );
}
export_pack( $argv[1], $argv[2], $argv[3] );
