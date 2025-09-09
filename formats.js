// formats.js - Main file to manage all MTG formats

// Global settings
let budgetMode = false;
let budgetLimit = 50;
let currentFormat = 'commander';

// Format registry - we'll populate this after loading individual format modules
const formatRegistry = {};

// Utility functions for all formats
function getCardType(typeLine) {
    if (!typeLine) return 'Unknown';
    
    const type = typeLine.toLowerCase();
    
    if (type.includes('creature')) return 'Creature';
    if (type.includes('instant')) return 'Instant';
    if (type.includes('sorcery')) return 'Sorcery';
    if (type.includes('artifact')) return 'Artifact';
    if (type.includes('enchantment')) return 'Enchantment';
    if (type.includes('planeswalker')) return 'Planeswalker';
    if (type.includes('land')) return 'Land';
    
    return 'Other';
}

async function getCardPrice(cardName) {
    try {
        const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`);
        
        if (response.ok) {
            const data = await response.json();
            return {
                price: parseFloat(data.prices?.usd || '0.50'),
                image: data.image_uris?.normal || data.card_faces?.[0]?.image_uris?.normal || '',
                scryfallId: data.id || ''
            };
        }
    } catch (error) {
        console.error('Error fetching price for', cardName, ':', error);
    }
    
    return {
        price: 0.50,
        image: '',
        scryfallId: ''
    };
}

async function searchForCards(query, colorIdentity, limit = 5) {
    try {
        let searchQuery = query;
        
        if (colorIdentity && colorIdentity.length > 0) {
            // Fix the color identity syntax
            const colorString = colorIdentity.join('');
            // Use "identity" instead of "id" for color identity searches
            searchQuery += ` identity:${colorString}`;
        }
        
        const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(searchQuery)}&order=edhrec`);
        
        if (response.ok) {
            const data = await response.json();
            return data.data?.slice(0, limit) || [];
        }
        
        return [];
    } catch (error) {
        console.log('Card search failed:', error);
        return [];
    }
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Format selection and management
function selectFormat(formatCode) {
    if (formatRegistry[formatCode]) {
        currentFormat = formatCode;
        return formatRegistry[formatCode];
    }
    return null;
}

function getCurrentFormat() {
    return formatRegistry[currentFormat];
}

// Deck generation and validation
async function generateDeck(mainCard) {
    const format = getCurrentFormat();
    if (!format) {
        console.error("No format selected");
        // Use emergency fallback with a default format
        return await emergencyFallbackDeck(mainCard, { code: 'standard', minDeckSize: 60, maxCopies: 4 });
    }
    
    console.log(`Generating deck for ${format.name} format with card: ${mainCard.name}`);
    
    try {
        let deck = [];
        
        // Try the format-specific deck generation
        try {
            // Special case for Commander format
            if (format.code === 'commander') {
                console.log("Using Commander-specific deck generation");
                deck = await format.generateDeck(mainCard);
            } else {
                // For other formats, use the generic deck generation
                console.log(`Using generic deck generation for ${format.name}`);
                deck = await generateGenericDeck(mainCard, format);
            }
        } catch (formatError) {
            console.error(`Error in ${format.name} deck generation:`, formatError);
            // If format-specific generation fails, try emergency fallback
            deck = await emergencyFallbackDeck(mainCard, format);
        }
        
        // Validate the generated deck
        if (!deck || !Array.isArray(deck) || deck.length === 0) {
            console.error(`${format.name} deck generation returned invalid result:`, deck);
            // If we still don't have a valid deck, use emergency fallback
            deck = await emergencyFallbackDeck(mainCard, format);
        }
        
        console.log(`Successfully generated ${deck.length} card ${format.name} deck`);
        return deck;
    } catch (error) {
        console.error(`Error generating ${format.name} deck:`, error);
        // Last resort fallback
        return await emergencyFallbackDeck(mainCard, format);
    }
}

function validateDeck(deck) {
    const format = getCurrentFormat();
    if (!format) return ['Invalid format'];
    
    return format.validateDeck(deck);
}

