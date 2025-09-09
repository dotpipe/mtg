<?php
// Card characteristic bit positions
$CHARACTERISTICS = [
    // Mana production/ramp
    'PRODUCES_MANA' => 0,
    'SEARCHES_LANDS' => 1,
    'REDUCES_COSTS' => 2,
    
    // Card advantage
    'DRAWS_CARDS' => 3,
    'TUTORS' => 4,
    'RECURS_CARDS' => 5,
    
    // Removal
    'DESTROYS_CREATURES' => 6,
    'EXILES_PERMANENTS' => 7,
    'COUNTERS_SPELLS' => 8,
    'BOARD_WIPE' => 9,
    
    // Protection
    'GRANTS_INDESTRUCTIBLE' => 10,
    'GRANTS_HEXPROOF' => 11,
    'PREVENTS_DAMAGE' => 12,
    
    // Combat
    'GRANTS_EVASION' => 13,
    'GRANTS_DOUBLE_STRIKE' => 14,
    'GRANTS_TRAMPLE' => 15,
    'GRANTS_DEATHTOUCH' => 16,
    
    // Token strategies
    'CREATES_TOKENS' => 17,
    'ANTHEM_EFFECTS' => 18,
    'TOKEN_DOUBLING' => 19,
    
    // Graveyard strategies
    'FILLS_GRAVEYARD' => 20,
    'REANIMATES' => 21,
    'EXILES_GRAVEYARDS' => 22,
    
    // Combo potential
    'UNTAPS_PERMANENTS' => 23,
    'COPIES_SPELLS' => 24,
    'DOUBLES_TRIGGERS' => 25,
    'INFINITE_COMBO_PIECE' => 26,
    
    // Life manipulation
    'GAINS_LIFE' => 27,
    'DRAINS_LIFE' => 28,
    'PAYS_LIFE' => 29,
    
    // Tribal synergies (examples)
    'TRIBAL_DRAGON' => 30,
    'TRIBAL_WIZARD' => 31,
    'TRIBAL_ZOMBIE' => 32,
    'TRIBAL_ELF' => 33,
    'TRIBAL_GOBLIN' => 34,
    'TRIBAL_MERFOLK' => 35,
    
    // Strategy archetypes
    'AGGRO' => 36,
    'CONTROL' => 37,
    'COMBO' => 38,
    'MIDRANGE' => 39,
    'TEMPO' => 40,
    'RAMP' => 41,
    'ARISTOCRATS' => 42,
    'SPELLSLINGER' => 43,
    'VOLTRON' => 44,
    'STAX' => 45,
    'GROUP_HUG' => 46,
    'MILL' => 47,
    
    // Color identity (for color-specific synergies)
    'WHITE_SYNERGY' => 48,
    'BLUE_SYNERGY' => 49,
    'BLACK_SYNERGY' => 50,
    'RED_SYNERGY' => 51,
    'GREEN_SYNERGY' => 52,
    'COLORLESS_SYNERGY' => 53,
    'MULTICOLOR_SYNERGY' => 54,
    
    // Card types matter
    'CARES_ABOUT_ARTIFACTS' => 55,
    'CARES_ABOUT_ENCHANTMENTS' => 56,
    'CARES_ABOUT_PLANESWALKERS' => 57,
    'CARES_ABOUT_INSTANTS_SORCERIES' => 58,
    'CARES_ABOUT_LANDS' => 59,
    'CARES_ABOUT_CREATURES' => 60,
    
    // Special mechanics
    'COUNTERS_MATTER' => 61,
    'SACRIFICE_OUTLET' => 62,
    'BLINK_FLICKER' => 63
];

/**
 * Generate a bit pattern for a card based on its characteristics
 * 
 * @param array $card Card data from database or API
 * @return string Binary string representing card characteristics
 */
