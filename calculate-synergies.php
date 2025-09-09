<?php
// Enable error reporting
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// Increase memory limit and execution time
ini_set('memory_limit', '512M');
set_time_limit(600); // 10 minutes

// Database configuration
$dbConfig = [
    'host' => 'localhost',
    'dbname' => 'adapt333_mtg',
    'user' => 'adapt333_mtg',
    'pass' => 'jKMdBDNb8d2kMfN'
];

// Minimum synergy threshold (55%)
$synergyThreshold = 0.55;

// Include the bit pattern definitions and functions
include 'bit_patterns.php';

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
    
    echo "<h1>Calculate Card Synergies</h1>";
    
    // Check if card_associations table exists
    $tableCheck = $pdo->query("SHOW TABLES LIKE 'card_associations'");
    if ($tableCheck->rowCount() === 0) {
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
        echo "<p style='color:green'>Created card_associations table</p>";
    } else {
        echo "<p>card_associations table already exists</p>";
    }
    
    // Get batch parameters
    $batchSize = isset($_GET['batch_size']) ? intval($_GET['batch_size']) : 50;
    $startId = isset($_GET['start_id']) ? intval($_GET['start_id']) : 0;
    
    // Get cards for this batch
    $stmt = $pdo->prepare("
        SELECT id, name, bit_pattern
        FROM cards
        WHERE id > ? AND bit_pattern IS NOT NULL
        ORDER BY id
        LIMIT ?
    ");
    $stmt->execute([$startId, $batchSize]);
    $cards = $stmt->fetchAll();
    
    if (count($cards) === 0) {
        echo "<p>No more cards to process</p>";
        exit;
    }
    
    echo "<p>Processing batch of " . count($cards) . " cards starting from ID $startId</p>";
    
    // Get all cards with bit patterns for comparison
    $allCardsStmt = $pdo->query("
        SELECT id, name, bit_pattern
        FROM cards
        WHERE bit_pattern IS NOT NULL
    ");
    $allCards = $allCardsStmt->fetchAll();
    
    echo "<p>Found " . count($allCards) . " total cards with bit patterns</p>";
    
    // Prepare insert statement
    $insertStmt = $pdo->prepare("
        INSERT INTO card_associations (card1_id, card2_id, synergy_score, synergy_type)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE synergy_score = VALUES(synergy_score), synergy_type = VALUES(synergy_type)
    ");
    
    // Process cards
    $processedCount = 0;
    $synergiesFound = 0;
    $totalCards = count($cards);
    $lastId = $startId;
    
    echo "<div id='progress' style='margin: 20px 0;'>";
    echo "<div style='background: #eee; height: 20px; width: 100%; border-radius: 5px;'>";
    echo "<div id='progress-bar' style='background: #4CAF50; height: 20px; width: 0%; border-radius: 5px; text-align: center; color: white;'>0%</div>";
    echo "</div>";
    echo "<p id='progress-text'>Processing cards...</p>";
    echo "</div>";
    
    // Flush output buffer to show progress
    ob_flush();
    flush();
    
    foreach ($cards as $card) {
        $lastId = $card['id'];
        $cardSynergies = 0;
        
        // Skip cards without bit patterns
        if (empty($card['bit_pattern'])) {
            continue;
        }
        
        // Compare with all other cards
        foreach ($allCards as $otherCard) {
            // Skip self-comparison
            if ($card['id'] === $otherCard['id']) {
                continue;
            }
            
            // Skip cards without bit patterns
            if (empty($otherCard['bit_pattern'])) {
                continue;
            }
            
            // Calculate synergy score
            $synergyScore = calculateSynergyScore($card['bit_pattern'], $otherCard['bit_pattern'], 3);
            
            // Only store significant synergies (>55%)
            if ($synergyScore >= $synergyThreshold) {
                // Determine synergy type based on matching patterns
                $synergyType = determineSynergyType($card['bit_pattern'], $otherCard['bit_pattern']);
                
                // Store synergy in database
                $insertStmt->execute([
                    $card['id'],
                    $otherCard['id'],
                    $synergyScore,
                    $synergyType
                ]);
                
                $cardSynergies++;
                $synergiesFound++;
            }
        }
        
        // Update progress
        $processedCount++;
        $percent = round(($processedCount / $totalCards) * 100);
        
        if ($processedCount % 5 === 0 || $processedCount === $totalCards) {
            echo "<script>
                document.getElementById('progress-bar').style.width = '$percent%';
                document.getElementById('progress-bar').innerText = '$percent%';
                document.getElementById('progress-text').innerText = 'Processed $processedCount of $totalCards cards... Found $synergiesFound synergies';
            </script>";
            ob_flush();
            flush();
        }
    }
    
    echo "<h2>Batch Complete</h2>";
    echo "<p>Processed $processedCount cards</p>";
    echo "<p>Found $synergiesFound synergies</p>";
    
    // Check if there are more cards to process
    $moreCardsStmt = $pdo->prepare("SELECT COUNT(*) FROM cards WHERE id > ? AND bit_pattern IS NOT NULL");
    $moreCardsStmt->execute([$lastId]);
    $moreCards = $moreCardsStmt->fetchColumn();
    
    if ($moreCards > 0) {
        echo "<p><a href='?start_id=$lastId&batch_size=$batchSize'>Process next batch</a></p>";
    } else {
        echo "<p style='color:green'>All cards processed!</p>";
    }
    
    // Sample synergies
    echo "<h2>Sample Synergies</h2>";
    $sampleSynergies = $pdo->query("
        SELECT ca.synergy_score, ca.synergy_type, c1.name as card1_name, c2.name as card2_name
        FROM card_associations ca
        JOIN cards c1 ON ca.card1_id = c1.id
        JOIN cards c2 ON ca.card2_id = c2.id
        ORDER BY ca.synergy_score DESC
        LIMIT 10
    ")->fetchAll();
    
    if (count($sampleSynergies) > 0) {
        echo "<table border='1' cellpadding='5'>";
        echo "<tr><th>Card 1</th><th>Card 2</th><th>Synergy Score</th><th>Synergy Type</th></tr>";
        
        foreach ($sampleSynergies as $synergy) {
            echo "<tr>";
            echo "<td>{$synergy['card1_name']}</td>";
            echo "<td>{$synergy['card2_name']}</td>";
            echo "<td>" . number_format($synergy['synergy_score'] * 100, 1) . "%</td>";
            echo "<td>{$synergy['synergy_type']}</td>";
            echo "</tr>";
        }
        
        echo "</table>";
    }
    
    echo "<p><a href='index.html'>Return to Forge of Decks</a></p>";
    
} catch (PDOException $e) {
    echo "<h1 style='color:red'>Database Error</h1>";
    echo "<p>{$e->getMessage()}</p>";
}

/**
 * Determine the type of synergy between two cards based on their bit patterns
 * 
 * @param string $pattern1 First card's bit pattern
 * @param string $pattern2 Second card's bit pattern
 * @return string Synergy type description
 */
function determineSynergyType($pattern1, $pattern2) {
    global $CHARACTERISTICS;
    
    // Check for specific synergy patterns
    
    // Mana production + high cost spells
    if ($pattern1[$CHARACTERISTICS['PRODUCES_MANA']] === '1' && 
        $pattern2[$CHARACTERISTICS['REDUCES_COSTS']] === '1') {
        return 'mana_acceleration';
    }
    
    // Card draw + spellslinger
    if ($pattern1[$CHARACTERISTICS['DRAWS_CARDS']] === '1' && 
        $pattern2[$CHARACTERISTICS['SPELLSLINGER']] === '1') {
        return 'card_advantage';
    }
    
    // Token creation + anthem effects
    if (($pattern1[$CHARACTERISTICS['CREATES_TOKENS']] === '1' && 
         $pattern2[$CHARACTERISTICS['ANTHEM_EFFECTS']] === '1') ||
        ($pattern2[$CHARACTERISTICS['CREATES_TOKENS']] === '1' && 
         $pattern1[$CHARACTERISTICS['ANTHEM_EFFECTS']] === '1')) {
        return 'token_swarm';
    }
    
    // Sacrifice outlet + death triggers
    if (($pattern1[$CHARACTERISTICS['SACRIFICE_OUTLET']] === '1' && 
         $pattern2[$CHARACTERISTICS['ARISTOCRATS']] === '1') ||
        ($pattern2[$CHARACTERISTICS['SACRIFICE_OUTLET']] === '1' && 
         $pattern1[$CHARACTERISTICS['ARISTOCRATS']] === '1')) {
        return 'aristocrats';
    }
    
    // Tribal synergies
    foreach (['TRIBAL_DRAGON', 'TRIBAL_WIZARD', 'TRIBAL_ZOMBIE', 'TRIBAL_ELF', 'TRIBAL_GOBLIN', 'TRIBAL_MERFOLK'] as $tribe) {
        if ($pattern1[$CHARACTERISTICS[$tribe]] === '1' && $pattern2[$CHARACTERISTICS[$tribe]] === '1') {
            return strtolower(str_replace('TRIBAL_', '', $tribe)) . '_tribal';
        }
    }
    
    // Infinite combo potential
    if ($pattern1[$CHARACTERISTICS['INFINITE_COMBO_PIECE']] === '1' && 
        $pattern2[$CHARACTERISTICS['INFINITE_COMBO_PIECE']] === '1') {
        return 'infinite_combo';
    }
    
    // Check for strategy archetypes
    foreach (['AGGRO', 'CONTROL', 'COMBO', 'MIDRANGE', 'TEMPO', 'RAMP', 'ARISTOCRATS', 'SPELLSLINGER', 'VOLTRON', 'STAX', 'GROUP_HUG', 'MILL'] as $strategy) {
        if ($pattern1[$CHARACTERISTICS[$strategy]] === '1' && $pattern2[$CHARACTERISTICS[$strategy]] === '1') {
            return strtolower($strategy) . '_strategy';
        }
    }
    
    // Check for color identity synergies
    foreach (['WHITE_SYNERGY', 'BLUE_SYNERGY', 'BLACK_SYNERGY', 'RED_SYNERGY', 'GREEN_SYNERGY'] as $color) {
        if ($pattern1[$CHARACTERISTICS[$color]] === '1' && $pattern2[$CHARACTERISTICS[$color]] === '1') {
            return strtolower(str_replace('_SYNERGY', '', $color)) . '_synergy';
        }
    }
    
    // Default: general synergy
    return 'general_synergy';
}
?>
