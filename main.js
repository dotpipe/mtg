/**
 * Card Selection and Synergy System
 * - Provides unique card selection
 * - Manages synergy calculations based on unique card names
 * - Prioritizes newer sets while allowing older cards when beneficial
 */
class CardSynergySystem {
    constructor() {
        this.selectedCards = new Map(); // Map of card name -> card object
        this.cardCopies = new Map();    // Map of card name -> quantity (1-4)
        this.synergies = new Map();     // Map of card name -> array of synergistic cards
        this.cardPool = [];             // Available cards in the pool
        this.setPreferences = {
            prioritizeNewest: true,     // Prioritize newer sets
            budgetConstraint: true,     // Consider budget when selecting cards
            maxPrice: 5.00              // Maximum price per card in USD
        };
    }

    /**
     * Initialize the card pool with data from API or local source
     * @param {string} source - 'api' or 'local'
     * @param {Object} options - Configuration options
     */
    async initializeCardPool(source = 'api', options = {}) {
        try {
            if (source === 'api') {
                // Fetch from Scryfall or your custom API
                const response = await fetch('api.php?action=get_card_pool');
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error);
                }
                
                this.cardPool = this.processCardData(data.cards);
            } else {
                // Use local data
                this.cardPool = this.processCardData(options.localData || []);
            }
            