function generateCardBitPattern($card) {
    global $CHARACTERISTICS;
    
    // Initialize bit pattern (64 bits = 8 bytes) with all zeros
    $bitPattern = str_repeat('0', 64);
    
    // Extract card text and other relevant fields
    $name = $card['name'] ?? '';
    $typeLine = $card['type_line'] ?? '';
    $oracleText = $card['oracle_text'] ?? '';
    $manaCost = $card['mana_cost'] ?? '';
    $colorIdentity = $card['color_identity'] ?? [];
    
    // Convert to uppercase for case-insensitive matching
    $typeLine = strtoupper($typeLine);
    $oracleText = strtoupper($oracleText);
    
    // Check for mana production/ramp
    if (strpos($oracleText, 'ADD') !== false && 
        (strpos($oracleText, '{W}') !== false || 
         strpos($oracleText, '{U}') !== false || 
         strpos($oracleText, '{B}') !== false || 
         strpos($oracleText, '{R}') !== false || 
         strpos($oracleText, '{G}') !== false || 
         strpos($oracleText, '{C}') !== false)) {
        $bitPattern[$CHARACTERISTICS['PRODUCES_MANA']] = '1';
    } else {
        $bitPattern[$CHARACTERISTICS['PRODUCES_MANA']] = '0';
    }
    
    // Add the rest of the function as provided in the previous response
    // (Include all the if/else blocks for each characteristic)
    
    // Return the complete bit pattern
    return $bitPattern;
}

/**
 * Calculate synergy score between two cards using fuzzy bit pattern matching
 * 
 * @param string $pattern1 First card's bit pattern
 * @param string $pattern2 Second card's bit pattern
 * @param int $consecutiveBitsRequired Number of consecutive matching bits required
 * @return float Synergy score between 0 and 1
 */
function calculateSynergyScore($pattern1, $pattern2, $consecutiveBitsRequired = 3) {
    $patternLength = strlen($pattern1);
    $totalMatches = 0;
    $maxPossibleMatches = $patternLength - $consecutiveBitsRequired + 1;
    
    // Look for consecutive matching bits
    for ($i = 0; $i <= $patternLength - $consecutiveBitsRequired; $i++) {
        $matchFound = true;
        
        for ($j = 0; $j < $consecutiveBitsRequired; $j++) {
            // If both bits are 1, it's a match
            if ($pattern1[$i + $j] === '1' && $pattern2[$i + $j] === '1') {
                continue;
            } else {
                $matchFound = false;
                break;
            }
        }
        
        if ($matchFound) {
            $totalMatches++;
            
            // Optional: Skip ahead to avoid overlapping matches
            // $i += $consecutiveBitsRequired - 1;
        }
    }
    
    // Calculate complementary matches (where one card has 0 and the other has 1)
    // This identifies cards that complement each other's weaknesses
    $complementaryMatches = 0;
    for ($i = 0; $i <= $patternLength - $consecutiveBitsRequired; $i++) {
        $complementaryFound = true;
        
        for ($j = 0; $j < $consecutiveBitsRequired; $j++) {
            // If one bit is 1 and the other is 0, it's complementary
            if (($pattern1[$i + $j] === '1' && $pattern2[$i + $j] === '0') ||
                ($pattern1[$i + $j] === '0' && $pattern2[$i + $j] === '1')) {
                continue;
            } else {
                $complementaryFound = false;
                break;
            }
        }
        
        if ($complementaryFound) {
            $complementaryMatches++;
        }
    }
    
    // Calculate synergy score based on matches and complementary matches
    // Direct matches are weighted more heavily than complementary matches
    $synergyScore = ($totalMatches * 0.7 + $complementaryMatches * 0.3) / $maxPossibleMatches;
    
    // Ensure score is between 0 and 1
    return min(1, max(0, $synergyScore));
}

