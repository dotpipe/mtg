/**
 * MTG Budget Deck Builder
 * Integrates with the MTG Synergy API to build optimized decks under budget constraints
 */

class MTGDeckBuilder {
    constructor(apiEndpoint) {
        this.apiEndpoint = apiEndpoint || 'api.php';
        this.userCollection = new Map(); // Cards the user owns (from CSV)
        this.currentDeck = new Map();    // Current deck being built
        this.budget = 100.00;            // Default budget in dollars
        this.format = 'commander';       // Default format
        this.deckSize = 100;             // Default deck size (100 for Commander)
        this.savedDecks = [];            // Saved deck configurations
        this.cardPrices = new Map();     // Card prices cache
        this.expirationTime = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
        
        // Initialize event listeners
        this.initEventListeners();
    }
    
    /**
     * Initialize all event listeners
     */
    initEventListeners() {
        // CSV Import button
        document.getElementById('import-csv').addEventListener('click', () => {
            document.getElementById('csv-file').click();
        });
        
        // CSV file input change
        document.getElementById('csv-file').addEventListener('change', (e) => {
            this.handleCSVImport(e.target.files[0]);
        });
        
        // Budget input
        document.getElementById('budget-input').addEventListener('change', (e) => {
            this.budget = parseFloat(e.target.value) || 100.00;
            this.updateBudgetDisplay();
        });
        
        // Format selector
        document.getElementById('format-select').addEventListener('change', (e) => {
            this.format = e.target.value;
            this.updateDeckSizeForFormat();
        });
        
        // Generate deck button
        document.getElementById('generate-deck').addEventListener('click', () => {
            this.generateDeck();
        });
        
        // Save deck button
        document.getElementById('save-deck').addEventListener('click', () => {
            this.saveDeck();
        });
        
        // Clear deck button
        document.getElementById('clear-deck').addEventListener('click', () => {
            this.clearDeck();
        });
        
        // Export deck button
        document.getElementById('export-deck').addEventListener('click', () => {
            this.exportDeck();
        });
        
        // Card search input
        document.getElementById('card-search').addEventListener('input', (e) => {
            this.searchCards(e.target.value);
        });
        
        // Initialize tooltips for cards
        this.initCardTooltips();
    }
    
    /**
     * Update deck size based on selected format
     */
    updateDeckSizeForFormat() {
        switch(this.format) {
            case 'commander':
                this.deckSize = 100; // 99 cards + commander
                break;
            case 'brawl':
                this.deckSize = 60; // 59 cards + commander
                break;
            case 'standard':
            case 'modern':
            case 'pioneer':
                this.deckSize = 60;
                break;
            case 'limited':
                this.deckSize = 40;
                break;
            default:
                this.deckSize = 60;
        }
        
        document.getElementById('deck-size').textContent = this.deckSize;
    }
    
    /**
     * Handle CSV file import
     */
    async handleCSVImport(file) {
        if (!file) return;
        
        try {
            const text = await this.readFileAsText(file);
            const cards = this.parseCSV(text);
            
            if (cards.length === 0) {
                this.showNotification('No valid cards found in CSV', 'error');
                return;
            }
            
            this.userCollection.clear();
            let importCount = 0;
            
            for (const card of cards) {
                if (card.name) {
                    // Store card in collection with quantity
                    this.userCollection.set(card.name.toLowerCase(), {
                        name: card.name,
                        quantity: parseInt(card.quantity) || 1,
                        price: parseFloat(card.price) || 0,
                        importDate: new Date().getTime()
                    });
                    importCount++;
                }
            }
            
            this.showNotification(`Imported ${importCount} cards from CSV`, 'success');
            this.displayUserCollection();
            
            // Schedule expiration check
            this.scheduleExpirationCheck();
        } catch (error) {
            console.error('CSV import error:', error);
            this.showNotification('Error importing CSV: ' + error.message, 'error');
        }
    }
    