// Combo finding
async function findCombos(cardName) {
    const format = getCurrentFormat();
    if (!format) return [];
    
    try {
        // Get card data
        const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`);
        if (!response.ok) return [];
        
        const card = await response.json();
        
        // Analyze card text and properties to find potential combos
        return await analyzeCardForCombos(card, format.code);
    } catch (error) {
        console.error('Error finding combos:', error);
        return [];
    }
}

// Analyze card for potential combos
async function analyzeCardForCombos(card, formatCode) {
    const combos = [];
    const cardName = card.name;
    const oracleText = card.oracle_text || '';
    const typeLine = card.type_line || '';
    const colorIdentity = card.color_identity || [];
    
    // Extract key mechanics and themes from the card
    const keywords = extractKeywords(oracleText, typeLine);
    
    // For each keyword/theme, search for potential combo pieces
    for (const keyword of keywords) {
        try {
            // Build a search query based on the keyword and format
            const query = `${keyword.searchTerm} format:${formatCode}`;
            
            // Search for potential combo pieces
            const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
            
            if (response.ok) {
                const data = await response.json();
                const potentialPieces = data.data || [];
                
                // Take the top 2 results as potential combo pieces
                const comboPieces = potentialPieces.slice(0, 2);
                
                if (comboPieces.length > 0) {
                    // Create a combo entry
                    combos.push({
                        cards: [cardName, ...comboPieces.map(piece => piece.name)],
                        result: keyword.result,
                        description: keyword.description.replace('{card}', cardName),
                        source: `${formatCode.charAt(0).toUpperCase() + formatCode.slice(1)} Synergy`
                    });
                }
            }
        } catch (error) {
            console.log(`Error finding combos for keyword ${keyword.searchTerm}:`, error);
        }
    }
    
    return combos;
}

// Extract keywords and themes from card text
function extractKeywords(oracleText, typeLine) {
    const keywords = [];
    
    // Check for mana production/untapping
    if (oracleText.includes('add') && (oracleText.includes('mana') || oracleText.includes('{T}'))) {
        keywords.push({
            searchTerm: 'o:"untap target" o:permanent',
            result: 'Potential infinite mana',
            description: 'Use {card} with untap effects to generate large amounts of mana'
        });
    }
    
    // Check for ETB effects
    if (oracleText.includes('enters the battlefield')) {
        keywords.push({
            searchTerm: 'o:"flicker" OR o:"blink" OR o:"exile target permanent" o:"return"',
            result: 'ETB value engine',
            description: 'Repeatedly trigger {card}\'s enter-the-battlefield effect'
        });
    }
    
    // Check for sacrifice effects
    if (oracleText.includes('sacrifice')) {
        keywords.push({
            searchTerm: 'o:"create token" o:sacrifice',
            result: 'Sacrifice synergy',
            description: 'Create a sacrifice engine with {card}'
        });
    }
    
    // Check for +1/+1 counters
    if (oracleText.includes('+1/+1 counter') || oracleText.includes('counters on')) {
        keywords.push({
            searchTerm: 'o:"double counters" OR o:"twice as many counters"',
            result: 'Counter multiplication',
            description: 'Multiply counters placed by {card} for exponential growth'
        });
    }
    
    // Check for card draw
    if (oracleText.includes('draw') && oracleText.includes('card')) {
        keywords.push({
            searchTerm: 'o:"whenever you draw" OR o:"draw an additional card"',
            result: 'Card draw engine',
            description: 'Create a powerful card draw engine with {card}'
        });
    }
    
    // Check for damage effects
    if (oracleText.includes('damage')) {
        keywords.push({
            searchTerm: 'o:"double damage" OR o:"damage can\'t be prevented"',
            result: 'Damage amplification',
            description: 'Amplify damage dealt by {card}'
        });
    }
    
    // Check for creature type synergies
    const creatureTypes = extractCreatureTypes(typeLine, oracleText);
    if (creatureTypes.length > 0) {
        keywords.push({
            searchTerm: `o:"${creatureTypes[0]} you control" o:get`,
            result: `${creatureTypes[0]} tribal synergy`,
            description: `Enhance your ${creatureTypes[0]}s including {card}`
        });
    }
    
    // Check for graveyard interactions
    if (oracleText.includes('graveyard') || oracleText.includes('dies')) {
        keywords.push({
            searchTerm: 'o:return o:graveyard o:battlefield',
            result: 'Recursion engine',
            description: 'Create a recursion loop with {card}'
        });
    }
    
    // If no specific keywords found, add a generic synergy
    if (keywords.length === 0) {
        if (typeLine.includes('Creature')) {
            keywords.push({
                searchTerm: 'o:"creatures you control" o:get',
                result: 'Creature enhancement',
                description: 'Enhance {card} and other creatures'
            });
        } else if (typeLine.includes('Instant') || typeLine.includes('Sorcery')) {
            keywords.push({
                searchTerm: 'o:"whenever you cast" o:instant o:sorcery',
                result: 'Spell synergy',
                description: 'Gain value when casting {card} and other spells'
            });
        } else if (typeLine.includes('Artifact')) {
            keywords.push({
                searchTerm: 'o:"whenever an artifact" o:enters',
                result: 'Artifact synergy',
                description: 'Create artifact synergies with {card}'
            });
        } else if (typeLine.includes('Enchantment')) {
            keywords.push({
                searchTerm: 'o:"whenever an enchantment" o:enters',
                result: 'Enchantment synergy',
                description: 'Create enchantment synergies with {card}'
            });
        } else if (typeLine.includes('Planeswalker')) {
            keywords.push({
                searchTerm: 'o:"planeswalker" o:loyalty',
                result: 'Planeswalker synergy',
                description: 'Enhance {card} and other planeswalkers'
            });
        } else if (typeLine.includes('Land')) {
            keywords.push({
                searchTerm: 'o:"additional land" OR o:"play additional lands"',
                result: 'Land synergy',
                description: 'Enhance land strategies with {card}'
            });
        }
    }
    
    return keywords;
}

// Extract creature types from type line
function extractCreatureTypes(typeLine, oracleText) {
    const creatureTypes = [];
    
    // Common creature types to check for
    const commonTypes = [
        'Human', 'Elf', 'Goblin', 'Zombie', 'Vampire', 'Dragon', 'Angel',
        'Merfolk', 'Wizard', 'Warrior', 'Knight', 'Cleric', 'Rogue', 'Druid',
        'Beast', 'Elemental', 'Spirit', 'Demon', 'Giant', 'Dwarf'
    ];
    
    // Check type line for creature types
    for (const type of commonTypes) {
        if (typeLine.includes(type)) {
            creatureTypes.push(type);
        }
    }
    
    // Check oracle text for "creature type is" or similar phrases
    for (const type of commonTypes) {
        if (oracleText.includes(`creature type is ${type}`) || 
            oracleText.includes(`creature types are ${type}`) ||
            oracleText.includes(`is every creature type`)) {
            if (!creatureTypes.includes(type)) {
                creatureTypes.push(type);
            }
        }
    }
    
    return creatureTypes;
}

// Budget settings
function setBudgetMode(enabled) {
    budgetMode = enabled;
}

function setBudgetLimit(limit) {
    budgetLimit = parseFloat(limit) || 50;
}

// Search functionality
async function searchDecks(query) {
    try {
        // This would connect to a database of saved decks
        // For now, we'll return a mock response
        return [
            { id: 1, name: 'Atraxa Superfriends', format: 'commander', commander: 'Atraxa, Praetors\' Voice', colors: ['W', 'U', 'B', 'G'] },
            { id: 2, name: 'Burn', format: 'modern', mainCard: 'Lightning Bolt', colors: ['R'] },
            { id: 3, name: 'Delver', format: 'legacy', mainCard: 'Delver of Secrets', colors: ['U', 'R'] }
        ].filter(deck => 
            deck.name.toLowerCase().includes(query.toLowerCase()) ||
            deck.commander?.toLowerCase().includes(query.toLowerCase()) ||
            deck.mainCard?.toLowerCase().includes(query.toLowerCase())
        );
    } catch (error) {
        console.error('Error searching decks:', error);
        return [];
    }
}

async function searchCombos(query) {
    try {
        // Search for combos across all formats
        const results = [];
        
        for (const formatKey in formatRegistry) {
            const format = formatRegistry[formatKey];
            
            try {
                const combos = await format.findCombos(query);
                
                if (combos && combos.length > 0) {
                    results.push({
                        format: format.name,
                        combos: combos
                    });
                }
            } catch (formatError) {
                console.error(`Error searching combos in ${format.name}:`, formatError);
            }
        }
        
        return results;
    } catch (error) {
        console.error('Error searching combos:', error);
        return [];
    }
}

// Initialize format registry after DOM is loaded
function initFormatRegistry() {
    console.log("Initializing format registry...");
    console.log("Available global format objects:", 
        Object.keys(window).filter(key => key.includes('Format')));
    
    // Access the format objects from the global scope
    if (window.commanderFormat) {
        formatRegistry.commander = window.commanderFormat;
        console.log("✅ Registered Commander format");
    } else {
        console.warn("❌ Commander format not found in global scope");
    }
    
    if (window.pauperFormat) {
        formatRegistry.pauper = window.pauperFormat;
        console.log("✅ Registered Pauper format");
    } else {
        console.warn("❌ Pauper format not found in global scope");
    }
    
    if (window.modernFormat) {
        formatRegistry.modern = window.modernFormat;
        console.log("✅ Registered Modern format");
    } else {
        console.warn("❌ Modern format not found in global scope");
    }
    
    if (window.legacyFormat) {
        formatRegistry.legacy = window.legacyFormat;
        console.log("✅ Registered Legacy format");
    } else {
        console.warn("❌ Legacy format not found in global scope");
    }
    
    if (window.standardFormat) {
        formatRegistry.standard = window.standardFormat;
        console.log("✅ Registered Standard format");
    } else {
        console.warn("❌ Standard format not found in global scope");
    }
    
    if (window.pioneerFormat) {
        formatRegistry.pioneer = window.pioneerFormat;
        console.log("✅ Registered Pioneer format");
    } else {
        console.warn("❌ Pioneer format not found in global scope");
    }
    
    // Log all registered formats
    console.log("Registered formats:", Object.keys(formatRegistry));
}
// Add these functions to formats.js

// Analyze card for potential Commander synergies
async function analyzeCardForCommanderSynergies(card, colorIdentity) {
    const synergies = [];
    const cardName = card.name;
    const oracleText = card.oracle_text || '';
    const typeLine = card.type_line || '';
    
    try {
        // Extract themes from the card
        const themes = extractCommanderThemes(oracleText, typeLine);
        
        // For each theme, find synergistic cards
        for (const theme of themes) {
            try {
                // Build a search query based on the theme and color identity
                let query = theme.searchTerm;
                
                // Add color identity restriction
                if (colorIdentity && colorIdentity.length > 0) {
                    const colorString = colorIdentity.join('');
                    query += ` identity<=${colorString}`;
                }
                
                // Add format legality
                query += ' legal:commander';
                
                // Search for synergistic cards
                const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
                
                if (response.ok) {
                    const data = await response.json();
                    const synergisticCards = data.data || [];
                    
                    // Take the top 2-3 results as synergistic cards
                    const themeCards = synergisticCards.slice(0, 3);
                    
                    if (themeCards.length > 0) {
                        // Create a synergy entry
                        synergies.push({
                            cards: [cardName, ...themeCards.map(card => card.name)],
                            result: theme.result,
                            description: theme.description.replace('{card}', cardName),
                            source: 'Commander Analysis'
                        });
                    }
                }
            } catch (error) {
                console.log(`Error finding synergies for theme ${theme.searchTerm}:`, error);
                // Continue with other themes even if one fails
            }
        }
    } catch (error) {
        console.error('Error extracting themes:', error);
        // Return a default synergy if theme extraction fails
        synergies.push({
            cards: [cardName, "Sol Ring", "Command Tower", "Arcane Signet"],
            result: "Commander staples",
            description: `Use ${cardName} with Commander staples for a solid foundation`,
            source: 'Commander Basics'
        });
    }
    
    // If no synergies found, add a default one
    if (synergies.length === 0) {
        synergies.push({
            cards: [cardName, "Sol Ring", "Command Tower", "Arcane Signet"],
            result: "Commander staples",
            description: `Use ${cardName} with Commander staples for a solid foundation`,
            source: 'Commander Basics'
        });
    }
    
    return synergies;
}

// Deck generation and validation
async function generateDeck(mainCard) {
    const format = getCurrentFormat();
    if (!format) {
        console.error("No format selected");
        return [];
    }
    
    console.log(`Generating deck for ${format.name} format with card: ${mainCard.name}`);
    
    try {
        // Special case for Commander format
        if (format.code === 'commander') {
            console.log("Using Commander-specific deck generation");
            return await format.generateDeck(mainCard);
        }
        
        // For other formats, use the generic deck generation
        if (typeof format.generateDeck === 'function') {
            return await format.generateDeck(mainCard);
        } else {
            return await generateGenericDeck(mainCard, format);
        }
    } catch (error) {
        console.error(`Error generating ${format.name} deck:`, error);
        return [];
    }
}

// Generic deck generation for any format
async function generateGenericDeck(mainCard, format) {
    console.log(`Using generic deck generation for ${format.name} with ${mainCard.name}`);
    
    // Ensure format has required properties
    if (!format.minDeckSize) {
        console.warn(`Format ${format.name} is missing minDeckSize property, defaulting to 60`);
        format.minDeckSize = 60;
    }
    
    if (!format.maxCopies) {
        console.warn(`Format ${format.name} is missing maxCopies property, defaulting to 4`);
        format.maxCopies = 4;
    }
    
    try {
        const deck = [];
        const colorIdentity = mainCard.color_identity || [];
        const cardType = getCardType(mainCard.type_line);
        const usedCardCounts = new Map(); // Track cards we've already added and their counts
        
        // Add the main card to the deck
        try {
            const mainCardWithPrice = {
                ...mainCard,
                type: cardType,
                price: (await getCardPrice(mainCard.name)).price
            };
            
            deck.push(mainCardWithPrice);
            usedCardCounts.set(mainCard.name, 1);
            
            console.log(`Added main card: ${mainCard.name}`);
        } catch (mainCardError) {
            console.error('Error adding main card:', mainCardError);
            // Continue even if adding the main card fails
        }
        
        // Determine deck size based on format
        const targetDeckSize = format.minDeckSize;
        
        // Determine max copies based on format
        const maxCopies = format.maxCopies;
        
        // Calculate card distribution
        const distribution = {
            Creature: Math.floor(targetDeckSize * 0.35),
            Instant: Math.floor(targetDeckSize * 0.10),
            Sorcery: Math.floor(targetDeckSize * 0.10),
            Artifact: Math.floor(targetDeckSize * 0.08),
            Enchantment: Math.floor(targetDeckSize * 0.07),
            Land: Math.floor(targetDeckSize * 0.30)
        };
        
        // Adjust for the main card
        if (distribution[cardType]) {
            distribution[cardType]--;
        }
        
        // Double-check total
        const totalCards = Object.values(distribution).reduce((sum, count) => sum + count, 0);
        if (totalCards !== targetDeckSize - 1) {
            console.warn(`Card distribution total is ${totalCards}, adjusting to ${targetDeckSize - 1}`);
            // Adjust land count to make total correct
            distribution.Land = (targetDeckSize - 1) - (totalCards - distribution.Land);
        }
        
        console.log("Card distribution:", distribution);
        
        // Add cards for each type
        for (const [type, count] of Object.entries(distribution)) {
            if (count <= 0) continue;
            
            console.log(`Adding ${count} ${type} cards`);
            
            try {
                if (type === 'Land') {
                    // Add lands
                    await addGenericLands(deck, colorIdentity, count, usedCardCounts, maxCopies, format);
                } else {
                    // Add other card types
                    await addGenericCardsByType(deck, type, colorIdentity, count, usedCardCounts, maxCopies, format);
                }
            } catch (typeError) {
                console.error(`Error adding ${type} cards:`, typeError);
                // Continue with other types even if one fails
            }
            
            console.log(`Deck now has ${deck.length} cards`);
        }
        
        // Ensure we have at least the minimum deck size
        if (deck.length < targetDeckSize) {
            console.log(`Need ${targetDeckSize - deck.length} more cards, adding lands`);
            try {
                await addGenericLands(deck, colorIdentity, targetDeckSize - deck.length, usedCardCounts, maxCopies, format);
            } catch (landError) {
                console.error('Error adding additional lands:', landError);
            }
        }
        
        // Final check - if we still don't have enough cards, add basic lands directly
        if (deck.length < targetDeckSize) {
            console.log(`Still need ${targetDeckSize - deck.length} more cards, adding basic lands directly`);
            try {
                await addFallbackBasicLands(deck, targetDeckSize - deck.length);
            } catch (basicLandError) {
                console.error('Error adding fallback basic lands:', basicLandError);
            }
        }
        
        // If we have too many cards, trim the deck
        if (deck.length > targetDeckSize) {
            console.log(`Deck has ${deck.length} cards, trimming to ${targetDeckSize}`);
            
            // Keep the main card and trim the rest
            const mainCard = deck[0];
            const otherCards = deck.slice(1);
            
            // Shuffle and take enough cards to make the target size
            const shuffled = shuffleArray(otherCards);
            deck.length = 0; // Clear the deck
            deck.push(mainCard); // Add main card back
            deck.push(...shuffled.slice(0, targetDeckSize - 1)); // Add remaining cards
        }
        
        console.log(`Generated ${deck.length} card ${format.name} deck`);
        
        if (deck.length === 0) {
            throw new Error(`Failed to generate any cards for ${format.name} deck`);
        }
        
        return deck;
    } catch (error) {
        console.error('Error in generic deck generation:', error);
        throw error;
    }
}

// Fallback function to add basic lands directly
async function addFallbackBasicLands(deck, count) {
    if (count <= 0) return;
    
    // Hardcoded Plains as a last resort
    const plainData = {
        name: "Plains",
        type_line: "Basic Land — Plains",
        oracle_text: "({T}: Add {W}.)",
        mana_cost: "",
        cmc: 0,
        colors: [],
        color_identity: ["W"],
        legalities: { standard: "legal", modern: "legal", legacy: "legal", commander: "legal" },
        set: "m21",
        set_name: "Core Set 2021",
        rarity: "common",
        image_uris: {
            small: "https://c1.scryfall.com/file/scryfall-cards/small/front/2/5/25eff27a-eb58-4a95-b2df-4a341cf9bef6.jpg?1598308261",
            normal: "https://c1.scryfall.com/file/scryfall-cards/normal/front/2/5/25eff27a-eb58-4a95-b2df-4a341cf9bef6.jpg?1598308261",
            large: "https://c1.scryfall.com/file/scryfall-cards/large/front/2/5/25eff27a-eb58-4a95-b2df-4a341cf9bef6.jpg?1598308261"
        }
    };
    
    for (let i = 0; i < count; i++) {
        deck.push({
            ...plainData,
            type: 'Basic Land',
            price: 0.1
        });
    }
    
    console.log(`Added ${count} fallback Plains`);
}

// Helper function to add lands to a generic deck
async function addGenericLands(deck, colorIdentity, count, usedCardCounts, maxCopies, format) {
    if (count <= 0) return;
    
    // Check if budget mode is enabled
    const budgetToggle = document.getElementById('budgetToggle');
    const budgetEnabled = budgetToggle && budgetToggle.textContent.includes('Disable');
    let budgetLimit = 50;
    
    if (budgetEnabled) {
        const budgetLimitInput = document.getElementById('budgetLimit');
        if (budgetLimitInput) {
            budgetLimit = parseFloat(budgetLimitInput.value) || 50;
        }
        console.log(`Budget mode active: Limiting lands to $${budgetLimit}`);
    }
    
    // Add basic lands (60% of lands)
    const basicLandCount = Math.floor(count * 0.6);
    await addGenericBasicLands(deck, colorIdentity, basicLandCount, usedCardCounts, maxCopies);
    
    // Add non-basic lands (40% of lands)
    const nonBasicLandCount = count - basicLandCount;
    if (nonBasicLandCount > 0) {
        try {
            let query = `type:land -type:basic format:${format.code}`;
            
            // Add color identity if available
            if (colorIdentity && colorIdentity.length > 0) {
                const colorQuery = colorIdentity.map(c => `color>=${c}`).join(' OR ');
                query += ` (${colorQuery})`;
            }
            
            // Add rarity restriction for formats like Pauper
            if (format.rarityRestriction) {
                query += ` rarity:${format.rarityRestriction}`;
            }
            
            // For non-Pauper formats, add price restriction to the query if budget mode is enabled
            if (budgetEnabled && format.code !== 'pauper') {
                query += ` usd<=${budgetLimit}`;
            }
            
            console.log(`Searching for non-basic lands with query: ${query}`);
            const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
            
            if (response.ok) {
                const data = await response.json();
                const lands = data.data || [];
                
                if (lands.length > 0) {
                    // Shuffle the lands to get variety
                    const shuffled = shuffleArray([...lands]);
                    let added = 0;
                    
                    // Add lands until we reach the desired count
                    for (const land of shuffled) {
                        // Check if we've already added this card
                        const currentCount = usedCardCounts.get(land.name) || 0;
                        
                        // Skip if we've reached the max copies (except for basic lands)
                        if (currentCount >= maxCopies && !isBasicLand(land.name)) continue;
                        
                        // Get land price
                        const price = parseFloat(land.prices?.usd || '0.50');
                        
                        // Double-check budget constraints
                        if (budgetEnabled && format.code !== 'pauper' && price > budgetLimit) {
                            console.log(`Skipping ${land.name} ($${price}) - exceeds budget limit of $${budgetLimit}`);
                            continue;
                        }
                        
                        // Skip banned lands
                        if (format.bannedCards && format.bannedCards.includes(land.name)) continue;
                        
                        // Add the land to the deck
                        deck.push({
                            ...land,
                            type: 'Land',
                            price: price
                        });
                        
                        // Update the count
                        usedCardCounts.set(land.name, currentCount + 1);
                        added++;
                        
                        if (added >= nonBasicLandCount) break;
                    }
                    
                    console.log(`Added ${added} non-basic lands`);
                } else {
                    console.log("No non-basic lands found with budget constraints. Trying without budget limit...");
                    
                    // Try a query without budget constraints as fallback
                    let fallbackQuery = `type:land -type:basic format:${format.code}`;
                    
                    if (colorIdentity && colorIdentity.length > 0) {
                        const colorQuery = colorIdentity.map(c => `color>=${c}`).join(' OR ');
                        fallbackQuery += ` (${colorQuery})`;
                    }
                    
                    if (format.rarityRestriction) {
                        fallbackQuery += ` rarity:${format.rarityRestriction}`;
                    }
                    
                    const fallbackResponse = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(fallbackQuery)}&order=edhrec`);
                    
                    if (fallbackResponse.ok) {
                        const fallbackData = await fallbackResponse.json();
                        if (fallbackData.data && fallbackData.data.length > 0) {
                            // Process these lands with manual budget filtering
                            const shuffled = shuffleArray([...fallbackData.data]);
                            let added = 0;
                            let skippedDueToBudget = 0;
                            
                            for (const land of shuffled) {
                                // Check if we've already added this card
                                const currentCount = usedCardCounts.get(land.name) || 0;
                                
                                // Skip if we've reached the max copies (except for basic lands)
                                if (currentCount >= maxCopies && !isBasicLand(land.name)) continue;
                                
                                // Get land price
                                const price = parseFloat(land.prices?.usd || '0.50');
                                
                                // Skip banned lands
                                if (format.bannedCards && format.bannedCards.includes(land.name)) continue;
                                
                                // Apply budget check manually
                                if (budgetEnabled && format.code !== 'pauper' && price > budgetLimit) {
                                    skippedDueToBudget++;
                                    continue;
                                }
                                
                                // Add the land to the deck
                                deck.push({
                                    ...land,
                                    type: 'Land',
                                    price: price
                                });
                                
                                // Update the count
                                usedCardCounts.set(land.name, currentCount + 1);
                                added++;
                                
                                if (added >= nonBasicLandCount) break;
                            }
                            
                            console.log(`Added ${added} non-basic lands (skipped ${skippedDueToBudget} due to budget constraints)`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error adding non-basic lands:`, error);
        }
    }
    
    // If we still need more lands, add basic lands
    const remainingLands = count - (deck.length - (deck.length - count + basicLandCount));
    if (remainingLands > 0) {
        await addGenericBasicLands(deck, colorIdentity, remainingLands, usedCardCounts, maxCopies);
    }
}

// Helper function to add basic lands to a generic deck
async function addGenericBasicLands(deck, colorIdentity, count, usedCardCounts, maxCopies) {
    if (count <= 0) return;
    
    // Default to adding Plains if no color identity
    if (!colorIdentity || colorIdentity.length === 0) {
        colorIdentity = ['W'];
    }
    
    // Map colors to basic land types
    const landTypes = {
        'W': 'Plains',
        'U': 'Island',
        'B': 'Swamp',
        'R': 'Mountain',
        'G': 'Forest'
    };
    
    // Calculate how many of each basic land to add
    const landsPerColor = Math.ceil(count / colorIdentity.length);
    let landsAdded = 0;
    
    // Add basic lands
    for (const color of colorIdentity) {
        if (landsAdded >= count) break;
        
        const landType = landTypes[color] || 'Plains';
        
        try {
            const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(landType)}`);
            
            if (response.ok) {
                const landData = await response.json();
                
                // Basic lands are exempt from the copy limit
                // Add multiple copies of this basic land
                const landsToAdd = Math.min(landsPerColor, count - landsAdded);
                
                for (let i = 0; i < landsToAdd; i++) {
                    deck.push({
                        ...landData,
                        type: 'Basic Land', // Make sure type is set to 'Basic Land'
                        price: 0.1
                    });
                    landsAdded++;
                }
                
                console.log(`Added ${landsToAdd} ${landType}`);
            }
        } catch (error) {
            console.error(`Error adding basic land ${landType}:`, error);
        }
    }
}

