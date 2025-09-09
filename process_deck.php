<?php
/**
 * MTG Deck Builder - Deck Generation API
 * Processes requests to generate optimized decks based on user collection and budget
 */

// Set unlimited execution time for potentially long operations
set_time_limit(0);
ini_set('memory_limit', '1G');

// Allow cross-origin requests
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

// Handle preflight OPTIONS request
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

// Database configuration
$dbConfig = [
    'host' => 'localhost',
    'dbname' => 'mtg_cards', // Change to your database name
    'user' => 'root',        // Change to your database user
    'pass' => ''             // Change to your database password
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

// Get request data
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data) {
    sendResponse(['error' => 'Invalid JSON data'], 400);
}

// Extract request parameters
$format = $data['format'] ?? 'commander';
$budget = floatval($data['budget'] ?? 100.0);
$collection = $data['collection'] ?? [];
$deckSize = intval($data['deckSize'] ?? 100);

// Validate parameters
if (empty($collection)) {
    sendResponse(['error' => 'Collection is empty'], 400);
}

if ($budget <= 0) {
    sendResponse(['error' => 'Budget must be greater than zero'], 400);
}

// Process the deck generation request
try {
    $result = generateDeck($pdo, $format, $budget, $collection, $deckSize);
    sendResponse($result);
} catch (Exception $e) {
    sendResponse(['error' => 'Deck generation failed: ' . $e->getMessage()], 500);
}

/**
 * Generate an optimized deck based on collection and budget
 */
function generateDeck($pdo, $format, $budget, $collection, $deckSize) {
    // Convert collection to a more usable format
    $availableCards = [];
    foreach ($collection as $card) {
        $availableCards[$card['name']] = [
            'name' => $card['name'],
            'quantity' => intval($card['quantity']),
            'price' => floatval($card['price'])
        ];
    }
    
    // Get format requirements
    $formatRequirements = getFormatRequirements($format);
    
    // Start building the deck
    $deck = [];
    $deckValue = 0;
    $cardsAdded = 0;
    
    // If Commander format, first select a commander
    $commander = null;
    if ($format === 'commander' || $format === 'brawl') {
        $commander = selectCommander($pdo, $availableCards, $budget);
        
        if ($commander) {
            $deck[] = $commander;
            $deckValue += $commander['price'];
            $cardsAdded++;
            
            // Remove commander from available cards
            $availableCards[$commander['name']]['quantity']--;
            if ($availableCards[$commander['name']]['quantity'] <= 0) {
                unset($availableCards[$commander['name']]);
            }
        }
    }
    
    // Get card synergies from database
    $synergies = [];
    if ($commander) {
        // If we have a commander, prioritize cards that synergize with it
        $synergies = getCommanderSynergies($pdo, $commander['id'], array_keys($availableCards));
    }
    
    // Build the deck based on synergies and budget
    $remainingBudget = $budget - $deckValue;
    $remainingSlots = $deckSize - $cardsAdded;
    
    // First, add high-synergy cards
    if (!empty($synergies)) {
        foreach ($synergies as $synergy) {
            if ($cardsAdded >= $deckSize) break;
            
            $cardName = $synergy['card_name'];
            
            // Skip if card is not in collection or already used up
            if (!isset($availableCards[$cardName]) || $availableCards[$cardName]['quantity'] <= 0) {
                continue;
            }
            
            $cardPrice = $availableCards[$cardName]['price'];
            
            // Skip if card is too expensive for remaining budget
            if ($cardPrice > $remainingBudget) {
                continue;
            }
            
            // Add card to deck
            $deck[] = [
                'name' => $cardName,
                'quantity' => 1,
                'price' => $cardPrice,
                'synergy_score' => $synergy['synergy_score']
            ];
            
            $deckValue += $cardPrice;
            $remainingBudget = $budget - $deckValue;
            $cardsAdded++;
            
            // Update available cards
            $availableCards[$cardName]['quantity']--;
            if ($availableCards[$cardName]['quantity'] <= 0) {
                unset($availableCards[$cardName]);
            }
        }
    }
    
    // Fill remaining slots with best available cards
    $remainingCards = array_values($availableCards);
    
    // Sort by a combination of price (lower is better) and card quality
    usort($remainingCards, function($a, $b) {
        // This is a simplified quality assessment
        // In a real implementation, you'd use card ratings or other metrics
        return $a['price'] <=> $b['price'];
    });
    
    // Add remaining cards
    foreach ($remainingCards as $card) {
        if ($cardsAdded >= $deckSize) break;
        
        $cardName = $card['name'];
        $cardPrice = $card['price'];
        $quantity = $card['quantity'];
        
        // Skip if card is too expensive for remaining budget
        if ($cardPrice > $remainingBudget) {
            continue;
        }
        
        // Add as many copies as possible (respecting format rules)
        $maxCopies = $formatRequirements['max_copies'];
        if ($format === 'commander' || $format === 'brawl') {
            $maxCopies = 1; // Only one copy of each card in Commander/Brawl
        }
        
        $copiesToAdd = min($maxCopies, $quantity, $remainingSlots);
        
        if ($copiesToAdd > 0) {
            $deck[] = [
                'name' => $cardName,
                'quantity' => $copiesToAdd,
                'price' => $cardPrice * $copiesToAdd
            ];
            
            $deckValue += $cardPrice * $copiesToAdd;
            $remainingBudget = $budget - $deckValue;
            $cardsAdded += $copiesToAdd;
            $remainingSlots -= $copiesToAdd;
        }
    }
    
    // Calculate synergy information for the deck
    $synergyInfo = calculateDeckSynergy($pdo, $deck);
    
    return [
        'deck' => $deck,
        'total_cards' => $cardsAdded,
        'total_value' => $deckValue,
        'budget_remaining' => $budget - $deckValue,
        'format' => $format,
        'commander' => $commander,
        'synergy_info' => $synergyInfo
    ];
}