            console.log(`Card pool initialized with ${this.cardPool.length} unique cards`);
            return true;
        } catch (error) {
            console.error('Failed to initialize card pool:', error);
            return false;
        }
    }
    
    /**
     * Process raw card data to ensure uniqueness by name
     * @param {Array} rawCards - Raw card data
     * @returns {Array} - Processed card data with unique names
     */
    processCardData(rawCards) {
        const uniqueCards = new Map();
        
        // Process cards, keeping only the newest printing of each unique name
        rawCards.forEach(card => {
            const existingCard = uniqueCards.get(card.name);
            
            // If card doesn't exist yet, or this is a newer printing
            if (!existingCard || this.isNewerPrinting(card, existingCard)) {
                uniqueCards.set(card.name, card);
            }
        });
        
        return Array.from(uniqueCards.values());
    }
    
    /**
     * Check if a card is a newer printing than another
     * @param {Object} card1 - First card
     * @param {Object} card2 - Second card
     * @returns {boolean} - True if card1 is newer
     */
    isNewerPrinting(card1, card2) {
        // Compare release dates if available
        if (card1.released_at && card2.released_at) {
            return new Date(card1.released_at) > new Date(card2.released_at);
        }
        
        // Compare set codes as fallback
        return card1.set_code > card2.set_code;
    }
    
    /**
     * Get random unique cards from the pool
     * @param {number} count - Number of cards to get
     * @param {Object} filters - Optional filters (type, color, etc.)
     * @returns {Array} - Array of random unique cards
     */
    getRandomUniqueCards(count = 10, filters = {}) {
        // Apply filters to card pool
        let filteredPool = this.cardPool;
        
        if (filters.type) {
            filteredPool = filteredPool.filter(card => 
                card.type_line && card.type_line.toLowerCase().includes(filters.type.toLowerCase())
            );
        }
        
        if (filters.color) {
            filteredPool = filteredPool.filter(card => 
                card.colors && card.colors.includes(filters.color)
            );
        }
        
        if (this.setPreferences.budgetConstraint && this.setPreferences.maxPrice) {
            filteredPool = filteredPool.filter(card => 
                !card.price || parseFloat(card.price) <= this.setPreferences.maxPrice
            );
        }
        
        // Shuffle and take the first 'count' cards
        const shuffled = [...filteredPool].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }
    
    /**
     * Select a card as the centerpiece
     * @param {Object} card - The card to select as centerpiece
     * @returns {boolean} - Success status
     */
    selectCenterpiece(card) {
        if (!card) return false;
        
        // Clear previous selections
        this.selectedCards.clear();
        this.cardCopies.clear();
        
        // Add centerpiece
        this.selectedCards.set(card.name, card);
        this.cardCopies.set(card.name, 1);
        
        // Calculate initial synergies
        this.calculateSynergies(card);
        
        console.log(`Selected "${card.name}" as centerpiece`);
        return true;
    }
    
    /**
     * Add a card to the selection
     * @param {Object} card - The card to add
     * @param {number} quantity - Number of copies to add (1-4)
     * @returns {boolean} - Success status
     */
    addCard(card, quantity = 1) {
        if (!card || quantity < 1 || quantity > 4) return false;
        
        // Check if card already exists
        if (this.selectedCards.has(card.name)) {
            // Update quantity, capped at 4
            const currentQuantity = this.cardCopies.get(card.name) || 0;
            const newQuantity = Math.min(currentQuantity + quantity, 4);
            this.cardCopies.set(card.name, newQuantity);
            
            console.log(`Updated "${card.name}" quantity to ${newQuantity}`);
        } else {
            // Add new card
            this.selectedCards.set(card.name, card);
            this.cardCopies.set(card.name, Math.min(quantity, 4));
            
            // Calculate synergies with existing cards
            this.calculateSynergies(card);
            
            console.log(`Added ${quantity}x "${card.name}" to selection`);
        }
        
        return true;
    }
    
    /**
     * Remove a card from the selection
     * @param {string} cardName - Name of the card to remove
     * @param {number} quantity - Number of copies to remove
     * @returns {boolean} - Success status
     */
    removeCard(cardName, quantity = 1) {
        if (!this.selectedCards.has(cardName)) return false;
        
        const currentQuantity = this.cardCopies.get(cardName) || 0;
        const newQuantity = Math.max(currentQuantity - quantity, 0);
        
        if (newQuantity === 0) {
            // Remove card completely
            this.selectedCards.delete(cardName);
            this.cardCopies.delete(cardName);
            console.log(`Removed "${cardName}" from selection`);
        } else {
            // Update quantity
            this.cardCopies.set(cardName, newQuantity);
            console.log(`Updated "${cardName}" quantity to ${newQuantity}`);
        }
        
        // Recalculate synergies for remaining cards
        this.recalculateAllSynergies();
        
        return true;
    }
    
    /**
     * Calculate synergies between a card and all selected cards
     * @param {Object} card - The card to calculate synergies for
     */
    calculateSynergies(card) {
        // Skip if card is not provided
        if (!card) return;
        
        // Get existing synergies or create new array
        const cardSynergies = this.synergies.get(card.name) || [];
        
        // Calculate synergies with all other selected cards
        this.selectedCards.forEach((selectedCard, selectedCardName) => {
            // Skip self-comparison
            if (selectedCardName === card.name) return;
            
            // Calculate synergy score between these two cards
            const synergyScore = this.calculateSynergyScore(card, selectedCard);
            
            // Add to synergies if score is significant
            if (synergyScore > 0.1) {
                cardSynergies.push({
                    card: selectedCardName,
                    score: synergyScore,
                    type: this.determineSynergyType(card, selectedCard)
                });
                
                // Also add to the other card's synergies
                const otherCardSynergies = this.synergies.get(selectedCardName) || [];
                otherCardSynergies.push({
                    card: card.name,
                    score: synergyScore,
                    type: this.determineSynergyType(selectedCard, card)
                });
                this.synergies.set(selectedCardName, otherCardSynergies);
            }
        });
        
        // Sort synergies by score (highest first)
        cardSynergies.sort((a, b) => b.score - a.score);
        
        // Save synergies
        this.synergies.set(card.name, cardSynergies);
    }
    
    /**
     * Recalculate synergies for all selected cards
     */
    recalculateAllSynergies() {
        // Clear existing synergies
        this.synergies.clear();
        
        // Recalculate for each card
        this.selectedCards.forEach(card => {
            this.calculateSynergies(card);
        });
    }
    
    /**
     * Calculate synergy score between two cards
     * @param {Object} card1 - First card
     * @param {Object} card2 - Second card
     * @returns {number} - Synergy score between 0 and 1
     */
    calculateSynergyScore(card1, card2) {
        // This is where you'd implement your synergy calculation algorithm
        // For demonstration, we'll use a simplified approach
        
        let score = 0;
        
        // Check for shared types
        if (card1.type_line && card2.type_line) {
            const types1 = card1.type_line.toLowerCase().split(' ');
            const types2 = card2.type_line.toLowerCase().split(' ');
            
            const sharedTypes = types1.filter(type => types2.includes(type));
            score += sharedTypes.length * 0.05;
        }
        
        // Check for shared colors
        if (card1.colors && card2.colors) {
            const sharedColors = card1.colors.filter(color => card2.colors.includes(color));
            score += sharedColors.length * 0.05;
        }
        
        // Check for keyword matches in oracle text
        if (card1.oracle_text && card2.oracle_text) {
            const keywords = ['draw', 'discard', 'sacrifice', 'counter', 'destroy', 'exile', 
                             'return', 'create', 'token', 'life', 'damage', '+1/+1'];
            
            keywords.forEach(keyword => {
                if (card1.oracle_text.toLowerCase().includes(keyword) && 
                    card2.oracle_text.toLowerCase().includes(keyword)) {
                    score += 0.03;
                }
            });
        }
        
        // Check for creature type synergies
        if (card1.type_line && card2.type_line && 
            card1.type_line.toLowerCase().includes('creature') && 
            card2.oracle_text) {
            
            const creatureTypes = this.extractCreatureTypes(card1);
            
            creatureTypes.forEach(type => {
                if (card2.oracle_text.toLowerCase().includes(type.toLowerCase())) {
                    score += 0.1;
                }
            });
        }
        
        // Cap score at 1.0
        return Math.min(score, 1.0);
    }
    
    /**
     * Extract creature types from a card
     * @param {Object} card - The card to extract types from
     * @returns {Array} - Array of creature types
     */
    extractCreatureTypes(card) {
        if (!card.type_line) return [];
        
        // Look for the dash that separates card types from subtypes
        const parts = card.type_line.split('—');
        if (parts.length < 2) return [];
        
        // Get subtypes and split by spaces
        return parts[1].trim().split(' ');
    }
    
    /**
     * Determine the type of synergy between two cards
     * @param {Object} card1 - First card
     * @param {Object} card2 - Second card
     * @returns {string} - Synergy type
     */
    determineSynergyType(card1, card2) {
        // This would be a more complex algorithm in practice
        // For demonstration, we'll use a simplified approach
        
        if (!card1.oracle_text || !card2.oracle_text) return 'general';
        
        const text1 = card1.oracle_text.toLowerCase();
        const text2 = card2.oracle_text.toLowerCase();
        
        if (text1.includes('draw') && text2.includes('draw')) return 'card_advantage';
        if (text1.includes('counter') || text2.includes('counter')) return 'control';
        if (text1.includes('damage') && text2.includes('damage')) return 'damage';
        if (text1.includes('token') && text2.includes('token')) return 'token_synergy';
        if (text1.includes('+1/+1') && text2.includes('+1/+1')) return 'counter_synergy';
        if (text1.includes('sacrifice') && text2.includes('sacrifice')) return 'sacrifice_synergy';
        
        return 'general';
    }
    
    /**
     * Get recommended cards based on current selection
     * @param {number} count - Number of recommendations to get
     * @returns {Array} - Array of recommended cards with synergy scores
     */
    getRecommendedCards(count = 5) {
        if (this.selectedCards.size === 0) return [];
        
        const recommendations = [];
        const consideredCards = new Set();
        
        // For each selected card, find cards with high synergy
        this.selectedCards.forEach((selectedCard) => {
            // Get cards from the pool that aren't already selected
            const candidates = this.cardPool.filter(card => 
                !this.selectedCards.has(card.name) && 
                !consideredCards.has(card.name)
            );
            
            // Calculate synergy with this selected card
            candidates.forEach(candidate => {
                const synergyScore = this.calculateSynergyScore(selectedCard, candidate);
                
                if (synergyScore >= 0.2) {  // Only consider significant synergies
                    recommendations.push({
                        card: candidate,
                        synergy: synergyScore,
                        with: selectedCard.name,
                        type: this.determineSynergyType(selectedCard, candidate)
                    });
                    
                    consideredCards.add(candidate.name);
                }
            });
        });
        
        // Sort by synergy score and take top recommendations
        recommendations.sort((a, b) => b.synergy - a.synergy);
        return recommendations.slice(0, count);
    }
    
    /**
     * Build a complete deck based on a centerpiece card
     * @param {Object} centerpiece - The centerpiece card
     * @param {number} deckSize - Target deck size
     * @returns {Object} - The built deck
     */
    buildDeckFromCenterpiece(centerpiece, deckSize = 60) {
        // Select centerpiece
        this.selectCenterpiece(centerpiece);
        
        // Determine land count based on average CMC
        const landCount = Math.floor(deckSize * 0.4); // 40% lands as default
        const nonLandCount = deckSize - landCount;
        
        // Keep adding cards until we reach the target non-land count
        while (this.getTotalCardCount() < nonLandCount) {
            // Get recommendations based on current selection
            const recommendations = this.getRecommendedCards(10);
            
            if (recommendations.length === 0) break;
            
            // Add the top recommendation
            const topRecommendation = recommendations[0];
            
            // Determine quantity (1-4) based on synergy score
            let quantity = 1;
            if (topRecommendation.synergy > 0.8) quantity = 4;
            else if (topRecommendation.synergy > 0.6) quantity = 3;
            else if (topRecommendation.synergy > 0.4) quantity = 2;
            
            this.addCard(topRecommendation.card, quantity);
        }
        
        // Add lands (this would be more sophisticated in practice)
        // For demonstration, we'll just return the current selection
        
        return {
            centerpiece: centerpiece,
            cards: Array.from(this.selectedCards.values()),
            quantities: Object.fromEntries(this.cardCopies),
            synergies: Object.fromEntries(this.synergies),
            totalCards: this.getTotalCardCount(),
            landCount: landCount
        };
    }
    
    /**
     * Get the total count of all selected cards
     * @returns {number} - Total card count
     */
    getTotalCardCount() {
        let total = 0;
        this.cardCopies.forEach(quantity => {
            total += quantity;
        });
        return total;
    }
    
    /**
     * Get all selected cards with their quantities
     * @returns {Array} - Array of cards with quantities
     */
    getSelectedCards() {
        const result = [];
        
        this.selectedCards.forEach((card, name) => {
            result.push({
                ...card,
                quantity: this.cardCopies.get(name) || 1
            });
        });
        
        return result;
    }
    
    /**
     * Get synergy network for visualization
     * @returns {Object} - Nodes and links for network visualization
     */
    getSynergyNetwork() {
        const nodes = [];
        const links = [];
        
        // Add nodes for each selected card
        this.selectedCards.forEach((card, name) => {
            nodes.push({
                id: name,
                group: this.getCardGroup(card),
                card: card
            });
        });
        
        // Add links for synergies
        this.synergies.forEach((cardSynergies, cardName) => {
            cardSynergies.forEach(synergy => {
                links.push({
                    source: cardName,
                    target: synergy.card,
                    value: synergy.score,
                    type: synergy.type
                });
            });
        });
        
        return { nodes, links };
    }
    
    /**
     * Determine the group/category of a card
     * @param {Object} card - The card to categorize
     * @returns {number} - Group number
     */
    getCardGroup(card) {
        if (!card.type_line) return 0;
        
        const typeLine = card.type_line.toLowerCase();
        
        if (typeLine.includes('land')) return 1;
        if (typeLine.includes('creature')) return 2;
        if (typeLine.includes('instant') || typeLine.includes('sorcery')) return 3;
        if (typeLine.includes('artifact')) return 4;
        if (typeLine.includes('enchantment')) return 5;
        if (typeLine.includes('planeswalker')) return 6;
        
        return 0;
    }
}