    /**
     * Read file as text
     */
    readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('File read error'));
            reader.readAsText(file);
        });
    }
    
    /**
     * Parse CSV text into card objects
     */
    parseCSV(text) {
        const lines = text.split('\n');
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        // Check for required columns
        if (!headers.includes('name')) {
            throw new Error('CSV must contain a "name" column');
        }
        
        const cards = [];
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = lines[i].split(',').map(v => v.trim());
            const card = {};
            
            headers.forEach((header, index) => {
                if (index < values.length) {
                    card[header] = values[index];
                }
            });
            
            cards.push(card);
        }
        
        return cards;
    }
    
    /**
     * Display user's card collection
     */
    displayUserCollection() {
        const collectionContainer = document.getElementById('collection-cards');
        collectionContainer.innerHTML = '';
        
        if (this.userCollection.size === 0) {
            collectionContainer.innerHTML = '<p class="empty-message">No cards in your collection. Import a CSV file to get started.</p>';
            return;
        }
        
        // Sort cards by name
        const sortedCards = Array.from(this.userCollection.values())
            .sort((a, b) => a.name.localeCompare(b.name));
        
        for (const card of sortedCards) {
            const cardElement = document.createElement('div');
            cardElement.className = 'collection-card';
            cardElement.dataset.cardName = card.name;
            
            cardElement.innerHTML = `
                <div class="card-name">${card.name}</div>
                <div class="card-quantity">x${card.quantity}</div>
                <div class="card-price">$${card.price.toFixed(2)}</div>
                <button class="add-to-deck" data-card="${card.name}">Add</button>
            `;
            
            // Add event listener to add card to deck
            cardElement.querySelector('.add-to-deck').addEventListener('click', () => {
                this.addCardToDeck(card.name);
            });
            
            collectionContainer.appendChild(cardElement);
        }
        
        // Update collection stats
        document.getElementById('collection-count').textContent = this.userCollection.size;
        
        const totalValue = Array.from(this.userCollection.values())
            .reduce((sum, card) => sum + (card.price * card.quantity), 0);
        document.getElementById('collection-value').textContent = totalValue.toFixed(2);
    }
    
    /**
     * Add a card to the current deck
     */
    addCardToDeck(cardName) {
        // Check if card exists in collection
        const cardLower = cardName.toLowerCase();
        const collectionCard = this.userCollection.get(cardLower);
        
        if (!collectionCard) {
            this.showNotification(`Card "${cardName}" not found in your collection`, 'error');
            return;
        }
        
        // Check if we already have this card in the deck
        const currentCount = this.currentDeck.get(cardLower)?.quantity || 0;
        
        // Check if we have enough copies in the collection
        if (currentCount >= collectionCard.quantity) {
            this.showNotification(`You don't have any more copies of "${cardName}"`, 'error');
            return;
        }
        
        // Check deck size limit
        const currentDeckSize = Array.from(this.currentDeck.values())
            .reduce((sum, card) => sum + card.quantity, 0);
            
        if (currentDeckSize >= this.deckSize) {
            this.showNotification(`Deck size limit (${this.deckSize}) reached`, 'error');
            return;
        }
        
        // Add card to deck
        if (this.currentDeck.has(cardLower)) {
            this.currentDeck.get(cardLower).quantity++;
        } else {
            this.currentDeck.set(cardLower, {
                name: collectionCard.name,
                quantity: 1,
                price: collectionCard.price
            });
        }
        
        this.updateDeckDisplay();
        this.showNotification(`Added "${cardName}" to deck`, 'success');
    }
    
    /**
     * Remove a card from the current deck
     */
    removeCardFromDeck(cardName) {
        const cardLower = cardName.toLowerCase();
        
        if (!this.currentDeck.has(cardLower)) {
            return;
        }
        
        const card = this.currentDeck.get(cardLower);
        card.quantity--;
        
        if (card.quantity <= 0) {
            this.currentDeck.delete(cardLower);
        }
        
        this.updateDeckDisplay();
        this.showNotification(`Removed "${cardName}" from deck`, 'info');
    }
    
    /**
     * Update the deck display
     */
    updateDeckDisplay() {
        const deckContainer = document.getElementById('deck-cards');
        deckContainer.innerHTML = '';
        
        if (this.currentDeck.size === 0) {
            deckContainer.innerHTML = '<p class="empty-message">Your deck is empty. Add cards or generate a deck.</p>';
            return;
        }
        
        // Group cards by type
        const cardsByType = {
            'Commander': [],
            'Creature': [],
            'Instant': [],
            'Sorcery': [],
            'Artifact': [],
            'Enchantment': [],
            'Planeswalker': [],
            'Land': [],
            'Other': []
        };
        
        // Sort cards into types
        for (const card of this.currentDeck.values()) {
            // We would need to fetch card type from API, but for now just put in Other
            // In a real implementation, we'd store the full card data
            cardsByType['Other'].push(card);
        }
        
        // Create sections for each type
        for (const [type, cards] of Object.entries(cardsByType)) {
            if (cards.length === 0) continue;
            
            const typeSection = document.createElement('div');
            typeSection.className = 'card-type-section';
            typeSection.innerHTML = `<h3>${type} (${cards.length})</h3>`;
            
            const cardsList = document.createElement('div');
            cardsList.className = 'type-cards';
            
            // Sort cards by name
            cards.sort((a, b) => a.name.localeCompare(b.name));
            
            for (const card of cards) {
                const cardElement = document.createElement('div');
                cardElement.className = 'deck-card';
                cardElement.dataset.cardName = card.name;
                
                cardElement.innerHTML = `
                    <div class="card-name">${card.name}</div>
                    <div class="card-quantity">x${card.quantity}</div>
                    <div class="card-price">$${(card.price * card.quantity).toFixed(2)}</div>
                    <button class="remove-from-deck" data-card="${card.name}">Remove</button>
                `;
                
                // Add event listener to remove card from deck
                cardElement.querySelector('.remove-from-deck').addEventListener('click', () => {
                    this.removeCardFromDeck(card.name);
                });
                
                cardsList.appendChild(cardElement);
            }
            
            typeSection.appendChild(cardsList);
            deckContainer.appendChild(typeSection);
        }
        
        // Update deck stats
        this.updateDeckStats();
    }
    
    /**
     * Update deck statistics
     */
    updateDeckStats() {
        const deckSize = Array.from(this.currentDeck.values())
            .reduce((sum, card) => sum + card.quantity, 0);
        
        const deckValue = Array.from(this.currentDeck.values())
            .reduce((sum, card) => sum + (card.price * card.quantity), 0);
        
        document.getElementById('deck-card-count').textContent = deckSize;
        document.getElementById('deck-value').textContent = deckValue.toFixed(2);
        
        // Update budget remaining
        const budgetRemaining = this.budget - deckValue;
        document.getElementById('budget-remaining').textContent = budgetRemaining.toFixed(2);
        
        // Visual indicator for budget
        const budgetBar = document.getElementById('budget-bar');
        const percentUsed = Math.min(100, (deckValue / this.budget) * 100);
        budgetBar.style.width = `${percentUsed}%`;
        
        if (percentUsed > 90) {
            budgetBar.className = 'budget-bar danger';
        } else if (percentUsed > 75) {
            budgetBar.className = 'budget-bar warning';
        } else {
            budgetBar.className = 'budget-bar good';
        }
    }
    
    /**
     * Update budget display
     */
    updateBudgetDisplay() {
        document.getElementById('budget-amount').textContent = this.budget.toFixed(2);
        this.updateDeckStats(); // Recalculate budget bar
    }
    
    /**
     * Generate a deck based on budget and collection
     */
    async generateDeck() {
        if (this.userCollection.size === 0) {
            this.showNotification('You need to import your collection first', 'error');
            return;
        }
        
        this.showNotification('Generating deck...', 'info');
        
        try {
            // Get all available cards from collection
            const availableCards = Array.from(this.userCollection.values());
            
            // Call API to get synergy data and build optimal deck
            const response = await fetch(`${this.apiEndpoint}?action=generate_deck`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    format: this.format,
                    budget: this.budget,
                    collection: availableCards,
                    deckSize: this.deckSize
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            // Clear current deck
            this.currentDeck.clear();
            
            // Add suggested cards to deck
            for (const card of data.deck) {
                this.currentDeck.set(card.name.toLowerCase(), {
                    name: card.name,
                    quantity: card.quantity,
                    price: card.price
                });
            }
            
            this.updateDeckDisplay();
            this.showNotification('Deck generated successfully!', 'success');
            
            // Show synergy information
            if (data.synergy_info) {
                this.displaySynergyInfo(data.synergy_info);
            }
        } catch (error) {
            console.error('Deck generation error:', error);
            this.showNotification('Error generating deck: ' + error.message, 'error');
        }
    }
    
    /**
     * Display synergy information for the generated deck
     */
    displaySynergyInfo(synergyInfo) {
        const synergyContainer = document.getElementById('synergy-info');
        synergyContainer.innerHTML = '';
        
        const synergyHeader = document.createElement('h3');
        synergyHeader.textContent = 'Deck Synergy Analysis';
        synergyContainer.appendChild(synergyHeader);
        
        // Overall synergy score
        const overallScore = document.createElement('div');
        overallScore.className = 'synergy-score';
        overallScore.innerHTML = `
            <span>Overall Synergy Score:</span>
            <span class="score">${(synergyInfo.overall_score * 100).toFixed(1)}%</span>
        `;
        synergyContainer.appendChild(overallScore);
        
        // Top synergy pairs
        if (synergyInfo.top_pairs && synergyInfo.top_pairs.length > 0) {
            const pairsHeader = document.createElement('h4');
            pairsHeader.textContent = 'Top Synergy Pairs';
            synergyContainer.appendChild(pairsHeader);
            
            const pairsList = document.createElement('ul');
            pairsList.className = 'synergy-pairs';
            
            for (const pair of synergyInfo.top_pairs) {
                const pairItem = document.createElement('li');
                pairItem.innerHTML = `
                    <span>${pair.card1} + ${pair.card2}</span>
                    <span class="pair-score">${(pair.synergy * 100).toFixed(1)}%</span>
                `;
                pairsList.appendChild(pairItem);
            }
            
            synergyContainer.appendChild(pairsList);
        }
        
        // Combo potential
        if (synergyInfo.combos && synergyInfo.combos.length > 0) {
            const combosHeader = document.createElement('h4');
            combosHeader.textContent = 'Potential Combos';
            synergyContainer.appendChild(combosHeader);
            
            const combosList = document.createElement('ul');
            combosList.className = 'combo-list';
            
            for (const combo of synergyInfo.combos) {
                const comboItem = document.createElement('li');
                comboItem.innerHTML = `
                    <div class="combo-name">${combo.type}</div>
                    <div class="combo-cards">${combo.cards.join(' + ')}</div>
                `;
                combosList.appendChild(comboItem);
            }
            
            synergyContainer.appendChild(combosList);
        }
    }
    
    /**
     * Save the current deck
     */
    saveDeck() {
        if (this.currentDeck.size === 0) {
            this.showNotification('Cannot save an empty deck', 'error');
            return;
        }
        
        const deckName = prompt('Enter a name for this deck:');
        if (!deckName) return;
        
        // Create a copy of the current deck
        const deckCopy = {
            name: deckName,
            format: this.format,
            created: new Date().toISOString(),
            cards: Array.from(this.currentDeck.values()),
            value: Array.from(this.currentDeck.values())
                .reduce((sum, card) => sum + (card.price * card.quantity), 0)
        };
        
        this.savedDecks.push(deckCopy);
        
        // Save to localStorage
        this.saveDeckToLocalStorage();
        
        this.showNotification(`Deck "${deckName}" saved successfully`, 'success');
        this.updateSavedDecksList();
    }
    
    /**
     * Save decks to localStorage
     */
    saveDeckToLocalStorage() {
        try {
            localStorage.setItem('mtg-saved-decks', JSON.stringify(this.savedDecks));
        } catch (e) {
            console.error('Error saving to localStorage:', e);
        }
    }
    
    /**
     * Load decks from localStorage
     */
    loadDecksFromLocalStorage() {
        try {
            const savedDecks = localStorage.getItem('mtg-saved-decks');
            if (savedDecks) {
                this.savedDecks = JSON.parse(savedDecks);
                this.updateSavedDecksList();
            }
        } catch (e) {
            console.error('Error loading from localStorage:', e);
        }
    }
    
    /**
     * Update the list of saved decks
     */
    updateSavedDecksList() {
        const savedDecksContainer = document.getElementById('saved-decks');
        savedDecksContainer.innerHTML = '';
        
        if (this.savedDecks.length === 0) {
            savedDecksContainer.innerHTML = '<p class="empty-message">No saved decks</p>';
            return;
        }
        
        for (let i = 0; i < this.savedDecks.length; i++) {
            const deck = this.savedDecks[i];
            const deckElement = document.createElement('div');
            deckElement.className = 'saved-deck';
            
            deckElement.innerHTML = `
                <div class="deck-header">
                    <h4>${deck.name}</h4>
                    <span class="deck-format">${deck.format}</span>
                </div>
                <div class="deck-info">
                    <span>${deck.cards.reduce((sum, card) => sum + card.quantity, 0)} cards</span>
                    <span>$${deck.value.toFixed(2)}</span>
                </div>
                <div class="deck-actions">
                    <button class="load-deck" data-index="${i}">Load</button>
                    <button class="delete-deck" data-index="${i}">Delete</button>
                </div>
            `;
            
            // Add event listeners
            deckElement.querySelector('.load-deck').addEventListener('click', () => {
                this.loadDeck(i);
            });
            
            deckElement.querySelector('.delete-deck').addEventListener('click', () => {
                this.deleteDeck(i);
            });
            
            savedDecksContainer.appendChild(deckElement);
        }
    }
    
    /**
     * Load a saved deck
     */
    loadDeck(index) {
        if (index < 0 || index >= this.savedDecks.length) return;
        
        const deck = this.savedDecks[index];
        
        // Confirm if current deck is not empty
        if (this.currentDeck.size > 0) {
            if (!confirm('This will replace your current deck. Continue?')) {
                return;
            }
        }
        
        // Set format
        this.format = deck.format;
        document.getElementById('format-select').value = this.format;
        this.updateDeckSizeForFormat();
        
        // Clear current deck
        this.currentDeck.clear();
        
        // Add cards from saved deck
        for (const card of deck.cards) {
            this.currentDeck.set(card.name.toLowerCase(), {
                name: card.name,
                quantity: card.quantity,
                price: card.price
            });
        }
        
        this.updateDeckDisplay();
        this.showNotification(`Loaded deck "${deck.name}"`, 'success');
    }
    
    /**
     * Delete a saved deck
     */
    deleteDeck(index) {
        if (index < 0 || index >= this.savedDecks.length) return;
        
        const deck = this.savedDecks[index];
        
        if (confirm(`Are you sure you want to delete the deck "${deck.name}"?`)) {
            this.savedDecks.splice(index, 1);
            this.saveDeckToLocalStorage();
            this.updateSavedDecksList();
            this.showNotification(`Deleted deck "${deck.name}"`, 'info');
        }
    }
    
    /**
     * Clear the current deck
     */
    clearDeck() {
        if (this.currentDeck.size === 0) return;
        
        if (confirm('Are you sure you want to clear the current deck?')) {
            this.currentDeck.clear();
            this.updateDeckDisplay();
            this.showNotification('Deck cleared', 'info');
        }
    }
    
    /**
     * Export the current deck
     */
    exportDeck() {
        if (this.currentDeck.size === 0) {
            this.showNotification('Cannot export an empty deck', 'error');
            return;
        }
        
        // Format deck for export
        let exportText = '';
        
        // Group by card type (simplified version)
        const cardsByType = {};
        
        for (const card of this.currentDeck.values()) {
            const type = 'Main'; // In a real implementation, we'd use actual card types
            
            if (!cardsByType[type]) {
                cardsByType[type] = [];
            }
            
            cardsByType[type].push(card);
        }
        
        // Build export text
        for (const [type, cards] of Object.entries(cardsByType)) {
            exportText += `// ${type}\n`;
            
            for (const card of cards) {
                exportText += `${card.quantity} ${card.name}\n`;
            }
            
            exportText += '\n';
        }
        
        // Create download link
        const blob = new Blob([exportText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mtg-deck.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showNotification('Deck exported successfully', 'success');
    }
    
    /**
     * Search cards in collection
     */
    searchCards(query) {
        if (!query) {
            // Show all cards
            document.querySelectorAll('.collection-card').forEach(card => {
                card.style.display = 'flex';
            });
            return;
        }
        
        query = query.toLowerCase();
        
        // Filter cards
        document.querySelectorAll('.collection-card').forEach(card => {
            const cardName = card.dataset.cardName.toLowerCase();
            
            if (cardName.includes(query)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    }
    
    /**
     * Initialize card tooltips
     */
    initCardTooltips() {
        // This would show card images on hover
        // Implementation depends on available card image API
    }
    
    /**
     * Schedule check for expired cards
     */
    scheduleExpirationCheck() {
        // Check every hour
        setInterval(() => {
            this.checkExpiredCards();
        }, 60 * 60 * 1000);
        
        // Also check immediately
        this.checkExpiredCards();
    }
    
    /**
     * Check for and remove expired cards
     */
    checkExpiredCards() {
        const now = new Date().getTime();
        let expiredCount = 0;
        
        for (const [cardName, cardData] of this.userCollection.entries()) {
            if (now - cardData.importDate > this.expirationTime) {
                this.userCollection.delete(cardName);
                expiredCount++;
            }
        }
        
        if (expiredCount > 0) {
            this.displayUserCollection();
            this.showNotification(`Removed ${expiredCount} expired cards from collection`, 'info');
        }
    }
    
    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        const container = document.getElementById('notification-container');
        container.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                container.removeChild(notification);
            }, 500);
        }, 5000);
    }
}

