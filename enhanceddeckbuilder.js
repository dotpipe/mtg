/**
 * Enhanced MTG Deck Builder with Synergy Web, Budget Controls, and Persistent UI
 * - Uses MTG Spellbook for combos
 * - Supports budget constraints
 * - Uses AllPrintings.json when appropriate
 * - English cards only
 * - Fuzzy phrase matching
 * - Persistent toasts
 * - Proper card type separation
 * - External card data integration
 */

// Global configuration
const CONFIG = {
    CARD_DATA_URL: 'https://mtgjson.com/api/v5/AllPrintings.json', // Fallback if local file not available
    MIN_SYNERGY_SCORE: 6,
    DEFAULT_BUDGET: 100, // Default budget in USD
    ENABLE_BUDGET: true,
    ENGLISH_ONLY: true,
    PERSISTENT_TOASTS: true,
    FUZZY_MATCH_THRESHOLD: 0.7 // 0-1, higher = stricter matching
};

// Initialize the enhanced deck builder
function initEnhancedDeckBuilder() {
    console.log("Initializing Enhanced MTG Deck Builder with Synergy Web");
    
    // Store original functions
    const originalFunctions = {
        engineGenerateDeck: window.DeckEngine ? window.DeckEngine.generateDeck : null,
        engineGenericDeck: window.DeckEngine ? window.DeckEngine.generateGenericDeck : null,
        synergyBinaryTree: window.SynergyEngine ? window.SynergyEngine.generateDeckWithBinaryTree : null,
        searchCards: window.DeckEngine ? window.DeckEngine.searchCards : null,
        showCardToast: window.CardToast ? window.CardToast.showCardToast : null,
        hideToast: window.CardToast ? window.CardToast.hideToast : null
    };
    
    // Initialize card data source
    initCardDataSource();
    
    // Enhance toast functionality for persistence
    enhanceToastFunctionality();
    
    // Enhance deck generation with synergy web and budget controls
    enhanceDeckGeneration(originalFunctions);
    
    // Enhance card search with fuzzy matching
    enhanceCardSearch(originalFunctions);
    
    // Add budget controls to UI
    addBudgetControlsToUI();
    
    console.log("Enhanced MTG Deck Builder initialized");
}

/**
 * Initialize card data source - try to use local file first, then fallback to API
 */