// UI Integration Functions

/**
 * Initialize the card selection system
 */
async function initializeCardSystem() {
    const synergySystem = new CardSynergySystem();
    
    // Initialize card pool
    const initialized = await synergySystem.initializeCardPool('api');
    
    if (!initialized) {
        showNotification('Failed to initialize card system', 'error');
        return null;
    }
    
    return synergySystem;
}

/**
 * Load random unique cards for selection
 * @param {CardSynergySystem} system - The card synergy system
 * @param {string} format - The selected format
 */
function loadRandomUniqueCards(system, format) {
    // Get filters based on format
    const filters = getFormatFilters(format);
    
    // Get random cards
    const randomCards = system.getRandomUniqueCards(10, filters);
    
    // Display cards in the UI
    displayCards(randomCards);
}

/**
 * Get filters based on format
 * @param {string} format - The selected format
 * @returns {Object} - Filter object
 */
function getFormatFilters(format) {
    switch (format) {
        case 'standard':
            return { format: 'standard' };
        case 'commander':
            return { format: 'commander' };
        case 'modern':
            return { format: 'modern' };
        default:
            return {};
    }
}

/**
 * Display cards in the UI
 * @param {Array} cards - Array of cards to display
 */
function displayCards(cards) {
    const cardGrid = document.getElementById('card-grid');
    cardGrid.innerHTML = '';
    
    cards.forEach(card => {
        const cardElement = createCardElement(card);
        cardGrid.appendChild(cardElement);
    });
    
    // Show the grid with animation
    setTimeout(() => {
        cardGrid.classList.add('visible');
    }, 100);
}

