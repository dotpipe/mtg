<?php
/**
 * Enhanced Card Selection API
 * - Fetches unique cards from specific sets
 * - Calculates synergy scores between cards
 * - Organizes cards by synergy level (3-5 stars)
 */
class EnhancedCardAPI {
    private $pdo;
    private $config;
    
    /**
     * Constructor - initialize database connection
     */
    public function __construct($dbConfig) {
        try {
            $dsn = "mysql:host={$dbConfig['host']};dbname={$dbConfig['database']};charset=utf8mb4";
            $this->pdo = new PDO($dsn, $dbConfig['username'], $dbConfig['password'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
            ]);
            
            $this->config = [
                'max_price' => 5.00,  // Default max price per card
                'synergy_threshold' => 0.15,  // Minimum synergy score to consider
                'max_results' => 100,  // Maximum cards to return
                'cache_duration' => 3600  // Cache results for 1 hour
            ];
        } catch (PDOException $e) {
            throw new Exception("Database connection failed: " . $e->getMessage());
        }
    }
    
    /**
     * Get random unique cards from a specific set
     * 
     * @param string $setCode The set code (e.g., 'znr' for Zendikar Rising)
     * @param int $limit Maximum number of cards to return
     * @param array $options Additional options
     * @return array Cards with synergy information
     */
    public function getUniqueCardsFromSet($setCode, $limit = 50, $options = []) {
        // Merge options with defaults
        $options = array_merge([
            'max_price' => $this->config['max_price'],
            'include_basic_lands' => false,
            'include_tokens' => false,
            'cache_key' => "set_{$setCode}_unique_cards"
        ], $options);
        
        // Check cache first
        $cachedResult = $this->getCache($options['cache_key']);
        if ($cachedResult !== false) {
            return $cachedResult;
        }
        
        try {
            // Fetch unique cards from the set
            $cards = $this->fetchUniqueCardsFromSet($setCode, $limit, $options);
            
            if (empty($cards)) {
                return ['error' => "No cards found in set {$setCode}"];
            }
            
            // Calculate synergies between all cards
            $synergies = $this->calculateSynergiesBetweenCards($cards);
            
            // Group cards by synergy level
            $groupedCards = $this->groupCardsBySynergyLevel($cards, $synergies);
            
            // Prepare result
            $result = [
                'set_code' => $setCode,
                'set_name' => $this->getSetName($setCode),
                'total_cards' => count($cards),
                'synergy_groups' => $groupedCards,
                'cards' => $cards
            ];
            
            // Cache the result
            $this->setCache($options['cache_key'], $result, $this->config['cache_duration']);
            
            return $result;
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Fetch unique cards from a specific set
     * 
     * @param string $setCode The set code
     * @param int $limit Maximum number of cards
     * @param array $options Additional options
     * @return array Cards from the set
     */
    private function fetchUniqueCardsFromSet($setCode, $limit, $options) {
        // Build query conditions
        $conditions = ["set_code = :set_code"];
        $params = [':set_code' => $setCode];
        
        if (!$options['include_basic_lands']) {
            $conditions[] = "type_line NOT LIKE '%Basic Land%'";
        }
        
        if (!$options['include_tokens']) {
            $conditions[] = "layout != 'token'";
        }
        
        if ($options['max_price'] > 0) {
            $conditions[] = "(price IS NULL OR price <= :max_price)";
            $params[':max_price'] = $options['max_price'];
        }
        
        // Build the query
        $sql = "
            SELECT 
                id, name, set_code, set_name, collector_number, 
                mana_cost, cmc, type_line, oracle_text, colors,
                color_identity, power, toughness, loyalty, 
                rarity, price, image_uri, scryfall_uri,
                keywords, subtypes, supertypes
            FROM cards
            WHERE " . implode(" AND ", $conditions) . "
            GROUP BY name
            ORDER BY RAND()
            LIMIT :limit
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':limit', min($limit, $this->config['max_results']), PDO::PARAM_INT);
        
        foreach ($params as $key => $value) {
            if (is_int($value)) {
                $stmt->bindValue($key, $value, PDO::PARAM_INT);
            } else {
                $stmt->bindValue($key, $value);
            }
        }
        
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        // Process cards (decode JSON fields, etc.)
        foreach ($cards as &$card) {
            $this->processCardData($card);
        }
        
        return $cards;
    }
    
    /**
     * Process raw card data (decode JSON fields, etc.)
     * 
     * @param array &$card Card data to process
     */
    private function processCardData(&$card) {
        // Decode JSON fields
        foreach (['colors', 'color_identity', 'keywords', 'subtypes', 'supertypes'] as $field) {
            if (isset($card[$field]) && is_string($card[$field])) {
                $card[$field] = json_decode($card[$field], true) ?: [];
            }
        }
        
        // Format price
        if (isset($card['price'])) {
            $card['price_formatted'] = '$' . number_format((float)$card['price'], 2);
        }
        
        // Add placeholder image if missing
        if (empty($card['image_uri'])) {
            $card['image_uri'] = 'https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg';
        }
    }
    
    /**
     * Calculate synergies between all cards in the set
     * 
     * @param array $cards Cards to analyze
     * @return array Synergy matrix
     */
    private function calculateSynergiesBetweenCards($cards) {
        $synergies = [];
        
        // Calculate synergy for each pair of cards
        for ($i = 0; $i < count($cards); $i++) {
            $card1 = $cards[$i];
            $synergies[$card1['id']] = [];
            
            for ($j = 0; $j < count($cards); $j++) {
                if ($i === $j) continue; // Skip self
                
                $card2 = $cards[$j];
                $synergyScore = $this->calculateSynergyScore($card1, $card2);
                
                if ($synergyScore >= $this->config['synergy_threshold']) {
                    $synergies[$card1['id']][$card2['id']] = [
                        'score' => $synergyScore,
                        'type' => $this->determineSynergyType($card1, $card2)
                    ];
                }
            }
        }
        
        return $synergies;
    }
    
    /**
     * Calculate synergy score between two cards
     * 
     * @param array $card1 First card
     * @param array $card2 Second card
     * @return float Synergy score between 0 and 1
     */
    private function calculateSynergyScore($card1, $card2) {
        $score = 0;
        
        // Check for shared types
        if (!empty($card1['type_line']) && !empty($card2['type_line'])) {
            $types1 = explode(' ', strtolower($card1['type_line']));
            $types2 = explode(' ', strtolower($card2['type_line']));
            
            $sharedTypes = array_intersect($types1, $types2);
            $score += count($sharedTypes) * 0.05;
        }
        
        // Check for shared colors
        if (!empty($card1['colors']) && !empty($card2['colors'])) {
            $sharedColors = array_intersect($card1['colors'], $card2['colors']);
            $score += count($sharedColors) * 0.05;
        }
        
        // Check for color identity match
        if (!empty($card1['color_identity']) && !empty($card2['color_identity'])) {
            $sharedIdentity = array_intersect($card1['color_identity'], $card2['color_identity']);
            $score += count($sharedIdentity) * 0.03;
        }
        
        // Check for keyword matches
        if (!empty($card1['keywords']) && !empty($card2['keywords'])) {
            $sharedKeywords = array_intersect($card1['keywords'], $card2['keywords']);
            $score += count($sharedKeywords) * 0.1;
        }
        
        // Check for creature type synergies
        if (!empty($card1['subtypes']) && !empty($card2['oracle_text'])) {
            foreach ($card1['subtypes'] as $subtype) {
                if (stripos($card2['oracle_text'], $subtype) !== false) {
                    $score += 0.15;
                }
            }
        }
        
        if (!empty($card2['subtypes']) && !empty($card1['oracle_text'])) {
            foreach ($card2['subtypes'] as $subtype) {
                if (stripos($card1['oracle_text'], $subtype) !== false) {
                    $score += 0.15;
                }
            }
        }
        
        // Check for keyword mentions in oracle text
        if (!empty($card1['oracle_text']) && !empty($card2['oracle_text'])) {
            $keywords = [
                'draw', 'discard', 'sacrifice', 'counter', 'destroy', 'exile', 
                'return', 'create', 'token', 'life', 'damage', '+1/+1', 'graveyard',
                'search', 'library', 'mana', 'cast', 'spell', 'creature', 'artifact',
                'enchantment', 'planeswalker', 'land', 'attack', 'block', 'target'
            ];
            
            foreach ($keywords as $keyword) {
                if (stripos($card1['oracle_text'], $keyword) !== false && 
                    stripos($card2['oracle_text'], $keyword) !== false) {
                    $score += 0.03;
                }
            }
        }
        
        // Check for mana cost synergy
        if (!empty($card1['mana_cost']) && !empty($card2['mana_cost'])) {
            // Similar CMC is good for curve considerations
            $cmcDiff = abs(($card1['cmc'] ?? 0) - ($card2['cmc'] ?? 0));
            if ($cmcDiff <= 1) {
                $score += 0.05;
            }
        }
        
        // Cap score at 1.0
        return min($score, 1.0);
    }
    
    /**
     * Determine the type of synergy between two cards
     * 
     * @param array $card1 First card
     * @param array $card2 Second card
     * @return string Synergy type
     */
    private function determineSynergyType($card1, $card2) {
        // Default synergy type
        $type = 'general';
        
        // Check oracle text for synergy patterns
        $text1 = strtolower($card1['oracle_text'] ?? '');
        $text2 = strtolower($card2['oracle_text'] ?? '');
        
        // Card advantage synergy
        if ((strpos($text1, 'draw') !== false && strpos($text2, 'draw') !== false) ||
            (strpos($text1, 'search your library') !== false && strpos($text2, 'search your library') !== false)) {
            return 'card_advantage';
        }
        
        // Control synergy
        if ((strpos($text1, 'counter') !== false && strpos($text1, 'spell') !== false) ||
            (strpos($text2, 'counter') !== false && strpos($text2, 'spell') !== false) ||
            (strpos($text1, 'destroy') !== false && strpos($text2, 'destroy') !== false)) {
            return 'control';
        }
        
        // Aggro synergy
        if ((strpos($text1, 'attack') !== false && strpos($text2, 'attack') !== false) ||
            (strpos($text1, 'combat') !== false && strpos($text2, 'combat') !== false)) {
            return 'aggro';
        }
        
        // Token synergy
        if ((strpos($text1, 'token') !== false && strpos($text2, 'token') !== false) ||
            (strpos($text1, 'create') !== false && strpos($text2, 'create') !== false)) {
            return 'token';
        }
        
        // Graveyard synergy
        if ((strpos($text1, 'graveyard') !== false && strpos($text2, 'graveyard') !== false) ||
            (strpos($text1, 'discard') !== false && strpos($text2, 'discard') !== false)) {
            return 'graveyard';
        }
        
        // Tribal synergy
        if (!empty($card1['subtypes']) && !empty($card2['subtypes'])) {
            $sharedSubtypes = array_intersect($card1['subtypes'], $card2['subtypes']);
            if (!empty($sharedSubtypes)) {
                return 'tribal_' . strtolower($sharedSubtypes[0]);
            }
        }
        
        // Check for creature type references
        if (!empty($card1['subtypes']) && !empty($card2['oracle_text'])) {
            foreach ($card1['subtypes'] as $subtype) {
                if (stripos($card2['oracle_text'], $subtype) !== false) {
                    return 'tribal_' . strtolower($subtype);
                }
            }
        }
        
        return $type;
    }
    
    /**
     * Group cards by synergy level
     * 
     * @param array $cards Cards to group
     * @param array $synergies Synergy matrix
     * @return array Cards grouped by synergy level
     */
    private function groupCardsBySynergyLevel($cards, $synergies) {
        $groups = [
            '5_star' => [],  // 0.8 - 1.0
            '4_star' => [],  // 0.6 - 0.79
            '3_star' => [],  // 0.4 - 0.59
            '2_star' => [],  // 0.2 - 0.39
            '1_star' => []   // 0.0 - 0.19
        ];
        
        foreach ($cards as $card) {
            // Calculate average synergy with other cards
            $totalSynergy = 0;
            $synergyCount = 0;
            
            if (isset($synergies[$card['id']])) {
                foreach ($synergies[$card['id']] as $targetId => $synergyData) {
                    $totalSynergy += $synergyData['score'];
                    $synergyCount++;
                }
            }
            
            $avgSynergy = $synergyCount > 0 ? $totalSynergy / $synergyCount : 0;
            
            // Determine star rating
            if ($avgSynergy >= 0.8) {
                $groups['5_star'][] = $card['id'];
            } elseif ($avgSynergy >= 0.6) {
                $groups['4_star'][] = $card['id'];
            } elseif ($avgSynergy >= 0.4) {
                $groups['3_star'][] = $card['id'];
            } elseif ($avgSynergy >= 0.2) {
                $groups['2_star'][] = $card['id'];
            } else {
                $groups['1_star'][] = $card['id'];
            }
        }
        
        return $groups;
    }
    
    /**
     * Get set name from set code
     * 
     * @param string $setCode The set code
     * @return string Set name
     */
    private function getSetName($setCode) {
        $stmt = $this->pdo->prepare("SELECT DISTINCT set_name FROM cards WHERE set_code = ? LIMIT 1");
        $stmt->execute([$setCode]);
        $result = $stmt->fetch();
        
        return $result ? $result['set_name'] : 'Unknown Set';
    }
    
    /**
     * Get cache value
     * 
     * @param string $key Cache key
     * @return mixed Cached value or false if not found
     */
    private function getCache($key) {
        $cacheFile = $this->getCacheFilePath($key);
        
        if (file_exists($cacheFile)) {
            $data = file_get_contents($cacheFile);
            $cacheData = json_decode($data, true);
            
            if ($cacheData && isset($cacheData['expires']) && $cacheData['expires'] > time()) {
                return $cacheData['data'];
            }
        }
        
        return false;
    }
    
    /**
     * Set cache value
     * 
     * @param string $key Cache key
     * @param mixed $value Value to cache
     * @param int $ttl Time to live in seconds
     * @return bool Success status
     */
    private function setCache($key, $value, $ttl) {
        $cacheFile = $this->getCacheFilePath($key);
        $cacheDir = dirname($cacheFile);
        
        if (!is_dir($cacheDir)) {
            mkdir($cacheDir, 0755, true);
        }
        
        $cacheData = [
            'expires' => time() + $ttl,
            'data' => $value
        ];
        
        return file_put_contents($cacheFile, json_encode($cacheData)) !== false;
    }
    
    /**
     * Get cache file path
     * 
     * @param string $key Cache key
     * @return string File path
     */
    private function getCacheFilePath($key) {
        $safeKey = preg_replace('/[^a-zA-Z0-9_]/', '_', $key);
        return __DIR__ . '/cache/' . $safeKey . '.json';
    }
    
    /**
     * Get available sets
     * 
     * @return array List of available sets
     */
    public function getAvailableSets() {
        $cacheKey = 'available_sets';
        $cachedResult = $this->getCache($cacheKey);
        
        if ($cachedResult !== false) {
            return $cachedResult;
        }
        
        try {
            $stmt = $this->pdo->query("
                SELECT DISTINCT set_code, set_name 
                FROM cards 
                WHERE set_code IS NOT NULL AND set_name IS NOT NULL
                ORDER BY release_date DESC
            ");
            
            $sets = $stmt->fetchAll();
            
            // Cache the result
            $this->setCache($cacheKey, $sets, 86400); // Cache for 1 day
            
            return $sets;
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Get synergistic cards for a specific card
     * 
     * @param int $cardId Card ID
     * @param int $limit Maximum number of cards to return
     * @return array Synergistic cards
     */
    public function getSynergisticCards($cardId, $limit = 10) {
        try {
            // Get the card
            $stmt = $this->pdo->prepare("SELECT * FROM cards WHERE id = ?");
            $stmt->execute([$cardId]);
            $card = $stmt->fetch();
            
            if (!$card) {
                return ['error' => 'Card not found'];
            }
            
            $this->processCardData($card);
            
            // Get potential synergistic cards
            $potentialCards = $this->getPotentialSynergisticCards($card, $limit * 3);
            
            // Calculate synergy scores
            $synergisticCards = [];
            
            foreach ($potentialCards as $potentialCard) {
                $synergyScore = $this->calculateSynergyScore($card, $potentialCard);
                
                if ($synergyScore >= $this->config['synergy_threshold']) {
                    $synergisticCards[] = [
                        'card' => $potentialCard,
                        'synergy_score' => $synergyScore,
                        'synergy_type' => $this->determineSynergyType($card, $potentialCard),
                        'star_rating' => $this->getSynergyStarRating($synergyScore)
                    ];
                }
            }
            
            // Sort by synergy score (highest first)
            usort($synergisticCards, function($a, $b) {
                return $b['synergy_score'] <=> $a['synergy_score'];
            });
            
            // Return top results
            return [
                'card' => $card,
                'synergistic_cards' => array_slice($synergisticCards, 0, $limit)
            ];
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Get potential synergistic cards
     * 
     * @param array $card Card to find synergies for
     * @param int $limit Maximum number of cards to return
     * @return array Potential synergistic cards
     */
    private function getPotentialSynergisticCards($card, $limit) {
        $conditions = [];
        $params = [];
        
        // Same set for better synergy
        $conditions[] = "set_code = :set_code";
        $params[':set_code'] = $card['set_code'];
        
        // Exclude the card itself
        $conditions[] = "id != :card_id";
        $params[':card_id'] = $card['id'];
        
        // Exclude basic lands
        $conditions[] = "type_line NOT LIKE '%Basic Land%'";
        
        // Price constraint
        if ($this->config['max_price'] > 0) {
            $conditions[] = "(price IS NULL OR price <= :max_price)";
            $params[':max_price'] = $this->config['max_price'];
        }
        
        // Build the query
        $sql = "
            SELECT 
                id, name, set_code, set_name, collector_number, 
                mana_cost, cmc, type_line, oracle_text, colors,
                color_identity, power, toughness, loyalty, 
                rarity, price, image_uri, scryfall_uri,
                keywords, subtypes, supertypes
            FROM cards
            WHERE " . implode(" AND ", $conditions) . "
            GROUP BY name
            ORDER BY RAND()
            LIMIT :limit
        ";
        
        $stmt = $this->pdo->prepare($sql);
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        
        foreach ($params as $key => $value) {
            if (is_int($value)) {
                $stmt->bindValue($key, $value, PDO::PARAM_INT);
            } else {
                $stmt->bindValue($key, $value);
            }
        }
        
        $stmt->execute();
        $cards = $stmt->fetchAll();
        
        // Process cards
        foreach ($cards as &$card) {
            $this->processCardData($card);
        }
        
        return $cards;
    }
    
    /**
     * Get synergy star rating based on score
     * 
     * @param float $score Synergy score
     * @return int Star rating (1-5)
     */
    private function getSynergyStarRating($score) {
        if ($score >= 0.8) return 5;
        if ($score >= 0.6) return 4;
        if ($score >= 0.4) return 3;
        if ($score >= 0.2) return 2;
        return 1;
    }
    
    /**
     * Build a synergistic deck from a centerpiece card
     * 
     * @param int $centerpieceId Centerpiece card ID
     * @param int $deckSize Target deck size
     * @param array $options Additional options
     * @return array Built deck
     */
    public function buildSynergisticDeck($centerpieceId, $deckSize = 60, $options = []) {
        // Merge options with defaults
        $options = array_merge([
            'min_synergy_score' => 0.3,
            'land_percentage' => 0.4,  // 40% lands
            'include_basic_lands' => true
        ], $options);
        
        try {
            // Get the centerpiece card
            $stmt = $this->pdo->prepare("SELECT * FROM cards WHERE id = ?");
            $stmt->execute([$centerpieceId]);
            $centerpiece = $stmt->fetch();
            
            if (!$centerpiece) {
                return ['error' => 'Centerpiece card not found'];
            }
            
            $this->processCardData($centerpiece);
            
            // Calculate non-land count
            $landCount = floor($deckSize * $options['land_percentage']);
            $nonLandCount = $deckSize - $landCount;
            
            // Start with the centerpiece
            $selectedCards = [$centerpiece];
            $selectedCardIds = [$centerpiece['id']];
            
            // Get synergistic cards
            $synergisticCards = [];
            $currentCards = [$centerpiece];
            
            // Iteratively find synergistic cards
            while (count($selectedCards) < $nonLandCount) {
                $newSynergisticCards = [];
                
                // For each current card, find synergistic cards
                foreach ($currentCards as $currentCard) {
                    $potentialCards = $this->getPotentialSynergisticCards($currentCard, 20);
                    
                    foreach ($potentialCards as $potentialCard) {
                        // Skip if already selected
                        if (in_array($potentialCard['id'], $selectedCardIds)) {
                            continue;
                        }
                        
                        // Calculate synergy with all selected cards
                        $totalSynergy = 0;
                        foreach ($selectedCards as $selectedCard) {
                            $totalSynergy += $this->calculateSynergyScore($potentialCard, $selectedCard);
                        }
                        
                        $avgSynergy = $totalSynergy / count($selectedCards);
                        
                        // Add to synergistic cards if above threshold
                        if ($avgSynergy >= $options['min_synergy_score']) {
                            $newSynergisticCards[] = [
                                'card' => $potentialCard,
                                'synergy_score' => $avgSynergy,
                                'star_rating' => $this->getSynergyStarRating($avgSynergy)
                            ];
                        }
                    }
                }
                
                // Sort by synergy score
                usort($newSynergisticCards, function($a, $b) {
                    return $b['synergy_score'] <=> $a['synergy_score'];
                });
                
                // Add top cards
                $addCount = min(5, $nonLandCount - count($selectedCards));
                $addCount = max(1, $addCount); // Add at least 1
                
                for ($i = 0; $i < $addCount && $i < count($newSynergisticCards); $i++) {
                    $selectedCards[] = $newSynergisticCards[$i]['card'];
                    $selectedCardIds[] = $newSynergisticCards[$i]['card']['id'];
                    $synergisticCards[] = $newSynergisticCards[$i];
                }
                
                // Update current cards for next iteration
                $currentCards = array_map(function($item) { return $item['card']; }, 
                                        array_slice($newSynergisticCards, 0, $addCount));
                
                // Break if no new cards were added
                if (empty($currentCards)) {
                    break;
                }
            }
            
            // Add lands
            $lands = $this->getAppropriateBasicLands($centerpiece, $landCount);
            
            // Prepare result
            $result = [
                'centerpiece' => $centerpiece,
                'non_land_cards' => $selectedCards,
                'lands' => $lands,
                'synergy_details' => $synergisticCards,
                'deck_size' => count($selectedCards) + count($lands),
                'average_synergy' => $this->calculateAverageDeckSynergy($selectedCards)
            ];
            
            return $result;
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }
    
    /**
     * Get appropriate basic lands based on card colors
     * 
     * @param array $card Card to match lands for
     * @param int $count Number of lands to get
     * @return array Basic lands
     */
    private function getAppropriateBasicLands($card, $count) {
        $lands = [];
        
        // Determine color distribution
        $colorDistribution = [
            'W' => 0,
            'U' => 0,
            'B' => 0,
            'R' => 0,
            'G' => 0
        ];
        
        // Use color identity if available
        if (!empty($card['color_identity'])) {
            foreach ($card['color_identity'] as $color) {
                $colorDistribution[$color] = 1;
            }
        } 
        // Fallback to colors
        else if (!empty($card['colors'])) {
            foreach ($card['colors'] as $color) {
                $colorDistribution[$color] = 1;
            }
        }
        
        // Count colors
        $colorCount = array_sum($colorDistribution);
        
        // If colorless, use only colorless lands
        if ($colorCount === 0) {
            for ($i = 0; $i < $count; $i++) {
                $lands[] = [
                    'name' => 'Wastes',
                    'type_line' => 'Basic Land — Wastes',
                    'oracle_text' => '({T}: Add {C}.)',
                    'colors' => [],
                    'color_identity' => [],
                    'image_uri' => 'https://c1.scryfall.com/file/scryfall-cards/normal/front/6/f/6f6531d4-2cb5-4a87-a92f-ecc38cf50f23.jpg'
                ];
            }
            return $lands;
        }
        
        // Distribute lands based on colors
        $landsPerColor = floor($count / $colorCount);
        $remainingLands = $count - ($landsPerColor * $colorCount);
        
        $basicLandTypes = [
            'W' => [
                'name' => 'Plains',
                'type_line' => 'Basic Land — Plains',
                'oracle_text' => '({T}: Add {W}.)',
                'colors' => [],
                'color_identity' => ['W'],
                'image_uri' => 'https://c1.scryfall.com/file/scryfall-cards/normal/front/5/f/5fc26aa1-58b9-41b5-95b4-7e9bf2309b54.jpg'
            ],
            'U' => [
                'name' => 'Island',
                'type_line' => 'Basic Land — Island',
                'oracle_text' => '({T}: Add {U}.)',
                'colors' => [],
                'color_identity' => ['U'],
                'image_uri' => 'https://c1.scryfall.com/file/scryfall-cards/normal/front/b/b/bb15b40c-9795-42ae-9f88-8b8c5911f0f3.jpg'
            ],
            'B' => [
                'name' => 'Swamp',
                'type_line' => 'Basic Land — Swamp',
                'oracle_text' => '({T}: Add {B}.)',
                'colors' => [],
                'color_identity' => ['B'],
                'image_uri' => 'https://c1.scryfall.com/file/scryfall-cards/normal/front/6/c/6c8c3f0e-7af4-410b-a675-9ea84f51e812.jpg'
            ],
            'R' => [
                'name' => 'Mountain',
                'type_line' => 'Basic Land — Mountain',
                'oracle_text' => '({T}: Add {R}.)',
                'colors' => [],
                'color_identity' => ['R'],
                'image_uri' => 'https://c1.scryfall.com/file/scryfall-cards/normal/front/5/4/54a1e2a4-e4b8-4efd-8d9a-9d582ac84aac.jpg'
            ],
            'G' => [
                'name' => 'Forest',
                'type_line' => 'Basic Land — Forest',
                'oracle_text' => '({T}: Add {G}.)',
                'colors' => [],
                'color_identity' => ['G'],
                'image_uri' => 'https://c1.scryfall.com/file/scryfall-cards/normal/front/a/e/aea5c36b-c107-4daf-bedb-507b4cd64724.jpg'
            ]
        ];
        
        // Add lands for each color
        foreach ($colorDistribution as $color => $count) {
            if ($count > 0) {
                for ($i = 0; $i < $landsPerColor; $i++) {
                    $lands[] = $basicLandTypes[$color];
                }
                
                // Add extra lands from remaining count
                if ($remainingLands > 0) {
                    $lands[] = $basicLandTypes[$color];
                    $remainingLands--;
                }
            }
        }
        
        return $lands;
    }
    
    /**
     * Calculate average synergy across all cards in a deck
     * 
     * @param array $cards Cards in the deck
     * @return float Average synergy score
     */
    private function calculateAverageDeckSynergy($cards) {
        $totalSynergy = 0;
        $pairCount = 0;
        
        // Calculate synergy for each pair of cards
        for ($i = 0; $i < count($cards); $i++) {
            for ($j = $i + 1; $j < count($cards); $j++) {
                $synergyScore = $this->calculateSynergyScore($cards[$i], $cards[$j]);
                $totalSynergy += $synergyScore;
                $pairCount++;
            }
        }
        
        return $pairCount > 0 ? $totalSynergy / $pairCount : 0;
    }
}

/**
 * API Endpoint Handler
 */
function handleApiRequest() {
    // Database configuration
    $dbConfig = [
        'host' => 'localhost',
        'database' => 'adapt333_mtg',
        'username' => 'adapt333_mtg',
        'password' => 'jKMdBDNb8d2kMfN'
    ];
    
    // Get action from request
    $action = $_GET['action'] ?? '';
    
    try {
        // Initialize API
        $api = new EnhancedCardAPI($dbConfig);
        
        // Process action
        switch ($action) {
            case 'get_sets':
                $result = $api->getAvailableSets();
                break;
                
            case 'get_set_cards':
                $setCode = $_GET['set_code'] ?? '';
                $limit = intval($_GET['limit'] ?? 50);
                $maxPrice = floatval($_GET['max_price'] ?? 5.00);
                
                if (empty($setCode)) {
                    $result = ['error' => 'Set code is required'];
                } else {
                    $result = $api->getUniqueCardsFromSet($setCode, $limit, [
                        'max_price' => $maxPrice,
                        'include_basic_lands' => false
                    ]);
                }
                break;
                
            case 'get_synergistic_cards':
                $cardId = intval($_GET['card_id'] ?? 0);
                $limit = intval($_GET['limit'] ?? 10);
                
                if ($cardId <= 0) {
                    $result = ['error' => 'Valid card ID is required'];
                } else {
                    $result = $api->getSynergisticCards($cardId, $limit);
                }
                break;
                
            case 'build_deck':
                $cardId = intval($_GET['card_id'] ?? 0);
                $deckSize = intval($_GET['deck_size'] ?? 60);
                $minSynergy = floatval($_GET['min_synergy'] ?? 0.3);
                
                if ($cardId <= 0) {
                    $result = ['error' => 'Valid card ID is required'];
                } else {
                    $result = $api->buildSynergisticDeck($cardId, $deckSize, [
                        'min_synergy_score' => $minSynergy
                    ]);
                }
                break;
                
            case 'get_high_synergy_cards':
                $setCode = $_GET['set_code'] ?? '';
                $minStars = intval($_GET['min_stars'] ?? 3);
                $limit = intval($_GET['limit'] ?? 20);
                
                if (empty($setCode)) {
                    $result = ['error' => 'Set code is required'];
                } else {
                    // Get cards from set
                    $setData = $api->getUniqueCardsFromSet($setCode, 100);
                    
                    if (isset($setData['error'])) {
                        $result = $setData;
                    } else {
                        // Filter by star rating
                        $highSynergyCardIds = [];
                        
                        // Combine cards from 3+ star groups
                        for ($stars = 5; $stars >= $minStars; $stars--) {
                            $groupKey = "{$stars}_star";
                            if (isset($setData['synergy_groups'][$groupKey])) {
                                $highSynergyCardIds = array_merge($highSynergyCardIds, $setData['synergy_groups'][$groupKey]);
                            }
                        }
                        
                        // Get the actual cards
                        $highSynergyCards = array_filter($setData['cards'], function($card) use ($highSynergyCardIds) {
                            return in_array($card['id'], $highSynergyCardIds);
                        });
                        
                        // Limit results
                        $highSynergyCards = array_slice($highSynergyCards, 0, $limit);
                        
                        $result = [
                            'set_code' => $setCode,
                            'set_name' => $setData['set_name'],
                            'min_stars' => $minStars,
                            'cards' => array_values($highSynergyCards)
                        ];
                    }
                }
                break;
                
            default:
                $result = [
                    'error' => 'Unknown action',
                    'available_actions' => [
                        'get_sets',
                        'get_set_cards',
                        'get_synergistic_cards',
                        'build_deck',
                        'get_high_synergy_cards'
                    ]
                ];
        }
    } catch (Exception $e) {
        $result = ['error' => $e->getMessage()];
    }
    
    // Return JSON response
    header('Content-Type: application/json');
    echo json_encode($result);
}

// Handle API request if this file is accessed directly
if (basename($_SERVER['SCRIPT_FILENAME']) === basename(__FILE__)) {
    handleApiRequest();
}
