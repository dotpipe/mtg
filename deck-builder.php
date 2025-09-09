<?php
// Advanced MTG Deckbuilder with Multi-Dimensional Synergy Analysis
// Extends the existing bitstream processor

class AdvancedDeckbuilder extends DatabaseBitstreamProcessor {
    private $synergyMatrix;
    private $cardCache;
    private $deckConstraints;
    private $synergyThresholds;
    
    public function __construct($dbConfig, $config, $characteristics) {
        parent::__construct($dbConfig, $config, $characteristics);
        
        $this->synergyMatrix = [];
        $this->cardCache = [];
        $this->deckConstraints = [
            'total_cards' => 60,
            'min_lands' => 20,
            'max_lands' => 26,
            'min_creatures' => 8,
            'max_creatures' => 24,
            'min_spells' => 8,
            'max_spells' => 32,
            'max_copies_per_card' => 4,
            'max_cmc_average' => 4.0,
            'min_synergy_score' => 2.0
        ];
        
        $this->synergyThresholds = [
            1 => 0.05,  // 1 star: minimal synergy
            2 => 0.15,  // 2 stars: basic synergy
            3 => 0.25,  // 3 stars: good synergy
            4 => 0.35,  // 4 stars: strong synergy
            5 => 0.45   // 5 stars: exceptional synergy
        ];
    }
    