/**
 * Select a card as centerpiece
 * @param {CardSynergySystem} system - The card synergy system
 * @param {Object} card - The card to select
 */
function selectCenterpiece(system, card) {
    if (!system || !card) return;
    
    // Select the card as centerpiece
    system.selectCenterpiece(card);
    
    // Update UI to show the selected centerpiece
    updateCenterpieceDisplay(card);
    
    // Get recommendations based on this centerpiece
    const recommendations = system.getRecommendedCards(5);
    
    // Display recommendations
    displayRecommendations(recommendations);
}

/**
 * Update the UI to show the selected centerpiece
 * @param {Object} card - The selected centerpiece card
 */
function updateCenterpieceDisplay(card) {
    const centerpieceContainer = document.getElementById('centerpiece-container');
    
    // Create centerpiece display
    centerpieceContainer.innerHTML = `
        <div class="centerpiece-card">
            <img src="https://api.scryfall.com/cards/named?format=image&exact=${encodeURIComponent(card.name)}" 
                 alt="${card.name}" class="centerpiece-image">
            <div class="centerpiece-info">
                <h3>${card.name}</h3>
                <p>${card.type_line || ''}</p>
                <div class="centerpiece-stats">
                    <span class="stat">CMC: ${card.cmc || '0'}</span>
                    <span class="stat">Set: ${card.set_name || 'Unknown'}</span>
                </div>
            </div>
        </div>
    `;
    
    // Show the centerpiece with animation
    centerpieceContainer.classList.add('active');
}

