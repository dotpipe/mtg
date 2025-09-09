<?php
/**
 * MTG Synergy System - JSON API Interface
 * 
 * This API allows automated processing and querying of the MTG synergy system.
 * 
 * Available endpoints:
 * - /api.php?action=process - Start processing all.json
 * - /api.php?action=status - Check processing status
 * - /api.php?action=search&query=CARDNAME - Search for cards
 * - /api.php?action=card&id=CARDID - Get card synergies
 * - /api.php?action=top_synergies&limit=20 - Get top synergies
 * - /api.php?action=combos&type=COMBOTYPE - Get combos
 * - /api.php?action=analyze_deck - Analyze deck (POST deck list)
 * - /api.php?action=stats - Get system statistics
 */

// Set unlimited execution time for long-running processes
set_time_limit(0);
ini_set('memory_limit', '1G');

// Allow cross-origin requests
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

// Database configuration
$dbConfig = [
    'host' => 'localhost',
    'dbname' => 'mtg_cards', // Change to your database name
    'user' => 'root',        // Change to your database user
    'pass' => ''             // Change to your database password
];

// System configuration
$config = [
    'json_file' => 'all.json',
    'batch_size' => 50,
    'synergy_threshold' => 0.70,
    'max_associations_per_card' => 15,
    'max_comparisons_per_card' => 5000,
    'include_all_card_types' => true,
    'skip_basic_lands' => true,
    'log_file' => 'synergy_process.log',
    'api_key' => 'your_secret_api_key' // Change this to a secure key
];

// Connect to database
try {
    $pdo = new PDO(
        "mysql:host={$dbConfig['host']};dbname={$dbConfig['dbname']};charset=utf8mb4",
        $dbConfig['user'],
        $dbConfig['pass'],
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4"
        ]
    );
} catch (PDOException $e) {
    sendResponse(['error' => 'Database connection failed: ' . $e->getMessage()], 500);
}

// Get action from request
$action = $_GET['action'] ?? '';

// Validate API key for sensitive operations
$apiKey = $_GET['api_key'] ?? '';
$sensitiveActions = ['process', 'reset', 'update_config'];

if (in_array($action, $sensitiveActions) && $apiKey !== $config['api_key']) {
    sendResponse(['error' => 'Invalid API key'], 403);
}

// Route to appropriate handler
switch ($action) {
    case 'process':
        handleProcess();
        break;
        
    case 'status':
        handleStatus();
        break;
        
    case 'search':
        $query = $_GET['query'] ?? '';
        handleSearch($query);
        break;
        
    case 'card':
        $cardId = $_GET['id'] ?? 0;
        handleCard($cardId);
        break;
        
    case 'top_synergies':
        $limit = $_GET['limit'] ?? 20;
        handleTopSynergies($limit);
        break;
        
    case 'combos':
        $comboType = $_GET['type'] ?? '';
        handleCombos($comboType);
        break;
        
    case 'analyze_deck':
        handleAnalyzeDeck();
        break;
        
    case 'stats':
        handleStats();
        break;
        
    case 'reset':
        handleReset();
        break;
        
    case 'update_config':
        handleUpdateConfig();
        break;

        case 'card_pair':
    handleCardPair();
    break;

    default:
        sendResponse([
            'error' => 'Invalid action',
            'available_actions' => [
                'process', 'status', 'search', 'card', 
                'top_synergies', 'combos', 'analyze_deck', 'stats'
            ]
        ], 400);
}

/**
 * Start processing all.json
 */