// Initialize the deck builder when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.deckBuilder = new MTGDeckBuilder('api.php');
    
    // Load saved decks from localStorage
    window.deckBuilder.loadDecksFromLocalStorage();
});

// Display synergies with the deck
function displayDeckSynergies(synergies) {
    const synergyInfo = document.getElementById('synergy-info');
    const deckSynergiesSection = synergyInfo.querySelector('.deck-synergies');
    
    if (!deckSynergiesSection) return;
    
    // Clear loading
    deckSynergiesSection.innerHTML = '<h3>Synergies with Your Deck</h3>';
    
    if (synergies.length === 0) {
        deckSynergiesSection.innerHTML += '<p>No synergies found with cards in your deck.</p>';
        return;
    }
    
    // Create synergy list
    const synergyList = document.createElement('div');
    synergyList.className = 'deck-synergy-list';
    
    // Add top synergies
    synergies.forEach(item => {
        const synergyItem = document.createElement('div');
        synergyItem.className = 'deck-synergy-item';
        
        // Determine synergy class based on score
        const scoreValue = item.synergy.synergy_score * 100;
        let scoreClass = 'low-synergy';
        if (scoreValue >= 90) scoreClass = 'very-high-synergy';
        else if (scoreValue >= 80) scoreClass = 'high-synergy';
        else if (scoreValue >= 70) scoreClass = 'medium-synergy';
        
        synergyItem.innerHTML = `
            <div class="synergy-pair">
                <span class="synergy-card1">${item.card1.name}</span>
                <span class="synergy-plus">+</span>
                <span class="synergy-card2">${item.card2.name}</span>
            </div>
            <div class="synergy-details">
                <span class="synergy-score ${scoreClass}">${scoreValue.toFixed(1)}%</span>
                ${item.synergy.combo_type ? `<span class="synergy-combo-type">${item.synergy.combo_type.replace(/_/g, ' ')}</span>` : ''}
            </div>
        `;
        
        // Add save button if this is a high synergy
        if (scoreValue >= 75) {
            const saveButton = document.createElement('button');
            saveButton.className = 'save-synergy-btn';
            saveButton.textContent = 'Save Synergy';
            saveButton.addEventListener('click', function() {
                saveSynergy(item.card1, item.card2, item.synergy);
                this.disabled = true;
                this.textContent = 'Saved';
            });
            
            synergyItem.appendChild(saveButton);
        }
        
        synergyList.appendChild(synergyItem);
    });
    
    deckSynergiesSection.appendChild(synergyList);
}