/**
 * Display card recommendations
 * @param {Array} recommendations - Array of recommended cards
 */
function displayRecommendations(recommendations) {
    const recommendationsContainer = document.getElementById('recommendations-container');
    recommendationsContainer.innerHTML = '<h3>Recommended Cards</h3>';
    
    if (recommendations.length === 0) {
        recommendationsContainer.innerHTML += '<p>No recommendations available</p>';
        return;
    }
    
    const recommendationsList = document.createElement('div');
    recommendationsList.className = 'recommendations-list';
    
    recommendations.forEach(rec => {
        const recItem = document.createElement('div');
        recItem.className = 'recommendation-item';
        
        // Calculate star rating based on synergy score
        const stars = Math.min(5, Math.ceil(rec.synergy * 5));
        const starDisplay = '★'.repeat(stars) + '☆'.repeat(5 - stars);
        
        recItem.innerHTML = `
            <div class="rec-card-info">
                <div class="rec-card-name">${rec.card.name}</div>
                <div class="rec-card-type">${rec.card.type_line || ''}</div>
            </div>
            <div class="rec-synergy">
                <div class="rec-synergy-score">${(rec.synergy * 100).toFixed(0)}%</div>
                <div class="rec-synergy-stars">${starDisplay}</div>
                <div class="rec-synergy-with">with ${rec.with}</div>
            </div>
            <div class="rec-actions">
                <button class="add-card-btn" data-card-id="${rec.card.id}">Add</button>
            </div>
        `;
        
        recommendationsList.appendChild(recItem);
    });
    
    recommendationsContainer.appendChild(recommendationsList);
    
    // Add event listeners to buttons
    document.querySelectorAll('.add-card-btn').forEach(button => {
        button.addEventListener('click', function() {
            const cardId = this.dataset.cardId;
            const card = recommendations.find(r => r.card.id === cardId)?.card;
            
            if (card) {
                window.cardSystem.addCard(card);
                updateDeckDisplay();
                showNotification(`Added ${card.name} to your deck`);
            }
        });
    });
}

/**
 * Update the deck display in the UI
 */