// Helper function to add cards by type to a generic deck
async function addGenericCardsByType(deck, cardType, colorIdentity, count, usedCardCounts, maxCopies, format) {
    if (count <= 0) return;
    
    try {
        // Check if budget mode is enabled
        const budgetToggle = document.getElementById('budgetToggle');
        const budgetEnabled = budgetToggle && budgetToggle.textContent.includes('Disable');
        let budgetLimit = 50;
        
        if (budgetEnabled) {
            const budgetLimitInput = document.getElementById('budgetLimit');
            if (budgetLimitInput) {
                budgetLimit = parseFloat(budgetLimitInput.value) || 50;
            }
            console.log(`Budget mode active: Limiting ${cardType} cards to $${budgetLimit}`);
        }
        
        // Build query for this card type
        let query = `type:${cardType.toLowerCase()} format:${format.code}`;
        
        // Add color identity if available
        if (colorIdentity && colorIdentity.length > 0) {
            const colorQuery = colorIdentity.map(c => `color>=${c}`).join(' OR ');
            query += ` (${colorQuery})`;
        }
        
        // Add rarity restriction for formats like Pauper
        if (format.rarityRestriction) {
            query += ` rarity:${format.rarityRestriction}`;
        }
        
        // For all formats except Pauper, add price restriction to the query if budget mode is enabled
        if (budgetEnabled && format.code !== 'pauper') {
            query += ` usd<=${budgetLimit}`;
        }
        
        console.log(`Searching for ${cardType} cards with query: ${query}`);
        const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
        
        if (response.ok) {
            const data = await response.json();
            const cards = data.data || [];
            
            if (cards.length === 0) {
                console.log(`No ${cardType} cards found with budget constraints. Trying without budget limit...`);
                
                // Try a query without budget constraints as fallback
                let fallbackQuery = `type:${cardType.toLowerCase()} format:${format.code}`;
                
                if (colorIdentity && colorIdentity.length > 0) {
                    const colorQuery = colorIdentity.map(c => `color>=${c}`).join(' OR ');
                    fallbackQuery += ` (${colorQuery})`;
                }
                
                if (format.rarityRestriction) {
                    fallbackQuery += ` rarity:${format.rarityRestriction}`;
                }
                
                const fallbackResponse = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(fallbackQuery)}&order=edhrec`);
                
                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    if (fallbackData.data && fallbackData.data.length > 0) {
                        console.log(`Found ${fallbackData.data.length} cards without budget constraints`);
                        
                        // Process these cards with manual budget filtering
                        const shuffled = shuffleArray([...fallbackData.data]);
                        let added = 0;
                        let skippedDueToBudget = 0;
                        
                        for (const card of shuffled) {
                            // Check if we've already added this card
                            const currentCount = usedCardCounts.get(card.name) || 0;
                            
                            // Skip if we've reached the max copies (except for basic lands)
                            if (currentCount >= maxCopies && !window.isBasicLand(card)) continue;
                            
                            // Get card price
                            const price = parseFloat(card.prices?.usd || '0.50');
                            
                            // Skip banned cards
                            if (format.bannedCards && format.bannedCards.includes(card.name)) continue;
                            
                            // Apply budget check manually
                            if (budgetEnabled && format.code !== 'pauper' && price > budgetLimit) {
                                skippedDueToBudget++;
                                continue;
                            }
                            
                            // Add the card to the deck
                            const type = getCardType(card.type_line);
                            
                            deck.push({
                                ...card,
                                type: type,
                                price: price
                            });
                            
                            // Update the count
                            usedCardCounts.set(card.name, currentCount + 1);
                            added++;
                            
                            // For non-singleton formats, add multiple copies if needed
                            if (maxCopies > 1 && added < count && format.code !== 'commander' && !window.isBasicLand(card)) {
                                const additionalCopies = Math.min(
                                    maxCopies - currentCount - 1, // Don't exceed max copies
                                    Math.floor(Math.random() * 3), // Random 0-2 additional copies
                                    count - added // Don't exceed requested count
                                );
                                
                                for (let i = 0; i < additionalCopies; i++) {
                                    deck.push({
                                        ...card,
                                        type: type,
                                        price: price
                                    });
                                    added++;
                                }
                                
                                // Update the count
                                usedCardCounts.set(card.name, currentCount + 1 + additionalCopies);
                            }
                            
                            if (added >= count) break;
                        }
                        
                        console.log(`Added ${added} ${cardType} cards (skipped ${skippedDueToBudget} due to budget constraints)`);
                        return;
                    }
                }
            }
            
            // Shuffle the cards to get variety
            const shuffled = shuffleArray([...cards]);
            let added = 0;
            
            // Add cards until we reach the desired count
            for (const card of shuffled) {
                // Check if we've already added this card
                const currentCount = usedCardCounts.get(card.name) || 0;
                
                // Skip if we've reached the max copies (except for basic lands)
                if (currentCount >= maxCopies && !window.isBasicLand(card)) continue;
                
                // Get card price
                const price = parseFloat(card.prices?.usd || '0.50');
                
                // Double-check budget constraints
                if (budgetEnabled && format.code !== 'pauper' && price > budgetLimit) {
                    console.log(`Skipping ${card.name} ($${price}) - exceeds budget limit of $${budgetLimit}`);
                    continue;
                }
                
                // Skip banned cards
                if (format.bannedCards && format.bannedCards.includes(card.name)) continue;
                
                // Add the card to the deck
                const type = getCardType(card.type_line);
                
                // Special handling for basic lands
                const finalType = card.type_line && card.type_line.includes('Basic Land') ? 'Basic Land' : type;
                
                deck.push({
                    ...card,
                    type: finalType,
                    price: price
                });
                
                // Update the count
                usedCardCounts.set(card.name, currentCount + 1);
                added++;
                
                // For non-singleton formats, add multiple copies if needed
                if (maxCopies > 1 && added < count && format.code !== 'commander' && !window.isBasicLand(card)) {
                    const additionalCopies = Math.min(
                        maxCopies - currentCount - 1, // Don't exceed max copies
                        Math.floor(Math.random() * 3), // Random 0-2 additional copies
                        count - added // Don't exceed requested count
                    );
                    
                    for (let i = 0; i < additionalCopies; i++) {
                        deck.push({
                            ...card,
                            type: finalType,
                            price: price
                        });
                        added++;
                    }
                    
                    // Update the count
                    usedCardCounts.set(card.name, currentCount + 1 + additionalCopies);
                }
                
                if (added >= count) break;
            }
            
            console.log(`Added ${added} ${cardType} cards`);
        } else {
            console.error(`Error searching for ${cardType} cards:`, response.status);
        }
    } catch (error) {
        console.error(`Error adding ${cardType} cards:`, error);
    }
}

// Helper function to check if a card is a basic land
function isBasicLand(card) {
    if (!card) return false;
    
    // If we have the full card object
    if (typeof card === 'object') {
        // Check the type line if available
        if (card.type_line && card.type_line.includes('Basic Land')) {
            return true;
        }
        
        // Check the type property if available
        if (card.type && (card.type === 'Basic Land' || card.type.includes('Basic Land'))) {
            return true;
        }
        
        // Fall back to checking the name
        if (card.name) {
            return isBasicLandName(card.name);
        }
        
        return false;
    }
    
    // If we just have the card name
    if (typeof card === 'string') {
        return isBasicLandName(card);
    }
    
    return false;
}

// Add this to formats.js
// Global helper function to check if a card is a basic land
window.isBasicLand = function(card) {
    // If we have a card object
    if (typeof card === 'object' && card !== null) {
        // Check the type directly
        if (card.type === 'Basic Land') {
            return true;
        }
        
        // Check the type_line if available
        if (card.type_line && card.type_line.includes('Basic Land')) {
            return true;
        }
        
        // Check the name
        if (card.name) {
            return window.isBasicLandName(card.name);
        }
        
        return false;
    }
    
    // If we just have a string (card name)
    if (typeof card === 'string') {
        return window.isBasicLandName(card);
    }
    
    return false;
};

// Helper function to check if a card name is a basic land
window.isBasicLandName = function(cardName) {
    if (!cardName) return false;
    
    const basicLandNames = [
        'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
        'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 
        'Snow-Covered Mountain', 'Snow-Covered Forest'
    ];
    
    // Check if the card name exactly matches or contains one of the basic land names
    return basicLandNames.some(name => 
        cardName === name || 
        cardName.includes(name) || 
        (typeof cardName === 'string' && cardName.toLowerCase().includes(name.toLowerCase()))
    );
};

// Helper function to check if a card name is a basic land
function isBasicLandName(cardName) {
    if (!cardName) return false;
    
    const basicLandNames = [
        'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
        'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 
        'Snow-Covered Mountain', 'Snow-Covered Forest'
    ];
    
    // Check if the card name exactly matches or contains one of the basic land names
    return basicLandNames.some(name => 
        cardName === name || 
        cardName.includes(name) || 
        (cardName.toLowerCase && cardName.toLowerCase().includes(name.toLowerCase()))
    );
}


// Helper function to add basic lands
async function addBasicLands(deck, colorIdentity, count, usedCardNames, maxCopies) {
    if (count <= 0) return;
    
    // Default to adding Plains if no color identity
    if (!colorIdentity || colorIdentity.length === 0) {
        colorIdentity = ['W'];
    }
    
    // Map colors to basic land types
    const landTypes = {
        'W': 'Plains',
        'U': 'Island',
        'B': 'Swamp',
        'R': 'Mountain',
        'G': 'Forest'
    };
    
    // Calculate how many of each basic land to add
    const landsPerColor = Math.ceil(count / colorIdentity.length);
    let landsAdded = 0;
    
    // Add basic lands
    for (const color of colorIdentity) {
        if (landsAdded >= count) break;
        
        const landType = landTypes[color] || 'Plains';
        
        try {
            const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(landType)}`);
            
            if (response.ok) {
                const landData = await response.json();
                
                // Basic lands are exempt from the copy limit
                // Add multiple copies of this basic land
                for (let i = 0; i < landsPerColor && landsAdded < count; i++) {
                    deck.push({
                        ...landData,
                        type: 'Basic Land',
                        price: 0.1
                    });
                    
                    // Update the count in usedCardNames
                    const currentCount = usedCardNames.get(landData.name) || 0;
                    usedCardNames.set(landData.name, currentCount + 1);
                    
                    landsAdded++;
                }
                
                console.log(`Added ${Math.min(landsPerColor, count - (landsAdded - Math.min(landsPerColor, count - landsAdded)))} ${landType}`);
            }
        } catch (error) {
            console.error(`Error adding basic land ${landType}:`, error);
        }
    }
}