// Find synergies between a card and the current deck
function findSynergiesWithDeck(card) {
    // Get all cards in the deck (including commander)
    const deckCards = [...window.deckState.cards];
    if (window.deckState.commander) {
        deckCards.push(window.deckState.commander);
    }
    
    // If deck is empty, nothing to do
    if (deckCards.length === 0) return;
    
    // Show loading in synergy info
    const synergyInfo = document.getElementById('synergy-info');
    if (!synergyInfo.querySelector('.deck-synergies')) {
        const deckSynergiesSection = document.createElement('div');
        deckSynergiesSection.className = 'deck-synergies';
        deckSynergiesSection.innerHTML = '<h3>Synergies with Your Deck</h3><div class="loading">Finding synergies...</div>';
        synergyInfo.appendChild(deckSynergiesSection);
    } else {
        synergyInfo.querySelector('.deck-synergies').innerHTML = '<h3>Synergies with Your Deck</h3><div class="loading">Finding synergies...</div>';
    }
    
    // Create an array of promises to fetch synergies for each card pair
    const synergiesPromises = deckCards.map(deckCard => {
        // Skip if it's the same card
        if (deckCard.id === card.id) return Promise.resolve(null);
        
        // Fetch synergy between these two cards
        return fetch(`api.php?action=card_pair&card1_id=${card.id}&card2_id=${deckCard.id}`)
            .then(response => response.json())
            .then(data => {
                if (data.error) return null;
                return {
                    card1: card,
                    card2: deckCard,
                    synergy: data.synergy || null
                };
            })
            .catch(error => {
                console.error('Error fetching synergy:', error);
                return null;
            });
    });
    
    // Wait for all synergy requests to complete
    Promise.all(synergiesPromises)
        .then(results => {
            // Filter out null results
            const synergies = results.filter(result => result !== null && result.synergy !== null);
            
            // Sort by synergy score
            synergies.sort((a, b) => b.synergy.synergy_score - a.synergy.synergy_score);
            
            // Display the synergies
            displayDeckSynergies(synergies);
        })
        .catch(error => {
            console.error('Error finding synergies:', error);
            const deckSynergiesSection = synergyInfo.querySelector('.deck-synergies');
            if (deckSynergiesSection) {
                deckSynergiesSection.innerHTML = '<h3>Synergies with Your Deck</h3><p>Error finding synergies.</p>';
            }
        });
}

