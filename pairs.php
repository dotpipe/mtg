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
    
    echo "<h1>Generate Card Bit Patterns</h1>";
    
    // Check if bit_pattern column exists
    $columnCheck = $pdo->query("SHOW COLUMNS FROM cards LIKE 'bit_pattern'");
    if ($columnCheck->rowCount() === 0) {
        $pdo->exec("ALTER TABLE cards ADD COLUMN bit_pattern VARCHAR(64)");
        echo "<p style='color:green'>Added bit_pattern column to cards table</p>";
    } else {
        echo "<p>bit_pattern column already exists</p>";
    }
    
    // Get batch parameters
    $batchSize = isset($_GET['batch_size']) ? intval($_GET['batch_size']) : 500;
    $startId = isset($_GET['start_id']) ? intval($_GET['start_id']) : 0;
    
    // Get cards for this batch
    $stmt = $pdo->prepare("
        SELECT id, name, type_line, oracle_text, mana_cost, cmc, color_identity
        FROM cards
        WHERE id > ?
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
    
    // Prepare update statement
    $updateStmt = $pdo->prepare("UPDATE cards SET bit_pattern = ? WHERE id = ?");
    
    // Process cards
    $processedCount = 0;
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
        // Generate bit pattern
        $bitPattern = generateCardBitPattern($card);
        
        // Update database
        $updateStmt->execute([$bitPattern, $card['id']]);
        
        // Update progress
        $processedCount++;
        $percent = round(($processedCount / $totalCards) * 100);
        $lastId = $card['id'];
        
        if ($processedCount % 50 === 0 || $processedCount === $totalCards) {
            echo "<script>
                document.getElementById('progress-bar').style.width = '$percent%';
                document.getElementById('progress-bar').innerText = '$percent%';
                document.getElementById('progress-text').innerText = 'Processed $processedCount of $totalCards cards...';
            </script>";
            ob_flush();
            flush();
        }
    }
    
    echo "<h2>Batch Complete</h2>";
    echo "<p>Generated bit patterns for $processedCount cards</p>";
    
    // Check if there are more cards to process
    $moreCardsStmt = $pdo->prepare("SELECT COUNT(*) FROM cards WHERE id > ?");
    $moreCardsStmt->execute([$lastId]);
    $moreCards = $moreCardsStmt->fetchColumn();
    
    if ($moreCards > 0) {
        echo "<p><a href='?start_id=$lastId&batch_size=$batchSize'>Process next batch</a></p>";
    } else {
        echo "<p style='color:green'>All cards processed!</p>";
    }
    
    // Sample bit patterns
    echo "<h2>Sample Bit Patterns</h2>";
    $sampleCards = $pdo->query("SELECT id, name, bit_pattern FROM cards WHERE bit_pattern IS NOT NULL LIMIT 5")->fetchAll();
    
    if (count($sampleCards) > 0) {
        echo "<table border='1' cellpadding='5'>";
        echo "<tr><th>ID</th><th>Name</th><th>Bit Pattern</th></tr>";
        
        foreach ($sampleCards as $card) {
            echo "<tr>";
            echo "<td>{$card['id']}</td>";
            echo "<td>{$card['name']}</td>";
            echo "<td><code>{$card['bit_pattern']}</code></td>";
            echo "</tr>";
        }
        
        echo "</table>";
    }
    
    echo "<p><a href='calculate-synergies.php'>Calculate Synergies</a></p>";
    echo "<p><a href='index.html'>Return to Forge of Decks</a></p>";
    
} catch (PDOException $e) {
    echo "<h1 style='color:red'>Database Error</h1>";
    echo "<p>{$e->getMessage()}</p>";
}
?>