function initCardDataSource() {
    window.cardDataSource = {
        allPrintings: null,
        isLoading: false,
        
        /**
         * Get card data from source
         * @param {string} cardName - Card name to search for
         * @returns {Promise<Object>} - Card data
         */
        async getCard(cardName) {
            // Try Scryfall first (most up-to-date)
            try {
                const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}&format=json`);
                if (response.ok) {
                    const card = await response.json();
                    // Ensure we have price data
                    if (!card.prices || !card.prices.usd) {
                        card.prices = card.prices || {};
                        card.prices.usd = await this.getCardPriceFromAlternativeSources(cardName);
                    }
                    return card;
                }
            } catch (error) {
                console.warn(`Scryfall API error for ${cardName}:`, error);
            }
            
            // Try local data
            return await this.getCardFromLocalData(cardName);
        },
        
        /**
         * Get card from local data
         * @param {string} cardName - Card name
         * @returns {Promise<Object>} - Card data
         */
        async getCardFromLocalData(cardName) {
            // Load data if not already loaded
            if (!this.allPrintings && !this.isLoading) {
                await this.loadCardData();
            }
            
            // Wait for data to load if currently loading
            if (this.isLoading) {
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (!this.isLoading) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 100);
                });
            }
            
            // Search for card in local data
            if (this.allPrintings) {
                // Fuzzy match the card name
                const matchedCard = this.fuzzyMatchCard(cardName);
                if (matchedCard) {
                    return this.convertToScryfallFormat(matchedCard);
                }
            }
            
            // Create a minimal card object if all else fails
            return {
                name: cardName,
                type_line: "Unknown",
                oracle_text: "",
                mana_cost: "",
                cmc: 0,
                colors: [],
                color_identity: [],
                prices: { usd: "0.00" },
                image_uris: { normal: "placeholder.jpg" }
            };
        },
        
        /**
         * Fuzzy match a card name in local data
         * @param {string} cardName - Card name to match
         * @returns {Object|null} - Matched card or null
         */
        fuzzyMatchCard(cardName) {
            if (!this.allPrintings) return null;
            
            // Normalize the search name
            const searchName = cardName.toLowerCase().trim();
            
            // First try exact match
            for (const setCode in this.allPrintings) {
                const set = this.allPrintings[setCode];
                if (set.cards) {
                    // Filter to English cards if specified
                    const cards = CONFIG.ENGLISH_ONLY 
                        ? set.cards.filter(card => card.language === 'English')
                        : set.cards;
                        
                    const exactMatch = cards.find(card => 
                        card.name.toLowerCase() === searchName
                    );
                    
                    if (exactMatch) return exactMatch;
                }
            }
            
            // If no exact match, try fuzzy matching
            let bestMatch = null;
            let bestScore = CONFIG.FUZZY_MATCH_THRESHOLD;
            
            for (const setCode in this.allPrintings) {
                const set = this.allPrintings[setCode];
                if (set.cards) {
                    // Filter to English cards if specified
                    const cards = CONFIG.ENGLISH_ONLY 
                        ? set.cards.filter(card => card.language === 'English')
                        : set.cards;
                        
                    for (const card of cards) {
                        const score = this.calculateFuzzyScore(searchName, card.name.toLowerCase());
                        if (score > bestScore) {
                            bestMatch = card;
                            bestScore = score;
                        }
                    }
                }
            }
            
            return bestMatch;
        },
        
        /**
         * Calculate fuzzy match score between two strings
         * @param {string} str1 - First string
         * @param {string} str2 - Second string
         * @returns {number} - Match score (0-1)
         */
        calculateFuzzyScore(str1, str2) {
            if (str1 === str2) return 1.0;
            if (str1.length === 0 || str2.length === 0) return 0.0;
            
            // Levenshtein distance calculation
            const len1 = str1.length;
            const len2 = str2.length;
            const matrix = Array(len1 + 1).fill().map(() => Array(len2 + 1).fill(0));
            
            for (let i = 0; i <= len1; i++) matrix[i][0] = i;
            for (let j = 0; j <= len2; j++) matrix[0][j] = j;
            
            for (let i = 1; i <= len1; i++) {
                for (let j = 1; j <= len2; j++) {
                    const cost = str1[i-1] === str2[j-1] ? 0 : 1;
                    matrix[i][j] = Math.min(
                        matrix[i-1][j] + 1,      // deletion
                        matrix[i][j-1] + 1,      // insertion
                        matrix[i-1][j-1] + cost  // substitution
                    );
                }
            }
            
            // Convert distance to similarity score (0-1)
            const maxLen = Math.max(len1, len2);
            return 1 - (matrix[len1][len2] / maxLen);
        },
        
        /**
         * Convert card from local data format to Scryfall format
         * @param {Object} card - Card in local format
         * @returns {Object} - Card in Scryfall format
         */
        convertToScryfallFormat(card) {
            // Create a Scryfall-like object from local data
            return {
                name: card.name,
                type_line: card.type || `${card.types.join(' ')}${card.subtypes ? ' — ' + card.subtypes.join(' ') : ''}`,
                oracle_text: card.text || "",
                mana_cost: card.manaCost || "",
                cmc: card.convertedManaCost || 0,
                colors: card.colors || [],
                color_identity: card.colorIdentity || [],
                rarity: card.rarity || "common",
                set: card.setCode || "",
                collector_number: card.number || "",
                prices: { 
                    usd: card.price || card.prices?.usd || "0.00" 
                },
                image_uris: { 
                    small: card.imageUrl || "placeholder.jpg",
                    normal: card.imageUrl || "placeholder.jpg",
                    large: card.imageUrl || "placeholder.jpg"
                },
                legalities: card.legalities || {}
            };
        },
        
        /**
         * Get card price from alternative sources
         * @param {string} cardName - Card name
         * @returns {Promise<string>} - Card price
         */
        async getCardPriceFromAlternativeSources(cardName) {
            // Try to get price from MTG Spellbook or other sources
            // For now, return a default price
            return "1.00";
        },
        
        /**
         * Load card data from source
         * @returns {Promise<void>}
         */
        async loadCardData() {
            this.isLoading = true;
            
            try {
                // Try to load from local file first
                const localData = localStorage.getItem('mtg_all_printings_path');
                
                if (localData) {
                    try {
                        const response = await fetch(localData);
                        if (response.ok) {
                            this.allPrintings = await response.json();
                            console.log("Loaded card data from local file");
                            this.isLoading = false;
                            return;
                        }
                    } catch (localError) {
                        console.warn("Error loading from local file:", localError);
                    }
                }
                
                // Fall back to remote URL
                console.log("Loading card data from remote URL...");
                const response = await fetch(CONFIG.CARD_DATA_URL);
                
                if (response.ok) {
                    this.allPrintings = await response.json();
                    console.log("Loaded card data from remote URL");
                } else {
                    console.error("Failed to load card data");
                }
            } catch (error) {
                console.error("Error loading card data:", error);
            } finally {
                this.isLoading = false;
            }
        }
    };
}

/**
 * Enhance toast functionality for persistence
 */
function enhanceToastFunctionality() {
    if (!window.CardToast) return;
    
    // Store original functions
    const originalShowToast = window.CardToast.showCardToast;
    const originalHideToast = window.CardToast.hideToast;
    
    // Override showCardToast to make toasts persistent
    window.CardToast.showCardToast = function(card, options = {}) {
        // If persistent toasts are enabled, remove the auto-hide
        if (CONFIG.PERSISTENT_TOASTS) {
            options.duration = 0; // Disable auto-hide
        }
        
        // Call original function
        originalShowToast(card, options);
        
        // Add click-away listener if persistent
        if (CONFIG.PERSISTENT_TOASTS) {
            setTimeout(() => {
                const toast = document.getElementById('cardToast');
                if (toast) {
                    // Only add listener if not already added
                    if (!toast.dataset.clickAwayAdded) {
                        document.addEventListener('click', handleToastClickAway);
                        toast.dataset.clickAwayAdded = 'true';
                    }
                }
            }, 100);
        }
    };
    
    // Handle click-away from toast
    function handleToastClickAway(event) {
        const toast = document.getElementById('cardToast');
        if (!toast) {
            // Remove listener if toast doesn't exist
            document.removeEventListener('click', handleToastClickAway);
            return;
        }
        
        // Check if click is outside toast
        if (toast && !toast.contains(event.target)) {
            // Hide toast
            originalHideToast(toast);
            
            // Remove listener
            document.removeEventListener('click', handleToastClickAway);
        }
    }
}

/**
 * Enhance deck generation with synergy web and budget controls
 * @param {Object} originalFunctions - Original functions
 */
function enhanceDeckGeneration(originalFunctions) {
    // Create the synergy web deck generator
    const synergyWebGenerator = createSynergyWebGenerator(originalFunctions);
    
    // Override DeckEngine's generateDeck
    if (window.DeckEngine) {
        window.DeckEngine.generateDeck = async function(mainCard, format, options = {}) {
            console.log(`Using enhanced synergy web deck generation for ${mainCard.name}`);
            
            // Apply budget constraints if enabled
            if (CONFIG.ENABLE_BUDGET) {
                options.budget = getBudgetFromUI();
            }
            
            try {
                // Use synergy web approach
                return await synergyWebGenerator.generateDeck(mainCard, format, options);
            } catch (error) {
                console.error(`Error in enhanced generateDeck:`, error);
                // Fall back to original function
                return await originalFunctions.engineGenerateDeck(mainCard, format, options);
            }
        };
    }
    
    // Override SynergyEngine's generateDeckWithBinaryTree
    if (window.SynergyEngine) {
        window.SynergyEngine.generateDeckWithBinaryTree = async function(rootCard, format, options = {}) {
            console.log(`Using enhanced synergy web deck generation for binary tree approach with ${rootCard.name}`);
            
            // Apply budget constraints if enabled
            if (CONFIG.ENABLE_BUDGET) {
                options.budget = getBudgetFromUI();
            }
            
            try {
                // Use synergy web approach
                return await synergyWebGenerator.generateDeck(rootCard, format, options);
            } catch (error) {
                console.error(`Error in enhanced generateDeckWithBinaryTree:`, error);
                // Fall back to original function
                return await originalFunctions.synergyBinaryTree(rootCard, format, options);
            }
        };
    }
}

/**
 * Create the synergy web generator
 * @param {Object} originalFunctions - Original functions
 * @returns {Object} - Synergy web generator
 */
function createSynergyWebGenerator(originalFunctions) {
    return {
        /**
         * Generate a deck using the synergy web approach
         * @param {Object} mainCard - Main card
         * @param {Object} format - Format configuration
         * @param {Object} options - Additional options
         * @returns {Promise<Array>} - Generated deck
         */
        async generateDeck(mainCard, format, options = {}) {
            console.log(`Generating synergy web deck with ${mainCard.name} as the foundation`);
            
            if (!format) {
                console.error("No format selected");
                return [];
            }
            
            // Initialize deck with main card
            const deck = [mainCard];
            const deckSize = format.minDeckSize || 60;
            const cardsByType = {};
            const synergyMatrix = new Map(); // Maps card name to array of {cardName, synergyScore} objects
            const processedCards = new Set([mainCard.name]);
            const budget = options.budget || CONFIG.DEFAULT_BUDGET;
            let currentBudget = 0;
            
            // Add main card to synergy matrix
            synergyMatrix.set(mainCard.name, []);
            
            // Track card type for main card
            const mainCardType = this.getCardType(mainCard);
            cardsByType[mainCardType] = [mainCard];
            
            try {
                // Step 1: Find initial high-synergy cards for the main card
                console.log("Finding initial high-synergy cards...");
                const initialSynergies = await this.findHighSynergyCards(mainCard, format, 20, budget);
                
                // Step 2: Select a random high-synergy card to start the web
                if (initialSynergies.length > 0) {
                    // Shuffle the synergies to get a random starting point
                    const shuffledSynergies = this.shuffleArray(initialSynergies);
                    const startingCard = shuffledSynergies[0].card;
                    
                    console.log(`Selected ${startingCard.name} as the starting point (synergy score: ${shuffledSynergies[0].synergyScore})`);
                    
                    // Add to deck and synergy matrix
                    deck.push(startingCard);
                    processedCards.add(startingCard.name);
                    
                    // Update budget
                    currentBudget += this.getCardPrice(startingCard);
                    
                    // Update synergy matrix
                    synergyMatrix.get(mainCard.name).push({
                        cardName: startingCard.name,
                        synergyScore: shuffledSynergies[0].synergyScore
                    });
                    synergyMatrix.set(startingCard.name, [{
                        cardName: mainCard.name,
                        synergyScore: shuffledSynergies[0].synergyScore
                    }]);
                    
                    // Track card type
                    const startingCardType = this.getCardType(startingCard);
                    if (!cardsByType[startingCardType]) {
                        cardsByType[startingCardType] = [];
                    }
                    cardsByType[startingCardType].push(startingCard);
                    
                    // Step 3: Build the web by finding synergies for each card in the deck
                    console.log("Building synergy web...");
                    await this.buildSynergyWeb(deck, synergyMatrix, format, cardsByType, processedCards, budget, currentBudget);
                    
                    // Step 4: Calculate distribution of remaining cards needed
                    const remainingCards = deckSize - deck.length;
                    console.log(`Web contains ${deck.length} cards, need ${remainingCards} more cards`);
                    
                    if (remainingCards > 0) {
                        // Calculate how many lands we need
                        const currentLands = cardsByType['Land'] ? cardsByType['Land'].length : 0;
                        const targetLandCount = Math.floor(deckSize * 0.38); // Approximately 38% lands
                        const landsNeeded = Math.max(0, targetLandCount - currentLands);
                        
                        console.log(`Current lands: ${currentLands}, Target lands: ${targetLandCount}, Need: ${landsNeeded}`);
                        
                        // Add lands
                        if (landsNeeded > 0) {
                            const lands = await this.getHighSynergyLands(mainCard, format, landsNeeded, deck, budget - currentBudget);
                            for (const land of lands) {
                                deck.push(land);
                                processedCards.add(land.name);
                                
                                // Update budget
                                currentBudget += this.getCardPrice(land);
                                
                                // Track card type
                                if (!cardsByType['Land']) {
                                    cardsByType['Land'] = [];
                                }
                                cardsByType['Land'].push(land);
                                
                                // Add to synergy matrix
                                if (!synergyMatrix.has(land.name)) {
                                    synergyMatrix.set(land.name, [{
                                        cardName: mainCard.name,
                                        synergyScore: land.synergyScore || CONFIG.MIN_SYNERGY_SCORE
                                    }]);
                                }
                            }
                        }
                        
                        // Calculate remaining non-land cards needed
                        const remainingNonLands = deckSize - deck.length;
                        
                        if (remainingNonLands > 0) {
                            console.log(`Need ${remainingNonLands} more non-land cards`);
                            
                            // Find more synergistic cards to fill the deck
                            await this.fillRemainingCards(deck, synergyMatrix, format, remainingNonLands, cardsByType, processedCards, budget - currentBudget);
                        }
                    }
                } else {
                    console.warn("No high-synergy cards found, falling back to standard deck generation");
                    return await originalFunctions.engineGenerateDeck(mainCard, format, options);
                }
                
                // Step 5: Ensure we have the right number of cards
                if (deck.length > deckSize) {
                    console.log(`Deck has ${deck.length} cards, trimming to ${deckSize}`);
                    
                    // Keep the main card
                    const mainCardObj = deck[0];
                    
                    // Sort other cards by their total synergy with the deck
                    const otherCards = deck.slice(1).map(card => {
                        const totalSynergy = this.calculateTotalSynergyWithDeck(card.name, synergyMatrix);
                        return { ...card, totalSynergy };
                    }).sort((a, b) => b.totalSynergy - a.totalSynergy);
                    
                    // Rebuild deck with highest synergy cards
                    deck.length = 0;
                    deck.push(mainCardObj);
                    deck.push(...otherCards.slice(0, deckSize - 1));
                }
                
                // Step 6: Add synergy commentary to each card
                for (const card of deck) {
                    if (card.name !== mainCard.name && !card.synergyCommentary) {
                        const synergies = synergyMatrix.get(card.name) || [];
                        if (synergies.length > 0) {
                            // Find the highest synergy
                            const highestSynergy = synergies.reduce((highest, current) => 
                                current.synergyScore > highest.synergyScore ? current : highest, 
                                { synergyScore: 0 }
                            );
                            
                            // Find the card object for the highest synergy
                            const synergisticCard = deck.find(c => c.name === highestSynergy.cardName);
                            
                            if (synergisticCard) {
                                card.synergyCommentary = this.generateSynergyCommentary(card, synergisticCard, highestSynergy.synergyScore);
                                card.synergyScore = highestSynergy.synergyScore;
                            }
                        }
                    }
                }
                
                // Step 7: Separate cards by type for Commander format
                if (format.code === 'commander') {
                    this.separateCardsByTypeForCommander(deck);
                }
                
                console.log(`Generated ${deck.length} card synergy web deck`);
                return deck;
            } catch (error) {
                console.error("Error generating synergy web deck:", error);
                // Fall back to original method
                return await originalFunctions.engineGenerateDeck(mainCard, format, options);
            }
        },
        
        /**
         * Build the synergy web by finding synergies for each card in the deck
         * @param {Array} deck - Current deck
         * @param {Map} synergyMatrix - Synergy relationships between cards
         * @param {Object} format - Format configuration
         * @param {Object} cardsByType - Cards organized by type
         * @param {Set} processedCards - Cards already processed
         * @param {number} budget - Total budget
         * @param {number} currentBudget - Current budget used
         */
        async buildSynergyWeb(deck, synergyMatrix, format, cardsByType, processedCards, budget, currentBudget) {
            // We'll process cards in waves, starting with the cards already in the deck
            let currentWave = [...deck];
            let maxDeckSize = Math.min(format.minDeckSize || 60, 60); // Cap at 60 for the web building phase
            let webBuildingIterations = 0;
            const MAX_ITERATIONS = 5; // Prevent infinite loops
            
            while (deck.length < maxDeckSize && webBuildingIterations < MAX_ITERATIONS && currentBudget < budget) {
                webBuildingIterations++;
                console.log(`Web building iteration ${webBuildingIterations}, current deck size: ${deck.length}, budget: $${currentBudget.toFixed(2)}/$${budget.toFixed(2)}`);
                
                const nextWave = [];
                
                // For each card in the current wave, find high synergy cards
                for (const sourceCard of currentWave) {
                    // Skip if we've reached max deck size or budget
                    if (deck.length >= maxDeckSize || currentBudget >= budget) break;
                    
                    // Find cards that synergize with this card
                    const synergies = await this.findHighSynergyCards(sourceCard, format, 5, budget - currentBudget);
                    
                    // Filter out cards already in the deck
                    const newSynergies = synergies.filter(s => !processedCards.has(s.card.name));
                    
                    // Add the highest synergy cards to the deck
                    for (const synergy of newSynergies) {
                        // Skip if we've reached max deck size or budget
                        if (deck.length >= maxDeckSize) break;
                        
                        // Check if adding this card would exceed budget
                        const cardPrice = this.getCardPrice(synergy.card);
                        if (currentBudget + cardPrice > budget) {
                            console.log(`Skipping ${synergy.card.name} ($${cardPrice.toFixed(2)}) - would exceed budget`);
                            continue;
                        }
                        
                        // Add to deck
                        deck.push(synergy.card);
                        processedCards.add(synergy.card.name);
                        nextWave.push(synergy.card);
                        
                        // Update budget
                        currentBudget += cardPrice;
                        
                        // Track card type
                        const cardType = this.getCardType(synergy.card);
                        if (!cardsByType[cardType]) {
                            cardsByType[cardType] = [];
                        }
                        cardsByType[cardType].push(synergy.card);
                        
                        // Update synergy matrix
                        if (!synergyMatrix.has(synergy.card.name)) {
                            synergyMatrix.set(synergy.card.name, []);
                        }
                        
                        // Add bidirectional synergy relationship
                        synergyMatrix.get(sourceCard.name).push({
                            cardName: synergy.card.name,
                            synergyScore: synergy.synergyScore
                        });
                        
                        synergyMatrix.get(synergy.card.name).push({
                            cardName: sourceCard.name,
                            synergyScore: synergy.synergyScore
                        });
                        
                        // Check for synergies with other cards already in the deck
                        for (const existingCard of deck) {
                            if (existingCard.name !== sourceCard.name && existingCard.name !== synergy.card.name) {
                                const existingSynergy = this.calculateSynergy(existingCard, synergy.card);
                                
                                if (existingSynergy >= CONFIG.MIN_SYNERGY_SCORE) {
                                    // Add bidirectional synergy relationship
                                    synergyMatrix.get(existingCard.name).push({
                                        cardName: synergy.card.name,
                                        synergyScore: existingSynergy
                                    });
                                    
                                    synergyMatrix.get(synergy.card.name).push({
                                        cardName: existingCard.name,
                                        synergyScore: existingSynergy
                                    });
                                }
                            }
                        }
                    }
                }
                
                // If we didn't add any new cards, break the loop
                if (nextWave.length === 0) {
                    console.log("No more high-synergy cards found, ending web building");
                    break;
                }
                
                // Set up for next iteration
                currentWave = nextWave;
            }
        },
        
        /**
         * Fill remaining slots in the deck with high-synergy cards
         * @param {Array} deck - Current deck
         * @param {Map} synergyMatrix - Synergy relationships between cards
         * @param {Object} format - Format configuration
         * @param {number} count - Number of cards to add
         * @param {Object} cardsByType - Cards organized by type
         * @param {Set} processedCards - Cards already processed
         * @param {number} remainingBudget - Remaining budget
         */
        async fillRemainingCards(deck, synergyMatrix, format, count, cardsByType, processedCards, remainingBudget) {
            // Calculate ideal distribution of remaining cards
            const distribution = this.calculateIdealDistribution(cardsByType, count, format);
            
            console.log("Filling remaining cards with distribution:", distribution);
            console.log(`Remaining budget: $${remainingBudget.toFixed(2)}`);
            
            let currentBudget = 0;
            
            // For each type, add the specified number of cards
            for (const [type, typeCount] of Object.entries(distribution)) {
                if (typeCount <= 0) continue;
                
                console.log(`Adding ${typeCount} ${type} cards`);
                
                // Find cards that synergize with the current deck
                const addedCards = await this.findHighSynergyCardsForType(
                    deck, format, typeCount, type, synergyMatrix, processedCards, remainingBudget - currentBudget
                );
                
                // Add to deck and update tracking
                for (const card of addedCards) {
                    deck.push(card);
                    processedCards.add(card.name);
                    
                    // Update budget
                    currentBudget += this.getCardPrice(card);
                    
                    // Track card type
                    if (!cardsByType[type]) {
                        cardsByType[type] = [];
                    }
                    cardsByType[type].push(card);
                }
            }
        },
        
        /**
         * Find high synergy cards for a specific card
         * @param {Object} card - Source card
         * @param {Object} format - Format configuration
         * @param {number} count - Number of cards to find
         * @param {number} remainingBudget - Remaining budget
         * @returns {Promise<Array>} - Array of {card, synergyScore} objects
         */
        async findHighSynergyCards(card, format, count, remainingBudget) {
            try {
                // Use SynergyEngine if available
                if (window.SynergyEngine && window.SynergyEngine.findSynergisticCards) {
                    const synergisticCards = await window.SynergyEngine.findSynergisticCards(card, format, count * 2);
                    
                    // Filter for high synergy (6+) and budget
                    return synergisticCards
                        .filter(s => {
                            // Check synergy score
                            if (s.synergyScore < CONFIG.MIN_SYNERGY_SCORE) return false;
                            
                            // Check budget
                            const price = this.getCardPrice(s.card);
                            return price <= remainingBudget;
                        })
                        .slice(0, count);
                }
                
                // Fallback to manual search
                const cardType = this.getCardType(card);
                const colorIdentity = card.color_identity || [];
                
                // Build search query
                let query = `identity:${colorIdentity.join('')}`;
                
                // Add format legality
                if (format.code) {
                    query += ` format:${format.code}`;
                }
                
                // Add budget constraint to query if possible
                if (remainingBudget < 100) {
                    query += ` usd<=${remainingBudget.toFixed(2)}`;
                }
                
                // Search for cards
                const searchResults = await this.searchCards(query, count * 3);
                
                // Calculate synergy for each card
                const synergies = [];
                
                for (const result of searchResults) {
                    // Skip if it's the same card
                    if (result.name === card.name) continue;
                    
                    // Check budget
                    const price = this.getCardPrice(result);
                    if (price > remainingBudget) continue;
                    
                    // Calculate synergy
                    const synergyScore = this.calculateSynergy(card, result);
                    
                    // Only include high synergy cards
                    if (synergyScore >= CONFIG.MIN_SYNERGY_SCORE) {
                        synergies.push({
                            card: result,
                            synergyScore
                        });
                    }
                }
                
                // Sort by synergy score (highest first) and return top results
                return synergies.sort((a, b) => b.synergyScore - a.synergyScore).slice(0, count);
            } catch (error) {
                console.warn(`Error finding high synergy cards for ${card.name}:`, error);
                return [];
            }
        },
        
        /**
         * Find high synergy cards of a specific type for the current deck
         * @param {Array} deck - Current deck
         * @param {Object} format - Format configuration
         * @param {number} count - Number of cards to find
         * @param {string} type - Card type to find
         * @param {Map} synergyMatrix - Synergy relationships between cards
         * @param {Set} processedCards - Cards already processed
         * @param {number} remainingBudget - Remaining budget
         * @returns {Promise<Array>} - Array of card objects
         */
        async findHighSynergyCardsForType(deck, format, count, type, synergyMatrix, processedCards, remainingBudget) {
            try {
                const mainCard = deck[0];
                const colorIdentity = mainCard.color_identity || [];
                
                // Build search query
                let query = `type:${type} identity:${colorIdentity.join('')}`;
                
                // Add format legality
                if (format.code) {
                    query += ` format:${format.code}`;
                }
                
                // Add budget constraint to query if possible
                if (remainingBudget < 100) {
                    query += ` usd<=${remainingBudget.toFixed(2)}`;
                }
                
                // Search for cards
                const searchResults = await this.searchCards(query, count * 3);
                
                // Calculate synergy for each card with the entire deck
                const synergies = [];
                
                for (const result of searchResults) {
                    // Skip if already in deck
                    if (processedCards.has(result.name)) continue;
                    
                    // Check budget
                    const price = this.getCardPrice(result);
                    if (price > remainingBudget) continue;
                    
                    // Calculate synergy with each card in the deck
                    let bestSynergyScore = 0;
                    let bestSynergyCard = null;
                    
                    for (const deckCard of deck) {
                        const synergyScore = this.calculateSynergy(deckCard, result);
                        
                        if (synergyScore > bestSynergyScore) {
                            bestSynergyScore = synergyScore;
                            bestSynergyCard = deckCard;
                        }
                    }
                    
                    // Only include high synergy cards
                    if (bestSynergyScore >= CONFIG.MIN_SYNERGY_SCORE) {
                        // Add synergy information to the card
                        result.synergyScore = bestSynergyScore;
                        result.synergyCommentary = this.generateSynergyCommentary(result, bestSynergyCard, bestSynergyScore);
                        
                        // Add to synergy matrix
                        if (!synergyMatrix.has(result.name)) {
                            synergyMatrix.set(result.name, []);
                        }
                        
                        // Add bidirectional synergy relationship
                        synergyMatrix.get(bestSynergyCard.name).push({
                            cardName: result.name,
                            synergyScore: bestSynergyScore
                        });
                        
                        synergyMatrix.get(result.name).push({
                            cardName: bestSynergyCard.name,
                            synergyScore: bestSynergyScore
                        });
                        
                        synergies.push(result);
                    }
                }
                
                // Sort by synergy score (highest first) and return top results
                return synergies.sort((a, b) => b.synergyScore - a.synergyScore).slice(0, count);
            } catch (error) {
                console.warn(`Error finding high synergy ${type} cards:`, error);
                return [];
            }
        },
        
        /**
         * Get high synergy lands for the deck
         * @param {Object} mainCard - Main card
         * @param {Object} format - Format configuration
         * @param {number} count - Number of lands to get
         * @param {Array} deck - Current deck
         * @param {number} remainingBudget - Remaining budget
         * @returns {Promise<Array>} - Array of land card objects
         */
        async getHighSynergyLands(mainCard, format, count, deck, remainingBudget) {
            try {
                const colorIdentity = mainCard.color_identity || [];
                
                // Calculate basic land distribution
                const basicLandCount = Math.floor(count * 0.7); // 70% basic lands
                const nonBasicCount = count - basicLandCount;
                
                const lands = [];
                
                // Add non-basic lands first
                if (nonBasicCount > 0) {
                    // Build search query for non-basic lands
                    let query = `type:land -type:basic identity:${colorIdentity.join('')}`;
                    
                    // Add format legality
                    if (format.code) {
                        query += ` format:${format.code}`;
                    }
                    
                    // Add budget constraint to query if possible
                    if (remainingBudget < 100) {
                        query += ` usd<=${remainingBudget.toFixed(2)}`;
                    }
                    
                    // Search for lands
                    const searchResults = await this.searchCards(query, nonBasicCount * 2);
                    
                    // Calculate synergy for each land with the entire deck
                    const synergies = [];
                    const processedCards = new Set(deck.map(card => card.name));
                    
                    for (const result of searchResults) {
                        // Skip if already in deck
                        if (processedCards.has(result.name)) continue;
                        
                        // Check budget
                        const price = this.getCardPrice(result);
                        if (price > remainingBudget) continue;
                        
                        // Calculate synergy with each card in the deck
                        let bestSynergyScore = 0;
                        let bestSynergyCard = null;
                        
                        for (const deckCard of deck) {
                            const synergyScore = this.calculateSynergy(deckCard, result);
                            
                            if (synergyScore > bestSynergyScore) {
                                bestSynergyScore = synergyScore;
                                bestSynergyCard = deckCard;
                            }
                        }
                        
                        // For lands, we're more lenient with synergy requirements
                        if (bestSynergyScore >= 4) {
                            // Add synergy information to the card
                            result.synergyScore = bestSynergyScore;
                            result.synergyCommentary = this.generateSynergyCommentary(result, bestSynergyCard, bestSynergyScore);
                            
                            synergies.push(result);
                        }
                    }
                    
                    // Sort by synergy score (highest first) and add to lands
                    const sortedLands = synergies.sort((a, b) => b.synergyScore - a.synergyScore).slice(0, nonBasicCount);
                    lands.push(...sortedLands);
                    
                    // Update remaining budget
                    for (const land of sortedLands) {
                        remainingBudget -= this.getCardPrice(land);
                    }
                }
                
                // Add basic lands to fill the rest
                if (basicLandCount > 0) {
                    const basicLands = await this.getBasicLands(colorIdentity, basicLandCount);
                    lands.push(...basicLands);
                }
                
                return lands;
            } catch (error) {
                console.warn("Error getting high synergy lands:", error);
                // Fallback to basic lands
                return await this.getBasicLands(mainCard.color_identity || [], count);
            }
        },
        
        /**
         * Get basic lands
         * @param {Array} colorIdentity - Color identity array
         * @param {number} count - Number of lands needed
         * @returns {Promise<Array>} - Array of land card objects
         */
        async getBasicLands(colorIdentity, count) {
            try {
                if (window.DeckEngine && window.DeckEngine.getBasicLands) {
                    return await window.DeckEngine.getBasicLands(colorIdentity, count);
                }
                
                // Fallback implementation
                const lands = [];
                const basicLandNames = {
                    'W': 'Plains',
                    'U': 'Island',
                    'B': 'Swamp',
                    'R': 'Mountain',
                    'G': 'Forest'
                };
                
                // If no colors, just add colorless lands
                if (!colorIdentity || colorIdentity.length === 0) {
                    for (let i = 0; i < count; i++) {
                        lands.push(this.createBasicLand('Wastes'));
                    }
                    return lands;
                }
                
                // Calculate land distribution
                const landsPerColor = Math.floor(count / colorIdentity.length);
                let remainingLands = count - (landsPerColor * colorIdentity.length);
                
                // Add lands for each color
                for (const color of colorIdentity) {
                    const landName = basicLandNames[color];
                    if (!landName) continue;
                    
                    // Add the calculated number of this land
                    for (let i = 0; i < landsPerColor; i++) {
                        lands.push(this.createBasicLand(landName));
                    }
                    
                    // Add one extra land if we have remaining lands
                    if (remainingLands > 0) {
                        lands.push(this.createBasicLand(landName));
                        remainingLands--;
                    }
                }
                
                return lands;
            } catch (error) {
                console.warn("Error getting basic lands:", error);
                return [];
            }
        },
        
        /**
         * Create a basic land card object
         * @param {string} name - Land name
         * @returns {Object} - Land card object
         */
        createBasicLand(name) {
            return {
                name: name,
                type_line: `Basic Land — ${name}`,
                type: 'Land',
                rarity: 'common',
                cmc: 0,
                color_identity: this.getLandColorIdentity(name),
                price: 0.1,
                oracle_text: `({T}: Add ${this.getLandManaSymbol(name)}.)`
            };
        },
        
        /**
         * Get color identity for a land
         * @param {string} landName - Land name
         * @returns {Array} - Color identity array
         */
        getLandColorIdentity(landName) {
            switch (landName) {
                case 'Plains': return ['W'];
                case 'Island': return ['U'];
                case 'Swamp': return ['B'];
                case 'Mountain': return ['R'];
                case 'Forest': return ['G'];
                default: return [];
            }
        },
        
        /**
         * Get mana symbol for a land
         * @param {string} landName - Land name
         * @returns {string} - Mana symbol
         */
        getLandManaSymbol(landName) {
            switch (landName) {
                case 'Plains': return '{W}';
                case 'Island': return '{U}';
                case 'Swamp': return '{B}';
                case 'Mountain': return '{R}';
                case 'Forest': return '{G}';
                default: return '{C}';
            }
        },
        
        /**
         * Calculate ideal distribution of remaining cards
         * @param {Object} cardsByType - Cards organized by type
         * @param {number} count - Number of cards to add
         * @param {Object} format - Format configuration
         * @returns {Object} - Ideal distribution by type
         */
        calculateIdealDistribution(cardsByType, count, format) {
            // Define ideal percentages for each type based on format
            let idealPercentages;
            
            if (format.code === 'commander') {
                idealPercentages = {
                    'Creature': 0.30,
                    'Instant': 0.10,
                    'Sorcery': 0.10,
                    'Artifact': 0.10,
                    'Enchantment': 0.10,
                    'Planeswalker': 0.02,
                    'Land': 0.38
                };
            } else {
                idealPercentages = {
                    'Creature': 0.35,
                    'Instant': 0.10,
                    'Sorcery': 0.10,
                    'Artifact': 0.10,
                    'Enchantment': 0.10,
                    'Planeswalker': 0.05,
                    'Land': 0.30
                };
            }
            
            // Calculate current counts and percentages
            const totalCards = Object.values(cardsByType).flat().length;
            const currentCounts = {};
            const currentPercentages = {};
            
            for (const type in idealPercentages) {
                currentCounts[type] = cardsByType[type] ? cardsByType[type].length : 0;
                currentPercentages[type] = totalCards > 0 ? currentCounts[type] / totalCards : 0;
            }
            
            // Calculate target counts for the final deck
            const finalDeckSize = totalCards + count;
            const targetCounts = {};
            
            for (const type in idealPercentages) {
                targetCounts[type] = Math.round(finalDeckSize * idealPercentages[type]);
            }
            
            // Calculate how many more of each type we need
            const distribution = {};
            
            for (const type in idealPercentages) {
                distribution[type] = Math.max(0, targetCounts[type] - currentCounts[type]);
            }
            
            // Adjust to match the total count
            let totalDistribution = Object.values(distribution).reduce((sum, val) => sum + val, 0);
            
            if (totalDistribution !== count) {
                // Proportionally adjust each type
                const adjustmentFactor = count / totalDistribution;
                
                for (const type in distribution) {
                    distribution[type] = Math.round(distribution[type] * adjustmentFactor);
                }
                
                // Fix any rounding errors
                totalDistribution = Object.values(distribution).reduce((sum, val) => sum + val, 0);
                
                if (totalDistribution < count) {
                    // Add the difference to creatures
                    distribution['Creature'] += (count - totalDistribution);
                } else if (totalDistribution > count) {
                    // Remove the difference from the type with the most cards
                    const typeWithMost = Object.entries(distribution)
                        .sort((a, b) => b[1] - a[1])[0][0];
                    distribution[typeWithMost] -= (totalDistribution - count);
                }
            }
            
            return distribution;
        },
        
        /**
         * Calculate total synergy of a card with the entire deck
         * @param {string} cardName - Card name
         * @param {Map} synergyMatrix - Synergy relationships between cards
         * @returns {number} - Total synergy score
         */
        calculateTotalSynergyWithDeck(cardName, synergyMatrix) {
            const synergies = synergyMatrix.get(cardName) || [];
            return synergies.reduce((total, synergy) => total + synergy.synergyScore, 0);
        },
        
        /**
         * Calculate synergy between two cards
         * @param {Object} card1 - First card
         * @param {Object} card2 - Second card
         * @returns {number} - Synergy score (0-10)
         */
        calculateSynergy(card1, card2) {
            try {
                // Use SynergyEngine if available
                if (window.SynergyEngine && window.SynergyEngine.calculateSynergyScore) {
                    return window.SynergyEngine.calculateSynergyScore(card1, card2);
                }
                
                // Use cardTextAnalyzer if available
                if (window.cardTextAnalyzer) {
                    const analysis1 = window.cardTextAnalyzer.analyzeCard(card1);
                    const analysis2 = window.cardTextAnalyzer.analyzeCard(card2);
                    
                    return this.calculateSynergyFromAnalysis(analysis1, analysis2);
                }
                
                // Fallback to basic synergy calculation
                return this.calculateBasicSynergy(card1, card2);
            } catch (error) {
                console.warn(`Error calculating synergy between ${card1.name} and ${card2.name}:`, error);
                return 0;
            }
        },
        
        /**
         * Calculate synergy from card analysis
         * @param {Object} analysis1 - First card analysis
         * @param {Object} analysis2 - Second card analysis
         * @returns {number} - Synergy score (0-10)
         */
        calculateSynergyFromAnalysis(analysis1, analysis2) {
            let score = 0;
            
            // Check for shared keywords
            const keywords1 = new Set(analysis1.textAnalysis?.keywords || []);
            const keywords2 = new Set(analysis2.textAnalysis?.keywords || []);
            
            keywords1.forEach(keyword => {
                if (keywords2.has(keyword)) {
                    score += 1;
                }
            });
            
            // Check for synergy groups
            const groups1 = analysis1.synergyGroups || [];
            const groups2 = analysis2.synergyGroups || [];
            
            groups1.forEach(group1 => {
                groups2.forEach(group2 => {
                    if (group1.type === group2.type) {
                        score += 2;
                    }
                });
            });
            
            // Check for creature types
            const types1 = analysis1.creatureTypes || [];
            const types2 = analysis2.creatureTypes || [];
            
            types1.forEach(type1 => {
                types2.forEach(type2 => {
                    if (type1.type === type2.type) {
                        score += 1.5;
                    }
                });
            });
            
            // Check for win conditions
            const wins1 = analysis1.winConditions || [];
            const wins2 = analysis2.winConditions || [];
            
            wins1.forEach(win1 => {
                wins2.forEach(win2 => {
                    if (win1.type === win2.type) {
                        score += 3;
                    }
                });
            });
            
            return Math.min(10, score);
        },
        
        /**
         * Basic synergy calculation
         * @param {Object} card1 - First card
         * @param {Object} card2 - Second card
         * @returns {number} - Synergy score (0-10)
         */
        calculateBasicSynergy(card1, card2) {
            let score = 0;
            
            // Check color identity match
            const colors1 = new Set(card1.color_identity || []);
            const colors2 = new Set(card2.color_identity || []);
            
            // Calculate color overlap percentage
            if (colors1.size > 0 && colors2.size > 0) {
                let matchCount = 0;
                colors1.forEach(color => {
                    if (colors2.has(color)) matchCount++;
                });
                
                const overlapPercent = matchCount / Math.max(colors1.size, colors2.size);
                score += overlapPercent * 2; // Up to 2 points for color match
            }
            
            // Check for type line similarities
            const type1 = card1.type_line || "";
            const type2 = card2.type_line || "";
            
            // Check for creature type matches
            const creatureTypes = [
                "Human", "Elf", "Goblin", "Zombie", "Vampire", "Wizard", 
                "Warrior", "Dragon", "Angel", "Demon", "Beast", "Elemental"
            ];
            
            creatureTypes.forEach(type => {
                if (type1.includes(type) && type2.includes(type)) {
                    score += 1;
                }
            });
            
            // Check for card text similarities
            const text1 = card1.oracle_text || "";
            const text2 = card2.oracle_text || "";
            
            // Check for common keywords
            const keywords = [
                "Flying", "Trample", "Haste", "Vigilance", "Deathtouch", 
                "Lifelink", "First strike", "Double strike", "Menace", "Hexproof"
            ];
            
            keywords.forEach(keyword => {
                if (text1.includes(keyword) && text2.includes(keyword)) {
                    score += 0.5;
                }
            });
            
            // Check for common mechanics
            const mechanics = [
                "draw", "discard", "sacrifice", "destroy", "exile", 
                "counter", "return", "search", "reveal", "damage",
                "token", "copy", "+1/+1", "graveyard", "library"
            ];
            
            mechanics.forEach(mechanic => {
                if (text1.toLowerCase().includes(mechanic) && text2.toLowerCase().includes(mechanic)) {
                    score += 0.7;
                }
            });
            
            // Check for mana cost similarities
            const cmc1 = card1.cmc || 0;
            const cmc2 = card2.cmc || 0;
            
            // Cards with similar mana costs often work well together in a curve
            if (Math.abs(cmc1 - cmc2) <= 1) {
                score += 0.5;
            }
            
            // Scale to 0-10
            return Math.min(10, score * 1.5);
        },
        
        /**
         * Generate commentary about synergy between cards
         * @param {Object} card - Card object
         * @param {Object} referenceCard - Reference card object
         * @param {number} synergyScore - Synergy score between cards
         * @returns {string} - Commentary text
         */
        generateSynergyCommentary(card, referenceCard, synergyScore) {
            // Use SynergyEngine if available
            if (window.SynergyEngine && window.SynergyEngine.generateCommentary) {
                return window.SynergyEngine.generateCommentary(card, referenceCard, synergyScore);
            }
            
            // Get card types
            const cardType = this.getCardType(card);
            const referenceType = this.getCardType(referenceCard);
            
            // Generate commentary based on card types and synergy score
            if (synergyScore >= 8) {
                return `Exceptional pairing with ${referenceCard.name}. This ${cardType.toLowerCase()} creates a powerful synergy that significantly enhances your deck's strategy.`;
            } else if (synergyScore >= 6) {
                return `Strong synergy with ${referenceCard.name}. This ${cardType.toLowerCase()} works very well with your ${referenceType.toLowerCase()} to create consistent value.`;
            } else {
                return `Good combination with ${referenceCard.name}. This card provides useful support and enhances your deck's core strategy.`;
            }
        },
        
        /**
         * Get the primary card type
         * @param {Object} card - Card object
         * @returns {string} - Primary card type
         */
        getCardType(card) {
            if (!card) return 'Unknown';
            
            const typeLine = card.type_line || '';
            
            if (typeLine.includes('Creature')) return 'Creature';
            if (typeLine.includes('Planeswalker')) return 'Planeswalker';
            if (typeLine.includes('Instant')) return 'Instant';
            if (typeLine.includes('Sorcery')) return 'Sorcery';
            if (typeLine.includes('Artifact')) return 'Artifact';
            if (typeLine.includes('Enchantment')) return 'Enchantment';
            if (typeLine.includes('Land')) return 'Land';
            
            return 'Unknown';
        },
        
        /**
         * Get card price
         * @param {Object} card - Card object
         * @returns {number} - Card price
         */
        getCardPrice(card) {
            if (!card) return 0;
            
            // Try to get price from card object
            if (card.price) return parseFloat(card.price) || 0;
            if (card.prices && card.prices.usd) return parseFloat(card.prices.usd) || 0;
            
            // Default price
            return 0.25;
        },
        
        /**
         * Search for cards
         * @param {string} query - Search query
         * @param {number} limit - Maximum number of results
         * @returns {Promise<Array>} - Array of card objects
         */
        async searchCards(query, limit = 20) {
            try {
                // Use existing search function if available
                if (window.DeckEngine && window.DeckEngine.searchCards) {
                    return await window.DeckEngine.searchCards(query, limit);
                }
                
                // Fallback to Scryfall API
                const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`);
                
                if (response.ok) {
                    const data = await response.json();
                    return data.data?.slice(0, limit) || [];
                }
                
                return [];
            } catch (error) {
                console.error("Error searching for cards:", error);
                return [];
            }
        },
        
        /**
         * Shuffle an array using Fisher-Yates algorithm
         * @param {Array} array - Array to shuffle
         * @returns {Array} - Shuffled array
         */
        shuffleArray(array) {
            const newArray = [...array];
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
            }
            return newArray;
        },
        
        /**
         * Separate cards by type for Commander format
         * @param {Array} deck - Deck to organize
         */
        separateCardsByTypeForCommander(deck) {
            // Find the commander
            const commanderIndex = deck.findIndex(card => card.type === 'Commander');
            
            if (commanderIndex === -1) return;
            
            // Move commander to the front
            const commander = deck.splice(commanderIndex, 1)[0];
            deck.unshift(commander);
            
            // Group the rest by type
            const cardsByType = {
                'Creature': [],
                'Instant': [],
                'Sorcery': [],
                'Artifact': [],
                'Enchantment': [],
                'Planeswalker': [],
                'Land': []
            };
            
            // Remove all cards from deck except commander
            const cards = deck.splice(1);
            
            // Sort cards by type
            cards.forEach(card => {
                const type = this.getCardType(card);
                if (cardsByType[type]) {
                    cardsByType[type].push(card);
                } else {
                    // If we have an unknown type, add it to artifacts
                    cardsByType['Artifact'].push(card);
                }
            });
            
            // Add cards back to deck in order
            deck.push(...cardsByType['Creature']);
            deck.push(...cardsByType['Instant']);
            deck.push(...cardsByType['Sorcery']);
            deck.push(...cardsByType['Artifact']);
            deck.push(...cardsByType['Enchantment']);
            deck.push(...cardsByType['Planeswalker']);
            deck.push(...cardsByType['Land']);
        }
    };
}

/**
 * Enhance card search with fuzzy matching
 * @param {Object} originalFunctions - Original functions
 */
function enhanceCardSearch(originalFunctions) {
    if (window.DeckEngine) {
        // Override searchCards to include fuzzy matching
        window.DeckEngine.searchCards = async function(query, limit = 20) {
            try {
                // Try Scryfall API first
                try {
                    const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec&unique=cards`);
                    
                    if (response.ok) {
                        const data = await response.json();
                        return data.data?.slice(0, limit) || [];
                    }
                } catch (scryfallError) {
                    console.warn("Scryfall search error:", scryfallError);
                }
                
                // If Scryfall fails, try fuzzy search in local data
                if (window.cardDataSource) {
                    return await fuzzySearchLocalData(query, limit);
                }
                
                // Fall back to original function if available
                if (originalFunctions.searchCards) {
                    return await originalFunctions.searchCards(query, limit);
                }
                
                return [];
            } catch (error) {
                console.error("Error searching for cards:", error);
                return [];
            }
        };
        
        /**
         * Fuzzy search in local card data
         * @param {string} query - Search query
         * @param {number} limit - Maximum number of results
         * @returns {Promise<Array>} - Array of card objects
         */
        async function fuzzySearchLocalData(query, limit) {
            if (!window.cardDataSource || !window.cardDataSource.allPrintings) {
                await window.cardDataSource.loadCardData();
            }
            
            if (!window.cardDataSource.allPrintings) {
                return [];
            }
            
            const results = [];
            const searchTerms = query.toLowerCase().split(' ');
            
            // Search through all sets
            for (const setCode in window.cardDataSource.allPrintings) {
                const set = window.cardDataSource.allPrintings[setCode];
                if (!set.cards) continue;
                
                // Filter to English cards if specified
                const cards = CONFIG.ENGLISH_ONLY 
                    ? set.cards.filter(card => card.language === 'English')
                    : set.cards;
                
                for (const card of cards) {
                    // Skip if we already have this card
                    if (results.some(r => r.name === card.name)) continue;
                    
                    // Calculate match score
                    let matchScore = 0;
                    
                    // Check card name
                    const cardName = card.name.toLowerCase();
                    searchTerms.forEach(term => {
                        if (cardName.includes(term)) {
                            matchScore += 3;
                        }
                    });
                    
                    // Check card text
                    const cardText = (card.text || '').toLowerCase();
                    searchTerms.forEach(term => {
                        if (cardText.includes(term)) {
                            matchScore += 1;
                        }
                    });
                    
                    // Check card type
                    const cardType = (card.type || '').toLowerCase();
                    searchTerms.forEach(term => {
                        if (cardType.includes(term)) {
                            matchScore += 2;
                        }
                    });
                    
                    // If we have a good match, add to results
                    if (matchScore >= 3) {
                        results.push(window.cardDataSource.convertToScryfallFormat(card));
                        
                        // Break if we have enough results
                        if (results.length >= limit) break;
                    }
                }
                
                // Break if we have enough results
                if (results.length >= limit) break;
            }
            
            return results;
        }
    }
}