// Enhanced card selection function
function toggleCardSelection(cardElement, card) {
    // Toggle selected class
    cardElement.classList.toggle('selected');
    
    if (cardElement.classList.contains('selected')) {
        // Card is now selected
        
        // Get the current format
        const format = document.querySelector('.format-btn.active')?.dataset.format;
        
        // If this is commander format, check if it can be a commander
        if (format === 'commander' && 
            card.type_line && 
            (card.type_line.includes('Legendary Creature') || 
             (card.oracle_text && card.oracle_text.includes('can be your commander')))) {
            
            // Check if we already have a commander
            if (window.deckState.commander) {
                // We already have a commander, so add this as a regular card
                addCardToDeck(card);
            } else {
                // Set as commander
                window.deckState.commander = card;
                updateDeckDisplay();
                showNotification(`${card.name} set as your commander!`);
            }
        } else {
            // Add to deck as regular card
            addCardToDeck(card);
        }
        
        // Show synergies for this card
        showCardSynergies(card.id);
        
        // Find synergies with cards already in the deck
        findSynergiesWithDeck(card);
    } else {
        // Card is now deselected
        // If it was the commander, remove it
        if (window.deckState.commander && window.deckState.commander.id === card.id) {
            removeCommander();
        } else {
            // Remove from deck
            removeCardFromDeck(card.id);
        }
    }
}