// Helper function to add cards of a specific type
async function addCardsOfType(deck, query, count, maxCopies, usedCardNames) {
    if (count <= 0) return;
    
    try {
        console.log(`Searching for cards with query: ${query}`);
        const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
        
        if (response.ok) {
            const data = await response.json();
            const cards = data.data || [];
            
            if (cards.length === 0) {
                console.log(`No cards found for query: ${query}`);
                return;
            }
            
            // Shuffle the cards to get variety
            const shuffled = shuffleArray([...cards]);
            let added = 0;
            
            // Add cards until we reach the desired count
            for (const card of shuffled) {
                // Check if we've already added this card
                const currentCount = usedCardNames.get(card.name) || 0;
                
                // Skip if we've reached the max copies
                if (currentCount >= maxCopies) continue;
                
                // Skip cards that are too expensive (over $50)
                const price = parseFloat(card.prices?.usd || '0.50');
                if (price > 50) continue;
                
                // Add the card to the deck
                const cardType = getCardType(card.type_line);
                
                deck.push({
                    ...card,
                    type: cardType,
                    price: price
                });
                
                // Update the count in usedCardNames
                usedCardNames.set(card.name, currentCount + 1);
                added++;
                
                // For non-singleton formats, add multiple copies if needed
                if (maxCopies > 1 && added < count) {
                    const additionalCopies = Math.min(
                        maxCopies - currentCount - 1, // Don't exceed max copies
                        Math.floor(Math.random() * 3), // Random 0-2 additional copies
                        count - added // Don't exceed requested count
                    );
                    
                    for (let i = 0; i < additionalCopies; i++) {
                        deck.push({
                            ...card,
                            type: cardType,
                            price: price
                        });
                        added++;
                    }
                    
                    // Update the count in usedCardNames
                    usedCardNames.set(card.name, currentCount + 1 + additionalCopies);
                }
                
                if (added >= count) break;
            }
            
            console.log(`Added ${added} cards for query: ${query}`);
        } else {
            console.error(`Error searching for cards with query ${query}:`, response.status);
        }
    } catch (error) {
        console.error(`Error adding cards of type ${query}:`, error);
    }
}