if (isset($_GET) && $_GET['s']) {

// Enable error reporting
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Database configuration
$dbConfig = [
    'host' => 'localhost',
    'dbname' => 'adapt333_mtg',
    'user' => 'adapt333_mtg',
    'pass' => 'jKMdBDNb8d2kMfN'
];

try {
    // Connect to database
    $pdo = new PDO(
        "mysql:host={$dbConfig['host']};dbname={$dbConfig['dbname']};charset=utf8mb4",
        $dbConfig['user'],
        $dbConfig['pass'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]
    );
    
    echo "<h1>Adding Bit Pattern Column</h1>";
    
    // Check if bit_pattern column exists
    $columnCheck = $pdo->query("SHOW COLUMNS FROM cards LIKE 'bit_pattern'");
    if ($columnCheck->rowCount() === 0) {
        // Add the bit_pattern column
        $pdo->exec("ALTER TABLE cards ADD COLUMN bit_pattern VARCHAR(64)");
        echo "<p style='color:green'>Successfully added bit_pattern column to cards table</p>";
    } else {
        echo "<p>bit_pattern column already exists in cards table</p>";
    }
    
    // Check if card_associations table exists
    $tableCheck = $pdo->query("SHOW TABLES LIKE 'card_associations'");
    if ($tableCheck->rowCount() === 0) {
        // Create the card_associations table
        $pdo->exec("
            CREATE TABLE card_associations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                card1_id INT NOT NULL,
                card2_id INT NOT NULL,
                synergy_score FLOAT NOT NULL,
                synergy_type VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_card1 (card1_id),
                INDEX idx_card2 (card2_id),
                INDEX idx_synergy (synergy_score),
                UNIQUE KEY unique_pair (card1_id, card2_id)
            )
        ");
        echo "<p style='color:green'>Successfully created card_associations table</p>";
    } else {
        echo "<p>card_associations table already exists</p>";
    }
    
    // Show table structure
    echo "<h2>Cards Table Structure</h2>";
    $columns = $pdo->query("SHOW COLUMNS FROM cards")->fetchAll();
    
    echo "<table border='1' cellpadding='5'>";
    echo "<tr><th>Field</th><th>Type</th><th>Null</th><th>Key</th><th>Default</th><th>Extra</th></tr>";
    
    foreach ($columns as $column) {
        echo "<tr>";
        echo "<td>{$column['Field']}</td>";
        echo "<td>{$column['Type']}</td>";
        echo "<td>{$column['Null']}</td>";
        echo "<td>{$column['Key']}</td>";
        echo "<td>{$column['Default']}</td>";
        echo "<td>{$column['Extra']}</td>";
        echo "</tr>";
    }
    
    echo "</table>";
    
    // Show sample data
    echo "<h2>Sample Cards Data</h2>";
    $sampleCards = $pdo->query("SELECT id, name, type_line FROM cards LIMIT 5")->fetchAll();
    
    echo "<table border='1' cellpadding='5'>";
    echo "<tr><th>ID</th><th>Name</th><th>Type Line</th></tr>";
    
    foreach ($sampleCards as $card) {
        echo "<tr>";
        echo "<td>{$card['id']}</td>";
        echo "<td>{$card['name']}</td>";
        echo "<td>{$card['type_line']}</td>";
        echo "</tr>";
    }
    
    echo "</table>";
    
    echo "<h2>Next Steps</h2>";
    echo "<p>Now that the bit_pattern column has been added, you can:</p>";
    echo "<ol>";
    echo "<li><a href='generate-bit-patterns.php'>Generate bit patterns for cards</a></li>";
    echo "<li><a href='calculate-synergies.php'>Calculate synergies between cards</a></li>";
    echo "<li><a href='synergy-dashboard.php'>View the synergy dashboard</a></li>";
    echo "</ol>";
    
    echo "<p><a href='index.html'>Return to Forge of Decks</a></p>";
    
} catch (PDOException $e) {
    echo "<h1 style='color:red'>Database Error</h1>";
    echo "<p>{$e->getMessage()}</p>";
}

}
?>