// Save a synergy pair
function saveSynergy(card1, card2, synergy) {
    // Get existing saved synergies
    let savedSynergies = JSON.parse(localStorage.getItem('forgeSynergies') || '[]');
    
    // Check if this synergy is already saved
    const alreadySaved = savedSynergies.some(item => 
        (item.card1.id === card1.id && item.card2.id === card2.id) || 
        (item.card1.id === card2.id && item.card2.id === card1.id)
    );
    
    if (alreadySaved) {
        showNotification('This synergy is already saved');
        return;
    }
    
    // Add to saved synergies
    savedSynergies.push({
        card1: {
            id: card1.id,
            name: card1.name,
            type_line: card1.type_line
        },
        card2: {
            id: card2.id,
            name: card2.name,
            type_line: card2.type_line
        },
        synergy: {
            synergy_score: synergy.synergy_score,
            combo_type: synergy.combo_type,
            strategic_role: synergy.strategic_role
        },
        saved_at: new Date().toISOString()
    });
    
    // Save to localStorage
    localStorage.setItem('forgeSynergies', JSON.stringify(savedSynergies));
    
    // Show notification
    showNotification(`Saved synergy between ${card1.name} and ${card2.name}`);
}

// Enhanced card element creation with synergy indicators
function createCardElement(card) {
    // Create card container
    const cardContainer = document.createElement('div');
    cardContainer.className = 'card-container';
    
    // Create card element
    const cardElement = document.createElement('div');
    cardElement.className = 'card';
    cardElement.dataset.cardId = card.id;
    cardElement.dataset.cardName = card.name;
    
    // Create card image - use Scryfall API for images
    const cardImage = document.createElement('img');
    cardImage.className = 'card-image';
    cardImage.src = `https://api.scryfall.com/cards/named?format=image&exact=${encodeURIComponent(card.name)}`;
    cardImage.alt = card.name;
    cardImage.loading = 'lazy';
    
    // Handle image loading error
    cardImage.onerror = function() {
        this.src = 'https://c1.scryfall.com/file/scryfall-card-backs/large/59/597b79b3-7d77-4261-871a-60dd17403388.jpg';
    };
    
    // Create card overlay
    const cardOverlay = document.createElement('div');
    cardOverlay.className = 'card-overlay';
    
    // Card name
    const cardName = document.createElement('div');
    cardName.className = 'card-name';
    cardName.textContent = card.name;
    
    // Card type
    const cardType = document.createElement('div');
    cardType.className = 'card-type';
    cardType.textContent = card.type_line || 'Unknown Type';
    
    // Add synergy indicators if available
    if (card.synergy_count || card.combo_potential) {
        const synergyIndicators = document.createElement('div');
        synergyIndicators.className = 'synergy-indicators';
        
        if (card.synergy_count) {
            const synergyCount = document.createElement('div');
            synergyCount.className = 'synergy-count';
            synergyCount.innerHTML = `<i class="synergy-icon">⚡</i> ${card.synergy_count}`;
            synergyIndicators.appendChild(synergyCount);
        }
        
        if (card.combo_potential) {
            const comboPotential = document.createElement('div');
            comboPotential.className = 'combo-potential';
            comboPotential.innerHTML = `<i class="combo-icon">∞</i>`;
            synergyIndicators.appendChild(comboPotential);
        }
        
        cardOverlay.appendChild(synergyIndicators);
    }
    
    // Card actions
    const cardActions = document.createElement('div');
    cardActions.className = 'card-actions';
    
    // Add to deck button
    const addButton = document.createElement('button');
    addButton.className = 'card-btn';
    addButton.textContent = 'Add to Deck';
    addButton.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent card click
        addCardToDeck(card);
    });
    
    // Scryfall link button
    const scryfallButton = document.createElement('button');
    scryfallButton.className = 'card-btn';
    scryfallButton.textContent = 'Scryfall';
    scryfallButton.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent card click
        window.open(`https://scryfall.com/search?q=${encodeURIComponent(card.name)}`, '_blank');
    });
    
    // Assemble card
    cardActions.appendChild(addButton);
    cardActions.appendChild(scryfallButton);
    
    cardOverlay.appendChild(cardName);
    cardOverlay.appendChild(cardType);
    cardOverlay.appendChild(cardActions);
    
    cardElement.appendChild(cardImage);
    cardElement.appendChild(cardOverlay);
    
    // Add click event to select card and show synergies
    cardElement.addEventListener('click', function() {
        toggleCardSelection(this, card);
        showCardSynergies(card.id);
    });
    
    cardContainer.appendChild(cardElement);
    
    return cardContainer;
}

