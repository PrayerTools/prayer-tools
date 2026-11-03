<?php
// Exports the Pray4Movement crisis prayer fuel spreadsheet (one "Day N" sheet
// per day: prayer wheel segments with prompts and verses, prayer requests and
// giving links) as a content pack zip (pack.json) for the operator Libraries
// import.
//
// Usage: php scripts/xlsx-crisis-export.php <crisis.xlsx> <out.zip>

const NIV = 'Scripture quotations taken from The Holy Bible, New International Version® NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide.';

// Tracking and short links in the sheet, replaced by where they lead.
const LINKS = [
    'https://bit.ly/45IBzwG' => 'https://giving.ag.org/donate/8e7b4d17-c549-4253-a2b3-89e55e3a7030',
    'https://zumeproject.us14.list-manage.com/track/click?u=ccd7c18cc92d558aadc2caefb&id=c04d8c4d3a&e=d8057e773b' => 'https://zume.vision/reports/in-the-midst-of-lockdown-breakthrough-came-to-burmese-believer/',
];

function export_pack( string $xlsx, string $out ): void {
    $book = read_xlsx( $xlsx );
    $entries = [];
    foreach ( $book as $name => $sheet ) {
        if ( ! preg_match( '/^Day (\d+)$/', trim( $name ), $m ) ) continue;
        $entries[] = [ 'day' => (int) $m[1], 'language' => 'en', 'doc' => [ 'type' => 'doc', 'content' => day_blocks( (int) $m[1], $sheet ) ] ];
    }
    if ( ! $entries ) fail( "No Day sheets in $xlsx" );
    usort( $entries, fn ( $a, $b ) => $a['day'] <=> $b['day'] );

    $pack = [
        'title' => '4-Day Crisis',
        'description' => 'Four days through the prayer wheel for a place in crisis, each with three five-minute segments, Scripture to pray, prayer requests from the ground, and ways to give. Written for the 2023 Morocco earthquake and Libya floods.',
        'cadence' => 'daily',
        'source_language' => 'en',
        'license' => 'permission',
        'license_note' => NIV,
        'credit' => 'Pray4Movement',
        'topics' => [ 'crisis' ],
        'template_keys' => [ 'disaster_4' ],
        'entries' => $entries,
    ];
    $zip = new ZipArchive();
    if ( $zip->open( $out, ZipArchive::CREATE | ZipArchive::OVERWRITE ) !== true ) fail( "Can't write $out" );
    $zip->addFromString( 'pack.json', json_encode( $pack, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ) );
    $zip->close();
    fwrite( STDERR, "{$pack['title']} → $out\n  en: " . count( $entries ) . " days\n" );
}

function fail( string $message ): never {
    fwrite( STDERR, $message . "\n" );
    exit( 1 );
}

// ── Reading the workbook ────────────────────────────────────────────────

// Sheet name → rows of [ label (column A), text (column B), link on B ].
function read_xlsx( string $path ): array {
    $z = new ZipArchive();
    if ( $z->open( $path ) !== true ) fail( "Can't read $path" );
    $strings = [];
    foreach ( simplexml_load_string( $z->getFromName( 'xl/sharedStrings.xml' ) )->si as $si ) {
        $t = isset( $si->t ) ? (string) $si->t : '';
        foreach ( $si->r as $r ) $t .= (string) $r->t;
        $strings[] = $t;
    }
    $rels = [];
    foreach ( simplexml_load_string( $z->getFromName( 'xl/_rels/workbook.xml.rels' ) )->Relationship as $r ) $rels[ (string) $r['Id'] ] = (string) $r['Target'];
    $book = [];
    foreach ( simplexml_load_string( $z->getFromName( 'xl/workbook.xml' ) )->sheets->sheet as $s ) {
        $file = 'xl/' . preg_replace( '#^/?xl/#', '', $rels[ (string) $s->attributes( 'r', true )['id'] ] );
        $xml = simplexml_load_string( $z->getFromName( $file ) );
        $links = [];
        $sheetRels = $z->getFromName( dirname( $file ) . '/_rels/' . basename( $file ) . '.rels' );
        $targets = [];
        if ( $sheetRels ) foreach ( simplexml_load_string( $sheetRels )->Relationship as $r ) $targets[ (string) $r['Id'] ] = (string) $r['Target'];
        foreach ( $xml->hyperlinks->hyperlink ?? [] as $h ) {
            $url = $targets[ (string) $h->attributes( 'r', true )['id'] ] ?? '';
            $links[ (string) $h['ref'] ] = LINKS[ $url ] ?? $url;
        }
        $rows = [];
        foreach ( $xml->sheetData->row as $row ) {
            $cells = [];
            foreach ( $row->c as $c ) {
                $v = isset( $c->v ) ? (string) $c->v : '';
                if ( (string) $c['t'] === 's' ) $v = $strings[ (int) $v ];
                $cells[ preg_replace( '/\d+/', '', (string) $c['r'] ) ] = trim( $v );
            }
            $b = $cells['B'] ?? '';
            if ( $b === '' ) continue;
            $rows[] = [ 'label' => $cells['A'] ?? '', 'text' => $b, 'link' => $links[ 'B' . $row['r'] ] ?? null ];
        }
        $book[ (string) $s['name'] ] = $rows;
    }
    return $book;
}