function handleProcess() {
    global $pdo, $config;
    
    // Check if processing is already running
    $stmt = $pdo->query("
        SELECT status FROM processing_batches 
        ORDER BY id DESC LIMIT 1
    ");
    $currentStatus = $stmt->fetch();
    
    if ($currentStatus && $currentStatus['status'] === 'processing') {
        sendResponse(['error' => 'Processing is already running'], 409);
    }
    
    // Start processing in background
    $command = sprintf(
        'php process_all_cards.php --json_file=%s --batch_size=%d --threshold=%f > /dev/null 2>&1 &',
        escapeshellarg($config['json_file']),
        $config['batch_size'],
        $config['synergy_threshold']
    );
    
    exec($command);
    
    // Create initial status record
    $pdo->exec("
        INSERT INTO processing_batches (batch_number, total_batches, status, start_time)
        VALUES (0, 0, 'processing', NOW())
    ");
    
    sendResponse([
        'status' => 'started',
        'message' => 'Processing started in background',
        'config' => [
            'json_file' => $config['json_file'],
            'batch_size' => $config['batch_size'],
            'threshold' => $config['synergy_threshold']
        ]
    ]);
}

/**
 * Check processing status
 */
function handleStatus() {
    global $pdo;
    
    $stmt = $pdo->query("
        SELECT * FROM processing_batches 
        ORDER BY id DESC LIMIT 1
    ");
    $status = $stmt->fetch();
    
    if (!$status) {
        sendResponse(['status' => 'not_started']);
    }
    
    // Calculate progress percentage
    $progress = 0;
    if ($status['total_batches'] > 0) {
        $progress = ($status['batch_number'] / $status['total_batches']) * 100;
    }
    
    // Calculate time remaining
    $timeRemaining = null;
    if ($status['status'] === 'processing' && $status['batch_number'] > 0 && $status['execution_time'] > 0) {
        $avgTimePerBatch = $status['execution_time'] / $status['batch_number'];
        $batchesRemaining = $status['total_batches'] - $status['batch_number'];
        $timeRemaining = $avgTimePerBatch * $batchesRemaining;
    }
    
    sendResponse([
        'status' => $status['status'],
        'progress' => round($progress, 2),
        'batch_number' => $status['batch_number'],
        'total_batches' => $status['total_batches'],
        'cards_processed' => $status['cards_processed'],
        'associations_created' => $status['associations_created'],
        'comparisons_made' => $status['comparisons_made'],
        'start_time' => $status['start_time'],
        'last_update' => $status['last_update'] ?? null,
        'execution_time' => $status['execution_time'],
        'estimated_time_remaining' => $timeRemaining ? round($timeRemaining) : null
    ]);
}

/**
 * Enhanced search for cards with color identity filtering
 */
function handleSearch($query) {
    global $pdo;
    
    try {
        if (empty($query)) {
            sendResponse(['error' => 'Search query is required'], 400);
        }
        
        // Get additional parameters
        $format = $_GET['format'] ?? '';
        $random = isset($_GET['random']) && $_GET['random'] === 'true';
        $limit = min(100, max(1, intval($_GET['limit'] ?? 50))); // Limit between 1 and 100
        $color = $_GET['color'] ?? ''; // Color identity filter
        
        // Build the query
        $sql = "SELECT id, name, type_line, oracle_text, mana_cost, cmc, card_type";
        
        // Add color_identity if available
        if ($pdo->query("SHOW COLUMNS FROM cards LIKE 'color_identity'")->rowCount() > 0) {
            $sql .= ", color_identity";
        }
        
        $sql .= " FROM cards WHERE (name LIKE ? OR oracle_text LIKE ?)";
        $params = ["%$query%", "%$query%"];
        
        // Add format filter if specified
        if (!empty($format)) {
            if ($format === 'commander') {
                // For commander, prioritize legendary creatures
                if (strpos(strtolower($query), 'legendary') === false && 
                    strpos(strtolower($query), 'creature') === false) {
                    $sql .= " AND (type_line LIKE '%Legendary%' AND type_line LIKE '%Creature%')";
                }
            } else if (in_array($format, ['standard', 'modern', 'pioneer', 'legacy', 'vintage'])) {
                // For other formats, check legality if available
                $legalityCheck = $pdo->query("SHOW COLUMNS FROM cards LIKE 'legalities'");
                if ($legalityCheck && $legalityCheck->rowCount() > 0) {
                    $sql .= " AND JSON_EXTRACT(legalities, '$.$format') = 'legal'";
                }
            }
        }
        
        // Add color identity filter if specified
        if (!empty($color)) {
            // Check if color_identity column exists
            $colorIdentityCheck = $pdo->query("SHOW COLUMNS FROM cards LIKE 'color_identity'");
            
            if ($colorIdentityCheck && $colorIdentityCheck->rowCount() > 0) {
                // Use color_identity column
                if ($color === 'colorless') {
                    $sql .= " AND (color_identity = '[]' OR color_identity IS NULL)";
                } else {
                    // For each color in the query, make sure it's in the card's color identity
                    $colors = str_split($color);
                    foreach ($colors as $c) {
                        $sql .= " AND JSON_CONTAINS(color_identity, '\"$c\"')";
                    }
                }
            } else {
                // Fallback to checking mana_cost
                if ($color === 'colorless') {
                    $sql .= " AND (mana_cost NOT LIKE '%W%' AND mana_cost NOT LIKE '%U%' AND mana_cost NOT LIKE '%B%' AND mana_cost NOT LIKE '%R%' AND mana_cost NOT LIKE '%G%')";
                } else {
                    // For each color in the query, check if it's in the mana cost
                    $colors = str_split($color);
                    foreach ($colors as $c) {
                        $sql .= " AND mana_cost LIKE '%$c%'";
                    }
                }
            }
        }
        
        // Add random ordering if requested
        if ($random) {
            $sql .= " ORDER BY RAND()";
        } else {
            $sql .= " ORDER BY name";
        }
        
        // Add limit directly to the SQL string for MariaDB
        $sql .= " LIMIT " . $limit;
        
        // Prepare and execute the query
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $cards = $stmt->fetchAll();
        
        sendResponse([
            'query' => $query,
            'format' => $format,
            'color' => $color,
            'count' => count($cards),
            'cards' => $cards
        ]);
    } catch (Exception $e) {
        sendResponse([
            'error' => 'Search failed: ' . $e->getMessage(),
            'trace' => $e->getTraceAsString()
        ], 500);
    }
}

/**
 * Get card synergies
 */
function handleCard($cardId) {
    global $pdo;
    
    if (empty($cardId)) {
        sendResponse(['error' => 'Card ID is required'], 400);
    }
    
    // Get card details
    $stmt = $pdo->prepare("
        SELECT id, name, type_line, oracle_text, mana_cost, cmc, card_type
        FROM cards
        WHERE id = ?
    ");
    $stmt->execute([$cardId]);
    $card = $stmt->fetch();
    
    if (!$card) {
        sendResponse(['error' => 'Card not found'], 404);
    }
    
    // Get synergies
    $stmt = $pdo->prepare("
        SELECT 
            c.id as synergy_card_id,
            c.name as synergy_card_name,
            c.type_line as synergy_card_type,
            ca.synergy_score,
            ca.text_similarity,
            ca.combo_potential,
            ca.strategic_synergy,
            ca.combo_type,
            ca.strategic_role
        FROM card_associations ca
        JOIN cards c ON (ca.card1_id = c.id OR ca.card2_id = c.id)
        WHERE (ca.card1_id = ? OR ca.card2_id = ?)
        AND c.id != ?
        ORDER BY ca.synergy_score DESC
        LIMIT 30
    ");
    $stmt->execute([$cardId, $cardId, $cardId]);
    $synergies = $stmt->fetchAll();
    
    sendResponse([
        'card' => $card,
        'synergies' => $synergies,
        'synergy_count' => count($synergies)
    ]);
}

/**
 * Get top synergies
 */
function handleTopSynergies($limit) {
    global $pdo;
    
    $limit = min(max((int)$limit, 1), 100); // Limit between 1 and 100
    
    $stmt = $pdo->prepare("
        SELECT 
            c1.id as card1_id,
            c1.name as card1_name,
            c1.type_line as card1_type,
            c2.id as card2_id,
            c2.name as card2_name,
            c2.type_line as card2_type,
            ca.synergy_score,
            ca.combo_type,
            ca.strategic_role
        FROM card_associations ca
        JOIN cards c1 ON ca.card1_id = c1.id
        JOIN cards c2 ON ca.card2_id = c2.id
        ORDER BY ca.synergy_score DESC
        LIMIT ?
    ");
    $stmt->execute([$limit]);
    $synergies = $stmt->fetchAll();
    
    sendResponse([
        'limit' => $limit,
        'synergies' => $synergies
    ]);
}

/**
 * Get combos
 */
function handleCombos($comboType) {
    global $pdo;
    
    if (!empty($comboType)) {
        // Get specific combo type
        $stmt = $pdo->prepare("
            SELECT 
                c1.id as card1_id,
                c1.name as card1_name,
                c1.type_line as card1_type,
                c2.id as card2_id,
                c2.name as card2_name,
                c2.type_line as card2_type,
                ca.synergy_score,
                ca.strategic_role
            FROM card_associations ca
            JOIN cards c1 ON ca.card1_id = c1.id
            JOIN cards c2 ON ca.card2_id = c2.id
            WHERE ca.combo_type = ?
            ORDER BY ca.synergy_score DESC
            LIMIT 50
        ");
        $stmt->execute([$comboType]);
        $combos = $stmt->fetchAll();
        
        sendResponse([
            'combo_type' => $comboType,
            'count' => count($combos),
            'combos' => $combos
        ]);
    } else {
        // Get all combo types
        $stmt = $pdo->query("
            SELECT 
                combo_type,
                COUNT(*) as count,
                AVG(synergy_score) as avg_score,
                MAX(synergy_score) as max_score
            FROM card_associations
            WHERE combo_type IS NOT NULL
            GROUP BY combo_type
            ORDER BY count DESC
        ");
        $comboTypes = $stmt->fetchAll();
        
        sendResponse([
            'count' => count($comboTypes),
            'combo_types' => $comboTypes
        ]);
    }
}

/**
 * Search for cards
 */
function handleSearch($query) {
    global $pdo;
    
    if (empty($query)) {
        sendResponse(['error' => 'Search query is required'], 400);
    }
    
    // Get additional parameters
    $format = $_GET['format'] ?? '';
    $random = isset($_GET['random']) && $_GET['random'] === 'true';
    $limit = min(50, max(1, intval($_GET['limit'] ?? 50))); // Limit between 1 and 50
    
    // Build the query
    $sql = "SELECT id, name, type_line, oracle_text, mana_cost, cmc, card_type";
    
    // Add synergy count if available
    if ($pdo->query("SHOW COLUMNS FROM cards LIKE 'synergy_count'")->rowCount() > 0) {
        $sql .= ", synergy_count";
    }
    
    // Add combo potential if available
    if ($pdo->query("SHOW COLUMNS FROM cards LIKE 'combo_potential'")->rowCount() > 0) {
        $sql .= ", combo_potential";
    }
    
    $sql .= " FROM cards WHERE (name LIKE ? OR oracle_text LIKE ?)";
    
    // Add format filter if specified
    if (!empty($format)) {
        $sql .= " AND legalities->>'$.{$format}' = 'legal'";
    }
    
    // Add random ordering if requested
    if ($random) {
        $sql .= " ORDER BY RAND()";
    } else {
        $sql .= " ORDER BY name";
    }
    
    $sql .= " LIMIT ?";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute(["%$query%", "%$query%", $limit]);
    $cards = $stmt->fetchAll();
    
    sendResponse([
        'query' => $query,
        'format' => $format,
        'count' => count($cards),
        'cards' => $cards
    ]);
}

/**
 * Get synergy between two specific cards
 */
function handleCardPair() {
    global $pdo;
    
    try {
        $card1Id = $_GET['card1_id'] ?? 0;
        $card2Id = $_GET['card2_id'] ?? 0;
        
        if (empty($card1Id) || empty($card2Id)) {
            sendResponse(['error' => 'Both card IDs are required'], 400);
        }
        
        // Check if card_associations table exists
        $tableCheck = $pdo->query("SHOW TABLES LIKE 'card_associations'");
        $tableExists = ($tableCheck !== false) && ($tableCheck->rowCount() > 0);
        
        if (!$tableExists) {
            sendResponse(['error' => 'Card associations table does not exist']);
        }
        
        // Get available columns
        $columns = [];
        $columnsResult = $pdo->query("SHOW COLUMNS FROM card_associations");
        while ($column = $columnsResult->fetch()) {
            $columns[] = $column['Field'];
        }
        
        // Build query based on available columns
        $selectFields = ["synergy_score"];
        
        // Add optional columns if they exist
        if (in_array('text_similarity', $columns)) {
            $selectFields[] = "text_similarity";
        }
        
        if (in_array('combo_potential', $columns)) {
            $selectFields[] = "combo_potential";
        }
        
        if (in_array('strategic_synergy', $columns)) {
            $selectFields[] = "strategic_synergy";
        }
        
        if (in_array('combo_type', $columns)) {
            $selectFields[] = "combo_type";
        }
        
        if (in_array('strategic_role', $columns)) {
            $selectFields[] = "strategic_role";
        }
        
        // Build the query
        $query = "
            SELECT " . implode(", ", $selectFields) . "
            FROM card_associations
            WHERE (card1_id = ? AND card2_id = ?) OR (card1_id = ? AND card2_id = ?)
            LIMIT 1
        ";
        
        // Execute the query
        $stmt = $pdo->prepare($query);
        $stmt->execute([$card1Id, $card2Id, $card2Id, $card1Id]);
        $synergy = $stmt->fetch();
        
        // Get card details
        $card1Stmt = $pdo->prepare("SELECT name, type_line FROM cards WHERE id = ?");
        $card1Stmt->execute([$card1Id]);
        $card1 = $card1Stmt->fetch();
        
        $card2Stmt = $pdo->prepare("SELECT name, type_line FROM cards WHERE id = ?");
        $card2Stmt->execute([$card2Id]);
        $card2 = $card2Stmt->fetch();
        
        sendResponse([
            'card1' => $card1,
            'card2' => $card2,
            'synergy' => $synergy
        ]);
    } catch (Exception $e) {
        sendResponse([
            'error' => 'Failed to get card pair synergy: ' . $e->getMessage(),
            'card1_id' => $_GET['card1_id'] ?? 0,
            'card2_id' => $_GET['card2_id'] ?? 0
        ], 500);
    }
}

/**
 * Analyze deck
 */
function handleAnalyzeDeck() {
    global $pdo;
    
    // Get deck list from POST data
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    
    if (!$data || !isset($data['deck'])) {
        // Try to get from POST form data
        $deckList = $_POST['deck'] ?? '';
        if (empty($deckList)) {
            sendResponse(['error' => 'Deck list is required in POST body'], 400);
        }
        $deckLines = explode("\n", $deckList);
    } else {
        $deckLines = $data['deck'];
    }
    
    $deckCards = [];
    foreach ($deckLines as $line) {
        $line = trim(preg_replace('/^\d+x?\s+/', '', $line));
        if (!empty($line)) {
            $deckCards[] = $line;
        }
    }
    
    if (empty($deckCards)) {
        sendResponse(['error' => 'No valid cards found in deck list'], 400);
    }
    
    // Find card IDs
    $cardIds = [];
    $notFound = [];
    
    foreach ($deckCards as $cardName) {
        $stmt = $pdo->prepare("SELECT id, name FROM cards WHERE name = ?");
        $stmt->execute([$cardName]);
        $card = $stmt->fetch();
        
        if ($card) {
            $cardIds[$card['id']] = $card['name'];
        } else {
            $notFound[] = $cardName;
        }
    }
    
    // Find synergies within the deck
    $synergies = [];
    
    foreach ($cardIds as $id1 => $name1) {
        foreach ($cardIds as $id2 => $name2) {
            if ($id1 >= $id2) continue;
            
            $stmt = $pdo->prepare("
                SELECT synergy_score, combo_type, strategic_role
                FROM card_associations
                WHERE (card1_id = ? AND card2_id = ?) OR (card1_id = ? AND card2_id = ?)
            ");
            $stmt->execute([$id1, $id2, $id2, $id1]);
            $result = $stmt->fetch();
            
            if ($result) {
                $synergies[] = [
                    'card1_id' => $id1,
                    'card1_name' => $name1,
                    'card2_id' => $id2,
                    'card2_name' => $name2,
                    'synergy_score' => $result['synergy_score'],
                    'combo_type' => $result['combo_type'],
                    'strategic_role' => $result['strategic_role']
                ];
            }
        }
    }
    
    // Sort by synergy score
    usort($synergies, function($a, $b) {
        return $b['synergy_score'] <=> $a['synergy_score'];
    });
    
    // Calculate average synergy
    $totalSynergy = 0;
    foreach ($synergies as $synergy) {
        $totalSynergy += $synergy['synergy_score'];
    }
    $avgSynergy = count($synergies) > 0 ? $totalSynergy / count($synergies) : 0;
    
    // Count combo types
    $comboTypes = [];
    foreach ($synergies as $synergy) {
        if (!empty($synergy['combo_type'])) {
            $comboTypes[$synergy['combo_type']] = ($comboTypes[$synergy['combo_type']] ?? 0) + 1;
        }
    }
    
    // Find suggested cards
    $suggestions = [];
    
    foreach ($cardIds as $deckCardId => $deckCardName) {
        $stmt = $pdo->prepare("
            SELECT 
                c.id, 
                c.name,
                c.type_line,
                ca.synergy_score,
                ca.combo_type
            FROM card_associations ca
            JOIN cards c ON (ca.card1_id = c.id OR ca.card2_id = c.id)
            WHERE (ca.card1_id = ? OR ca.card2_id = ?)
            AND c.id != ?
            AND c.id NOT IN (" . implode(',', array_keys($cardIds)) . ")
            AND ca.synergy_score >= 0.8
            ORDER BY ca.synergy_score DESC
            LIMIT 5
        ");
        $stmt->execute([$deckCardId, $deckCardId, $deckCardId]);
        $results = $stmt->fetchAll();
        
        foreach ($results as $result) {
            $cardId = $result['id'];
            if (!isset($suggestions[$cardId])) {
                $suggestions[$cardId] = [
                    'id' => $cardId,
                    'name' => $result['name'],
                    'type_line' => $result['type_line'],
                    'synergy_with' => [],
                    'total_synergy' => 0,
                    'combo_types' => []
                ];
            }
            
            $suggestions[$cardId]['synergy_with'][$deckCardName] = $result['synergy_score'];
            $suggestions[$cardId]['total_synergy'] += $result['synergy_score'];
            
            if (!empty($result['combo_type'])) {
                $suggestions[$cardId]['combo_types'][] = $result['combo_type'];
            }
        }
    }
    
    // Sort suggestions by total synergy
    uasort($suggestions, function($a, $b) {
        return $b['total_synergy'] <=> $a['total_synergy'];
    });
    
    sendResponse([
        'deck_size' => count($deckCards),
        'cards_found' => count($cardIds),
        'cards_not_found' => $notFound,
        'synergy_count' => count($synergies),
        'average_synergy' => $avgSynergy,
        'combo_types' => $comboTypes,
        'top_synergies' => array_slice($synergies, 0, 20),
        'suggestions' => array_values(array_slice($suggestions, 0, 10, true))
    ]);
}

/**
 * Get system statistics
 */
function handleStats() {
    global $pdo;
    
    // Card counts
    $cardCount = $pdo->query("SELECT COUNT(*) FROM cards")->fetchColumn();
    $cardWithTextCount = $pdo->query("SELECT COUNT(*) FROM cards WHERE oracle_text IS NOT NULL AND oracle_text != ''")->fetchColumn();
    
    // Association counts
    $associationCount = $pdo->query("SELECT COUNT(*) FROM card_associations")->fetchColumn();
    $avgSynergy = $pdo->query("SELECT AVG(synergy_score) FROM card_associations")->fetchColumn();
    $highSynergyCount = $pdo->query("SELECT COUNT(*) FROM card_associations WHERE synergy_score >= 0.9")->fetchColumn();
    
    // Card type distribution
    $cardTypes = $pdo->query("
        SELECT card_type, COUNT(*) as count
        FROM cards
        GROUP BY card_type
        ORDER BY count DESC
    ")->fetchAll();
    
    // Combo type distribution
    $comboTypes = $pdo->query("
        SELECT combo_type, COUNT(*) as count
        FROM card_associations
        WHERE combo_type IS NOT NULL
        GROUP BY combo_type
        ORDER BY count DESC
    ")->fetchAll();
    
    // Processing history
    $processingHistory = $pdo->query("
        SELECT 
            id, 
            batch_number, 
            total_batches, 
            cards_processed, 
            associations_created,
            status,
            start_time,
            execution_time
        FROM processing_batches
        ORDER BY id DESC
        LIMIT 10
    ")->fetchAll();
    
    sendResponse([
        'card_stats' => [
            'total_cards' => $cardCount,
            'cards_with_text' => $cardWithTextCount,
            'card_types' => $cardTypes
        ],
        'synergy_stats' => [
            'total_associations' => $associationCount,
            'average_synergy' => $avgSynergy,
            'high_synergy_count' => $highSynergyCount,
            'combo_types' => $comboTypes
        ],
        'processing_history' => $processingHistory
    ]);
}

/**
 * Reset the system
 */
function handleReset() {
    global $pdo;
    
    // Check if processing is running
    $stmt = $pdo->query("
        SELECT status FROM processing_batches 
        WHERE status = 'processing'
        ORDER BY id DESC LIMIT 1
    ");
    $currentStatus = $stmt->fetch();
    
    if ($currentStatus) {
        sendResponse(['error' => 'Cannot reset while processing is running'], 409);
    }
    
    // Reset tables
    $pdo->exec("TRUNCATE TABLE card_associations");
    $pdo->exec("TRUNCATE TABLE processing_batches");
    
    sendResponse([
        'status' => 'success',
        'message' => 'System reset successfully'
    ]);
}

/**
 * Update configuration
 */
function handleUpdateConfig() {
    global $config;
    
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    
    if (!$data) {
        sendResponse(['error' => 'Invalid JSON data'], 400);
    }
    
    $validConfigKeys = [
        'batch_size', 'synergy_threshold', 'max_associations_per_card', 
        'max_comparisons_per_card', 'include_all_card_types', 'skip_basic_lands'
    ];
    
    $updatedConfig = [];
    
    foreach ($validConfigKeys as $key) {
        if (isset($data[$key])) {
            $config[$key] = $data[$key];
            $updatedConfig[$key] = $data[$key];
        }
    }
    
    if (empty($updatedConfig)) {
        sendResponse(['error' => 'No valid configuration keys provided'], 400);
    }
    
    sendResponse([
        'status' => 'success',
        'message' => 'Configuration updated',
        'updated_config' => $updatedConfig,
        'current_config' => $config
    ]);
}

/**
 * Send JSON response
 */
function sendResponse($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_PRETTY_PRINT);
    exit;
}


?>