// Helper function to display cards in the grid
function displayCards(cards, cardGrid) {
    // Create card elements
    cards.forEach(card => {
        const cardContainer = createCardElement(card);
        cardGrid.appendChild(cardContainer);
    });
    
    // Hide loading and show cards with slight delay for animation
    setTimeout(() => {
        document.getElementById('loading').classList.add('hidden');
        cardGrid.classList.add('visible');
    }, 300);
}

// Create a card element from API data
function createCardElement(card) {
    // Create card container
    const cardContainer = document.createElement('div');
    cardContainer.className = 'card-container';
    
    // Create card element
    const cardElement = document.createElement('div');
    cardElement.className = 'card';
    cardElement.dataset.cardId = card.id;
    cardElement.dataset.cardName = card.name;
    
    // Create card image - use Scryfall API if image_uri is not available
    const cardImage = document.createElement('img');
    cardImage.className = 'card-image';
    
    // Use image from your database if available, otherwise fetch from Scryfall
    if (card.image_uri_normal) {
        cardImage.src = card.image_uri_normal;
    } else {
        cardImage.src = `https://api.scryfall.com/cards/named?format=image&exact=${encodeURIComponent(card.name)}`;
    }
    
    cardImage.alt = card.name;
    cardImage.loading = 'lazy';
    
    // Create card overlay
    const cardOverlay = document.createElement('div');
    cardOverlay.className = 'card-overlay';
    
    // Card name
    const cardName = document.createElement('div');
    cardName.className = 'card-name';
    cardName.textContent = card.name;
    
    // Card type
    const cardType = document.createElement('div');
    cardType.className = 'card-type';
    cardType.textContent = card.type_line || 'Unknown Type';
    
    // Card actions
    const cardActions = document.createElement('div');
    cardActions.className = 'card-actions';
    
    // Add to deck button
    const addButton = document.createElement('button');
    addButton.className = 'card-btn';
    addButton.textContent = 'Add to Deck';
    addButton.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent card click
        addCardToDeck(card);
    });
    
    // Scryfall link button
    const scryfallButton = document.createElement('button');
    scryfallButton.className = 'card-btn';
    scryfallButton.textContent = 'Scryfall';
    scryfallButton.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent card click
        window.open(`https://scryfall.com/search?q=${encodeURIComponent(card.name)}`, '_blank');
    });
    
    // Assemble card
    cardActions.appendChild(addButton);
    cardActions.appendChild(scryfallButton);
    
    cardOverlay.appendChild(cardName);
    cardOverlay.appendChild(cardType);
    cardOverlay.appendChild(cardActions);
    
    cardElement.appendChild(cardImage);
    cardElement.appendChild(cardOverlay);
    
    // Add click event to select card and show synergies
    cardElement.addEventListener('click', function() {
        toggleCardSelection(this, card);
        showCardSynergies(card.id);
    });
    
    cardContainer.appendChild(cardElement);
    
    return cardContainer;
}

// Show synergies for a selected card
function showCardSynergies(cardId) {
    // Show loading indicator
    const synergyInfo = document.getElementById('synergy-info');
    synergyInfo.innerHTML = '<p>Loading synergies...</p>';
    
    // Fetch synergies from your API
    fetch(`api.php?action=card&id=${cardId}`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            // Display synergies
            displaySynergies(data.card, data.synergies);
        })
        .catch(error => {
            console.error('Error loading synergies:', error);
            synergyInfo.innerHTML = '<p>Failed to load synergies. Please try again.</p>';
        });
}

// Display synergies for a card
function displaySynergies(card, synergies) {
    const synergyInfo = document.getElementById('synergy-info');
    synergyInfo.innerHTML = '';
    
    // Create header
    const header = document.createElement('h3');
    header.textContent = `Synergies for ${card.name}`;
    synergyInfo.appendChild(header);
    
    // If no synergies found
    if (synergies.length === 0) {
        const noSynergies = document.createElement('p');
        noSynergies.textContent = 'No synergies found for this card.';
        synergyInfo.appendChild(noSynergies);
        return;
    }
    
    // Create synergy list
    const synergyList = document.createElement('div');
    synergyList.className = 'synergy-list';
    
    // Add top synergies
    synergies.slice(0, 5).forEach(synergy => {
        const synergyItem = document.createElement('div');
        synergyItem.className = 'synergy-item';
        
        // Synergy card name
        const synergyCard = document.createElement('div');
        synergyCard.className = 'synergy-card';
        synergyCard.textContent = synergy.synergy_card_name;
        
        // Synergy score
        const synergyScore = document.createElement('div');
        synergyScore.className = 'synergy-score';
        synergyScore.textContent = (synergy.synergy_score * 100).toFixed(0) + '%';
        
        // Combo type if available
        if (synergy.combo_type) {
            const comboType = document.createElement('div');
            comboType.className = 'combo-type';
            comboType.textContent = synergy.combo_type.replace(/_/g, ' ');
            synergyItem.appendChild(comboType);
        }
        
        // Add to synergy item
        synergyItem.appendChild(synergyCard);
        synergyItem.appendChild(synergyScore);
        
        // Add click event to add card to deck
        synergyItem.addEventListener('click', function() {
            // Find this card in the grid or fetch it
            fetch(`api.php?action=card&id=${synergy.synergy_card_id}`)
                .then(response => response.json())
                .then(data => {
                    if (data.card) {
                        addCardToDeck(data.card);
                        showNotification(`Added ${data.card.name} to deck`);
                    }
                })
                .catch(error => console.error('Error:', error));
        });
        
        synergyList.appendChild(synergyItem);
    });
    
    synergyInfo.appendChild(synergyList);
    
    // Add "View All" button if there are more synergies
    if (synergies.length > 5) {
        const viewAllBtn = document.createElement('button');
        viewAllBtn.className = 'view-all-btn';
        viewAllBtn.textContent = 'View All Synergies';
        viewAllBtn.addEventListener('click', function() {
            displayAllSynergies(card, synergies);
        });
        synergyInfo.appendChild(viewAllBtn);
    }
}