/**
 * Add budget controls to UI
 */
function addBudgetControlsToUI() {
    // Create budget controls container
    const budgetControls = document.createElement('div');
    budgetControls.className = 'budget-controls';
    budgetControls.innerHTML = `
        <div class="budget-toggle">
            <label class="switch">
                <input type="checkbox" id="budgetToggle" ${CONFIG.ENABLE_BUDGET ? 'checked' : ''}>
                <span class="slider round"></span>
            </label>
            <span>Budget Mode</span>
        </div>
        <div class="budget-slider" ${CONFIG.ENABLE_BUDGET ? '' : 'style="display:none;"'}>
            <input type="range" id="budgetSlider" min="10" max="500" step="10" value="${CONFIG.DEFAULT_BUDGET}">
            <span id="budgetValue">$${CONFIG.DEFAULT_BUDGET}</span>
        </div>
    `;
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        .budget-controls {
            background-color: #f5f5f5;
            padding: 10px 15px;
            border-radius: 8px;
            margin: 10px 0;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
        }
        
        .budget-toggle {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 24px;
        }
        
        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #ccc;
            transition: .4s;
        }
        
        .slider:before {
            position: absolute;
            content: "";
            height: 16px;
            width: 16px;
            left: 4px;
            bottom: 4px;
            background-color: white;
            transition: .4s;
        }
        
        input:checked + .slider {
            background-color: #4a148c;
        }
        
        input:checked + .slider:before {
            transform: translateX(26px);
        }
        
        .slider.round {
            border-radius: 24px;
        }
        
        .slider.round:before {
            border-radius: 50%;
        }
        
        .budget-slider {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 10px;
            width: 100%;
        }
        
        .budget-slider input {
            flex-grow: 1;
        }
        
        #budgetValue {
            font-weight: bold;
            min-width: 50px;
            text-align: right;
        }
    `;
    
    // Add to document
    document.head.appendChild(style);
    
    // Find a good place to insert the budget controls
    const formatSelector = document.querySelector('.format-selector');
    if (formatSelector && formatSelector.parentNode) {
        formatSelector.parentNode.insertBefore(budgetControls, formatSelector.nextSibling);
    } else {
        const searchSection = document.querySelector('.search-section');
        if (searchSection && searchSection.parentNode) {
            searchSection.parentNode.insertBefore(budgetControls, searchSection.nextSibling);
        }
    }
    
    // Add event listeners
    const budgetToggle = document.getElementById('budgetToggle');
    const budgetSlider = document.getElementById('budgetSlider');
    const budgetValue = document.getElementById('budgetValue');
    
    if (budgetToggle) {
        budgetToggle.addEventListener('change', function() {
            CONFIG.ENABLE_BUDGET = this.checked;
            const budgetSliderContainer = document.querySelector('.budget-slider');
            if (budgetSliderContainer) {
                budgetSliderContainer.style.display = this.checked ? 'flex' : 'none';
            }
        });
    }
    
    if (budgetSlider && budgetValue) {
        budgetSlider.addEventListener('input', function() {
            CONFIG.DEFAULT_BUDGET = parseInt(this.value);
            budgetValue.textContent = `$${this.value}`;
        });
    }
}

/**
 * Get budget from UI
 * @returns {number} - Budget value
 */
function getBudgetFromUI() {
    const budgetToggle = document.getElementById('budgetToggle');
    const budgetSlider = document.getElementById('budgetSlider');
    
    if (budgetToggle && budgetToggle.checked && budgetSlider) {
        return parseInt(budgetSlider.value);
    }
    
    return CONFIG.DEFAULT_BUDGET;
}

// Call the initialization function when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Wait for all modules to load
    setTimeout(initEnhancedDeckBuilder, 1000);
});

/**
 * Fix for card selection issue
 * This ensures that when a card is selected from search results, it's properly tracked
 */

function fixCardSelectionIssue() {
    console.log("Applying fix for card selection issue");
    
    // Global variable to track selected card
    window.selectedCard = null;
    
    // Add event listeners to search results
    function addCardSelectionListeners() {
        const searchResults = document.getElementById('searchResults');
        if (!searchResults) return;
        
        // Add delegation listener for card results
        searchResults.addEventListener('click', function(e) {
            const cardResult = e.target.closest('.card-result');
            if (!cardResult) return;
            
            // Get card index from dataset
            const cardIndex = cardResult.dataset.index;
            if (!cardIndex || !window.currentDisplayedCards) return;
            
            // Get card data
            const card = window.currentDisplayedCards[parseInt(cardIndex)];
            if (!card) return;
            
            // Set as selected card
            selectCard(card);
        });
    }
    
    // Function to select a card
    function selectCard(card) {
        console.log("Selected card:", card);
        
        // Set global selected card
        window.selectedCard = card;
        
        // Update UI to show selected card
        updateSelectedCardUI(card);
        
        // Show card toast if available
        if (window.CardToast) {
            window.CardToast.showCardToast(card, {
                position: 'bottom-right',
                theme: 'dark',
                duration: 0 // Make it persistent
            });
        }
    }
    
    // Update UI to show selected card
    function updateSelectedCardUI(card) {
        // Find or create selected card container
        let selectedCardContainer = document.getElementById('selectedCard');
        
        if (!selectedCardContainer) {
            selectedCardContainer = document.createElement('div');
            selectedCardContainer.id = 'selectedCard';
            selectedCardContainer.className = 'selected-card-container';
            
            // Find a good place to insert it
            const searchResults = document.getElementById('searchResults');
            if (searchResults && searchResults.parentNode) {
                searchResults.parentNode.insertBefore(selectedCardContainer, searchResults.nextSibling);
            }
        }
        
        // Get card image URL
        const imageUrl = card.image_uris?.normal || 
            (card.card_faces && card.card_faces[0].image_uris ? card.card_faces[0].image_uris.normal : '');
        
        // Format oracle text if available
        const oracleText = card.oracle_text || '';
        const formattedText = window.DeckUtils && window.DeckUtils.formatCardText ? 
            window.DeckUtils.formatCardText(oracleText) : oracleText.replace(/\n/g, '<br>');
        
        // Create selected card HTML
        selectedCardContainer.innerHTML = `
            <div class="selected-card">
                <div class="selected-card-image">
                    <img src="${imageUrl}" alt="${card.name}">
                </div>
                <div class="selected-card-details">
                    <h3>${card.name}</h3>
                    <p class="selected-card-type">${card.type_line || ''}</p>
                    <p class="selected-card-text">${formattedText}</p>
                    <div class="selected-card-actions">
                        <button class="generate-button">Generate Deck</button>
                        <button class="binary-tree-button"><span class="binary-tree-icon">🌳</span> Generate Combo Deck</button>
                    </div>
                </div>
            </div>
        `;
        
        // Add event listeners to buttons
        const generateButton = selectedCardContainer.querySelector('.generate-button');
        if (generateButton) {
            generateButton.addEventListener('click', handleGenerateDeck);
        }
        
        const binaryTreeButton = selectedCardContainer.querySelector('.binary-tree-button');
        if (binaryTreeButton) {
            binaryTreeButton.addEventListener('click', handleGenerateBinaryTreeDeck);
        }
    }
    
    // Handle generate deck button click
    function handleGenerateDeck() {
        if (!window.selectedCard) {
            alert('Please select a card first!');
            return;
        }
        
        // Show loading indicator
        showDeckGenerationLoading();
        
        // Generate deck
        if (window.DeckEngine && window.DeckEngine.generateDeck) {
            const format = getCurrentFormat();
            
            window.DeckEngine.generateDeck(window.selectedCard, format)
                .then(deck => {
                    window.generatedDeck = deck;
                    displayGeneratedDeck();
                })
                .catch(error => {
                    console.error('Deck generation error:', error);
                    showDeckGenerationError(error.message);
                });
        } else {
            showDeckGenerationError('Deck generation engine not available');
        }
    }
    
    // Handle generate binary tree deck button click
    function handleGenerateBinaryTreeDeck() {
        if (!window.selectedCard) {
            alert('Please select a card first!');
            return;
        }
        
        // Show loading indicator
        showDeckGenerationLoading();
        
        // Generate deck using binary tree approach
        if (window.SynergyEngine && window.SynergyEngine.generateDeckWithBinaryTree) {
            const format = getCurrentFormat();
            
            window.SynergyEngine.generateDeckWithBinaryTree(window.selectedCard, format)
                .then(deck => {
                    window.generatedDeck = deck;
                    displayGeneratedDeck(true);
                })
                .catch(error => {
                    console.error('Binary tree deck generation error:', error);
                    showDeckGenerationError(error.message);
                });
        } else {
            showDeckGenerationError('Binary tree deck generation engine not available');
        }
    }
    
    // Show deck generation loading indicator
    function showDeckGenerationLoading() {
        // Find or create deck section
        let deckSection = document.getElementById('deckSection');
        
        if (!deckSection) {
            deckSection = document.createElement('div');
            deckSection.id = 'deckSection';
            deckSection.className = 'deck-section';
            
            // Find a good place to insert it
            const selectedCard = document.getElementById('selectedCard');
            if (selectedCard && selectedCard.parentNode) {
                selectedCard.parentNode.insertBefore(deckSection, selectedCard.nextSibling);
            } else {
                document.body.appendChild(deckSection);
            }
        }
        
        // Show loading indicator
        deckSection.innerHTML = `
            <div class="deck-generation-loading">
                <div class="spinner"></div>
                <p>Generating deck...</p>
            </div>
        `;
        
        deckSection.style.display = 'block';
    }
    
    // Show deck generation error
    function showDeckGenerationError(message) {
        const deckSection = document.getElementById('deckSection');
        
        if (deckSection) {
            deckSection.innerHTML = `
                <div class="deck-generation-error">
                    <h3>⚠️ Deck Generation Error</h3>
                    <p>${message || 'Unknown error occurred'}</p>
                    <button onclick="location.reload()">Reload Page</button>
                </div>
            `;
        }
    }
    
    // Display the generated deck
    function displayGeneratedDeck(useBinaryTree = false) {
        if (!window.generatedDeck || window.generatedDeck.length === 0) {
            showDeckGenerationError('No cards were generated. Please try again.');
            return;
        }
        
        // Find or create deck section
        const deckSection = document.getElementById('deckSection');
        
        if (!deckSection) {
            console.error('Deck section not found');
            return;
        }
        
        // Clear deck section
        deckSection.innerHTML = '';
        
        // Create deck container
        const deckContainer = document.createElement('div');
        deckContainer.className = 'deck-container';
        deckSection.appendChild(deckContainer);
        
        // Display deck
        if (useBinaryTree && window.DeckView && window.DeckView.displayBinaryTreeDeck) {
            window.DeckView.displayBinaryTreeDeck(window.generatedDeck, deckContainer, {
                title: `${getCurrentFormat().name} Deck - Binary Tree Approach`
            });
        } else if (window.DeckView && window.DeckView.displayDeckByType) {
            window.DeckView.displayDeckByType(window.generatedDeck, deckContainer, {
                title: `${getCurrentFormat().name} Deck`
            });
        } else {
            // Fallback display method
            displayDeckFallback(window.generatedDeck, deckContainer);
        }
        
        // Check for rule violations
        const format = getCurrentFormat();
        if (format && format.validateDeck) {
            const violations = format.validateDeck(window.generatedDeck);
            if (violations.length > 0) {
                displayRuleViolations(violations, deckContainer);
            }
        }
        
        // Add deck export options
        if (window.DeckView && window.DeckView.createDeckExport) {
            window.DeckView.createDeckExport(window.generatedDeck, deckContainer);
        } else {
            createDeckExportFallback(window.generatedDeck, deckContainer);
        }
    }
    
    // Fallback method to display a deck
    function displayDeckFallback(deck, container) {
        // Group cards by type
        const cardsByType = {};
        
        deck.forEach(card => {
            const type = card.type || getCardType(card.type_line || '');
            if (!cardsByType[type]) {
                cardsByType[type] = [];
            }
            cardsByType[type].push(card);
        });
        
        // Create deck HTML
        let deckHtml = `
            <h2>Generated Deck (${deck.length} cards)</h2>
            <div class="deck-overview">
        `;
        
        // Add each card type section
        for (const [type, cards] of Object.entries(cardsByType)) {
            if (cards.length === 0) continue;
            
            deckHtml += `
                <div class="deck-section-type">
                    <h3>${type} (${cards.length})</h3>
                    <ul class="deck-card-list">
            `;
            
            // Add each card
            cards.forEach(card => {
                const imageUrl = card.image_uris?.small || 
                    (card.card_faces && card.card_faces[0].image_uris ? card.card_faces[0].image_uris.small : '');
                
                deckHtml += `
                    <li class="deck-card-item">
                        <div class="deck-card-hover-container">
                            <img src="${imageUrl}" alt="${card.name}" class="deck-card-image">
                            <div class="deck-card-name">
                                <a href="#" class="card-name-link">${card.name}</a>
                            </div>
                        </div>
                    </li>
                `;
            });
            
            deckHtml += `
                    </ul>
                </div>
            `;
        }
        
        deckHtml += '</div>';
        
        // Set container HTML
        container.innerHTML = deckHtml;
        
        // Add click handlers to card names
        const cardLinks = container.querySelectorAll('.card-name-link');
        cardLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                const cardName = link.textContent;
                const card = deck.find(c => c.name === cardName);
                
                if (card) {
                    showOverlay(card);
                }
            });
        });
    }
    
    // Display rule violations
    function displayRuleViolations(violations, container) {
        if (!violations || violations.length === 0) return;
        
        const violationsDiv = document.createElement('div');
        violationsDiv.className = 'rule-violations';
        
        let violationsHtml = `
            <h3>⚠️ Rule Violations</h3>
            <ul>
        `;
        
        violations.forEach(violation => {
            violationsHtml += `<li>${violation}</li>`;
        });
        
        violationsHtml += '</ul>';
        
        violationsDiv.innerHTML = violationsHtml;
        container.appendChild(violationsDiv);
    }
    
    // Create deck export options fallback
    function createDeckExportFallback(deck, container) {
        const exportDiv = document.createElement('div');
        exportDiv.className = 'deck-export';
        
        // Create text export
        const deckText = deck.map(card => card.name).join('\n');
        
        exportDiv.innerHTML = `
            <h3>Export Deck</h3>
            <div class="export-options">
                <button id="copyDeckButton" class="export-button">Copy to Clipboard</button>
                <button id="downloadDeckButton" class="export-button">Download .txt</button>
            </div>
            <textarea id="deckTextarea" class="deck-textarea" readonly>${deckText}</textarea>
        `;
        
        container.appendChild(exportDiv);
        
        // Add event listeners
        const copyButton = exportDiv.querySelector('#copyDeckButton');
        if (copyButton) {
            copyButton.addEventListener('click', () => {
                const textarea = document.getElementById('deckTextarea');
                if (textarea) {
                    textarea.select();
                    document.execCommand('copy');
                    alert('Deck copied to clipboard!');
                }
            });
        }
        
        const downloadButton = exportDiv.querySelector('#downloadDeckButton');
        if (downloadButton) {
            downloadButton.addEventListener('click', () => {
                const blob = new Blob([deckText], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'deck.txt';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            });
        }
    }
    
    // Get the current format
    function getCurrentFormat() {
        // Try to get format from MTGDeckBuilder
        if (window.MTGDeckBuilder && window.MTGDeckBuilder.getCurrentFormat) {
            return window.MTGDeckBuilder.getCurrentFormat();
        }
        
        // Try to get format from mtgFormats
        if (window.mtgFormats && window.mtgFormats.getCurrentFormat) {
            return window.mtgFormats.getCurrentFormat();
        }
        
        // Fallback to commander format
        if (window.commanderFormat) {
            return window.commanderFormat;
        }
        
        // Create a basic format as last resort
        return {
            name: 'Commander',
            code: 'commander',
            description: 'Format details not available',
            minDeckSize: 100,
            maxCopies: 1
        };
    }
    
    // Helper function to get card type
    function getCardType(typeLine) {
        if (!typeLine) return 'Unknown';
        
        typeLine = typeLine.toLowerCase();
        
        if (typeLine.includes('creature')) return 'Creature';
        if (typeLine.includes('planeswalker')) return 'Planeswalker';
        if (typeLine.includes('instant')) return 'Instant';
        if (typeLine.includes('sorcery')) return 'Sorcery';
        if (typeLine.includes('artifact')) return 'Artifact';
        if (typeLine.includes('enchantment')) return 'Enchantment';
        if (typeLine.includes('land')) return 'Land';
        
        return 'Unknown';
    }
    
    // Override the global selectCard function if it exists
    if (window.selectCard) {
        const originalSelectCard = window.selectCard;
        window.selectCard = function(card) {
            // Set the global selected card
            window.selectedCard = card;
            
            // Call the original function
            originalSelectCard(card);
        };
    } else {
        // Create the global selectCard function if it doesn't exist
        window.selectCard = selectCard;
    }
    
    // Add card selection listeners
    addCardSelectionListeners();
    
    // Add global handlers for deck generation
    window.handleGenerateDeck = handleGenerateDeck;
    window.handleGenerateBinaryTreeDeck = handleGenerateBinaryTreeDeck;
    
    console.log("Card selection fix applied");
}

// Call the fix function when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Wait for all modules to load
    setTimeout(fixCardSelectionIssue, 1500);
});