// Helper function to add cards of a specific type
async function addCardsOfType(deck, query, count, maxCopies, usedCardNames) {
    if (count <= 0) return;
    
    try {
        console.log(`Searching for cards with query: ${query}`);
        const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
        
        if (response.ok) {
            const data = await response.json();
            const cards = data.data || [];
            
            if (cards.length === 0) {
                console.log(`No cards found for query: ${query}`);
                return;
            }
            
            // Shuffle the cards to get variety
            const shuffled = shuffleArray([...cards]);
            let added = 0;
            
            // Add cards until we reach the desired count
            for (const card of shuffled) {
                // Skip cards we've already used
                if (usedCardNames.has(card.name)) continue;
                
                // Skip cards that are too expensive (over $50)
                const price = parseFloat(card.prices?.usd || '0.50');
                if (price > 50) continue;
                
                // Add the card to the deck
                const cardType = getCardType(card.type_line);
                
                deck.push({
                    ...card,
                    type: cardType,
                    price: price
                });
                
                usedCardNames.add(card.name);
                added++;
                
                // For non-singleton formats, add multiple copies
                if (maxCopies > 1) {
                    const copies = Math.min(maxCopies, Math.ceil(Math.random() * 3)); // Random 1-3 copies, up to max
                    
                    for (let i = 1; i < copies && added < count; i++) {
                        deck.push({
                            ...card,
                            type: cardType,
                            price: price
                        });
                        added++;
                    }
                }
                
                if (added >= count) break;
            }
            
            console.log(`Added ${added} cards for query: ${query}`);
        } else {
            console.error(`Error searching for cards with query ${query}:`, response.status);
        }
    } catch (error) {
        console.error(`Error adding cards of type ${query}:`, error);
    }
}