// Analyze the current deck using your API
function analyzeDeck() {
    // Check if deck has cards
    if (window.deckState.cards.length === 0) {
        showNotification('Add cards to your deck first', 'error');
        return;
    }
    
    // Show loading
    const synergyInfo = document.getElementById('synergy-info');
    synergyInfo.innerHTML = '<p>Analyzing deck...</p>';
    
    // Prepare deck data
    const deckCards = window.deckState.cards.map(card => card.name);
    if (window.deckState.commander) {
        deckCards.unshift(window.deckState.commander.name);
    }
    
    // Call your API to analyze the deck
    fetch('api.php?action=analyze_deck', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ deck: deckCards })
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            throw new Error(data.error);
        }
        
        // Display analysis results
        displayDeckAnalysis(data);
    })
    .catch(error => {
        console.error('Error analyzing deck:', error);
        synergyInfo.innerHTML = '<p>Failed to analyze deck. Please try again.</p>';
    });
}

// Display deck analysis results
function displayDeckAnalysis(analysis) {
    const synergyInfo = document.getElementById('synergy-info');
    synergyInfo.innerHTML = '';
    
    // Create header
    const header = document.createElement('h3');
    header.textContent = 'Deck Analysis';
    synergyInfo.appendChild(header);
    
    // Overall synergy score
    const overallScore = document.createElement('div');
    overallScore.className = 'synergy-score';
    overallScore.innerHTML = `
        <span>Overall Synergy Score:</span>
        <span class="score">${(analysis.average_synergy * 100).toFixed(1)}%</span>
    `;
    synergyInfo.appendChild(overallScore);
    
    // Top synergy pairs
    if (analysis.top_synergies && analysis.top_synergies.length > 0) {
        const pairsHeader = document.createElement('h4');
        pairsHeader.textContent = 'Top Synergy Pairs';
        synergyInfo.appendChild(pairsHeader);
        
        const pairsList = document.createElement('ul');
        pairsList.className = 'synergy-pairs';
        
        analysis.top_synergies.slice(0, 5).forEach(pair => {
            const pairItem = document.createElement('li');
            pairItem.innerHTML = `
                <span>${pair.card1_name} + ${pair.card2_name}</span>
                <span class="pair-score">${(pair.synergy_score * 100).toFixed(1)}%</span>
            `;
            pairsList.appendChild(pairItem);
        });
        
        synergyInfo.appendChild(pairsList);
    }
    
    // Combo types
    if (analysis.combo_types && Object.keys(analysis.combo_types).length > 0) {
        const combosHeader = document.createElement('h4');
        combosHeader.textContent = 'Potential Combos';
        synergyInfo.appendChild(combosHeader);
        
        const combosList = document.createElement('ul');
        combosList.className = 'combo-list';
        
        for (const [comboType, count] of Object.entries(analysis.combo_types)) {
            const comboItem = document.createElement('li');
            comboItem.innerHTML = `
                <div class="combo-name">${comboType.replace(/_/g, ' ')}</div>
                <div class="combo-count">Found in ${count} card pairs</div>
            `;
            combosList.appendChild(comboItem);
        }
        
        synergyInfo.appendChild(combosList);
    }
    
    // Suggested cards
    if (analysis.suggestions && analysis.suggestions.length > 0) {
        const suggestionsHeader = document.createElement('h4');
        suggestionsHeader.textContent = 'Suggested Cards';
        synergyInfo.appendChild(suggestionsHeader);
        
        const suggestionsList = document.createElement('div');
        suggestionsList.className = 'suggestions-list';
        
        analysis.suggestions.slice(0, 5).forEach(suggestion => {
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'suggestion-item';
            
            // Get synergy with cards
            const synergyWith = Object.entries(suggestion.synergy_with)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([card, score]) => `${card} (${(score * 100).toFixed(0)}%)`)
                .join(', ');
            
            suggestionItem.innerHTML = `
                <div class="suggestion-name">${suggestion.name}</div>
                <div class="suggestion-type">${suggestion.type_line}</div>
                <div class="suggestion-synergy">Synergizes with: ${synergyWith}</div>
            `;
            
            // Add button to add to deck
            const addButton = document.createElement('button');
            addButton.className = 'add-suggestion';
            addButton.textContent = 'Add to Deck';
            addButton.addEventListener('click', function() {
                addCardToDeck({
                    id: suggestion.id,
                    name: suggestion.name,
                    type_line: suggestion.type_line
                });
            });
            
            suggestionItem.appendChild(addButton);
            suggestionsList.appendChild(suggestionItem);
        });
        
        synergyInfo.appendChild(suggestionsList);
    }
}

// Helper function to shuffle an array
function shuffleArray(array) {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}