/**
 * Get format requirements
 */
function getFormatRequirements($format) {
    $requirements = [
        'commander' => [
            'deck_size' => 100,
            'max_copies' => 1,
            'requires_commander' => true
        ],
        'brawl' => [
            'deck_size' => 60,
            'max_copies' => 1,
            'requires_commander' => true
        ],
        'standard' => [
            'deck_size' => 60,
            'max_copies' => 4,
            'requires_commander' => false
        ],
        'modern' => [
            'deck_size' => 60,
            'max_copies' => 4,
            'requires_commander' => false
        ],
        'pioneer' => [
            'deck_size' => 60,
            'max_copies' => 4,
            'requires_commander' => false
        ],
        'limited' => [
            'deck_size' => 40,
            'max_copies' => 4,
            'requires_commander' => false
        ]
    ];
    
    return $requirements[$format] ?? $requirements['standard'];
}

/**
 * Select a commander from available cards
 */
function selectCommander($pdo, $availableCards, $budget) {
    // Get legendary creatures from available cards
    $legendaryCreatures = [];
    
    foreach ($availableCards as $cardName => $cardData) {
        // Check if card exists in database
        $stmt = $pdo->prepare("
            SELECT id, name, type_line, oracle_text
            FROM cards
            WHERE name = ? AND type_line LIKE '%Legendary Creature%'
        ");
        $stmt->execute([$cardName]);
        $card = $stmt->fetch();
        
        if ($card && $cardData['price'] <= $budget * 0.2) { // Commander shouldn't be more than 20% of budget
            $legendaryCreatures[] = [
                'id' => $card['id'],
                'name' => $card['name'],
                'price' => $cardData['price'],
                'type_line' => $card['type_line'],
                'oracle_text' => $card['oracle_text']
            ];
        }
    }
    
    if (empty($legendaryCreatures)) {
        return null; // No suitable commander found
    }
    
    // Sort by a simple "commander quality" heuristic
    // In a real implementation, you'd use more sophisticated metrics
    usort($legendaryCreatures, function($a, $b) {
        // Simple heuristic: longer oracle text might indicate more interesting abilities
        $textLengthA = strlen($a['oracle_text']);
        $textLengthB = strlen($b['oracle_text']);
        
        return $textLengthB <=> $textLengthA;
    });
    
    // Return the best commander
    return $legendaryCreatures[0];
}

/**
 * Get cards that synergize with the commander
 */
function getCommanderSynergies($pdo, $commanderId, $availableCardNames) {
    if (empty($availableCardNames)) {
        return [];
    }
    
    // Get synergies from database
    $placeholders = implode(',', array_fill(0, count($availableCardNames), '?'));
    
    $stmt = $pdo->prepare("
        SELECT 
            c.name as card_name,
            ca.synergy_score,
            ca.combo_potential,
            ca.strategic_synergy
        FROM card_associations ca
        JOIN cards c ON (ca.card1_id = c.id OR ca.card2_id = c.id)
        WHERE (ca.card1_id = ? OR ca.card2_id = ?)
        AND c.id != ?
        AND c.name IN ($placeholders)
        ORDER BY ca.synergy_score DESC
    ");
    
    $params = array_merge([$commanderId, $commanderId, $commanderId], $availableCardNames);
    $stmt->execute($params);
    
    return $stmt->fetchAll();
}

/**
 * Calculate synergy information for the deck
 */
function calculateDeckSynergy($pdo, $deck) {
    if (count($deck) < 2) {
        return [
            'overall_score' => 0,
            'top_pairs' => [],
            'combos' => []
        ];
    }
    
    // Extract card names
    $cardNames = array_map(function($card) {
        return $card['name'];
    }, $deck);
    
    // Get card IDs from database
    $placeholders = implode(',', array_fill(0, count($cardNames), '?'));
    $stmt = $pdo->prepare("
        SELECT id, name
        FROM cards
        WHERE name IN ($placeholders)
    ");
    $stmt->execute($cardNames);
    $cardIds = [];
    
    while ($row = $stmt->fetch()) {
        $cardIds[$row['name']] = $row['id'];
    }
    
    // Get synergies between cards in the deck
    $synergies = [];
    $combos = [];
    
    foreach ($cardNames as $i => $card1) {
        if (!isset($cardIds[$card1])) continue;
        
        for ($j = $i + 1; $j < count($cardNames); $j++) {
            $card2 = $cardNames[$j];
            if (!isset($cardIds[$card2])) continue;
            
            $id1 = $cardIds[$card1];
            $id2 = $cardIds[$card2];
            
            $stmt = $pdo->prepare("
                SELECT 
                    synergy_score,
                    combo_type,
                    strategic_role
                FROM card_associations
                WHERE (card1_id = ? AND card2_id = ?) OR (card1_id = ? AND card2_id = ?)
            ");
            $stmt->execute([$id1, $id2, $id2, $id1]);
            $result = $stmt->fetch();
            
            if ($result) {
                $synergies[] = [
                    'card1' => $card1,
                    'card2' => $card2,
                    'synergy' => $result['synergy_score']
                ];
                
                // Track combos
                if ($result['combo_type']) {
                    $found = false;
                    foreach ($combos as &$combo) {
                        if ($combo['type'] === $result['combo_type']) {
                            if (!in_array($card1, $combo['cards'])) {
                                $combo['cards'][] = $card1;
                            }
                            if (!in_array($card2, $combo['cards'])) {
                                $combo['cards'][] = $card2;
                            }
                            $found = true;
                            break;
                        }
                    }
                    
                    if (!$found) {
                        $combos[] = [
                            'type' => $result['combo_type'],
                            'cards' => [$card1, $card2]
                        ];
                    }
                }
            }
        }
    }
    
    // Calculate overall synergy score
    $overallScore = 0;
    if (!empty($synergies)) {
        $totalSynergy = array_sum(array_column($synergies, 'synergy'));
        $overallScore = $totalSynergy / count($synergies);
    }
    
    // Sort synergies by score
    usort($synergies, function($a, $b) {
        return $b['synergy'] <=> $a['synergy'];
    });
    
    // Get top 10 synergy pairs
    $topPairs = array_slice($synergies, 0, 10);
    
    return [
        'overall_score' => $overallScore,
        'top_pairs' => $topPairs,
        'combos' => $combos
    ];
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