function updateDeckDisplay() {
    if (!window.cardSystem) return;
    
    const deckCards = window.cardSystem.getSelectedCards();
    const deckContainer = document.getElementById('deck-cards');
    
    // Clear container
    deckContainer.innerHTML = '';
    
    if (deckCards.length === 0) {
        deckContainer.innerHTML = '<p>Your deck is empty. Select a centerpiece card to begin.</p>';
        return;
    }
    
    // Group cards by type
    const groupedCards = {
        'Creatures': [],
        'Instants & Sorceries': [],
        'Artifacts': [],
        'Enchantments': [],
        'Planeswalkers': [],
        'Lands': [],
        'Other': []
    };
    
    deckCards.forEach(card => {
        if (!card.type_line) {
            groupedCards['Other'].push(card);
            return;
        }
        
        const typeLine = card.type_line.toLowerCase();
        
        if (typeLine.includes('creature')) {
            groupedCards['Creatures'].push(card);
        } else if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
            groupedCards['Instants & Sorceries'].push(card);
        } else if (typeLine.includes('artifact')) {
            groupedCards['Artifacts'].push(card);
        } else if (typeLine.includes('enchantment')) {
            groupedCards['Enchantments'].push(card);
        } else if (typeLine.includes('planeswalker')) {
            groupedCards['Planeswalkers'].push(card);
        } else if (typeLine.includes('land')) {
            groupedCards['Lands'].push(card);
        } else {
            groupedCards['Other'].push(card);
        }
    });
    
    // Create sections for each card type
    Object.entries(groupedCards).forEach(([type, cards]) => {
        if (cards.length === 0) return;
        
        const section = document.createElement('div');
        section.className = 'deck-section';
        
        const sectionHeader = document.createElement('h4');
        sectionHeader.textContent = `${type} (${cards.length})`;
        section.appendChild(sectionHeader);
        
        const cardsList = document.createElement('div');
        cardsList.className = 'deck-cards-list';
        
        cards.forEach(card => {
            const cardElement = document.createElement('div');
            cardElement.className = 'deck-card';
            
            cardElement.innerHTML = `
                <img src="https://api.scryfall.com/cards/named?format=image&exact=${encodeURIComponent(card.name)}" 
                     alt="${card.name}" class="deck-card-img">
                <div class="deck-card-info">
                    <div class="deck-card-name">${card.name} ${card.quantity > 1 ? `(${card.quantity})` : ''}</div>
                    <div class="deck-card-type">${card.type_line || ''}</div>
                </div>
                <button class="remove-card" data-card-name="${card.name}">×</button>
            `;
            
            cardsList.appendChild(cardElement);
        });
        
        section.appendChild(cardsList);
        deckContainer.appendChild(section);
    });
    
    // Add event listeners to remove buttons
    document.querySelectorAll('.remove-card').forEach(button => {
        button.addEventListener('click', function() {
            const cardName = this.dataset.cardName;
            window.cardSystem.removeCard(cardName);
            updateDeckDisplay();
            showNotification(`Removed ${cardName} from your deck`);
        });
    });
    
    // Update deck stats
    updateDeckStats();
}

/**
 * Update deck statistics display
 */
function updateDeckStats() {
    if (!window.cardSystem) return;
    
    const totalCards = window.cardSystem.getTotalCardCount();
    document.getElementById('card-count').textContent = totalCards;
    
    // Calculate and display other stats as needed
}

/**
 * Initialize the application
 */
async function initApp() {
    // Initialize card system
    window.cardSystem = await initializeCardSystem();
    
    if (!window.cardSystem) {
        console.error('Failed to initialize card system');
        return;
    }
    
    // Set up format buttons
    document.querySelectorAll('.format-btn').forEach(button => {
        button.addEventListener('click', function() {
            // Update active button
            document.querySelectorAll('.format-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
            
            // Load cards for this format
            const format = this.dataset.format;
            loadRandomUniqueCards(window.cardSystem, format);
        });
    });
    
    // Set up analyze deck button
    document.getElementById('analyze-deck').addEventListener('click', function() {
        if (window.cardSystem.getTotalCardCount() === 0) {
            showNotification('Add cards to your deck first', 'error');
            return;
        }
        
        analyzeDeck();
    });
    
    // Load initial cards
    loadRandomUniqueCards(window.cardSystem, 'standard');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