// Fill a category of cards in the deck
async function fillCategory(deck, category, count, format, colorIdentity, baseQuery) {
    try {
        // Skip if we already have enough cards
        const existingCount = deck.filter(card => card.type === category).length;
        if (existingCount >= count) return;
        
        // Build query for this category
        let query = `${baseQuery} t:${category}`;
        
        // For lands, prioritize appropriate colors
        if (category === 'Land') {
            if (colorIdentity && colorIdentity.length > 0) {
                // Add basic lands of the right colors
                for (const color of colorIdentity) {
                    const basicLandType = getBasicLandType(color);
                    if (basicLandType) {
                        const response = await fetch(`https://api.scryfall.com/cards/named?exact=${basicLandType}`);
                        
                        if (response.ok) {
                            const landData = await response.json();
                            
                            // Add multiple copies of basic lands
                            const basicCount = Math.ceil((count - existingCount) / colorIdentity.length);
                            
                            for (let i = 0; i < basicCount; i++) {
                                deck.push({
                                    ...landData,
                                    type: 'Basic Land',
                                    price: 0.1
                                });
                                
                                if (deck.filter(card => card.type === category).length >= count) {
                                    return;
                                }
                            }
                        }
                    }
                }
                
                // Add dual lands if we need more
                if (colorIdentity.length > 1) {
                    query += ' o:"add {';
                    for (const color of colorIdentity) {
                        query += color;
                    }
                    query += '}"';
                }
            } else {
                // Add basic lands for colorless decks
                const response = await fetch(`https://api.scryfall.com/cards/named?exact=Wastes`);
                
                if (response.ok) {
                    const landData = await response.json();
                    
                    for (let i = 0; i < count - existingCount; i++) {
                        deck.push({
                            ...landData,
                            type: 'Basic Land',
                            price: 0.1
                        });
                    }
                    
                    return;
                }
            }
        }
        
        // Search for cards in this category
        const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=edhrec`);
        
        if (response.ok) {
            const data = await response.json();
            const cards = data.data || [];
            
            // Shuffle the cards to get variety
            const shuffled = shuffleArray(cards);
            
            // Add cards until we reach the desired count
            for (const card of shuffled) {
                // Skip cards already in the deck
                if (deck.some(c => c.name === card.name)) continue;
                
                const cardType = getCardType(card.type_line);
                const price = (await getCardPrice(card.name)).price;
                
                deck.push({
                    ...card,
                    type: cardType,
                    price: price
                });
                
                if (deck.filter(c => c.type === category).length >= count) {
                    break;
                }
            }
        }
    } catch (error) {
        console.log(`Error filling ${category} category:`, error);
    }
}

// Get basic land type for a color
function getBasicLandType(color) {
    switch (color) {
        case 'W': return 'Plains';
        case 'U': return 'Island';
        case 'B': return 'Swamp';
        case 'R': return 'Mountain';
        case 'G': return 'Forest';
        default: return 'Wastes';
    }
}

// Emergency fallback deck generation
async function emergencyFallbackDeck(mainCard, format) {
    console.log("Using emergency fallback deck generation");
    
    const deck = [];
    
    // Add the main card
    deck.push({
        ...mainCard,
        type: getCardType(mainCard.type_line),
        price: 1.0
    });
    
    // Determine deck size
    const targetSize = format.minDeckSize || 60;
    
    // Add basic lands to fill the deck
    const basicLands = [
        {
            name: "Plains",
            type_line: "Basic Land — Plains",
            oracle_text: "({T}: Add {W}.)",
            mana_cost: "",
            cmc: 0,
            colors: [],
            color_identity: ["W"],
            legalities: { standard: "legal", modern: "legal", legacy: "legal", commander: "legal" },
            set: "m21",
            set_name: "Core Set 2021",
            rarity: "common",
            image_uris: {
                small: "https://c1.scryfall.com/file/scryfall-cards/small/front/2/5/25eff27a-eb58-4a95-b2df-4a341cf9bef6.jpg?1598308261",
                normal: "https://c1.scryfall.com/file/scryfall-cards/normal/front/2/5/25eff27a-eb58-4a95-b2df-4a341cf9bef6.jpg?1598308261",
                large: "https://c1.scryfall.com/file/scryfall-cards/large/front/2/5/25eff27a-eb58-4a95-b2df-4a341cf9bef6.jpg?1598308261"
            }
        },
        {
            name: "Island",
            type_line: "Basic Land — Island",
            oracle_text: "({T}: Add {U}.)",
            mana_cost: "",
            cmc: 0,
            colors: [],
            color_identity: ["U"],
            legalities: { standard: "legal", modern: "legal", legacy: "legal", commander: "legal" },
            set: "m21",
            set_name: "Core Set 2021",
            rarity: "common",
            image_uris: {
                small: "https://c1.scryfall.com/file/scryfall-cards/small/front/7/a/7a8550f5-cf3c-4061-8010-74b3d8709c68.jpg?1597375429",
                normal: "https://c1.scryfall.com/file/scryfall-cards/normal/front/7/a/7a8550f5-cf3c-4061-8010-74b3d8709c68.jpg?1597375429",
                large: "https://c1.scryfall.com/file/scryfall-cards/large/front/7/a/7a8550f5-cf3c-4061-8010-74b3d8709c68.jpg?1597375429"
            }
        },
        {
            name: "Swamp",
            type_line: "Basic Land — Swamp",
            oracle_text: "({T}: Add {B}.)",
            mana_cost: "",
            cmc: 0,
            colors: [],
            color_identity: ["B"],
            legalities: { standard: "legal", modern: "legal", legacy: "legal", commander: "legal" },
            set: "m21",
            set_name: "Core Set 2021",
            rarity: "common",
            image_uris: {
                small: "https://c1.scryfall.com/file/scryfall-cards/small/front/6/6/66bb5192-58bc-4efe-a145-2e804fd3483d.jpg?1597375472",
                normal: "https://c1.scryfall.com/file/scryfall-cards/normal/front/6/6/66bb5192-58bc-4efe-a145-2e804fd3483d.jpg?1597375472",
                large: "https://c1.scryfall.com/file/scryfall-cards/large/front/6/6/66bb5192-58bc-4efe-a145-2e804fd3483d.jpg?1597375472"
            }
        },
        {
            name: "Mountain",
            type_line: "Basic Land — Mountain",
            oracle_text: "({T}: Add {R}.)",
            mana_cost: "",
            cmc: 0,
            colors: [],
            color_identity: ["R"],
            legalities: { standard: "legal", modern: "legal", legacy: "legal", commander: "legal" },
            set: "m21",
            set_name: "Core Set 2021",
            rarity: "common",
            image_uris: {
                small: "https://c1.scryfall.com/file/scryfall-cards/small/front/3/3/330e5230-7c5a-4720-b582-1087e5aa0cf8.jpg?1597375432",
                normal: "https://c1.scryfall.com/file/scryfall-cards/normal/front/3/3/330e5230-7c5a-4720-b582-1087e5aa0cf8.jpg?1597375432",
                large: "https://c1.scryfall.com/file/scryfall-cards/large/front/3/3/330e5230-7c5a-4720-b582-1087e5aa0cf8.jpg?1597375432"
            }
        },
        {
            name: "Forest",
            type_line: "Basic Land — Forest",
            oracle_text: "({T}: Add {G}.)",
            mana_cost: "",
            cmc: 0,
            colors: [],
            color_identity: ["G"],
            legalities: { standard: "legal", modern: "legal", legacy: "legal", commander: "legal" },
            set: "m21",
            set_name: "Core Set 2021",
            rarity: "common",
            image_uris: {
                small: "https://c1.scryfall.com/file/scryfall-cards/small/front/a/6/a6712361-976a-4ef9-bae9-48505344904e.jpg?1597375431",
                normal: "https://c1.scryfall.com/file/scryfall-cards/normal/front/a/6/a6712361-976a-4ef9-bae9-48505344904e.jpg?1597375431",
                large: "https://c1.scryfall.com/file/scryfall-cards/large/front/a/6/a6712361-976a-4ef9-bae9-48505344904e.jpg?1597375431"
            }
        }
    ];
    
    // Get color identity of main card
    const colorIdentity = mainCard.color_identity || [];
    
    // If no color identity, default to all colors
    const landsToUse = colorIdentity.length > 0 
        ? basicLands.filter(land => colorIdentity.some(color => land.color_identity.includes(color)))
        : basicLands;
    
    // If no matching lands, use all lands
    const finalLandsToUse = landsToUse.length > 0 ? landsToUse : basicLands;
    
    // Add lands to fill the deck
    const landsNeeded = targetSize - deck.length;
    const landsPerType = Math.ceil(landsNeeded / finalLandsToUse.length);
    
    for (const land of finalLandsToUse) {
        for (let i = 0; i < landsPerType && deck.length < targetSize; i++) {
            deck.push({
                ...land,
                type: 'Basic Land',
                price: 0.1
            });
        }
    }
    
    // Special case for Commander - ensure we have exactly 100 cards
    if (format.code === 'commander' && deck.length !== 100) {
        // If we have too many cards, trim down
        if (deck.length > 100) {
            deck.splice(100); // Keep only the first 100 cards
        }
        
        // If we have too few cards, add more Plains
        while (deck.length < 100) {
            deck.push({
                ...basicLands[0], // Plains
                type: 'Basic Land',
                price: 0.1
            });
        }
        
        // Ensure the main card is marked as Commander
        if (deck[0]) {
            deck[0].type = 'Commander';
        }
    }
    
    console.log(`Emergency fallback generated ${deck.length} card deck`);
    return deck;
}

// Add this function to formats.js

// Extract Commander themes from card text
function extractCommanderThemes(oracleText, typeLine) {
    const themes = [];
    const lowercaseText = oracleText.toLowerCase();
    
    // Theme: Card advantage
    if (lowercaseText.includes('draw') || lowercaseText.includes('search your library')) {
        themes.push({
            searchTerm: 'o:"whenever you draw" OR o:"draw additional" OR o:"card draw"',
            result: 'Card advantage engine',
            description: 'Build a card advantage engine around {card} to keep your hand full'
        });
    }
    
    // Theme: Tokens
    if (lowercaseText.includes('create') && (lowercaseText.includes('token') || lowercaseText.includes('tokens'))) {
        themes.push({
            searchTerm: 'o:"whenever a creature enters" OR o:"populate" OR o:"token" o:"tokens"',
            result: 'Token strategy',
            description: 'Generate value from tokens with {card}'
        });
    }
    
    // Theme: Lifegain
    if (lowercaseText.includes('gain') && lowercaseText.includes('life')) {
        themes.push({
            searchTerm: 'o:"whenever you gain life" OR o:"life gain" OR o:"pay life"',
            result: 'Lifegain synergy',
            description: 'Use {card} in a lifegain strategy'
        });
    }
    
    // Theme: Graveyard
    if (lowercaseText.includes('graveyard') || lowercaseText.includes('dies') || lowercaseText.includes('discard')) {
        themes.push({
            searchTerm: 'o:"from your graveyard" OR o:"return target" o:"graveyard"',
            result: 'Graveyard recursion',
            description: 'Utilize your graveyard as a resource with {card}'
        });
    }
    
    // Theme: +1/+1 counters
    if (lowercaseText.includes('+1/+1') || lowercaseText.includes('counter') || lowercaseText.includes('counters')) {
        themes.push({
            searchTerm: 'o:"+1/+1 counter" OR o:"counters on"',
            result: 'Counter synergy',
            description: 'Build around counters with {card}'
        });
    }
    
    // Theme: Tribal
    const tribes = extractTribes(typeLine, oracleText);
    if (tribes.length > 0) {
        themes.push({
            searchTerm: `t:${tribes[0]} o:"${tribes[0]}"`,
            result: `${tribes[0]} tribal`,
            description: `Build a ${tribes[0]} tribal deck with {card}`
        });
    }
    
    // Theme: Landfall
    if (lowercaseText.includes('land') && (lowercaseText.includes('enters') || lowercaseText.includes('play'))) {
        themes.push({
            searchTerm: 'o:"landfall" OR o:"whenever a land enters"',
            result: 'Landfall triggers',
            description: 'Trigger abilities when lands enter with {card}'
        });
    }
    
    // Theme: Spellslinger
    if (lowercaseText.includes('instant') || lowercaseText.includes('sorcery') || 
        typeLine.toLowerCase().includes('instant') || typeLine.toLowerCase().includes('sorcery')) {
        themes.push({
            searchTerm: 'o:"whenever you cast" o:"instant" OR o:"sorcery"',
            result: 'Spellslinger synergy',
            description: 'Cast lots of spells for value with {card}'
        });
    }
    
    // Theme: Artifacts
    if (lowercaseText.includes('artifact') || typeLine.toLowerCase().includes('artifact')) {
        themes.push({
            searchTerm: 'o:"artifact you control" OR o:"whenever an artifact"',
            result: 'Artifact synergy',
            description: 'Build an artifact-focused strategy with {card}'
        });
    }
    
    // Theme: Enchantments
    if (lowercaseText.includes('enchantment') || typeLine.toLowerCase().includes('enchantment')) {
        themes.push({
            searchTerm: 'o:"enchantment you control" OR o:"whenever an enchantment"',
            result: 'Enchantment synergy',
            description: 'Build an enchantment-focused strategy with {card}'
        });
    }
    
    // Theme: Sacrifice
    if (lowercaseText.includes('sacrifice')) {
        themes.push({
            searchTerm: 'o:"sacrifice a" OR o:"whenever a creature dies"',
            result: 'Sacrifice synergy',
            description: 'Create a sacrifice engine with {card}'
        });
    }
    
    // Theme: Combat
    if (lowercaseText.includes('attack') || lowercaseText.includes('combat')) {
        themes.push({
            searchTerm: 'o:"whenever a creature attacks" OR o:"combat damage"',
            result: 'Combat strategy',
            description: 'Focus on combat with {card}'
        });
    }
    
    // Theme: Politics
    if (lowercaseText.includes('opponent') && (lowercaseText.includes('choose') || lowercaseText.includes('may'))) {
        themes.push({
            searchTerm: 'o:"each opponent" OR o:"target opponent" o:"choose"',
            result: 'Political strategy',
            description: 'Use {card} in a political/multiplayer strategy'
        });
    }
    
    // If no specific themes found, add generic commander value
    if (themes.length === 0) {
        if (typeLine.includes('Creature')) {
            themes.push({
                searchTerm: 'o:"commander" o:"creature"',
                result: 'Commander value',
                description: 'Use {card} for general commander value'
            });
        } else {
            themes.push({
                searchTerm: 'o:"commander" o:"cast"',
                result: 'Commander support',
                description: 'Support your commander strategy with {card}'
            });
        }
    }
    
    return themes;
}

// Extract tribes from type line and oracle text
function extractTribes(typeLine, oracleText) {
    const tribes = [];
    
    // Common creature types in Commander
    const commonTribes = [
        'Dragon', 'Zombie', 'Elf', 'Goblin', 'Human', 'Angel', 'Demon', 'Vampire',
        'Wizard', 'Warrior', 'Knight', 'Cleric', 'Rogue', 'Druid', 'Merfolk',
        'Beast', 'Elemental', 'Spirit', 'Giant', 'Dinosaur', 'Cat', 'Dog'
    ];
    
    // Check type line for tribes
    for (const tribe of commonTribes) {
        if (typeLine.includes(tribe)) {
            tribes.push(tribe);
        }
    }
    
    // Check oracle text for tribal references
    for (const tribe of commonTribes) {
        if (oracleText.includes(tribe) && !tribes.includes(tribe)) {
            tribes.push(tribe);
        }
    }
    
    return tribes;
}

// Calculate synergy score for an individual card within a deck
function calculateCardSynergy(card, deck) {
    if (!card || !deck || deck.length === 0) return 0;
    
    try {
        let synergyScore = 0;
        const oracleText = (card.oracle_text || '').toLowerCase();
        const typeLine = (card.type_line || '').toLowerCase();
        
        // Extract themes and keywords from the card
        const cardThemes = new Set();
        const cardKeywords = new Set();
        const cardTribes = new Set();
        
        extractKeywordsAndThemes(oracleText, typeLine).forEach(item => {
            if (item.type === 'keyword') {
                cardKeywords.add(item.value);
            } else if (item.type === 'tribe') {
                cardTribes.add(item.value);
            } else if (item.type === 'theme') {
                cardThemes.add(item.value);
            }
        });
        
        // Count synergies with other cards in the deck
        let synergisticCards = 0;
        
        deck.forEach(otherCard => {
            if (otherCard.id === card.id) return; // Skip self
            
            const otherOracleText = (otherCard.oracle_text || '').toLowerCase();
            const otherTypeLine = (otherCard.type_line || '').toLowerCase();
            let cardSynergy = 0;
            
            // Check for color identity match
            if (card.color_identity && otherCard.color_identity) {
                const colorMatch = card.color_identity.some(color => 
                    otherCard.color_identity.includes(color)
                );
                if (colorMatch) cardSynergy += 0.1;
            }
            
            // Check for theme matches
            extractKeywordsAndThemes(otherOracleText, otherTypeLine).forEach(item => {
                if (item.type === 'keyword' && cardKeywords.has(item.value)) {
                    cardSynergy += 0.3;
                } else if (item.type === 'tribe' && cardTribes.has(item.value)) {
                    cardSynergy += 0.5;
                } else if (item.type === 'theme' && cardThemes.has(item.value)) {
                    cardSynergy += 0.4;
                }
            });
            
            // Check for direct card name mentions
            if (oracleText.includes(otherCard.name.toLowerCase()) || 
                otherOracleText.includes(card.name.toLowerCase())) {
                cardSynergy += 1.0;
            }
            
            // Check for type line mentions
            const cardTypes = typeLine.split(' ').filter(t => t.length > 3);
            const otherTypes = otherTypeLine.split(' ').filter(t => t.length > 3);
            
            cardTypes.forEach(type => {
                if (otherOracleText.includes(type)) {
                    cardSynergy += 0.3;
                }
            });
            
            otherTypes.forEach(type => {
                if (oracleText.includes(type)) {
                    cardSynergy += 0.3;
                }
            });
            
            // If there's any synergy, count this card
            if (cardSynergy > 0.2) {
                synergisticCards++;
            }
        });
        
        // Calculate final score based on percentage of synergistic cards
        synergyScore = Math.min(10, Math.round((synergisticCards / (deck.length - 1)) * 20));
        
        return synergyScore;
    } catch (error) {
        console.error('Error calculating card synergy:', error);
        return 5; // Default middle score
    }
}


// Calculate synergy rating for a deck
function calculateSynergyRating(deck) {
    if (!deck || deck.length === 0) return 0;
    
    try {
        // Initialize synergy metrics
        let synergyScore = 0;
        const colorIdentities = new Set();
        const cardTypes = new Set();
        const keywords = new Set();
        const tribes = new Set();
        const themes = new Map();
        
        // Extract color identity from all cards
        deck.forEach(card => {
            if (card.color_identity) {
                card.color_identity.forEach(color => colorIdentities.add(color));
            }
        });
        
        // Analyze each card for synergies
        deck.forEach(card => {
            // Get card type
            const type = getCardType(card.type_line || '');
            cardTypes.add(type);
            
            // Extract oracle text
            const oracleText = (card.oracle_text || '').toLowerCase();
            
            // Check color identity match
            if (card.color_identity) {
                const colorMatch = card.color_identity.every(color => colorIdentities.has(color));
                if (colorMatch) synergyScore += 0.2;
            }
            
            // Extract keywords and themes
            extractKeywordsAndThemes(oracleText, card.type_line || '').forEach(item => {
                if (item.type === 'keyword') {
                    keywords.add(item.value);
                } else if (item.type === 'tribe') {
                    tribes.add(item.value);
                } else if (item.type === 'theme') {
                    const currentCount = themes.get(item.value) || 0;
                    themes.set(item.value, currentCount + 1);
                }
            });
        });
        
        // Calculate theme synergy
        let themeScore = 0;
        themes.forEach((count, theme) => {
            // More cards with the same theme = higher synergy
            themeScore += Math.min(count / 5, 1) * 2;
        });
        
        // Calculate tribal synergy
        let tribalScore = 0;
        tribes.forEach(tribe => {
            const tribalCount = deck.filter(card => 
                (card.type_line || '').toLowerCase().includes(tribe.toLowerCase()) ||
                (card.oracle_text || '').toLowerCase().includes(tribe.toLowerCase())
            ).length;
            
            tribalScore += Math.min(tribalCount / 10, 1) * 3;
        });
        
        // Calculate keyword synergy
        let keywordScore = 0;
        keywords.forEach(keyword => {
            const keywordCount = deck.filter(card => 
                (card.oracle_text || '').toLowerCase().includes(keyword.toLowerCase())
            ).length;
            
            keywordScore += Math.min(keywordCount / 8, 1) * 1.5;
        });
        
        // Calculate mana curve score
        const manaCurve = [0, 0, 0, 0, 0, 0, 0, 0]; // 0-7+ CMC
        deck.forEach(card => {
            const cmc = Math.min(7, Math.floor(card.cmc || 0));
            manaCurve[cmc]++;
        });
        
        // Ideal mana curve has more low-cost cards and fewer high-cost cards
        const curveScore = (
            manaCurve[1] * 0.8 + 
            manaCurve[2] * 1.0 + 
            manaCurve[3] * 0.9 + 
            manaCurve[4] * 0.7 + 
            manaCurve[5] * 0.5 + 
            manaCurve[6] * 0.3 + 
            manaCurve[7] * 0.2
        ) / deck.length * 10;
        
        // Calculate land balance score
        const landCount = deck.filter(card => 
            card.type === 'Land' || card.type === 'Basic Land'
        ).length;
        
        const format = getCurrentFormat();
        const idealLandRatio = format.code === 'commander' ? 0.38 : 0.4;
        const landRatio = landCount / deck.length;
        const landScore = 10 - Math.abs(landRatio - idealLandRatio) * 50;
        
        // Combine all scores
        const totalScore = synergyScore + themeScore + tribalScore + keywordScore + (curveScore * 0.5) + (landScore * 0.5);
        
        // Convert to 1-10 scale
        const normalizedScore = Math.min(10, Math.max(1, Math.round(totalScore)));
        
        // Return detailed synergy information
        return {
            score: normalizedScore,
            details: {
                themes: Array.from(themes.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([theme, count]) => ({ theme, count })),
                tribes: Array.from(tribes).slice(0, 2),
                keywords: Array.from(keywords).slice(0, 5),
                colorIdentity: Array.from(colorIdentities),
                manaCurve,
                landRatio
            }
        };
    } catch (error) {
        console.error('Error calculating synergy rating:', error);
        return {
            score: 5, // Default middle score
            details: {
                themes: [],
                tribes: [],
                keywords: [],
                colorIdentity: [],
                manaCurve: [0, 0, 0, 0, 0, 0, 0, 0],
                landRatio: 0
            }
        };
    }
}

// Helper function to extract keywords and themes from card text
function extractKeywordsAndThemes(oracleText, typeLine) {
    const results = [];
    
    // Common MTG keywords
    const keywords = [
        'flying', 'first strike', 'double strike', 'deathtouch', 'haste',
        'hexproof', 'indestructible', 'lifelink', 'menace', 'reach',
        'trample', 'vigilance', 'flash', 'defender', 'prowess',
        'scry', 'kicker', 'convoke', 'delve', 'surveil', 'adapt',
        'afterlife', 'amass', 'ascend', 'cascade', 'cipher', 'conspire',
        'devoid', 'emerge', 'enrage', 'exalted', 'exploit', 'extort',
        'fateseal', 'ferocious', 'graft', 'hellbent', 'heroic', 'improvise',
        'infect', 'landfall', 'mentor', 'metalcraft', 'morbid', 'persist',
        'proliferate', 'prowl', 'raid', 'rally', 'revolt', 'spectacle',
        'storm', 'threshold', 'undergrowth', 'unleash', 'addendum'
    ];
    
    // Check for keywords
    keywords.forEach(keyword => {
        if (oracleText.includes(keyword)) {
            results.push({ type: 'keyword', value: keyword });
        }
    });
    
    // Common creature types for tribal synergies
    const tribes = [
        'Human', 'Elf', 'Goblin', 'Zombie', 'Vampire', 'Dragon', 'Angel',
        'Demon', 'Wizard', 'Warrior', 'Knight', 'Cleric', 'Rogue', 'Druid',
        'Merfolk', 'Beast', 'Elemental', 'Spirit', 'Giant', 'Dinosaur'
    ];
    
    // Check for tribes
    tribes.forEach(tribe => {
        if (typeLine.includes(tribe) || oracleText.includes(tribe)) {
            results.push({ type: 'tribe', value: tribe });
        }
    });
    
    // Common deck themes
    const themePatterns = [
        { pattern: /draw.*card|scry|surveil|look at the top/, value: 'Card Advantage' },
        { pattern: /create.*token|populate|creature.*enter/, value: 'Tokens' },
        { pattern: /gain.*life|lifelink|whenever you gain life/, value: 'Lifegain' },
        { pattern: /graveyard|dies|discard|exile.*from.*graveyard/, value: 'Graveyard' },
        { pattern: /\+1\/\+1 counter|counter on|proliferate/, value: 'Counters' },
        { pattern: /land.*enter|landfall|search.*for.*land/, value: 'Lands Matter' },
        { pattern: /sacrifice|dies|whenever.*creature.*dies/, value: 'Sacrifice' },
        { pattern: /damage|deal.*damage|whenever.*deals damage/, value: 'Damage' },
        { pattern: /control.*enchantment|enchanted|aura/, value: 'Enchantments' },
        { pattern: /control.*artifact|equip|equipment/, value: 'Artifacts' },
        { pattern: /cast.*instant|cast.*sorcery|whenever you cast/, value: 'Spellslinger' },
        { pattern: /attack|combat|whenever.*creature.*attacks/, value: 'Combat' },
        { pattern: /copy|create.*copy|duplicate/, value: 'Copy' },
        { pattern: /return.*to.*hand|bounce|flicker|blink/, value: 'Bounce/Flicker' },
        { pattern: /counter.*spell|counter target|unless/, value: 'Control' }
    ];
    
    // Check for themes
    themePatterns.forEach(({ pattern, value }) => {
        if (pattern.test(oracleText)) {
            results.push({ type: 'theme', value });
        }
    });
    
    return results;
}

// Make all functions available globally
window.mtgFormats = {
    getCardType,
    getCardPrice,
    searchForCards,
    shuffleArray,
    selectFormat,
    getCurrentFormat,
    generateDeck,
    generateGenericDeck,
    emergencyFallbackDeck,
    addGenericLands,
    addGenericBasicLands,
    addGenericCardsByType,
    addFallbackBasicLands,
    validateDeck,
    findCombos,
    setBudgetMode,
    setBudgetLimit,
    searchDecks,
    searchCombos,
    formatRegistry,
    initFormatRegistry,
    analyzeCardForCommanderSynergies,
    extractCommanderThemes,
    extractTribes,
    calculateSynergyRating,
    calculateCardSynergy,
    extractKeywordsAndThemes
};