    public function initializeDeckbuilderTables() {
        // Create deck storage table
        $this->pdo->exec("
            CREATE TABLE IF NOT EXISTS generated_decks (
                id INT AUTO_INCREMENT PRIMARY KEY,
                deck_name VARCHAR(255) NOT NULL,
                commander_id INT NULL,
                total_synergy_score FLOAT NOT NULL,
                average_synergy_score FLOAT NOT NULL,
                mana_curve JSON NOT NULL,
                color_identity JSON NOT NULL,
                deck_composition JSON NOT NULL,
                generation_method VARCHAR(100) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_synergy_score (total_synergy_score),
                INDEX idx_avg_synergy (average_synergy_score),
                INDEX idx_commander (commander_id),
                INDEX idx_generation_method (generation_method)
            ) ENGINE=InnoDB
        ");
        
        // Create deck cards relationship table
        $this->pdo->exec("
            CREATE TABLE IF NOT EXISTS deck_cards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                deck_id INT NOT NULL,
                card_id INT NOT NULL,
                quantity INT NOT NULL DEFAULT 1,
                card_role VARCHAR(50) NOT NULL,
                synergy_contribution FLOAT NOT NULL DEFAULT 0.0,
                synergy_stars INT NOT NULL DEFAULT 1,
                
                INDEX idx_deck_id (deck_id),
                INDEX idx_card_id (card_id),
                INDEX idx_synergy_stars (synergy_stars),
                FOREIGN KEY (deck_id) REFERENCES generated_decks(id) ON DELETE CASCADE
            ) ENGINE=InnoDB
        ");
        
        // Create synergy relationships cache
        $this->pdo->exec("
            CREATE TABLE IF NOT EXISTS synergy_cache (
                id INT AUTO_INCREMENT PRIMARY KEY,
                card1_id INT NOT NULL,
                card2_id INT NOT NULL,
                synergy_score FLOAT NOT NULL,
                synergy_stars INT NOT NULL,
                shared_characteristics JSON NOT NULL,
                synergy_type VARCHAR(100) NOT NULL,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_card1 (card1_id),
                INDEX idx_card2 (card2_id),
                INDEX idx_synergy_score (synergy_score),
                INDEX idx_synergy_stars (synergy_stars),
                UNIQUE KEY unique_pair (card1_id, card2_id)
            ) ENGINE=InnoDB
        ");
        
        // Create multi-dimensional synergy matrix table
        $this->pdo->exec("
            CREATE TABLE IF NOT EXISTS synergy_matrix (
                id INT AUTO_INCREMENT PRIMARY KEY,
                dimension_name VARCHAR(100) NOT NULL,
                card_id INT NOT NULL,
                dimension_vector JSON NOT NULL,
                synergy_weights JSON NOT NULL,
                calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                
                INDEX idx_dimension (dimension_name),
                INDEX idx_card_id (card_id),
                UNIQUE KEY unique_card_dimension (card_id, dimension_name)
            ) ENGINE=InnoDB
        ");
    }
    
    public function buildMultiDimensionalMatrix() {
        echo "<h3>Building Multi-Dimensional Synergy Matrix...</h3>";
        
        // Define synergy dimensions
        $dimensions = [
            'mana_curve' => $this->calculateManaCurveDimension(),
            'color_synergy' => $this->calculateColorSynergyDimension(),
            'tribal_synergy' => $this->calculateTribalSynergyDimension(),
            'mechanic_synergy' => $this->calculateMechanicSynergyDimension(),
            'card_advantage' => $this->calculateCardAdvantageDimension(),
            'tempo_control' => $this->calculateTempoControlDimension(),
            'win_condition' => $this->calculateWinConditionDimension(),
            'removal_utility' => $this->calculateRemovalUtilityDimension()
        ];
        
        $totalCards = 0;
        $processedCards = 0;
        
        foreach ($dimensions as $dimensionName => $dimensionData) {
            echo "<p>Processing dimension: <strong>{$dimensionName}</strong></p>";
            
            foreach ($dimensionData as $cardId => $vector) {
                $this->storeDimensionVector($cardId, $dimensionName, $vector);
                $processedCards++;
            }
            
            $totalCards += count($dimensionData);
        }
        
        echo "<div class='success'>✓ Multi-dimensional matrix built successfully!</div>";
        echo "<p>Processed {$processedCards} card-dimension pairs across " . count($dimensions) . " dimensions.</p>";
        
        return $dimensions;
    }
    
    private function calculateManaCurveDimension() {
        $sql = "
            SELECT c.id, c.cmc, c.type_line, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        
        foreach ($cards as $card) {
            $cmc = intval($card['cmc']);
            $isLand = strpos(strtolower($card['type_line']), 'land') !== false;
            
            // Mana curve positioning (0-7+ CMC)
            $curvePosition = min($cmc, 7);
            
            // Calculate curve synergy weights
            $vector = [
                'cmc' => $cmc,
                'curve_position' => $curvePosition,
                'is_land' => $isLand ? 1 : 0,
                'early_game' => $cmc <= 2 ? 1 : 0,
                'mid_game' => ($cmc >= 3 && $cmc <= 5) ? 1 : 0,
                'late_game' => $cmc >= 6 ? 1 : 0,
                'mana_efficiency' => $isLand ? 1.0 : ($cmc > 0 ? 1.0 / $cmc : 1.0)
            ];
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateColorSynergyDimension() {
        $sql = "
            SELECT c.id, c.colors, c.color_identity, c.mana_cost, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        
        foreach ($cards as $card) {
            $colors = json_decode($card['colors'] ?? '[]', true) ?: [];
            $colorIdentity = json_decode($card['color_identity'] ?? '[]', true) ?: [];
            
            $vector = [
                'white' => in_array('W', $colors) ? 1 : 0,
                'blue' => in_array('U', $colors) ? 1 : 0,
                'black' => in_array('B', $colors) ? 1 : 0,
                'red' => in_array('R', $colors) ? 1 : 0,
                'green' => in_array('G', $colors) ? 1 : 0,
                'colorless' => empty($colors) ? 1 : 0,
                'multicolor' => count($colors) > 1 ? 1 : 0,
                'color_count' => count($colors),
                'identity_count' => count($colorIdentity),
                'devotion_weight' => $this->calculateDevotionWeight($card['mana_cost'])
            ];
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateTribalSynergyDimension() {
        $sql = "
            SELECT c.id, c.type_line, c.subtypes, c.oracle_text, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        $tribalTypes = ['human', 'wizard', 'warrior', 'beast', 'dragon', 'angel', 'demon', 'elemental', 'goblin', 'elf', 'zombie', 'vampire'];
        
        foreach ($cards as $card) {
            $subtypes = json_decode($card['subtypes'] ?? '[]', true) ?: [];
            $subtypesLower = array_map('strtolower', $subtypes);
            $oracleText = strtolower($card['oracle_text'] ?? '');
            
            $vector = [
                'is_tribal' => !empty(array_intersect($subtypesLower, $tribalTypes)) ? 1 : 0,
                'tribal_support' => 0,
                'creature_count_matters' => 0
            ];
            
            // Check for tribal support
            foreach ($tribalTypes as $tribe) {
                if (in_array($tribe, $subtypesLower)) {
                    $vector[$tribe] = 1;
                } else {
                    $vector[$tribe] = 0;
                }
                
                if (strpos($oracleText, $tribe) !== false) {
                    $vector['tribal_support'] = 1;
                }
            }
            
            // Check for creature count matters
            if (strpos($oracleText, 'creature') !== false && 
                (strpos($oracleText, 'control') !== false || strpos($oracleText, 'number') !== false)) {
                $vector['creature_count_matters'] = 1;
            }
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateMechanicSynergyDimension() {
        $sql = "
            SELECT c.id, c.oracle_text, c.keywords, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        $mechanics = [
            'flying', 'trample', 'vigilance', 'haste', 'first_strike', 'double_strike',
            'deathtouch', 'lifelink', 'hexproof', 'indestructible', 'menace',
            'flashback', 'cycling', 'kicker', 'morph', 'suspend', 'storm',
            'affinity', 'convoke', 'delve', 'emerge', 'proliferate'
        ];
        
        foreach ($cards as $card) {
            $oracleText = strtolower($card['oracle_text'] ?? '');
            $keywords = json_decode($card['keywords'] ?? '[]', true) ?: [];
            $keywordsLower = array_map('strtolower', $keywords);
            
            $vector = [];
            
            foreach ($mechanics as $mechanic) {
                $mechanicClean = str_replace('_', ' ', $mechanic);
                $vector[$mechanic] = (
                    strpos($oracleText, $mechanicClean) !== false || 
                    in_array($mechanicClean, $keywordsLower)
                ) ? 1 : 0;
            }
            
            // Calculate mechanic density
            $vector['mechanic_density'] = array_sum($vector) / count($mechanics);
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateCardAdvantageDimension() {
        $sql = "
            SELECT c.id, c.oracle_text, c.type_line, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        
        foreach ($cards as $card) {
            $oracleText = strtolower($card['oracle_text'] ?? '');
            
            $vector = [
                'draws_cards' => (strpos($oracleText, 'draw') !== false && strpos($oracleText, 'card') !== false) ? 1 : 0,
                'tutors_cards' => (strpos($oracleText, 'search') !== false && strpos($oracleText, 'library') !== false) ? 1 : 0,
                'creates_tokens' => (strpos($oracleText, 'create') !== false && strpos($oracleText, 'token') !== false) ? 1 : 0,
                'returns_from_graveyard' => (strpos($oracleText, 'return') !== false && strpos($oracleText, 'graveyard') !== false) ? 1 : 0,
                'card_selection' => (strpos($oracleText, 'scry') !== false || strpos($oracleText, 'surveil') !== false) ? 1 : 0,
                'value_engine' => 0
            ];
            
            // Calculate value engine potential
            $advantageScore = array_sum(array_slice($vector, 0, -1));
            $vector['value_engine'] = $advantageScore >= 2 ? 1 : 0;
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateTempoControlDimension() {
        $sql = "
            SELECT c.id, c.oracle_text, c.type_line, c.cmc, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        
        foreach ($cards as $card) {
            $oracleText = strtolower($card['oracle_text'] ?? '');
            $typeLine = strtolower($card['type_line'] ?? '');
            $cmc = intval($card['cmc']);
            
            $vector = [
                'removal' => (strpos($oracleText, 'destroy') !== false || strpos($oracleText, 'exile') !== false) ? 1 : 0,
                'counterspell' => (strpos($oracleText, 'counter') !== false && strpos($oracleText, 'spell') !== false) ? 1 : 0,
                'bounce' => (strpos($oracleText, 'return') !== false && strpos($oracleText, 'hand') !== false) ? 1 : 0,
                'tap_effect' => strpos($oracleText, 'tap') !== false ? 1 : 0,
                'haste' => strpos($oracleText, 'haste') !== false ? 1 : 0,
                'flash' => strpos($oracleText, 'flash') !== false ? 1 : 0,
                'instant_speed' => strpos($typeLine, 'instant') !== false ? 1 : 0,
                'tempo_rating' => 0
            ];
            
            // Calculate tempo rating based on speed and disruption
            $tempoScore = 0;
            if ($cmc <= 2) $tempoScore += 2;
            elseif ($cmc <= 4) $tempoScore += 1;
            
            $tempoScore += $vector['removal'] + $vector['counterspell'] + $vector['bounce'] + $vector['haste'] + $vector['flash'];
            
            $vector['tempo_rating'] = min($tempoScore / 5.0, 1.0);
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateWinConditionDimension() {
        $sql = "
            SELECT c.id, c.oracle_text, c.type_line, c.power, c.toughness, c.loyalty, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        
        foreach ($cards as $card) {
            $oracleText = strtolower($card['oracle_text'] ?? '');
            $typeLine = strtolower($card['type_line'] ?? '');
            $power = $card['power'] ? intval($card['power']) : 0;
            $toughness = $card['toughness'] ? intval($card['toughness']) : 0;
            
            $vector = [
                'combat_threat' => 0,
                'burn_damage' => (strpos($oracleText, 'deals') !== false && strpos($oracleText, 'damage') !== false) ? 1 : 0,
                'alternate_wincon' => (strpos($oracleText, 'win') !== false || strpos($oracleText, 'lose') !== false) ? 1 : 0,
                'planeswalker_threat' => strpos($typeLine, 'planeswalker') !== false ? 1 : 0,
                'evasion' => 0,
                'threat_level' => 0
            ];
            
            // Combat threat assessment
            if (strpos($typeLine, 'creature') !== false) {
                if ($power >= 4) $vector['combat_threat'] = 1;
                
                // Evasion abilities
                if (strpos($oracleText, 'flying') !== false || 
                    strpos($oracleText, 'unblockable') !== false ||
                    strpos($oracleText, 'trample') !== false) {
                    $vector['evasion'] = 1;
                }
            }
            
            // Overall threat level
            $threatScore = $vector['combat_threat'] + $vector['burn_damage'] + 
                          $vector['alternate_wincon'] + $vector['planeswalker_threat'] + $vector['evasion'];
            
            $vector['threat_level'] = min($threatScore / 5.0, 1.0);
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateRemovalUtilityDimension() {
        $sql = "
            SELECT c.id, c.oracle_text, c.type_line, c.cmc, cb.basic_bitstream
            FROM cards c
            JOIN card_bitstreams cb ON c.id = cb.card_id
            WHERE cb.bitstream_version = '2.0'
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        $dimension = [];
        
        foreach ($cards as $card) {
            $oracleText = strtolower($card['oracle_text'] ?? '');
            $cmc = intval($card['cmc']);
            
            $vector = [
                'creature_removal' => (strpos($oracleText, 'destroy') !== false && strpos($oracleText, 'creature') !== false) ? 1 : 0,
                'artifact_removal' => (strpos($oracleText, 'destroy') !== false && strpos($oracleText, 'artifact') !== false) ? 1 : 0,
                'enchantment_removal' => (strpos($oracleText, 'destroy') !== false && strpos($oracleText, 'enchantment') !== false) ? 1 : 0,
                'planeswalker_removal' => (strpos($oracleText, 'damage') !== false && strpos($oracleText, 'planeswalker') !== false) ? 1 : 0,
                'mass_removal' => (strpos($oracleText, 'all') !== false && strpos($oracleText, 'destroy') !== false) ? 1 : 0,
                'exile_removal' => strpos($oracleText, 'exile') !== false ? 1 : 0,
                'utility_rating' => 0
            ];
            
            // Calculate utility rating
            $utilityScore = array_sum(array_slice($vector, 0, -1));
            
            // Efficiency bonus for low CMC
            if ($cmc <= 2 && $utilityScore > 0) $utilityScore += 1;
            elseif ($cmc <= 4 && $utilityScore > 0) $utilityScore += 0.5;
            
            $vector['utility_rating'] = min($utilityScore / 7.0, 1.0);
            
            $dimension[$card['id']] = $vector;
        }
        
        return $dimension;
    }
    
    private function calculateDevotionWeight($manaCost) {
        if (empty($manaCost)) return 0;
        
        $devotion = 0;
        $manaCost = strtolower($manaCost);
        
        // Count colored mana symbols
        $devotion += substr_count($manaCost, 'w');
        $devotion += substr_count($manaCost, 'u');
        $devotion += substr_count($manaCost, 'b');
        $devotion += substr_count($manaCost, 'r');
        $devotion += substr_count($manaCost, 'g');
        
        return $devotion;
    }
    
    private function storeDimensionVector($cardId, $dimensionName, $vector) {
        $sql = "
            INSERT INTO synergy_matrix (card_id, dimension_name, dimension_vector, synergy_weights)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                dimension_vector = VALUES(dimension_vector),
                synergy_weights = VALUES(synergy_weights),
                calculated_at = CURRENT_TIMESTAMP
        ";
        
        $weights = $this->calculateSynergyWeights($vector);
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            $cardId,
            $dimensionName,
            json_encode($vector),
            json_encode($weights)
        ]);
    }
    
    private function calculateSynergyWeights($vector) {
        $weights = [];
        $totalValue = array_sum($vector);
        
        foreach ($vector as $key => $value) {
            $weights[$key] = $totalValue > 0 ? $value / $totalValue : 0;
        }
        
        return $weights;
    }
    
    public function calculateRecursiveSynergy($cardId, $depth = 3, $visited = []) {
        if ($depth <= 0 || in_array($cardId, $visited)) {
            return [];
        }
        
        $visited[] = $cardId;
        $synergies = [];
        
        // Get direct synergies
        $directSynergies = $this->findSimilarCards($cardId, 20, 0.1);
        
        foreach ($directSynergies as $synergy) {
            $synergyScore = $synergy['similarity_score'];
            $stars = $this->calculateSynergyStars($synergyScore);
            
            $synergies[$synergy['card_id']] = [
                'card_id' => $synergy['card_id'],
                'name' => $synergy['name'],
                'direct_synergy' => $synergyScore,
                'stars' => $stars,
                'depth' => 4 - $depth,
                'path' => array_merge($visited, [$synergy['card_id']])
            ];
            
            // Recursive synergies (with diminishing returns)
            if ($stars >= 2) {
                $recursiveSynergies = $this->calculateRecursiveSynergy(
                    $synergy['card_id'], 
                    $depth - 1, 
                    $visited
                );
                
                foreach ($recursiveSynergies as $recSynergy) {
                    $combinedScore = ($synergyScore + $recSynergy['direct_synergy']) / 2;
                    $recSynergy['combined_synergy'] = $combinedScore;
                    $recSynergy['recursive_depth'] = $recSynergy['depth'];
                    
                    if (!isset($synergies[$recSynergy['card_id']]) || 
                        $combinedScore > $synergies[$recSynergy['card_id']]['combined_synergy']) {
                        $synergies[$recSynergy['card_id']] = $recSynergy;
                    }
                }
            }
        }
        
        return $synergies;
    }
    
    private function calculateSynergyStars($synergyScore) {
        foreach ($this->synergyThresholds as $stars => $threshold) {
            if ($synergyScore >= $threshold) {
                return $stars;
            }
        }
        return 1;
    }
    
    public function buildOptimalDeck($commanderCardId, $deckSize = 60) {
        echo "<h3>Building Optimal Deck for Card ID: {$commanderCardId}</h3>";
        
        $startTime = microtime(true);
        
        // Get commander card info
        $commander = $this->getCardInfo($commanderCardId);
        if (!$commander) {
            throw new Exception("Commander card not found");
        }
        
        echo "<div class='card-preview'>";
        echo "<h4>Commander: {$commander['name']}</h4>";
        echo "<p><strong>Type:</strong> {$commander['type_line']}</p>";
        echo "<p><strong>Mana Cost:</strong> {$commander['mana_cost']}</p>";
        echo "</div>";
        
        // Calculate recursive synergies
        echo "<p>Calculating recursive synergies...</p>";
        $allSynergies = $this->calculateRecursiveSynergy($commanderCardId, 3);
        
        echo "<p>Found " . count($allSynergies) . " synergistic cards</p>";
        
        // Filter and categorize cards
        $categorizedCards = $this->categorizeCardsByRole($allSynergies);
        
        // Build optimal deck composition
        $deck = $this->assembleOptimalDeck($commanderCardId, $categorizedCards, $deckSize);
        
        // Calculate deck statistics
        $deckStats = $this->calculateDeckStatistics($deck);
        
        // Store deck in database
        $deckId = $this->storeDeck($commander['name'] . " Synergy Deck", $commanderCardId, $deck, $deckStats);
        
        $buildTime = microtime(true) - $startTime;
        
        echo "<div class='success'>✓ Deck built successfully in " . round($buildTime, 2) . " seconds!</div>";
        
        return [
            'deck_id' => $deckId,
            'commander' => $commander,
            'deck' => $deck,
            'statistics' => $deckStats,
            'build_time' => $buildTime
        ];
    }
    
    private function getCardInfo($cardId) {
        $sql = "
            SELECT c.*, cb.basic_bitstream, cb.bits_set
            FROM cards c
            LEFT JOIN card_bitstreams cb ON c.id = cb.card_id AND cb.bitstream_version = '2.0'
            WHERE c.id = ?
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$cardId]);
        return $stmt->fetch();
    }
    
    private function categorizeCardsByRole($synergies) {
        $categories = [
            'lands' => [],
            'ramp' => [],
            'card_draw' => [],
            'removal' => [],
            'threats' => [],
            'utility' => [],
            'win_conditions' => []
        ];
        
        foreach ($synergies as $cardId => $synergy) {
            $card = $this->getCardInfo($cardId);
            if (!$card) continue;
            
            $typeLine = strtolower($card['type_line']);
            $oracleText = strtolower($card['oracle_text'] ?? '');
            
            // Categorize based on type and function
            if (strpos($typeLine, 'land') !== false) {
                $categories['lands'][] = array_merge($synergy, ['card_info' => $card]);
            } elseif (strpos($oracleText, 'add') !== false && strpos($oracleText, 'mana') !== false) {
                $categories['ramp'][] = array_merge($synergy, ['card_info' => $card]);
            } elseif (strpos($oracleText, 'draw') !== false && strpos($oracleText, 'card') !== false) {
                $categories['card_draw'][] = array_merge($synergy, ['card_info' => $card]);
            } elseif (strpos($oracleText, 'destroy') !== false || strpos($oracleText, 'exile') !== false) {
                $categories['removal'][] = array_merge($synergy, ['card_info' => $card]);
            } elseif (strpos($typeLine, 'creature') !== false && intval($card['power'] ?? 0) >= 3) {
                $categories['threats'][] = array_merge($synergy, ['card_info' => $card]);
            } elseif (strpos($oracleText, 'win') !== false || 
                     (strpos($typeLine, 'planeswalker') !== false) ||
                     (intval($card['power'] ?? 0) >= 6)) {
                $categories['win_conditions'][] = array_merge($synergy, ['card_info' => $card]);
            } else {
                $categories['utility'][] = array_merge($synergy, ['card_info' => $card]);
            }
        }
        
        // Sort each category by synergy score
        foreach ($categories as &$category) {
            usort($category, function($a, $b) {
                return ($b['combined_synergy'] ?? $b['direct_synergy']) <=> 
                       ($a['combined_synergy'] ?? $a['direct_synergy']);
            });
        }
        
        return $categories;
    }
    
    private function assembleOptimalDeck($commanderId, $categorizedCards, $deckSize) {
        $deck = [
            'commander' => $commanderId,
            'cards' => []
        ];
        
        $remainingSlots = $deckSize - 1; // -1 for commander
        
        // Deck composition targets
        $composition = [
            'lands' => max(20, min(26, intval($deckSize * 0.4))),
            'ramp' => max(4, intval($deckSize * 0.08)),
            'card_draw' => max(6, intval($deckSize * 0.12)),
            'removal' => max(6, intval($deckSize * 0.12)),
            'threats' => max(8, intval($deckSize * 0.15)),
            'win_conditions' => max(3, intval($deckSize * 0.08)),
            'utility' => 0 // Fill remaining slots
        ];
        
        // Calculate utility slots
        $usedSlots = array_sum(array_slice($composition, 0, -1));
        $composition['utility'] = max(0, $remainingSlots - $usedSlots);
        
        echo "<h4>Target Deck Composition:</h4>";
        echo "<ul>";
        foreach ($composition as $category => $count) {
            echo "<li><strong>" . ucfirst(str_replace('_', ' ', $category)) . ":</strong> {$count} cards</li>";
        }
        echo "</ul>";
        
        // Fill deck according to composition
        foreach ($composition as $category => $targetCount) {
            $added = 0;
            $availableCards = $categorizedCards[$category] ?? [];
            
            foreach ($availableCards as $cardData) {
                if ($added >= $targetCount) break;
                
                $card = $cardData['card_info'];
                $synergyScore = $cardData['combined_synergy'] ?? $cardData['direct_synergy'];
                $stars = $this->calculateSynergyStars($synergyScore);
                
                // Apply minimum synergy requirements
                $minStars = ($category === 'lands') ? 1 : 2;
                if ($stars < $minStars) continue;
                
                // Determine quantity (max 4 for non-lands, 1 for legends)
                $quantity = 1;
                if ($category !== 'lands' && strpos(strtolower($card['type_line']), 'legendary') === false) {
                    if ($stars >= 4) $quantity = 4;
                    elseif ($stars >= 3) $quantity = min(3, $targetCount - $added);
                    else $quantity = min(2, $targetCount - $added);
                }
                
                $deck['cards'][] = [
                    'card_id' => $card['id'],
                    'name' => $card['name'],
                    'type_line' => $card['type_line'],
                    'mana_cost' => $card['mana_cost'],
                    'cmc' => $card['cmc'],
                    'quantity' => $quantity,
                    'category' => $category,
                    'synergy_score' => $synergyScore,
                    'synergy_stars' => $stars,
                    'recursive_depth' => $cardData['depth'] ?? 0
                ];
                
                $added += $quantity;
            }
            
            echo "<p><strong>" . ucfirst(str_replace('_', ' ', $category)) . ":</strong> Added {$added}/{$targetCount} cards</p>";
        }
        
        return $deck;
    }
    
    private function calculateDeckStatistics($deck) {
        $stats = [
            'total_cards' => 0,
            'total_synergy_score' => 0,
            'average_synergy_score' => 0,
            'mana_curve' => array_fill(0, 8, 0), // 0-7+ CMC
            'color_distribution' => ['W' => 0, 'U' => 0, 'B' => 0, 'R' => 0, 'G' => 0, 'C' => 0],
            'type_distribution' => [],
            'synergy_star_distribution' => [1 => 0, 2 => 0, 3 => 0, 4 => 0, 5 => 0],
            'category_distribution' => [],
            'average_cmc' => 0,
            'recursive_depth_analysis' => []
        ];
        
        $totalCmc = 0;
        $cardCount = 0;
        
        foreach ($deck['cards'] as $cardEntry) {
            $quantity = $cardEntry['quantity'];
            $cmc = intval($cardEntry['cmc'] ?? 0);
            $synergyScore = $cardEntry['synergy_score'];
            $stars = $cardEntry['synergy_stars'];
            $category = $cardEntry['category'];
            $depth = $cardEntry['recursive_depth'] ?? 0;
            
            // Update totals
            $stats['total_cards'] += $quantity;
            $stats['total_synergy_score'] += $synergyScore * $quantity;
            $cardCount += $quantity;
            
            // Mana curve
            $curveSlot = min($cmc, 7);
            $stats['mana_curve'][$curveSlot] += $quantity;
            $totalCmc += $cmc * $quantity;
            
            // Color distribution (simplified)
            $manaCost = strtoupper($cardEntry['mana_cost'] ?? '');
            foreach (['W', 'U', 'B', 'R', 'G'] as $color) {
                $stats['color_distribution'][$color] += substr_count($manaCost, $color) * $quantity;
            }
            if (empty($manaCost) || !preg_match('/[WUBRG]/', $manaCost)) {
                $stats['color_distribution']['C'] += $quantity;
            }
            
            // Type distribution
            $mainType = explode(' ', $cardEntry['type_line'])[0];
            if (!isset($stats['type_distribution'][$mainType])) {
                $stats['type_distribution'][$mainType] = 0;
            }
            $stats['type_distribution'][$mainType] += $quantity;
            
            // Synergy stars
            $stats['synergy_star_distribution'][$stars] += $quantity;
            
            // Category distribution
            if (!isset($stats['category_distribution'][$category])) {
                $stats['category_distribution'][$category] = 0;
            }
            $stats['category_distribution'][$category] += $quantity;
            
            // Recursive depth
            if (!isset($stats['recursive_depth_analysis'][$depth])) {
                $stats['recursive_depth_analysis'][$depth] = 0;
            }
            $stats['recursive_depth_analysis'][$depth] += $quantity;
        }
        
        // Calculate averages
        if ($cardCount > 0) {
            $stats['average_synergy_score'] = $stats['total_synergy_score'] / $cardCount;
            $stats['average_cmc'] = $totalCmc / $cardCount;
        }
        
        return $stats;
    }
    
    private function storeDeck($deckName, $commanderId, $deck, $stats) {
        // Insert deck
        $sql = "
            INSERT INTO generated_decks 
            (deck_name, commander_id, total_synergy_score, average_synergy_score, 
             mana_curve, color_identity, deck_composition, generation_method)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            $deckName,
            $commanderId,
            $stats['total_synergy_score'],
            $stats['average_synergy_score'],
            json_encode($stats['mana_curve']),
            json_encode($stats['color_distribution']),
            json_encode($stats['category_distribution']),
            'recursive_synergy_v2'
        ]);
        
        $deckId = $this->pdo->lastInsertId();
        
        // Insert deck cards
        $cardSql = "
            INSERT INTO deck_cards 
            (deck_id, card_id, quantity, card_role, synergy_contribution, synergy_stars)
            VALUES (?, ?, ?, ?, ?, ?)
        ";
        
        $cardStmt = $this->pdo->prepare($cardSql);
        
        foreach ($deck['cards'] as $cardEntry) {
            $cardStmt->execute([
                $deckId,
                $cardEntry['card_id'],
                $cardEntry['quantity'],
                $cardEntry['category'],
                $cardEntry['synergy_score'],
                $cardEntry['synergy_stars']
            ]);
        }
        
        return $deckId;
    }
    
    public function analyzeDeckSynergy($deckId) {
        // Get deck cards
        $sql = "
            SELECT dc.*, c.name, c.type_line, c.mana_cost, c.oracle_text, cb.basic_bitstream
            FROM deck_cards dc
            JOIN cards c ON dc.card_id = c.id
            LEFT JOIN card_bitstreams cb ON c.id = cb.card_id AND cb.bitstream_version = '2.0'
            WHERE dc.deck_id = ?
            ORDER BY dc.synergy_stars DESC, dc.synergy_contribution DESC
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$deckId]);
        $deckCards = $stmt->fetchAll();
        
        // Calculate inter-card synergies
        $synergyMatrix = [];
        $totalPairSynergies = 0;
        $pairCount = 0;
        
        for ($i = 0; $i < count($deckCards); $i++) {
            for ($j = $i + 1; $j < count($deckCards); $j++) {
                $card1 = $deckCards[$i];
                $card2 = $deckCards[$j];
                
                if ($card1['basic_bitstream'] && $card2['basic_bitstream']) {
                    $pairSynergy = $this->calculateSynergyFromBitstreams(
                        $card1['basic_bitstream'], 
                        $card2['basic_bitstream']
                    );
                    
                    $synergyMatrix[$card1['card_id']][$card2['card_id']] = $pairSynergy['jaccard_similarity'];
                    $totalPairSynergies += $pairSynergy['jaccard_similarity'];
                    $pairCount++;
                }
            }
        }
        
        $averagePairSynergy = $pairCount > 0 ? $totalPairSynergies / $pairCount : 0;
        
        // Identify synergy clusters
        $clusters = $this->identifySynergyClusters($deckCards, $synergyMatrix);
        
        return [
            'deck_cards' => $deckCards,
            'synergy_matrix' => $synergyMatrix,
            'average_pair_synergy' => $averagePairSynergy,
            'synergy_clusters' => $clusters,
            'deck_cohesion_score' => $this->calculateDeckCohesion($synergyMatrix, $deckCards)
        ];
    }
    
    private function identifySynergyClusters($deckCards, $synergyMatrix) {
        $clusters = [];
        $processed = [];
        $minClusterSynergy = 0.25;
        
        foreach ($deckCards as $card) {
            if (in_array($card['card_id'], $processed)) continue;
            
            $cluster = [$card['card_id']];
            $processed[] = $card['card_id'];
            
            // Find highly synergistic cards
            foreach ($deckCards as $otherCard) {
                if ($card['card_id'] === $otherCard['card_id'] || 
                    in_array($otherCard['card_id'], $processed)) continue;
                
                $synergy = $synergyMatrix[$card['card_id']][$otherCard['card_id']] ?? 
                          $synergyMatrix[$otherCard['card_id']][$card['card_id']] ?? 0;
                
                if ($synergy >= $minClusterSynergy) {
                    $cluster[] = $otherCard['card_id'];
                    $processed[] = $otherCard['card_id'];
                }
            }
            
            if (count($cluster) >= 2) {
                $clusters[] = [
                    'cards' => $cluster,
                    'size' => count($cluster),
                    'average_synergy' => $this->calculateClusterSynergy($cluster, $synergyMatrix)
                ];
            }
        }
        
        // Sort clusters by synergy strength
        usort($clusters, function($a, $b) {
            return $b['average_synergy'] <=> $a['average_synergy'];
        });
        
        return $clusters;
    }
    
    private function calculateClusterSynergy($cardIds, $synergyMatrix) {
        $totalSynergy = 0;
        $pairCount = 0;
        
        for ($i = 0; $i < count($cardIds); $i++) {
            for ($j = $i + 1; $j < count($cardIds); $j++) {
                $synergy = $synergyMatrix[$cardIds[$i]][$cardIds[$j]] ?? 
                          $synergyMatrix[$cardIds[$j]][$cardIds[$i]] ?? 0;
                $totalSynergy += $synergy;
                $pairCount++;
            }
        }
        
        return $pairCount > 0 ? $totalSynergy / $pairCount : 0;
    }
    
    private function calculateDeckCohesion($synergyMatrix, $deckCards) {
        $totalSynergy = 0;
        $totalPairs = 0;
        $highSynergyPairs = 0;
        
        foreach ($synergyMatrix as $card1Id => $synergies) {
            foreach ($synergies as $card2Id => $synergy) {
                $totalSynergy += $synergy;
                $totalPairs++;
                
                if ($synergy >= 0.3) {
                    $highSynergyPairs++;
                }
            }
        }
        
        $averageSynergy = $totalPairs > 0 ? $totalSynergy / $totalPairs : 0;
        $highSynergyRatio = $totalPairs > 0 ? $highSynergyPairs / $totalPairs : 0;
        
        // Cohesion score combines average synergy and high-synergy pair ratio
        return ($averageSynergy * 0.6) + ($highSynergyRatio * 0.4);
    }
    
    public function generateDeckReport($deckId) {
        // Get deck info
        $sql = "SELECT * FROM generated_decks WHERE id = ?";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$deckId]);
        $deckInfo = $stmt->fetch();
        
        if (!$deckInfo) {
            throw new Exception("Deck not found");
        }
        
        // Get detailed analysis
        $analysis = $this->analyzeDeckSynergy($deckId);
        
        // Get commander info
        $commander = $this->getCardInfo($deckInfo['commander_id']);
        
        return [
            'deck_info' => $deckInfo,
            'commander' => $commander,
            'analysis' => $analysis,
            'recommendations' => $this->generateDeckRecommendations($analysis)
        ];
    }
    
    private function generateDeckRecommendations($analysis) {
        $recommendations = [];
        
        // Analyze synergy distribution
        $starCounts = array_count_values(array_column($analysis['deck_cards'], 'synergy_stars'));
        
        if (($starCounts[1] ?? 0) > 5) {
            $recommendations[] = [
                'type' => 'warning',
                'message' => 'Deck contains many low-synergy cards (1-star). Consider replacing with higher synergy alternatives.'
            ];
        }
        
        if (($starCounts[4] ?? 0) + ($starCounts[5] ?? 0) < 10) {
            $recommendations[] = [
                'type' => 'suggestion',
                'message' => 'Consider adding more high-synergy cards (4-5 stars) to improve deck cohesion.'
            ];
        }
        
        // Analyze cohesion
        if ($analysis['deck_cohesion_score'] < 0.3) {
            $recommendations[] = [
                'type' => 'warning',
                'message' => 'Low deck cohesion detected. Cards may not work well together.'
            ];
        } elseif ($analysis['deck_cohesion_score'] > 0.6) {
            $recommendations[] = [
                'type' => 'success',
                'message' => 'Excellent deck cohesion! Cards work very well together.'
            ];
        }
        
        // Analyze clusters
        $largeClusters = array_filter($analysis['synergy_clusters'], function($cluster) {
            return $cluster['size'] >= 4;
        });
        
        if (count($largeClusters) >= 2) {
            $recommendations[] = [
                'type' => 'success',
                'message' => 'Multiple strong synergy clusters detected. Deck has good internal synergies.'
            ];
        }
        
        return $recommendations;
    }
}

// Initialize the advanced deckbuilder
try {
    $deckbuilder = new AdvancedDeckbuilder($dbConfig, $config, $cardCharacteristics);
    $deckbuilder->initializeDeckbuilderTables();
    
    // Handle deckbuilder actions
    $action = $_GET['action'] ?? 'dashboard';
    $commanderId = intval($_GET['commander_id'] ?? 0);
    $deckId = intval($_GET['deck_id'] ?? 0);
    $deckSize = intval($_GET['deck_size'] ?? 60);
    
    // Add deckbuilder navigation
    if (in_array($action, ['deckbuilder', 'build_deck', 'view_deck', 'matrix', 'deck_analysis'])) {
        echo "<!DOCTYPE html>
        <html>
        <head>
            <title>Advanced MTG Deckbuilder</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
                .container { max-width: 1400px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1, h2, h3 { color: #333; }
                .nav { background: #2c3e50; padding: 15px; margin: -20px -20px 20px -20px; border-radius: 8px 8px 0 0; }
                .nav a { color: white; text-decoration: none; margin-right: 20px; padding: 8px 16px; border-radius: 4px; }
                .nav a:hover, .nav a.active { background: #34495e; }
                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 20px 0; }
                .stat-card { background: #ecf0f1; padding: 20px; border-radius: 8px; text-align: center; }
                .stat-number { font-size: 2em; font-weight: bold; color: #2c3e50; }
                .stat-label { color: #7f8c8d; margin-top: 5px; }
                .card-preview { background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #3498db; }
                .synergy-stars { color: #f39c12; font-size: 1.2em; }
                .deck-card { background: #fff; border: 1px solid #ddd; padding: 10px; margin: 5px 0; border-radius: 4px; display: flex; justify-content: space-between; align-items: center; }
                .deck-card:hover { background: #f8f9fa; }
                .synergy-matrix { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 20px 0; }
                .matrix-cell { background: #ecf0f1; padding: 10px; border-radius: 4px; text-align: center; }
                .high-synergy { background: #d5f4e6; border-left: 3px solid #27ae60; }
                .medium-synergy { background: #fef9e7; border-left: 3px solid #f39c12; }
                .low-synergy { background: #fadbd8; border-left: 3px solid #e74c3c; }
                .form-group { margin: 15px 0; }
                .form-group label { display: block; margin-bottom: 5px; font-weight: bold; }
                .form-group input, .form-group select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 200px; }
                .btn { background: #3498db; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; margin: 5px; }
                .btn:hover { background: #2980b9; }
                .btn-success { background: #27ae60; }
                .btn-warning { background: #f39c12; }
                .btn-danger { background: #e74c3c; }
                .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
                .table th { background: #f8f9fa; font-weight: bold; }
                .table tr:hover { background: #f8f9fa; }
                .success { color: #27ae60; font-weight: bold; }
                .warning { color: #f39c12; font-weight: bold; }
                .error { color: #e74c3c; font-weight: bold; }
                .progress-bar { background: #ecf0f1; height: 20px; border-radius: 10px; overflow: hidden; margin: 10px 0; }
                .progress-fill { background: #3498db; height: 100%; transition: width 0.3s ease; }
                .mana-curve { display: flex; align-items: end; height: 200px; gap: 5px; margin: 20px 0; }
                .mana-bar { background: #3498db; min-width: 30px; display: flex; align-items: end; justify-content: center; color: white; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class='container'>
                <div class='nav'>
                    <a href='?action=dashboard'>Main Dashboard</a>
                    <a href='?action=deckbuilder' class='" . ($action === 'deckbuilder' ? 'active' : '') . "'>Deckbuilder</a>
                    <a href='?action=matrix' class='" . ($action === 'matrix' ? 'active' : '') . "'>Synergy Matrix</a>
                    <a href='?action=deck_analysis' class='" . ($action === 'deck_analysis' ? 'active' : '') . "'>Deck Analysis</a>
                </div>";
        
        switch ($action) {
            case 'deckbuilder':
                echo "<h1>Advanced MTG Deckbuilder</h1>";
                
                if ($commanderId > 0) {
                    // Build deck
                    try {
                        $result = $deckbuilder->buildOptimalDeck($commanderId, $deckSize);
                        
                        echo "<div class='success'>✓ Deck built successfully!</div>";
                        
                        // Display deck statistics
                        echo "<div class='stats-grid'>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>{$result['statistics']['total_cards']}</div>";
                        echo "<div class='stat-label'>Total Cards</div>";
                        echo "</div>";
                        
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>" . round($result['statistics']['average_synergy_score'], 3) . "</div>";
                        echo "<div class='stat-label'>Avg Synergy Score</div>";
                        echo "</div>";
                        
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>" . round($result['statistics']['average_cmc'], 1) . "</div>";
                        echo "<div class='stat-label'>Average CMC</div>";
                        echo "</div>";
                        
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>" . round($result['build_time'], 2) . "s</div>";
                        echo "<div class='stat-label'>Build Time</div>";
                        echo "</div>";
                        echo "</div>";
                        
                        // Display mana curve
                        echo "<h3>Mana Curve</h3>";
                        echo "<div class='mana-curve'>";
                        $maxCount = max($result['statistics']['mana_curve']);
                        foreach ($result['statistics']['mana_curve'] as $cmc => $count) {
                            $height = $maxCount > 0 ? ($count / $maxCount) * 180 : 0;
                            $label = $cmc === 7 ? '7+' : $cmc;
                            echo "<div class='mana-bar' style='height: {$height}px;'>";
                            if ($count > 0) echo $count;
                            echo "</div>";
                        }
                        echo "</div>";
                        echo "<div style='display: flex; gap: 5px; margin-left: 15px;'>";
                        for ($i = 0; $i <= 7; $i++) {
                            $label = $i === 7 ? '7+' : $i;
                            echo "<div style='min-width: 30px; text-align: center; font-weight: bold;'>{$label}</div>";
                        }
                        echo "</div>";
                        
                        // Display synergy star distribution
                        echo "<h3>Synergy Distribution</h3>";
                        echo "<div class='synergy-matrix'>";
                        foreach ($result['statistics']['synergy_star_distribution'] as $stars => $count) {
                            $class = $stars >= 4 ? 'high-synergy' : ($stars >= 3 ? 'medium-synergy' : 'low-synergy');
                            echo "<div class='matrix-cell {$class}'>";
                            echo "<div class='synergy-stars'>" . str_repeat('★', $stars) . "</div>";
                            echo "<div>{$count} cards</div>";
                            echo "</div>";
                        }
                        echo "</div>";
                        
                        // Display deck list
                        echo "<h3>Deck List</h3>";
                        echo "<div style='columns: 2; column-gap: 20px;'>";
                        
                        $categorizedDeck = [];
                        foreach ($result['deck']['cards'] as $card) {
                            $categorizedDeck[$card['category']][] = $card;
                        }
                        
                        foreach ($categorizedDeck as $category => $cards) {
                            echo "<div style='break-inside: avoid; margin-bottom: 20px;'>";
                            echo "<h4>" . ucfirst(str_replace('_', ' ', $category)) . " (" . count($cards) . ")</h4>";
                            
                            foreach ($cards as $card) {
                                $stars = str_repeat('★', $card['synergy_stars']);
                                echo "<div class='deck-card'>";
                                echo "<div>";
                                echo "<strong>{$card['quantity']}x {$card['name']}</strong><br>";
                                echo "<small>{$card['mana_cost']} - {$card['type_line']}</small>";
                                echo "</div>";
                                echo "<div class='synergy-stars'>{$stars}</div>";
                                echo "</div>";
                            }
                            echo "</div>";
                        }
                        echo "</div>";
                        
                        echo "<a href='?action=view_deck&deck_id={$result['deck_id']}' class='btn btn-success'>View Detailed Analysis</a>";
                        
                    } catch (Exception $e) {
                        echo "<div class='error'>Error building deck: " . htmlspecialchars($e->getMessage()) . "</div>";
                    }
                } else {
                    // Show deck builder form
                    echo "<p>Build an optimized deck using multi-dimensional synergy analysis and recursive card relationships.</p>";
                    
                    echo "<form method='get'>";
                    echo "<input type='hidden' name='action' value='deckbuilder'>";
                    echo "<div class='form-group'>";
                    echo "<label>Commander Card ID:</label>";
                    echo "<input type='number' name='commander_id' value='{$commanderId}' min='1' required>";
                    echo "</div>";
                    echo "<div class='form-group'>";
                    echo "<label>Deck Size:</label>";
                    echo "<select name='deck_size'>";
                    echo "<option value='60'" . ($deckSize === 60 ? ' selected' : '') . ">60 cards (Standard)</option>";
                    echo "<option value='100'" . ($deckSize === 100 ? ' selected' : '') . ">100 cards (Commander)</option>";
                    echo "<option value='40'" . ($deckSize === 40 ? ' selected' : '') . ">40 cards (Limited)</option>";
                    echo "</select>";
                    echo "</div>";
                    echo "<button type='submit' class='btn'>Build Optimal Deck</button>";
                    echo "</form>";
                    
                    // Show recent decks
                    $recentDecks = $deckbuilder->getRecentDecks(10);
                    if (!empty($recentDecks)) {
                        echo "<h3>Recent Decks</h3>";
                        echo "<table class='table'>";
                        echo "<tr><th>Deck Name</th><th>Commander</th><th>Cards</th><th>Avg Synergy</th><th>Created</th><th>Actions</th></tr>";
                        
                        foreach ($recentDecks as $deck) {
                            $commander = $deckbuilder->getCardInfo($deck['commander_id']);
                            echo "<tr>";
                            echo "<td><strong>{$deck['deck_name']}</strong></td>";
                            echo "<td>" . ($commander ? $commander['name'] : 'Unknown') . "</td>";
                            echo "<td>" . json_decode($deck['deck_composition'], true)['total'] ?? 'N/A' . "</td>";
                            echo "<td>" . round($deck['average_synergy_score'], 3) . "</td>";
                            echo "<td>" . date('M j, Y', strtotime($deck['created_at'])) . "</td>";
                            echo "<td>";
                            echo "<a href='?action=view_deck&deck_id={$deck['id']}' class='btn' style='font-size: 12px; padding: 5px 10px;'>View</a>";
                            echo "<a href='?action=deck_analysis&deck_id={$deck['id']}' class='btn btn-warning' style='font-size: 12px; padding: 5px 10px;'>Analyze</a>";
                            echo "</td>";
                            echo "</tr>";
                        }
                        echo "</table>";
                    }
                }
                break;
                
            case 'matrix':
                echo "<h1>Multi-Dimensional Synergy Matrix</h1>";
                
                if (isset($_GET['build_matrix'])) {
                    try {
                        $dimensions = $deckbuilder->buildMultiDimensionalMatrix();
                        echo "<div class='success'>✓ Matrix built successfully!</div>";
                        
                        // Show dimension statistics
                        echo "<h3>Dimension Statistics</h3>";
                        echo "<div class='stats-grid'>";
                        
                        foreach ($dimensions as $dimensionName => $dimensionData) {
                            echo "<div class='stat-card'>";
                            echo "<div class='stat-number'>" . count($dimensionData) . "</div>";
                            echo "<div class='stat-label'>" . ucfirst(str_replace('_', ' ', $dimensionName)) . "</div>";
                            echo "</div>";
                        }
                        echo "</div>";
                        
                    } catch (Exception $e) {
                        echo "<div class='error'>Error building matrix: " . htmlspecialchars($e->getMessage()) . "</div>";
                    }
                } else {
                    echo "<p>Build and analyze the multi-dimensional synergy matrix for advanced deck construction.</p>";
                    echo "<a href='?action=matrix&build_matrix=1' class='btn btn-success'>Build Synergy Matrix</a>";
                    
                    // Show existing matrix statistics
                    $matrixStats = $deckbuilder->getMatrixStatistics();
                    if ($matrixStats['total_vectors'] > 0) {
                        echo "<h3>Current Matrix Status</h3>";
                        echo "<div class='stats-grid'>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>{$matrixStats['total_vectors']}</div>";
                        echo "<div class='stat-label'>Total Vectors</div>";
                        echo "</div>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>{$matrixStats['dimensions']}</div>";
                        echo "<div class='stat-label'>Dimensions</div>";
                        echo "</div>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>{$matrixStats['unique_cards']}</div>";
                        echo "<div class='stat-label'>Cards Processed</div>";
                        echo "</div>";
                        echo "</div>";
                        
                        // Show dimension breakdown
                        echo "<h3>Dimension Breakdown</h3>";
                        echo "<table class='table'>";
                        echo "<tr><th>Dimension</th><th>Vectors</th><th>Last Updated</th></tr>";
                        
                        foreach ($matrixStats['dimension_breakdown'] as $dimension) {
                            echo "<tr>";
                            echo "<td>" . ucfirst(str_replace('_', ' ', $dimension['dimension_name'])) . "</td>";
                            echo "<td>{$dimension['vector_count']}</td>";
                            echo "<td>" . date('M j, Y H:i', strtotime($dimension['last_updated'])) . "</td>";
                            echo "</tr>";
                        }
                        echo "</table>";
                    }
                }
                break;
                
            case 'view_deck':
                if ($deckId > 0) {
                    try {
                        $deckReport = $deckbuilder->generateDeckReport($deckId);
                        
                        echo "<h1>Deck Analysis: {$deckReport['deck_info']['deck_name']}</h1>";
                        
                        // Commander info
                        echo "<div class='card-preview'>";
                        echo "<h3>Commander: {$deckReport['commander']['name']}</h3>";
                        echo "<p><strong>Type:</strong> {$deckReport['commander']['type_line']}</p>";
                        echo "<p><strong>Mana Cost:</strong> {$deckReport['commander']['mana_cost']}</p>";
                        echo "</div>";
                        
                        // Deck statistics
                        $stats = json_decode($deckReport['deck_info']['deck_composition'], true);
                        echo "<div class='stats-grid'>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>" . round($deckReport['deck_info']['average_synergy_score'], 3) . "</div>";
                        echo "<div class='stat-label'>Average Synergy</div>";
                        echo "</div>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>" . round($deckReport['analysis']['deck_cohesion_score'], 3) . "</div>";
                        echo "<div class='stat-label'>Deck Cohesion</div>";
                        echo "</div>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>" . count($deckReport['analysis']['synergy_clusters']) . "</div>";
                        echo "<div class='stat-label'>Synergy Clusters</div>";
                        echo "</div>";
                        echo "<div class='stat-card'>";
                        echo "<div class='stat-number'>" . round($deckReport['analysis']['average_pair_synergy'], 3) . "</div>";
                        echo "<div class='stat-label'>Avg Pair Synergy</div>";
                        echo "</div>";
                        echo "</div>";
                        
                        // Recommendations
                        if (!empty($deckReport['recommendations'])) {
                            echo "<h3>Recommendations</h3>";
                            foreach ($deckReport['recommendations'] as $rec) {
                                $class = $rec['type'] === 'success' ? 'success' : ($rec['type'] === 'warning' ? 'warning' : 'error');
                                echo "<div class='{$class}'>• {$rec['message']}</div>";
                            }
                        }
                        
                        // Synergy clusters
                        if (!empty($deckReport['analysis']['synergy_clusters'])) {
                            echo "<h3>Synergy Clusters</h3>";
                            echo "<div class='synergy-matrix'>";
                            
                            foreach ($deckReport['analysis']['synergy_clusters'] as $i => $cluster) {
                                $class = $cluster['average_synergy'] >= 0.4 ? 'high-synergy' : 
                                        ($cluster['average_synergy'] >= 0.25 ? 'medium-synergy' : 'low-synergy');
                                
                                echo "<div class='matrix-cell {$class}'>";
                                echo "<h4>Cluster " . ($i + 1) . "</h4>";
                                echo "<p><strong>Cards:</strong> {$cluster['size']}</p>";
                                echo "<p><strong>Synergy:</strong> " . round($cluster['average_synergy'], 3) . "</p>";
                                
                                // Show cluster cards
                                echo "<div style='font-size: 12px; margin-top: 10px;'>";
                                foreach ($cluster['cards'] as $cardId) {
                                    $cardInfo = array_filter($deckReport['analysis']['deck_cards'], 
                                                           function($c) use ($cardId) { return $c['card_id'] == $cardId; });
                                    $cardInfo = reset($cardInfo);
                                    if ($cardInfo) {
                                        echo "<div>{$cardInfo['name']}</div>";
                                    }
                                }
                                echo "</div>";
                                echo "</div>";
                            }
                            echo "</div>";
                        }
                        
                        // Full deck list with synergy details
                        echo "<h3>Complete Deck List</h3>";
                        echo "<table class='table'>";
                        echo "<tr><th>Card</th><th>Type</th><th>CMC</th><th>Role</th><th>Synergy</th><th>Stars</th></tr>";
                        
                        foreach ($deckReport['analysis']['deck_cards'] as $card) {
                            $stars = str_repeat('★', $card['synergy_stars']);
                            $synergyClass = $card['synergy_stars'] >= 4 ? 'high-synergy' : 
                                          ($card['synergy_stars'] >= 3 ? 'medium-synergy' : 'low-synergy');
                            
                            echo "<tr class='{$synergyClass}'>";
                            echo "<td><strong>{$card['quantity']}x {$card['name']}</strong></td>";
                            echo "<td>{$card['type_line']}</td>";
                            echo "<td>{$card['mana_cost']}</td>";
                            echo "<td>" . ucfirst(str_replace('_', ' ', $card['card_role'])) . "</td>";
                            echo "<td>" . round($card['synergy_contribution'], 3) . "</td>";
                            echo "<td class='synergy-stars'>{$stars}</td>";
                            echo "</tr>";
                        }
                        echo "</table>";
                        
                    } catch (Exception $e) {
                        echo "<div class='error'>Error loading deck: " . htmlspecialchars($e->getMessage()) . "</div>";
                    }
                } else {
                    echo "<h1>View Deck</h1>";
                    echo "<p>Please specify a deck ID to view.</p>";
                    echo "<a href='?action=deckbuilder' class='btn'>Back to Deckbuilder</a>";
                }
                break;
                
            case 'deck_analysis':
                echo "<h1>Deck Analysis Tools</h1>";
                
                if ($deckId > 0) {
                    // Perform advanced analysis
                    try {
                        $analysis = $deckbuilder->analyzeDeckSynergy($deckId);
                        
                        echo "<h3>Advanced Synergy Analysis</h3>";
                        
                        // Synergy heatmap
                        echo "<h4>Card-to-Card Synergy Matrix</h4>";
                        echo "<div style='overflow-x: auto;'>";
                        echo "<table class='table' style='font-size: 11px;'>";
                        
                        // Header row
                        echo "<tr><th>Card</th>";
                        foreach ($analysis['deck_cards'] as $card) {
                            echo "<th style='writing-mode: vertical-rl; text-orientation: mixed; min-width: 30px;'>";
                            echo substr($card['name'], 0, 8) . "...";
                            echo "</th>";
                        }
                        echo "</tr>";
                        
                        // Data rows
                        foreach ($analysis['deck_cards'] as $i => $card1) {
                            echo "<tr>";
                            echo "<td><strong>" . substr($card1['name'], 0, 15) . "...</strong></td>";
                            
                            foreach ($analysis['deck_cards'] as $j => $card2) {
                                if ($i === $j) {
                                    echo "<td style='background: #34495e; color: white;'>-</td>";
                                } else {
                                    $synergy = $analysis['synergy_matrix'][$card1['card_id']][$card2['card_id']] ?? 
                                              $analysis['synergy_matrix'][$card2['card_id']][$card1['card_id']] ?? 0;
                                    
                                    $color = $synergy >= 0.4 ? '#27ae60' : 
                                            ($synergy >= 0.25 ? '#f39c12' : 
                                            ($synergy >= 0.1 ? '#e67e22' : '#e74c3c'));
                                    
                                    echo "<td style='background: {$color}; color: white; text-align: center;'>";
                                    echo round($synergy, 2);
                                    echo "</td>";
                                }
                            }
                            echo "</tr>";
                        }
                        echo "</table>";
                        echo "</div>";
                        
                        // Top synergy pairs
                        echo "<h4>Strongest Synergy Pairs</h4>";
                        $topPairs = [];
                        foreach ($analysis['synergy_matrix'] as $card1Id => $synergies) {
                            foreach ($synergies as $card2Id => $synergy) {
                                if ($synergy >= 0.2) {
                                    $card1Name = '';
                                    $card2Name = '';
                                    
                                    foreach ($analysis['deck_cards'] as $card) {
                                        if ($card['card_id'] == $card1Id) $card1Name = $card['name'];
                                        if ($card['card_id'] == $card2Id) $card2Name = $card['name'];
                                    }
                                    
                                    $topPairs[] = [
                                        'card1' => $card1Name,
                                        'card2' => $card2Name,
                                        'synergy' => $synergy
                                    ];
                                }
                            }
                        }
                        
                        usort($topPairs, function($a, $b) {
                            return $b['synergy'] <=> $a['synergy'];
                        });
                        
                        echo "<table class='table'>";
                        echo "<tr><th>Card 1</th><th>Card 2</th><th>Synergy Score</th></tr>";
                        
                        foreach (array_slice($topPairs, 0, 20) as $pair) {
                            $class = $pair['synergy'] >= 0.4 ? 'high-synergy' : 
                                    ($pair['synergy'] >= 0.25 ? 'medium-synergy' : 'low-synergy');
                            
                            echo "<tr class='{$class}'>";
                            echo "<td>{$pair['card1']}</td>";
                            echo "<td>{$pair['card2']}</td>";
                            echo "<td>" . round($pair['synergy'], 3) . "</td>";
                            echo "</tr>";
                        }
                        echo "</table>";
                        
                    } catch (Exception $e) {
                        echo "<div class='error'>Error analyzing deck: " . htmlspecialchars($e->getMessage()) . "</div>";
                    }
                } else {
                    // Show deck selection
                    echo "<p>Select a deck to perform advanced synergy analysis.</p>";
                    
                    $recentDecks = $deckbuilder->getRecentDecks(20);
                    if (!empty($recentDecks)) {
                        echo "<table class='table'>";
                        echo "<tr><th>Deck Name</th><th>Commander</th><th>Synergy Score</th><th>Created</th><th>Actions</th></tr>";
                        
                        foreach ($recentDecks as $deck) {
                            $commander = $deckbuilder->getCardInfo($deck['commander_id']);
                            echo "<tr>";
                            echo "<td><strong>{$deck['deck_name']}</strong></td>";
                            echo "<td>" . ($commander ? $commander['name'] : 'Unknown') . "</td>";
                            echo "<td>" . round($deck['average_synergy_score'], 3) . "</td>";
                            echo "<td>" . date('M j, Y', strtotime($deck['created_at'])) . "</td>";
                            echo "<td>";
                            echo "<a href='?action=deck_analysis&deck_id={$deck['id']}' class='btn'>Analyze</a>";
                            echo "</td>";
                            echo "</tr>";
                        }
                        echo "</table>";
                    }
                }
                break;
        }
        
        echo "</div></body></html>";
        exit;
    }
    
} catch (Exception $e) {
    echo "<div class='error'>Deckbuilder Error: " . htmlspecialchars($e->getMessage()) . "</div>";
}

// Add methods to the AdvancedDeckbuilder class
class AdvancedDeckbuilderExtensions extends AdvancedDeckbuilder {
    
    public function getRecentDecks($limit = 10) {
        $sql = "
            SELECT * FROM generated_decks 
            ORDER BY created_at DESC 
            LIMIT " . intval($limit);
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll();
    }
    
    public function getMatrixStatistics() {
        $stats = [
            'total_vectors' => 0,
            'dimensions' => 0,
            'unique_cards' => 0,
            'dimension_breakdown' => []
        ];
        
        // Total vectors
        $stmt = $this->pdo->prepare("SELECT COUNT(*) as count FROM synergy_matrix");
        $stmt->execute();
        $stats['total_vectors'] = $stmt->fetch()['count'];
        
        // Unique dimensions
        $stmt = $this->pdo->prepare("SELECT COUNT(DISTINCT dimension_name) as count FROM synergy_matrix");
        $stmt->execute();
        $stats['dimensions'] = $stmt->fetch()['count'];
        
        // Unique cards
        $stmt = $this->pdo->prepare("SELECT COUNT(DISTINCT card_id) as count FROM synergy_matrix");
        $stmt->execute();
        $stats['unique_cards'] = $stmt->fetch()['count'];
        
        // Dimension breakdown
        $stmt = $this->pdo->prepare("
            SELECT 
                dimension_name, 
                COUNT(*) as vector_count,
                MAX(calculated_at) as last_updated
            FROM synergy_matrix 
            GROUP BY dimension_name 
            ORDER BY dimension_name
        ");
        $stmt->execute();
        $stats['dimension_breakdown'] = $stmt->fetchAll();
        
        return $stats;
    }
    
    public function optimizeDeckForMeta($deckId, $metaConstraints = []) {
        // Advanced deck optimization based on meta constraints
        $defaultConstraints = [
            'max_cmc' => 6,
            'min_interaction' => 8,
            'min_card_advantage' => 6,
            'preferred_archetypes' => ['aggro', 'midrange', 'control'],
            'banned_cards' => [],
            'required_synergy_threshold' => 0.25
        ];
        
        $constraints = array_merge($defaultConstraints, $metaConstraints);
        
        // Get current deck
        $currentDeck = $this->analyzeDeckSynergy($deckId);
        
        // Identify optimization opportunities
        $optimizations = [];
        
        // Check CMC distribution
        $highCmcCards = array_filter($currentDeck['deck_cards'], function($card) use ($constraints) {
            return intval($card['cmc'] ?? 0) > $constraints['max_cmc'];
        });
        
        if (count($highCmcCards) > 3) {
            $optimizations[] = [
                'type' => 'cmc_reduction',
                'message' => 'Consider replacing high CMC cards with lower cost alternatives',
                'affected_cards' => array_column($highCmcCards, 'card_id')
            ];
        }
        
        // Check interaction density
        $interactionCards = array_filter($currentDeck['deck_cards'], function($card) {
            $oracle = strtolower($card['oracle_text'] ?? '');
            return strpos($oracle, 'destroy') !== false || 
                   strpos($oracle, 'counter') !== false ||
                   strpos($oracle, 'exile') !== false;
        });
        
        if (count($interactionCards) < $constraints['min_interaction']) {
            $optimizations[] = [
                'type' => 'interaction_increase',
                'message' => 'Deck needs more interaction/removal spells',
                'target_count' => $constraints['min_interaction'] - count($interactionCards)
            ];
        }
        
        return [
            'current_deck' => $currentDeck,
            'optimizations' => $optimizations,
            'meta_score' => $this->calculateMetaScore($currentDeck, $constraints)
        ];
    }
    
    private function calculateMetaScore($deckAnalysis, $constraints) {
        $score = 0;
        $maxScore = 100;
        
        // Synergy score (40 points)
        $synergyScore = min($deckAnalysis['average_pair_synergy'] * 80, 40);
        $score += $synergyScore;
        
        // Cohesion score (30 points)
        $cohesionScore = min($deckAnalysis['deck_cohesion_score'] * 30, 30);
        $score += $cohesionScore;
        
        // Curve efficiency (20 points)
        $avgCmc = 0;
        $cardCount = 0;
        foreach ($deckAnalysis['deck_cards'] as $card) {
            $avgCmc += intval($card['cmc'] ?? 0) * $card['quantity'];
            $cardCount += $card['quantity'];
        }
        $avgCmc = $cardCount > 0 ? $avgCmc / $cardCount : 0;
        
        $curveScore = max(0, 20 - ($avgCmc - 3) * 5); // Optimal around 3 CMC
        $score += $curveScore;
        
        // Interaction density (10 points)
        $interactionCount = 0;
        foreach ($deckAnalysis['deck_cards'] as $card) {
            $oracle = strtolower($card['oracle_text'] ?? '');
            if (strpos($oracle, 'destroy') !== false || 
                strpos($oracle, 'counter') !== false ||
                strpos($oracle, 'exile') !== false) {
                $interactionCount += $card['quantity'];
            }
        }
        
        $interactionScore = min($interactionCount * 1.25, 10);
        $score += $interactionScore;
        
        return [
            'total_score' => round($score, 1),
            'max_score' => $maxScore,
            'percentage' => round(($score / $maxScore) * 100, 1),
            'breakdown' => [
                'synergy' => round($synergyScore, 1),
                'cohesion' => round($cohesionScore, 1),
                'curve' => round($curveScore, 1),
                'interaction' => round($interactionScore, 1)
            ]
        ];
    }
    
    public function generateSynergyReport($cardId, $depth = 2) {
        $report = [
            'card_id' => $cardId,
            'timestamp' => date('Y-m-d H:i:s'),
            'synergy_analysis' => $this->calculateRecursiveSynergy($cardId, $depth),
            'dimensional_analysis' => $this->analyzeDimensionalSynergy($cardId),
            'deck_recommendations' => $this->generateDeckRecommendationsForCard($cardId)
        ];
        
        return $report;
    }
    
    private function analyzeDimensionalSynergy($cardId) {
        $sql = "
            SELECT dimension_name, dimension_vector, synergy_weights
            FROM synergy_matrix
            WHERE card_id = ?
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([$cardId]);
        $dimensions = $stmt->fetchAll();
        
        $analysis = [];
        
        foreach ($dimensions as $dimension) {
            $vector = json_decode($dimension['dimension_vector'], true);
            $weights = json_decode($dimension['synergy_weights'], true);
            
            $analysis[$dimension['dimension_name']] = [
                'vector' => $vector,
                'weights' => $weights,
                'dominant_characteristics' => $this->findDominantCharacteristics($vector, $weights),
                'synergy_potential' => array_sum($weights)
            ];
        }
        
        return $analysis;
    }
    
    private function findDominantCharacteristics($vector, $weights) {
        $characteristics = [];
        
        foreach ($vector as $key => $value) {
            if ($value > 0 && ($weights[$key] ?? 0) > 0.1) {
                $characteristics[] = [
                    'characteristic' => $key,
                    'value' => $value,
                    'weight' => $weights[$key] ?? 0
                ];
            }
        }
        
        usort($characteristics, function($a, $b) {
            return $b['weight'] <=> $a['weight'];
        });
        
        return array_slice($characteristics, 0, 5);
    }
    
    private function generateDeckRecommendationsForCard($cardId) {
        $card = $this->getCardInfo($cardId);
        if (!$card) return [];
        
        $recommendations = [];
        
        // Analyze card type and suggest deck archetypes
        $typeLine = strtolower($card['type_line']);
        $oracleText = strtolower($card['oracle_text'] ?? '');
        
        if (strpos($typeLine, 'creature') !== false) {
            if (intval($card['power'] ?? 0) >= 4) {
                $recommendations[] = [
                    'archetype' => 'aggro',
                    'reason' => 'High power creature suitable for aggressive strategies',
                    'priority' => 'high'
                ];
            }
            
            if (strpos($oracleText, 'enters the battlefield') !== false) {
                $recommendations[] = [
                    'archetype' => 'value_engine',
                    'reason' => 'ETB effect provides card advantage',
                    'priority' => 'medium'
                ];
            }
        }
        
        if (strpos($oracleText, 'draw') !== false && strpos($oracleText, 'card') !== false) {
            $recommendations[] = [
                'archetype' => 'control',
                'reason' => 'Card draw supports control strategies',
                'priority' => 'high'
            ];
        }
        
        return $recommendations;
    }
}

// Export the extended deckbuilder
$deckbuilder = new AdvancedDeckbuilderExtensions($dbConfig, $config, $cardCharacteristics);

?>