// ── One day ─────────────────────────────────────────────────────────────

function day_blocks( int $day, array $rows ): array {
    $out = [ heading( 2, "Day $day" ) ];
    $list = null;
    $endList = function () use ( &$out, &$list ) {
        if ( $list ) $out[] = [ 'type' => 'bulletList', 'content' => $list ];
        $list = null;
    };
    foreach ( $rows as $r ) {
        [ 'label' => $label, 'text' => $text, 'link' => $link ] = $r;
        if ( in_array( $label, [ 'CONTENT', 'DAY ' . $day ], true ) || $text === "DAY $day" || $text === 'Optional' || $text === 'Bonus Content' ) continue;
        if ( $label === 'Prayer Wheel Segment' ) {
            $endList();
            $out[] = heading( 2, $text );
        } elseif ( str_starts_with( $text, 'Prayer Requests from' ) ) {
            $endList();
            $out[] = heading( 2, rtrim( $text, ':' ) );
            $list = [];
        } elseif ( $text === 'Feel led to give to relief efforts?' ) {
            $endList();
            $out[] = heading( 2, 'Give to relief efforts' );
            $list = [];
        } elseif ( $text === 'One-shot Prayer Walk' ) {
            continue;
        } elseif ( str_starts_with( $text, 'How does God lead you to pray as you view this image' ) ) {
            $endList();
            $out[] = heading( 2, 'One-shot Prayer Walk' );
            $out[] = paragraph( $text );
        } elseif ( is_array( $list ) ) {
            $list[] = [ 'type' => 'listItem', 'content' => [ paragraph( $text, $link ) ] ];
        } elseif ( $label === 'Image' ) {
            $out[] = [ 'type' => 'paragraph', 'content' => [ [ 'type' => 'text', 'text' => $text, 'marks' => [ [ 'type' => 'italic' ] ] ] ] ];
        } else {
            $out[] = verse( $text ) ?? paragraph( $text, $link );
        }
    }
    $endList();
    return $out;
}

function heading( int $level, string $text ): array {
    return [ 'type' => 'heading', 'attrs' => [ 'level' => $level ], 'content' => [ [ 'type' => 'text', 'text' => $text ] ] ];
}

function paragraph( string $text, ?string $link = null ): array {
    $node = [ 'type' => 'text', 'text' => $text ];
    if ( $link ) $node['marks'] = [ [ 'type' => 'link', 'attrs' => [ 'href' => $link ] ] ];
    return [ 'type' => 'paragraph', 'content' => [ $node ] ];
}

// `“…” –Psalm 34:18` as a Scripture block.
function verse( string $text ): ?array {
    if ( ! preg_match( '/^“(.+)[”“"]\s*[–-]\s*((?:[1-3] )?[A-Z][a-z]+ \d+:\d+(?:-\d+)?(?:, \d+)?)$/su', $text, $m ) ) return null;
    return [ 'type' => 'verse', 'attrs' => [ 'reference' => $m[2], 'translation' => 'NIV' ],
        'content' => [ [ 'type' => 'paragraph', 'content' => [ [ 'type' => 'text', 'text' => trim( $m[1] ) ] ] ] ] ];
}

// ── Entry point ─────────────────────────────────────────────────────────

if ( $argc < 3 ) {
    fwrite( STDERR, "Usage: php scripts/xlsx-crisis-export.php <crisis.xlsx> <out.zip>\n" );
    exit( 1 );
}
export_pack( $argv[1], $argv[2] );
