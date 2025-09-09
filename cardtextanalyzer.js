// cardTextAnalyzer.js - Enhanced version with fuzzy matching and improved synergy detection

/**
 * Card Text Pattern Analyzer
 * 
 * This module analyzes patterns in card text to identify synergies,
 * creature types, and strategic trends to build balanced decks with
 * approximately 75% win rate potential.
 */

const cardTextAnalyzer = (function() {
    // Private variables
    const creatureTypes = {
        humanoid: ['Human', 'Elf', 'Dwarf', 'Goblin', 'Merfolk', 'Vampire', 'Zombie', 'Warrior', 'Wizard', 'Knight', 'Cleric', 'Rogue'],
        monstrous: ['Beast', 'Dragon', 'Hydra', 'Wurm', 'Elemental', 'Giant', 'Demon', 'Devil', 'Horror'],
        eldritch: ['Eldrazi', 'Horror', 'Nightmare', 'Spirit', 'Specter', 'Illusion'],
        natural: ['Plant', 'Fungus', 'Insect', 'Bird', 'Fish', 'Snake', 'Wolf', 'Bear', 'Cat', 'Elephant'],
        artificial: ['Construct', 'Golem', 'Thopter', 'Servo', 'Drone', 'Myr', 'Scarecrow', 'Homunculus']
    };

    const colorIdentities = {
        W: {
            themes: ['protection', 'life gain', 'small creatures', 'enchantments', 'exile', 'taxes', 'equipment'],
            keywords: ['vigilance', 'lifelink', 'first strike', 'protection', 'exile', 'enchantment', 'equipment'],
            playstyle: 'defensive, incremental advantage, board control'
        },
        U: {
            themes: ['card draw', 'counterspells', 'bounce', 'control', 'artifacts', 'flying', 'tempo'],
            keywords: ['flying', 'hexproof', 'scry', 'draw', 'counter', 'return', 'tap', 'untap'],
            playstyle: 'reactive, controlling, card advantage, combo'
        },
        B: {
            themes: ['sacrifice', 'graveyard', 'discard', 'life loss', 'removal', 'recursion'],
            keywords: ['deathtouch', 'lifelink', 'sacrifice', 'discard', 'destroy', 'graveyard', 'exile'],
            playstyle: 'attrition, resource denial, life as resource, combo'
        },
        R: {
            themes: ['direct damage', 'aggression', 'chaos', 'artifacts', 'impulsive draw', 'temporary effects'],
            keywords: ['haste', 'first strike', 'double strike', 'damage', 'sacrifice', 'discard', 'exile'],
            playstyle: 'aggressive, explosive, unpredictable, burn'
        },
        G: {
            themes: ['ramp', 'big creatures', 'lands', 'tokens', '+1/+1 counters', 'fight'],
            keywords: ['trample', 'reach', 'hexproof', 'fight', 'counter', 'land', 'mana'],
            playstyle: 'ramp, creature-focused, midrange, value'
        }
    };

    const winConditions = {
        combat: {
            patterns: ['creatures get +', 'double strike', 'trample', 'flying', 'unblockable', 'extra combat'],
            cards: ['Craterhoof Behemoth', 'Overwhelming Stampede', 'Triumph of the Hordes']
        },
        combo: {
            patterns: ['infinite', 'whenever', 'instead', 'each opponent', 'you win the game'],
            cards: ['Thassa\'s Oracle', 'Laboratory Maniac', 'Approach of the Second Sun']
        },
        control: {
            patterns: ['counter target', 'destroy all', 'exile all', 'return all', 'each opponent sacrifices'],
            cards: ['Cyclonic Rift', 'Wrath of God', 'Toxic Deluge']
        },
        value: {
            patterns: ['draw a card', 'create a token', 'gain life', 'whenever you', 'at the beginning of'],
            cards: ['Rhystic Study', 'Smothering Tithe', 'Sylvan Library']
        }
    };

    // Dangerous life payment patterns that could lead to self-defeat
    const dangerousLifePatterns = [
        { regex: /pay half your life/i, severity: 'high' },
        { regex: /pay \d+ life/i, severity: 'medium' },
        { regex: /pay x life/i, severity: 'variable' },
        { regex: /lose \d+ life/i, severity: 'medium' },
        { regex: /lose life equal to/i, severity: 'high' }
    ];

    // Power/toughness patterns for fuzzy matching
    const powerToughnessPatterns = [
        { regex: /\+(\d+)\/\+(\d+)/g, type: 'boost', description: 'Static boost' },
        { regex: /\-(\d+)\/\-(\d+)/g, type: 'debuff', description: 'Static debuff' },
        { regex: /\+X\/\+X/gi, type: 'variable_boost', description: 'Variable boost' },
        { regex: /\-X\/\-X/gi, type: 'variable_debuff', description: 'Variable debuff' },
        { regex: /\*\/\*/g, type: 'dynamic', description: 'Dynamic power/toughness' },
        { regex: /power and toughness each equal to/i, type: 'equal_to', description: 'Equal to specific value' },
        { regex: /base power and toughness (\d+)\/(\d+)/i, type: 'base_change', description: 'Base power/toughness change' },
        { regex: /becomes (\d+)\/(\d+)/i, type: 'becomes', description: 'Becomes specific power/toughness' }
    ];

    // Win condition patterns for precise matching
    const exactWinConditions = [
        { regex: /you win the game/i, type: 'direct', risk: 'low' },
        { regex: /that player loses the game/i, type: 'opponent_loss', risk: 'low' },
        { regex: /each opponent loses the game/i, type: 'all_opponents_lose', risk: 'low' },
        { regex: /if [^.]*? you win the game/i, type: 'conditional', risk: 'medium' },
        { regex: /at the beginning of [^.]*? you win the game/i, type: 'delayed', risk: 'high' },
        { regex: /win the game at the beginning of/i, type: 'delayed', risk: 'high' },
        { regex: /can't lose the game/i, type: 'protection', risk: 'medium' },
        { regex: /your opponents can't win the game/i, type: 'protection', risk: 'medium' }
    ];

    // Synergy patterns for more precise matching
    const synergyPatterns = [
        // Tribal synergies
        { regex: /other ([a-z]+)s you control get/i, type: 'tribal', subtype: 'lord' },
        { regex: /whenever a ([a-z]+) enters the battlefield under your control/i, type: 'tribal', subtype: 'etb' },
        { regex: /whenever a ([a-z]+) you control dies/i, type: 'tribal', subtype: 'death' },
        
        // Counter synergies
        { regex: /put (?:a|an|\d+) ([a-z+\/-]+) counter/i, type: 'counter', subtype: 'add' },
        { regex: /for each ([a-z+\/-]+) counter/i, type: 'counter', subtype: 'payoff' },
        { regex: /remove (?:a|an|\d+) ([a-z+\/-]+) counter/i, type: 'counter', subtype: 'remove' },
        
        // Graveyard synergies
        { regex: /return (?:target|a|all) .* from your graveyard/i, type: 'graveyard', subtype: 'recursion' },
        { regex: /whenever a creature dies/i, type: 'graveyard', subtype: 'death_trigger' },
        { regex: /exile (?:target|a|all) .* from (?:a|all|your) graveyard/i, type: 'graveyard', subtype: 'exile' },
        
        // Sacrifice synergies
        { regex: /sacrifice a/i, type: 'sacrifice', subtype: 'cost' },
        { regex: /whenever you sacrifice a/i, type: 'sacrifice', subtype: 'trigger' },
        { regex: /each (?:player|opponent) sacrifices/i, type: 'sacrifice', subtype: 'edict' },
        
        // Token synergies
        { regex: /create (?:a|an|\d+) .* token/i, type: 'token', subtype: 'create' },
        { regex: /whenever you create a token/i, type: 'token', subtype: 'trigger' },
        { regex: /tokens you control get/i, type: 'token', subtype: 'anthem' },
        
        // Spell synergies
        { regex: /whenever you cast (?:a|an) (instant|sorcery|artifact|enchantment|planeswalker|creature) spell/i, type: 'spell', subtype: 'cast_trigger' },
        { regex: /(instant|sorcery|artifact|enchantment|planeswalker|creature) spells you cast cost/i, type: 'spell', subtype: 'cost_reduction' },
        { regex: /copy (?:target|a|that) (instant|sorcery) spell/i, type: 'spell', subtype: 'copy' },
        
        // Land synergies
        { regex: /whenever a land enters the battlefield under your control/i, type: 'land', subtype: 'landfall' },
        { regex: /search your library for (?:a|an|\d+) .* land card/i, type: 'land', subtype: 'tutor' },
        { regex: /you may play an additional land/i, type: 'land', subtype: 'extra_land' },
        
        // Mana synergies
        { regex: /add (?:an additional )?\{[WUBRG]\}/i, type: 'mana', subtype: 'produce' },
        { regex: /whenever you tap .* for mana/i, type: 'mana', subtype: 'trigger' },
        { regex: /mana of any color/i, type: 'mana', subtype: 'fixing' }
    ];

    // Private methods
    function fuzzyMatchPattern(text, pattern) {
        if (!text) return false;
        
        // Convert pattern to a more flexible regex
        const flexPattern = pattern
            .replace(/\s+/g, '\\s+') // Allow flexible whitespace
            .replace(/\./g, '\\.?') // Make periods optional
            .replace(/\?/g, '.?') // Replace ? with optional any character
            .replace(/\(/g, '\\(?') // Make opening parentheses optional
            .replace(/\)/g, '\\)?'); // Make closing parentheses optional
            
        const regex = new RegExp(flexPattern, 'i');
        return regex.test(text);
    }

    function analyzeCardText(cardText) {
        if (!cardText) return {};
        
        const textLower = cardText.toLowerCase();
        const analysis = {
            keywords: [],
            triggers: [],
            targets: [],
            effects: [],
            synergies: [],
            powerToughness: [],
            winConditions: [],
            lifeLossRisks: [],
            synergyPatterns: []
        };

        // Identify keywords
        const keywordPatterns = [
            'flying', 'first strike', 'double strike', 'deathtouch', 'haste', 
            'hexproof', 'indestructible', 'lifelink', 'menace', 'protection', 
            'reach', 'trample', 'vigilance', 'ward', 'flash'
        ];

        keywordPatterns.forEach(keyword => {
            if (textLower.includes(keyword)) {
                analysis.keywords.push(keyword);
            }
        });

        // Identify triggers with fuzzy matching
        const triggerPatterns = [
            'when ~ enters the battlefield', 'whenever', 'at the beginning of', 
            'when ~ dies', 'when ~ attacks', 'when ~ blocks', 'when ~ becomes tapped'
        ];

        triggerPatterns.forEach(pattern => {
            const regex = new RegExp(pattern.replace('~', '.*?'), 'i');
            if (regex.test(textLower)) {
                analysis.triggers.push(pattern);
            }
        });

        // Identify targets
        const targetPatterns = [
            'target creature', 'target player', 'target opponent', 'target artifact', 
            'target enchantment', 'target permanent', 'each opponent', 'each player'
        ];

        targetPatterns.forEach(pattern => {
            if (textLower.includes(pattern)) {
                analysis.targets.push(pattern);
            }
        });

        // Identify effects
        const effectPatterns = [
            'destroy', 'exile', 'return', 'draw', 'discard', 'sacrifice', 
            'gain life', 'lose life', 'damage', 'counter', 'create', 'put'
        ];

        effectPatterns.forEach(pattern => {
            if (textLower.includes(pattern)) {
                analysis.effects.push(pattern);
            }
        });

        // Analyze power/toughness patterns with fuzzy matching
        powerToughnessPatterns.forEach(pattern => {
            const matches = cardText.match(pattern.regex);
            if (matches) {
                matches.forEach(match => {
                    analysis.powerToughness.push({
                        text: match,
                        type: pattern.type,
                        description: pattern.description
                    });
                });
            }
        });

        // Analyze exact win conditions
        exactWinConditions.forEach(condition => {
            if (condition.regex.test(cardText)) {
                analysis.winConditions.push({
                    text: cardText.match(condition.regex)[0],
                    type: condition.type,
                    risk: condition.risk
                });
            }
        });

        // Analyze dangerous life payment patterns
        dangerousLifePatterns.forEach(pattern => {
            if (pattern.regex.test(cardText)) {
                const match = cardText.match(pattern.regex)[0];
                analysis.lifeLossRisks.push({
                    text: match,
                    severity: pattern.severity,
                    // Extract numeric value if present
                    value: match.match(/\d+/) ? parseInt(match.match(/\d+/)[0]) : 'variable'
                });
            }
        });

        // Analyze synergy patterns
        synergyPatterns.forEach(pattern => {
            const matches = cardText.match(pattern.regex);
            if (matches) {
                matches.forEach(match => {
                    // Extract the subtype value (e.g., creature type, counter type)
                    const subtypeMatch = pattern.regex.exec(match);
                    const subtypeValue = subtypeMatch && subtypeMatch.length > 1 ? subtypeMatch[1] : null;
                    
                    analysis.synergyPatterns.push({
                        text: match,
                        type: pattern.type,
                        subtype: pattern.subtype,
                        value: subtypeValue
                    });
                });
            }
        });

        return analysis;
    }

    function identifyCreatureType(typeLine) {
        if (!typeLine) return [];
        
        const types = [];
        const typeLineLower = typeLine.toLowerCase();
        
        for (const category in creatureTypes) {
            for (const type of creatureTypes[category]) {
                if (typeLineLower.includes(type.toLowerCase())) {
                    types.push({
                        type: type,
                        category: category
                    });
                }
            }
        }
        
        return types;
    }

    function analyzeColorIdentity(colors) {
        if (!colors || !colors.length) return { themes: [], keywords: [], playstyle: 'colorless' };
        
        const analysis = {
            themes: [],
            keywords: [],
            playstyle: ''
        };
        
        // Combine themes and keywords from all colors
        colors.forEach(color => {
            if (colorIdentities[color]) {
                analysis.themes = [...analysis.themes, ...colorIdentities[color].themes];
                analysis.keywords = [...analysis.keywords, ...colorIdentities[color].keywords];
            }
        });
        
        // Remove duplicates
        analysis.themes = [...new Set(analysis.themes)];
        analysis.keywords = [...new Set(analysis.keywords)];
        
        // Determine playstyle based on color combination
        if (colors.length === 1) {
            analysis.playstyle = colorIdentities[colors[0]].playstyle;
        } else if (colors.includes('U') && colors.includes('R') && colors.includes('G')) {
            analysis.playstyle = 'tempo, value-oriented, explosive';
        } else if (colors.includes('W') && colors.includes('U') && colors.includes('B')) {
            analysis.playstyle = 'control, attrition, methodical';
        } else if (colors.includes('B') && colors.includes('R') && colors.includes('G')) {
            analysis.playstyle = 'aggressive, sacrifice-oriented, explosive';
        } else if (colors.includes('W') && colors.includes('B') && colors.includes('G')) {
            analysis.playstyle = 'value, recursion, resilient';
        } else if (colors.includes('W') && colors.includes('U') && colors.includes('R')) {
            analysis.playstyle = 'tempo, control, combo potential';
        } else {
            analysis.playstyle = 'balanced, adaptable';
        }
        
        return analysis;
    }

    function identifyWinConditions(cardText, colors) {
        const potentialWinCons = [];
        
        if (!cardText) return potentialWinCons;
        
        const textLower = cardText.toLowerCase();
        
        // Check for explicit win conditions with exact matching
        for (const condition of exactWinConditions) {
            if (condition.regex.test(cardText)) {
                potentialWinCons.push({
                    type: condition.type,
                    description: `${condition.type} win condition: "${cardText.match(condition.regex)[0]}"`,
                    reliability: condition.risk === 'low' ? 'high' : 
                                condition.risk === 'medium' ? 'medium' : 'low'
                });
            }
        }
        
        // Check for combat-based win conditions
        if (colors.includes('G') || colors.includes('R') || colors.includes('W')) {
            for (const pattern of winConditions.combat.patterns) {
                if (textLower.includes(pattern)) {
                    potentialWinCons.push({
                        type: 'combat',
                        description: `Combat enhancement through "${pattern}"`,
                        reliability: 'medium'
                    });
                    break;
                }
            }
        }
        
        // Check for combo potential
        if (colors.includes('U') || colors.includes('B')) {
            for (const pattern of winConditions.combo.patterns) {
                if (textLower.includes(pattern) && pattern !== 'you win the game') { // Avoid duplication with exact win conditions
                    potentialWinCons.push({
                        type: 'combo',
                        description: `Combo potential through "${pattern}"`,
                        reliability: 'variable'
                    });
                    break;
                }
            }
        }
        
        // Check for control finishers
        if (colors.includes('W') || colors.includes('U') || colors.includes('B')) {
            for (const pattern of winConditions.control.patterns) {
                if (textLower.includes(pattern)) {
                    potentialWinCons.push({
                        type: 'control',
                        description: `Control element through "${pattern}"`,
                        reliability: 'medium'
                    });
                    break;
                }
            }
        }
        
        return potentialWinCons;
    }

    function assessLifePaymentRisk(textAnalysis) {
        if (!textAnalysis.lifeLossRisks || textAnalysis.lifeLossRisks.length === 0) {
            return { risk: 'none', description: 'No significant life payment risks' };
        }
        
        // Sort risks by severity
        const sortedRisks = [...textAnalysis.lifeLossRisks].sort((a, b) => {
            const severityOrder = { 'high': 3, 'medium': 2, 'variable': 1, 'low': 0 };
            return severityOrder[b.severity] - severityOrder[a.severity];
        });
        
        const highestRisk = sortedRisks[0];
        
        if (highestRisk.severity === 'high') {
            return {
                risk: 'high',
                description: `High risk of self-defeat through life payment: "${highestRisk.text}"`,
                recommendation: 'Include significant life gain to offset this cost'
            };
        } else if (highestRisk.severity === 'medium') {
            return {
                risk: 'medium',
                description: `Moderate risk through life payment: "${highestRisk.text}"`,
                recommendation: 'Consider including some life gain effects'
            };
        } else {
            return {
                risk: 'low',
                description: `Low or variable risk through life payment: "${highestRisk.text}"`,
                recommendation: 'Monitor life total during gameplay'
            };
        }
    }

    function analyzePowerToughnessDynamics(textAnalysis) {
        if (!textAnalysis.powerToughness || textAnalysis.powerToughness.length === 0) {
            return { dynamics: 'none', description: 'No power/toughness modifications' };
        }
        
        const boosts = textAnalysis.powerToughness.filter(pt => 
            pt.type === 'boost' || pt.type === 'variable_boost');
        
        const debuffs = textAnalysis.powerToughness.filter(pt => 
            pt.type === 'debuff' || pt.type === 'variable_debuff');
        
        const dynamics = textAnalysis.powerToughness.filter(pt => 
            pt.type === 'dynamic' || pt.type === 'equal_to' || pt.type === 'base_change' || pt.type === 'becomes');
        
        let analysis = {
            dynamics: 'mixed',
            description: '',
            recommendation: ''
        };
        
        if (boosts.length > 0 && debuffs.length === 0) {
            analysis.dynamics = 'positive';
            analysis.description = `Positive power/toughness modifications: ${boosts.map(b => b.text).join(', ')}`;
            analysis.recommendation = 'Good for aggressive strategies';
        } else if (debuffs.length > 0 && boosts.length === 0) {
            analysis.dynamics = 'negative';
            analysis.description = `Negative power/toughness modifications: ${debuffs.map(d => d.text).join(', ')}`;
            analysis.recommendation = 'Good for control strategies';
        } else if (dynamics.length > 0) {
            analysis.dynamics = 'dynamic';
            analysis.description = `Dynamic power/toughness: ${dynamics.map(d => d.text).join(', ')}`;
            analysis.recommendation = 'Build around the specific condition';
        } else {
            analysis.dynamics = 'mixed';
            analysis.description = `Mixed power/toughness modifications: ${textAnalysis.powerToughness.map(pt => pt.text).join(', ')}`;
            analysis.recommendation = 'Versatile for different situations';
        }
        
        return analysis;
    }

    function identifySynergyGroups(textAnalysis) {
        if (!textAnalysis.synergyPatterns || textAnalysis.synergyPatterns.length === 0) {
            return [];
        }
        
        const synergyGroups = {};
        
        // Group synergies by their type
        textAnalysis.synergyPatterns.forEach(synergy => {
            if (!synergyGroups[synergy.type]) {
                synergyGroups[synergy.type] = [];
            }
            synergyGroups[synergy.type].push(synergy);
        });
        
        // Convert to array format with descriptions
        return Object.entries(synergyGroups).map(([type, synergies]) => {
            const subtypes = [...new Set(synergies.map(s => s.subtype))];
            
            let description = '';
            let recommendation = '';
            
            switch (type) {
                case 'tribal':
                    const tribes = synergies.filter(s => s.value).map(s => s.value);
                    const uniqueTribes = [...new Set(tribes)];
                    description = `Tribal synergy with ${uniqueTribes.join(', ')}`;
                    recommendation = 'Include more creatures of these types';
                    break;
                case 'counter':
                    const counterTypes = synergies.filter(s => s.value).map(s => s.value);
                    const uniqueCounters = [...new Set(counterTypes)];
                    description = `Counter synergy with ${uniqueCounters.join(', ')} counters`;
                    recommendation = 'Include more cards that interact with these counters';
                    break;
                case 'graveyard':
                    description = 'Graveyard interaction';
                    recommendation = 'Include self-mill and recursion effects';
                    break;
                case 'sacrifice':
                    description = 'Sacrifice synergy';
                    recommendation = 'Include token generators and death triggers';
                    break;
                case 'token':
                    description = 'Token generation and synergy';
                    recommendation = 'Include token doublers and anthem effects';
                    break;
                case 'spell':
                    const spellTypes = synergies.filter(s => s.value).map(s => s.value);
                    const uniqueSpells = [...new Set(spellTypes)];
                    description = `Spell synergy with ${uniqueSpells.join(', ')} spells`;
                    recommendation = 'Include more spells of these types';
                    break;
                case 'land':
                    description = 'Land synergy';
                    recommendation = 'Include fetch lands and land tutors';
                    break;
                case 'mana':
                    description = 'Mana production synergy';
                    recommendation = 'Include mana doublers and mana sinks';
                    break;
                default:
                    description = `${type} synergy`;
                    recommendation = 'Build around this synergy';
            }
            
            return {
                type,
                subtypes,
                synergies,
                description,
                recommendation
            };
        });
    }

    function generateStrategicProfile(card) {
        if (!card) return null;
        
        const textAnalysis = analyzeCardText(card.oracle_text);
        const creatureTypes = identifyCreatureType(card.type_line);
        const colorAnalysis = analyzeColorIdentity(card.color_identity);
        const winCons = identifyWinConditions(card.oracle_text, card.color_identity);
        const lifeRiskAssessment = assessLifePaymentRisk(textAnalysis);
        const powerToughnessAnalysis = analyzePowerToughnessDynamics(textAnalysis);
        const synergyGroups = identifySynergyGroups(textAnalysis);
        
        return {
            name: card.name,
            textAnalysis,
            creatureTypes,
            colorAnalysis,
            winConditions: winCons,
            lifeRiskAssessment,
            powerToughnessAnalysis,
            synergyGroups,
            recommendedStrategy: determineStrategy(textAnalysis, colorAnalysis, winCons, synergyGroups)
        };
    }

    function determineStrategy(textAnalysis, colorAnalysis, winCons, synergyGroups) {
        // Determine primary strategy based on card analysis
        let primaryStrategy = '';
        let supportStrategies = [];
        let gameplanSuggestions = [];
        
        // Check for aggressive elements
        const aggressiveElements = textAnalysis.keywords.filter(k => 
            ['haste', 'double strike', 'first strike', 'trample'].includes(k)
        ).length;
        
        // Check for control elements
        const controlElements = textAnalysis.effects.filter(e => 
            ['destroy', 'exile', 'counter', 'return'].includes(e)
        ).length;
        
        // Check for value elements
        const valueElements = textAnalysis.effects.filter(e => 
            ['draw', 'create', 'gain life'].includes(e)
        ).length;
        
        // Check for combo elements
        const comboElements = textAnalysis.triggers.length + 
            (textAnalysis.effects.includes('sacrifice') ? 1 : 0) +
            (textAnalysis.effects.includes('put') ? 1 : 0);
        
        // Add synergy group weights
        let synergyWeights = {
            aggressive: 0,
            control: 0,
            value: 0,
            combo: 0
        };
        
        synergyGroups.forEach(group => {
            switch(group.type) {
                case 'tribal':
                case 'token':
                    synergyWeights.aggressive += 2;
                    synergyWeights.value += 1;
                    break;
                case 'counter':
                    synergyWeights.value += 2;
                    synergyWeights.combo += 1;
                    break;
                case 'graveyard':
                    synergyWeights.value += 2;
                    synergyWeights.combo += 2;
                    break;
                case 'sacrifice':
                    synergyWeights.control += 1;
                    synergyWeights.combo += 2;
                    break;
                case 'spell':
                    synergyWeights.control += 2;
                    synergyWeights.combo += 1;
                    break;
                case 'land':
                    synergyWeights.value += 2;
                    break;
                case 'mana':
                    synergyWeights.value += 1;
                    synergyWeights.combo += 1;
                    break;
            }
        });
        
        // Determine primary strategy
        const strategies = [
            { name: 'aggressive', score: aggressiveElements + synergyWeights.aggressive },
            { name: 'control', score: controlElements + synergyWeights.control },
            { name: 'value', score: valueElements + synergyWeights.value },
            { name: 'combo', score: comboElements + synergyWeights.combo }
        ];
        
        strategies.sort((a, b) => b.score - a.score);
        
        primaryStrategy = strategies[0].name;
        
        // Add support strategies if they have non-zero scores
        for (let i = 1; i < strategies.length; i++) {
            if (strategies[i].score > 0) {
                supportStrategies.push(strategies[i].name);
            }
        }
        
        // Generate gameplan suggestions
        switch (primaryStrategy) {
            case 'aggressive':
                gameplanSuggestions = [
                    'Focus on early board presence',
                    'Include combat tricks to push through damage',
                    'Consider cards that provide evasion (flying, trample, etc.)',
                    'Include some reach for when the board stalls'
                ];
                break;
            case 'control':
                gameplanSuggestions = [
                    'Focus on answering threats efficiently',
                    'Include card draw to maintain advantage',
                    'Consider board wipes for recovery',
                    'Include a few reliable win conditions'
                ];
                break;
            case 'value':
                gameplanSuggestions = [
                    'Focus on cards that generate incremental advantage',
                    'Include recursion elements to reuse key pieces',
                    'Consider protection for your value engines',
                    'Balance value with actual win conditions'
                ];
                break;
            case 'combo':
                gameplanSuggestions = [
                    'Identify key combo pieces and include tutors',
                    'Include protection for combo pieces',
                    'Consider backup plans for when combos are disrupted',
                    'Balance combo focus with interaction'
                ];
                break;
        }
        
        // Add win condition specific suggestions
        if (winCons.length > 0) {
            winCons.forEach(winCon => {
                switch (winCon.type) {
                    case 'combat':
                        gameplanSuggestions.push('Include ways to make creatures unblockable or enhance combat damage');
                        break;
                    case 'combo':
                        gameplanSuggestions.push('Include tutors and protection for combo pieces');
                        break;
                    case 'control':
                        gameplanSuggestions.push('Include efficient removal and counterspells');
                        break;
                    case 'direct':
                    case 'opponent_loss':
                    case 'all_opponents_lose':
                        gameplanSuggestions.push('Build around the explicit win condition');
                        break;
                    case 'conditional':
                        gameplanSuggestions.push('Focus on meeting the win condition requirements');
                        break;
                    case 'delayed':
                        gameplanSuggestions.push('Include protection to survive until the delayed win triggers');
                        break;
                    case 'protection':
                        gameplanSuggestions.push('Leverage the inability to lose by taking calculated risks');
                        break;
                }
            });
        }
        
        // Add life risk assessment suggestions
        if (textAnalysis.lifeLossRisks && textAnalysis.lifeLossRisks.length > 0) {
            const highestRisk = textAnalysis.lifeLossRisks.sort((a, b) => {
                const severityOrder = { 'high': 3, 'medium': 2, 'variable': 1, 'low': 0 };
                return severityOrder[b.severity] - severityOrder[a.severity];
            })[0];
            
            if (highestRisk.severity === 'high') {
                gameplanSuggestions.push('Include significant life gain to offset life payment costs');
                gameplanSuggestions.push('Consider cards that prevent life loss or provide alternative payment methods');
            } else if (highestRisk.severity === 'medium') {
                gameplanSuggestions.push('Include some life gain effects to offset life payments');
            }
        }
        
        // Add power/toughness suggestions
        if (textAnalysis.powerToughness && textAnalysis.powerToughness.length > 0) {
            const ptTypes = textAnalysis.powerToughness.map(pt => pt.type);
            
            if (ptTypes.includes('boost') || ptTypes.includes('variable_boost')) {
                gameplanSuggestions.push('Include creatures that benefit from power/toughness boosts');
            }
            
            if (ptTypes.includes('dynamic') || ptTypes.includes('equal_to')) {
                gameplanSuggestions.push('Build around the condition that determines power/toughness');
            }
        }
        
        // Add synergy group suggestions
        synergyGroups.forEach(group => {
            gameplanSuggestions.push(group.recommendation);
        });
        
        return {
            primaryStrategy,
            supportStrategies: supportStrategies.slice(0, 2), // Limit to top 2 support strategies
            gameplanSuggestions: [...new Set(gameplanSuggestions)] // Remove duplicates
        };
    }

    function generateDeckTrends(commander, format) {
        if (!commander) return null;
        
        const profile = generateStrategicProfile(commander);
        if (!profile) return null;
        
        // Generate deck trends based on commander profile
        const trends = {
            archetypes: [],
            keyCards: [],
            synergies: [],
            counterplay: [],
            winConditions: [],
            safetyMechanisms: [], // New: cards to protect against self-defeat
            powerToughnessEnhancers: [] // New: cards that enhance power/toughness dynamics
        };
        
        // Determine archetypes based on commander profile and synergy groups
        profile.synergyGroups.forEach(group => {
            switch(group.type) {
                case 'tribal':
                    const tribes = group.synergies.filter(s => s.value).map(s => s.value);
                    const uniqueTribes = [...new Set(tribes)];
                    if (uniqueTribes.length > 0) {
                        uniqueTribes.forEach(tribe => {
                            trends.archetypes.push(`${tribe} Tribal`);
                        });
                    }
                    break;
                case 'counter':
                    const counterTypes = group.synergies.filter(s => s.value).map(s => s.value);
                    const uniqueCounters = [...new Set(counterTypes)];
                    if (uniqueCounters.includes('+1/+1')) {
                        trends.archetypes.push('+1/+1 Counters');
                    } else if (uniqueCounters.length > 0) {
                        trends.archetypes.push(`${uniqueCounters.join('/')} Counter Synergy`);
                    }
                    break;
                case 'graveyard':
                    trends.archetypes.push('Graveyard Value / Recursion');
                    break;
                case 'sacrifice':
                    trends.archetypes.push('Sacrifice / Aristocrats');
                    break;
                case 'token':
                    trends.archetypes.push('Token / Go Wide');
                    break;
                case 'spell':
                    const spellTypes = group.synergies.filter(s => s.value).map(s => s.value);
                    const uniqueSpells = [...new Set(spellTypes)];
                    if (uniqueSpells.includes('instant') || uniqueSpells.includes('sorcery')) {
                        trends.archetypes.push('Spellslinger');
                    } else if (uniqueSpells.includes('artifact')) {
                        trends.archetypes.push('Artifact Synergy');
                    } else if (uniqueSpells.includes('enchantment')) {
                        trends.archetypes.push('Enchantment Synergy');
                    }
                    break;
                case 'land':
                    trends.archetypes.push('Landfall / Land Matters');
                    break;
                case 'mana':
                    trends.archetypes.push('Mana Acceleration / Big Mana');
                    break;
            }
        });
        
        // If no archetypes were determined from synergy groups, use color identity
        if (trends.archetypes.length === 0) {
            if (profile.colorAnalysis.themes.includes('tokens')) {
                trends.archetypes.push('Go Wide / Tokens');
            }
            if (profile.colorAnalysis.themes.includes('big creatures') || 
                profile.colorAnalysis.themes.includes('ramp')) {
                trends.archetypes.push('Go Tall / Ramp');
            }
            if (profile.colorAnalysis.themes.includes('graveyard')) {
                trends.archetypes.push('Graveyard Value / Recursion');
            }
            if (profile.colorAnalysis.themes.includes('artifacts')) {
                trends.archetypes.push('Artifact Synergy');
            }
            if (profile.colorAnalysis.themes.includes('enchantments')) {
                trends.archetypes.push('Enchantment Synergy');
            }
            if (profile.textAnalysis.effects.includes('sacrifice')) {
                trends.archetypes.push('Sacrifice / Aristocrats');
            }
        }
        
        // If still no archetypes, add generic ones based on color identity
        if (trends.archetypes.length === 0) {
            if (commander.color_identity.includes('W') && commander.color_identity.includes('U')) {
                trends.archetypes.push('Control / Blink');
            } else if (commander.color_identity.includes('U') && commander.color_identity.includes('B')) {
                trends.archetypes.push('Control / Reanimator');
            } else if (commander.color_identity.includes('B') && commander.color_identity.includes('R')) {
                trends.archetypes.push('Sacrifice / Aristocrats');
            } else if (commander.color_identity.includes('R') && commander.color_identity.includes('G')) {
                trends.archetypes.push('Stompy / Land Ramp');
            } else if (commander.color_identity.includes('G') && commander.color_identity.includes('W')) {
                trends.archetypes.push('Tokens / +1/+1 Counters');
            } else if (commander.color_identity.length === 1) {
                trends.archetypes.push('Mono-Color Goodstuff');
            }
        }
        
        // Determine key cards based on commander profile, synergies, and format
        if (format === 'commander') {
            // Add format-specific key cards based on primary strategy
            if (profile.recommendedStrategy.primaryStrategy === 'aggressive') {
                trends.keyCards.push('Sword of Feast and Famine', 'Embercleave', 'Craterhoof Behemoth');
            } else if (profile.recommendedStrategy.primaryStrategy === 'control') {
                trends.keyCards.push('Cyclonic Rift', 'Swords to Plowshares', 'Counterspell');
            } else if (profile.recommendedStrategy.primaryStrategy === 'value') {
                trends.keyCards.push('Rhystic Study', 'Smothering Tithe', 'Sylvan Library');
            } else if (profile.recommendedStrategy.primaryStrategy === 'combo') {
                trends.keyCards.push('Demonic Tutor', 'Vampiric Tutor', 'Enlightened Tutor');
            }
            
            // Add cards based on synergy groups
            profile.synergyGroups.forEach(group => {
                switch(group.type) {
                    case 'tribal':
                        const tribes = group.synergies.filter(s => s.value).map(s => s.value);
                        const uniqueTribes = [...new Set(tribes)];
                        if (uniqueTribes.includes('Human')) {
                            trends.keyCards.push('Champion of the Parish', 'Thalia\'s Lieutenant');
                        } else if (uniqueTribes.includes('Elf')) {
                            trends.keyCards.push('Elvish Archdruid', 'Ezuri, Renegade Leader');
                        } else if (uniqueTribes.includes('Goblin')) {
                            trends.keyCards.push('Krenko, Mob Boss', 'Goblin Chieftain');
                        } else if (uniqueTribes.includes('Zombie')) {
                            trends.keyCards.push('Lord of the Undead', 'Gravecrawler');
                        } else if (uniqueTribes.includes('Dragon')) {
                            trends.keyCards.push('Utvara Hellkite', 'Dragon Tempest');
                        }
                        break;
                    case 'counter':
                        trends.keyCards.push('Hardened Scales', 'Doubling Season', 'The Ozolith');
                        break;
                    case 'graveyard':
                        trends.keyCards.push('Animate Dead', 'Eternal Witness', 'Muldrotha, the Gravetide');
                        break;
                    case 'sacrifice':
                        trends.keyCards.push('Dictate of Erebos', 'Grave Pact', 'Viscera Seer');
                        break;
                    case 'token':
                        trends.keyCards.push('Parallel Lives', 'Anointed Procession', 'Divine Visitation');
                        break;
                    case 'spell':
                        trends.keyCards.push('Guttersnipe', 'Young Pyromancer', 'Talrand, Sky Summoner');
                        break;
                    case 'land':
                        trends.keyCards.push('Lotus Cobra', 'Tireless Tracker', 'Field of the Dead');
                        break;
                    case 'mana':
                        trends.keyCards.push('Zendikar Resurgent', 'Mirari\'s Wake', 'Nyxbloom Ancient');
                        break;
                }
            });
        } else {
            // Add format-specific key cards for other formats
            if (profile.recommendedStrategy.primaryStrategy === 'aggressive') {
                trends.keyCards.push('Lightning Bolt', 'Fatal Push', 'Path to Exile');
            } else if (profile.recommendedStrategy.primaryStrategy === 'control') {
                trends.keyCards.push('Force of Will', 'Thoughtseize', 'Supreme Verdict');
            } else if (profile.recommendedStrategy.primaryStrategy === 'value') {
                trends.keyCards.push('Jace, the Mind Sculptor', 'Tarmogoyf', 'Snapcaster Mage');
            } else if (profile.recommendedStrategy.primaryStrategy === 'combo') {
                trends.keyCards.push('Brainstorm', 'Ponder', 'Dark Ritual');
            }
        }
        
        // Add safety mechanisms based on life risk assessment
        if (profile.lifeRiskAssessment.risk === 'high') {
            trends.safetyMechanisms.push(
                'Whip of Erebos', 
                'Exquisite Blood', 
                'Lifelink creatures', 
                'Essence Warden', 
                'Soul Warden'
            );
        } else if (profile.lifeRiskAssessment.risk === 'medium') {
            trends.safetyMechanisms.push(
                'Basilisk Collar',
                'Batterskull',
                'Loxodon Warhammer'
            );
        }
        
        // Add power/toughness enhancers based on analysis
        if (profile.powerToughnessAnalysis.dynamics === 'positive') {
            trends.powerToughnessEnhancers.push(
                'Craterhoof Behemoth',
                'Overwhelming Stampede',
                'Beastmaster Ascension'
            );
        } else if (profile.powerToughnessAnalysis.dynamics === 'dynamic') {
            trends.powerToughnessEnhancers.push(
                'Coat of Arms',
                'Cathars\' Crusade',
                'Biomass Mutation'
            );
        }
        
        // Determine synergies based on commander profile
        profile.synergyGroups.forEach(group => {
            trends.synergies.push(group.description);
        });
        
        // If no synergies were found from synergy groups, use text analysis
        if (trends.synergies.length === 0) {
            if (profile.textAnalysis.triggers.length > 0) {
                trends.synergies.push(`Cards that trigger "${profile.textAnalysis.triggers[0]}"`);
            }
            if (profile.textAnalysis.effects.includes('sacrifice')) {
                trends.synergies.push('Sacrifice outlets and death triggers');
            }
            if (profile.textAnalysis.effects.includes('draw')) {
                trends.synergies.push('Card draw enhancers and payoffs');
            }
            if (profile.creatureTypes.length > 0) {
                trends.synergies.push(`${profile.creatureTypes[0].type} tribal synergies`);
            }
        }
        
        // Determine counterplay based on commander profile
        if (profile.recommendedStrategy.primaryStrategy === 'aggressive') {
            trends.counterplay.push('Board wipes', 'Fog effects', 'Life gain');
        } else if (profile.recommendedStrategy.primaryStrategy === 'control') {
            trends.counterplay.push('Uncounterable spells', 'Hexproof/Indestructible', 'Hand disruption');
        } else if (profile.recommendedStrategy.primaryStrategy === 'value') {
            trends.counterplay.push('Graveyard hate', 'Stax effects', 'Targeted removal');
        } else if (profile.recommendedStrategy.primaryStrategy === 'combo') {
            trends.counterplay.push('Counterspells', 'Discard', 'Stifle effects');
        }
        
        // Determine win conditions based on commander profile
        if (profile.winConditions.length > 0) {
            profile.winConditions.forEach(winCon => {
                trends.winConditions.push(`${winCon.type}: ${winCon.description}`);
            });
        } else {
            // Add generic win conditions based on strategy
            if (profile.recommendedStrategy.primaryStrategy === 'aggressive') {
                trends.winConditions.push('Combat damage through evasive creatures');
            } else if (profile.recommendedStrategy.primaryStrategy === 'control') {
                trends.winConditions.push('Value engines leading to insurmountable advantage');
            } else if (profile.recommendedStrategy.primaryStrategy === 'value') {
                trends.winConditions.push('Outvalue opponents and win through attrition');
            } else if (profile.recommendedStrategy.primaryStrategy === 'combo') {
                trends.winConditions.push('Assemble key combo pieces for game-ending effect');
            }
        }
        
        return {
            commanderProfile: profile,
            deckTrends: trends,
            winRate: calculateExpectedWinRate(profile, trends)
        };
    }

    function calculateExpectedWinRate(profile, trends) {
        // This is a sophisticated model to estimate win rate potential
        let baseRate = 50; // Start at 50%
        
        // Adjust based on strategy clarity
        if (profile.recommendedStrategy.primaryStrategy && 
            profile.recommendedStrategy.supportStrategies.length > 0) {
            baseRate += 5; // Clear primary and support strategies
        }
        
        // Adjust based on win condition clarity
        if (profile.winConditions.length > 0) {
            baseRate += 5; // Clear win conditions
        }
        
        // Adjust based on synergy potential
        if (profile.synergyGroups.length >= 2) {
            baseRate += 5; // Multiple synergy groups identified
        }
        
        // Adjust based on counterplay awareness
        if (trends.deckTrends.counterplay.length >= 2) {
            baseRate += 5; // Awareness of potential counterplay
        }
        
        // Adjust based on archetype strength
        if (trends.deckTrends.archetypes.some(a => 
            a.includes('Control') || 
            a.includes('Recursion') || 
            a.includes('Combo')
        )) {
            baseRate += 5; // Strong archetypes in Commander
        }
        
        // Adjust based on life risk assessment
        if (profile.lifeRiskAssessment.risk === 'high') {
            baseRate -= 5; // High risk of self-defeat
        } else if (profile.lifeRiskAssessment.risk === 'medium') {
            baseRate -= 2; // Medium risk of self-defeat
        }
        
        // Adjust based on power/toughness dynamics
        if (profile.powerToughnessAnalysis.dynamics === 'positive') {
            baseRate += 3; // Positive power/toughness modifications
        } else if (profile.powerToughnessAnalysis.dynamics === 'negative') {
            baseRate -= 1; // Negative power/toughness modifications
        }
        
        // Cap at 75% as requested
        return Math.min(baseRate, 75);
    }

    function generateNarrativeFromTrends(trends, commander) {
        if (!trends || !commander) return '';
        
        const narrative = [];
        
        // Introduction based on commander
        narrative.push(`${commander.name} leads a ${commander.color_identity.join('')} deck focused on ${trends.deckTrends.archetypes.join(' and ')}.`);
        
        // Strategy narrative
        const profile = trends.commanderProfile;
        narrative.push(`The deck primarily employs a ${profile.recommendedStrategy.primaryStrategy} strategy` + 
            (profile.recommendedStrategy.supportStrategies.length > 0 ? 
                ` with elements of ${profile.recommendedStrategy.supportStrategies.join(' and ')}.` : '.'));
        
        // Key synergies
        if (trends.deckTrends.synergies.length > 0) {
            narrative.push(`Key synergies include ${trends.deckTrends.synergies.join(', ')}.`);
        }
        
        // Win conditions
        if (trends.deckTrends.winConditions.length > 0) {
            narrative.push(`The deck aims to win through ${trends.deckTrends.winConditions.join(' or ')}.`);
        }
        
        // Key cards
        if (trends.deckTrends.keyCards.length > 0) {
            narrative.push(`Important cards to consider include ${trends.deckTrends.keyCards.slice(0, 5).join(', ')}.`);
        }
        
        // Life risk assessment
        if (profile.lifeRiskAssessment.risk !== 'none') {
            narrative.push(profile.lifeRiskAssessment.description);
            if (profile.lifeRiskAssessment.recommendation) {
                narrative.push(profile.lifeRiskAssessment.recommendation);
            }
            
            if (trends.deckTrends.safetyMechanisms.length > 0) {
                narrative.push(`Consider including ${trends.deckTrends.safetyMechanisms.slice(0, 3).join(', ')} to mitigate life loss risks.`);
            }
        }
        
        // Power/toughness dynamics
        if (profile.powerToughnessAnalysis.dynamics !== 'none') {
            narrative.push(profile.powerToughnessAnalysis.description);
            if (profile.powerToughnessAnalysis.recommendation) {
                narrative.push(profile.powerToughnessAnalysis.recommendation);
            }
            
            if (trends.deckTrends.powerToughnessEnhancers.length > 0) {
                narrative.push(`Cards like ${trends.deckTrends.powerToughnessEnhancers.slice(0, 3).join(', ')} would enhance these power/toughness dynamics.`);
            }
        }
        
        // Counterplay awareness
        if (trends.deckTrends.counterplay.length > 0) {
            narrative.push(`Be prepared to face ${trends.deckTrends.counterplay.join(', ')} as potential counterplay.`);
        }
        
        // Win rate projection
        narrative.push(`With proper piloting and tuning, this deck has the potential to achieve a win rate of approximately ${trends.winRate}%.`);
        
        return narrative.join(' ');
    }

    // Public API
    return {
        analyzeCard: function(card) {
            return generateStrategicProfile(card);
        },
        
        analyzeDeckTrends: function(commander, format = 'commander') {
            return generateDeckTrends(commander, format);
        },
        
        generateNarrative: function(commander, format = 'commander') {
            const trends = generateDeckTrends(commander, format);
            return generateNarrativeFromTrends(trends, commander);
        },
        
        getRecommendedCards: function(commander, format = 'commander') {
            const trends = generateDeckTrends(commander, format);
            if (!trends) return [];
            
            // Return key cards plus additional recommendations based on strategy
            const recommendations = [...new Set([
                ...trends.deckTrends.keyCards,
                ...(trends.deckTrends.safetyMechanisms || []),
                ...(trends.deckTrends.powerToughnessEnhancers || [])
            ])];
            
            // Add strategy-specific recommendations
            const profile = trends.commanderProfile;
            if (profile.recommendedStrategy.primaryStrategy === 'aggressive') {
                recommendations.push('Lightning Greaves', 'Swiftfoot Boots', 'Heroic Intervention');
            } else if (profile.recommendedStrategy.primaryStrategy === 'control') {
                recommendations.push('Mystic Remora', 'Arcane Denial', 'Path to Exile');
            } else if (profile.recommendedStrategy.primaryStrategy === 'value') {
                recommendations.push('Eternal Witness', 'Solemn Simulacrum', 'Sun Titan');
            } else if (profile.recommendedStrategy.primaryStrategy === 'combo') {
                recommendations.push('Silence', 'Grand Abolisher', 'Teferi\'s Protection');
            }
            
            return recommendations;
        },
        
        // Check if a card has dangerous life payment effects
        checkLifePaymentRisks: function(card) {
            if (!card || !card.oracle_text) return { risk: 'none', description: 'No life payment risks' };
            
            const textAnalysis = analyzeCardText(card.oracle_text);
            return assessLifePaymentRisk(textAnalysis);
        },
        
        // Check for power/toughness dynamics
        analyzePowerToughness: function(card) {
            if (!card || !card.oracle_text) return { dynamics: 'none', description: 'No power/toughness modifications' };
            
            const textAnalysis = analyzeCardText(card.oracle_text);
            return analyzePowerToughnessDynamics(textAnalysis);
        },
        
        // Identify exact win conditions
        identifyExactWinConditions: function(card) {
            if (!card || !card.oracle_text) return [];
            
            const winCons = [];
            exactWinConditions.forEach(condition => {
                if (condition.regex.test(card.oracle_text)) {
                    winCons.push({
                        text: card.oracle_text.match(condition.regex)[0],
                        type: condition.type,
                        risk: condition.risk
                    });
                }
            });
            
            return winCons;
        },
        
        // Identify synergy patterns
        identifySynergies: function(card) {
            if (!card || !card.oracle_text) return [];
            
            const textAnalysis = analyzeCardText(card.oracle_text);
            return identifySynergyGroups(textAnalysis);
        },
        
        identifyCreatureTypes: identifyCreatureType,
        analyzeColorIdentity: analyzeColorIdentity
    };
})();

// Make available globally
window.cardTextAnalyzer = cardTextAnalyzer;

// Integration with app.js
// Add this to app.js to integrate with the deck generation process
function enhanceDeckGeneration() {
    // Original generateDeck function in app.js
    const originalGenerateDeck = window.mtgFormats.generateDeck;
    
    // Override with enhanced version
    window.mtgFormats.generateDeck = async function(selectedCard) {
        // First, analyze the selected card
        const cardAnalysis = window.cardTextAnalyzer.analyzeCard(selectedCard);
        console.log('Card Analysis:', cardAnalysis);
        
        // Get the current format
        const format = window.mtgFormats.getCurrentFormat();
        
        // Generate deck trends
        const deckTrends = window.cardTextAnalyzer.analyzeDeckTrends(selectedCard, format.code);
        console.log('Deck Trends:', deckTrends);
        
        // Call the original function to generate the deck
        let generatedDeck = await originalGenerateDeck(selectedCard);
        
        // Post-process the deck based on analysis
        generatedDeck = postProcessDeck(generatedDeck, cardAnalysis, deckTrends);
        
        return generatedDeck;
    };
    
    // Function to post-process the deck based on analysis
    function postProcessDeck(deck, cardAnalysis, deckTrends) {
        if (!deck || !Array.isArray(deck) || deck.length === 0) return deck;
        
        // Check for life payment risks
        if (cardAnalysis.lifeRiskAssessment.risk === 'high') {
            // Add life gain cards if not already present
            const lifeGainCards = deckTrends.deckTrends.safetyMechanisms || [];
            const existingLifeGainCards = deck.filter(card => 
                lifeGainCards.includes(card.name)
            ).length;
            
            // If we don't have enough life gain cards, try to add some
            if (existingLifeGainCards < 3) {
                console.log('Adding life gain cards to mitigate high life payment risks');
                // This would need to be implemented with actual card fetching
            }
        }
        
        // Check for power/toughness dynamics
        if (cardAnalysis.powerToughnessAnalysis.dynamics === 'positive' || 
            cardAnalysis.powerToughnessAnalysis.dynamics === 'dynamic') {
            // Add power/toughness enhancers if not already present
            const ptEnhancers = deckTrends.deckTrends.powerToughnessEnhancers || [];
            const existingPTEnhancers = deck.filter(card => 
                ptEnhancers.includes(card.name)
            ).length;
            
            // If we don't have enough enhancers, try to add some
            if (existingPTEnhancers < 2) {
                console.log('Adding power/toughness enhancers to leverage dynamics');
                // This would need to be implemented with actual card fetching
            }
        }
        
        // Check for win conditions
        if (cardAnalysis.winConditions.length > 0) {
            // Make sure we have enough support for the win conditions
            const hasExplicitWinCon = cardAnalysis.winConditions.some(wc => 
                wc.type === 'direct' || wc.type === 'opponent_loss' || wc.type === 'all_opponents_lose'
            );
            
            if (hasExplicitWinCon) {
                console.log('Deck contains explicit win conditions - ensuring proper support');
                // This would need to be implemented with actual card fetching/protection
            }
        }
        
        // Check for synergy groups
        if (cardAnalysis.synergyGroups.length > 0) {
            // Make sure we have enough cards for each synergy group
            cardAnalysis.synergyGroups.forEach(group => {
                const synergisticCards = deck.filter(card => {
                    // This would need more sophisticated analysis of each card
                    // For now, just check if the card text contains keywords related to the synergy
                    if (!card.oracle_text) return false;
                    
                    switch(group.type) {
                        case 'tribal':
                            const tribes = group.synergies.filter(s => s.value).map(s => s.value);
                            return tribes.some(tribe => 
                                card.type_line && card.type_line.toLowerCase().includes(tribe.toLowerCase())
                            );
                        case 'counter':
                            const counterTypes = group.synergies.filter(s => s.value).map(s => s.value);
                            return counterTypes.some(counter => 
                                card.oracle_text.toLowerCase().includes(counter.toLowerCase() + ' counter')
                            );
                        case 'graveyard':
                            return card.oracle_text.toLowerCase().includes('graveyard');
                        case 'sacrifice':
                            return card.oracle_text.toLowerCase().includes('sacrifice');
                        case 'token':
                            return card.oracle_text.toLowerCase().includes('token');
                        case 'spell':
                            const spellTypes = group.synergies.filter(s => s.value).map(s => s.value);
                            return spellTypes.some(spell => 
                                card.oracle_text.toLowerCase().includes(spell.toLowerCase() + ' spell')
                            );
                        case 'land':
                            return card.oracle_text.toLowerCase().includes('land');
                        case 'mana':
                            return card.oracle_text.toLowerCase().includes('mana');
                        default:
                            return false;
                    }
                });
                
                console.log(`Found ${synergisticCards.length} cards supporting ${group.type} synergy`);
                
                // If we don't have enough synergistic cards, we might want to add more
                // This would need to be implemented with actual card fetching
            });
        }
        
        // Ensure we don't have too many cards that could lead to self-defeat
        const dangerousCards = deck.filter(card => {
            if (!card.oracle_text) return false;
            
            // Check for dangerous life payment patterns
            for (const pattern of dangerousLifePatterns) {
                if (pattern.severity === 'high' && pattern.regex.test(card.oracle_text)) {
                    return true;
                }
            }
            
            return false;
        });
        
        if (dangerousCards.length > 3) {
            console.log(`Warning: Deck contains ${dangerousCards.length} cards with high-risk life payments`);
            console.log('Consider removing some of these cards or adding more life gain');
            // This would need to be implemented with actual card replacement
        }
        
        return deck;
    }
    
    // Add card analysis to the selectCard function
    const originalSelectCard = window.selectCard;
    
    window.selectCard = function(card) {
        // Call the original function
        originalSelectCard(card);
        
        // Add card analysis
        if (card) {
            const cardAnalysis = window.cardTextAnalyzer.analyzeCard(card);
            const format = window.mtgFormats.getCurrentFormat();
            const deckTrends = window.cardTextAnalyzer.analyzeDeckTrends(card, format.code);
            const narrative = window.cardTextAnalyzer.generateNarrative(card, format.code);
            
            // Display the analysis
            displayCardAnalysis(cardAnalysis, deckTrends, narrative);
        }
    };
    
    // Function to display card analysis
    function displayCardAnalysis(analysis, trends, narrative) {
        // Check if the analysis container already exists
        let analysisContainer = document.getElementById('card-analysis-container');
        
        // If not, create it
        if (!analysisContainer) {
            analysisContainer = document.createElement('div');
            analysisContainer.id = 'card-analysis-container';
            analysisContainer.className = 'card-analysis-container';
            
            // Add it to the page
            const container = document.getElementById('selectedCardContent');
            if (container) {
                container.appendChild(analysisContainer);
            }
        }
        
        // Update the content
        analysisContainer.innerHTML = `
            <h3>Card Strategy Analysis</h3>
            <div class="narrative-section">
                <p>${narrative}</p>
            </div>
            <div class="strategy-section">
                <h4>Recommended Strategy</h4>
                <div class="strategy-primary">Primary: ${analysis.recommendedStrategy.primaryStrategy}</div>
                ${analysis.recommendedStrategy.supportStrategies.length > 0 ? 
                    `<div class="strategy-support">Support: ${analysis.recommendedStrategy.supportStrategies.join(', ')}</div>` : ''}
            </div>
            ${analysis.lifeRiskAssessment.risk !== 'none' ? `
                <div class="risk-section ${analysis.lifeRiskAssessment.risk}-risk">
                    <h4>Life Payment Risk</h4>
                    <p>${analysis.lifeRiskAssessment.description}</p>
                    <p>${analysis.lifeRiskAssessment.recommendation || ''}</p>
                </div>
            ` : ''}
            ${analysis.powerToughnessAnalysis.dynamics !== 'none' ? `
                <div class="pt-section">
                    <h4>Power/Toughness Dynamics</h4>
                    <p>${analysis.powerToughnessAnalysis.description}</p>
                    <p>${analysis.powerToughnessAnalysis.recommendation || ''}</p>
                </div>
            ` : ''}
            ${analysis.winConditions.length > 0 ? `
                <div class="win-conditions-section">
                    <h4>Win Conditions</h4>
                    <ul>
                        ${analysis.winConditions.map(wc => `<li>${wc.text} (${wc.type})</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            <div class="synergy-section">
                <h4>Synergy Groups</h4>
                ${analysis.synergyGroups.length > 0 ? `
                    <ul>
                        ${analysis.synergyGroups.map(sg => `
                            <li>
                                <strong>${sg.type}</strong>: ${sg.description}
                                <div class="synergy-recommendation">${sg.recommendation}</div>
                            </li>
                        `).join('')}
                    </ul>
                ` : '<p>No specific synergy groups detected</p>'}
            </div>
            <div class="win-rate-section">
                <h4>Projected Win Rate</h4>
                <div class="win-rate-meter">
                    <div class="win-rate-fill" style="width: ${trends.winRate}%"></div>
                    <div class="win-rate-label">${trends.winRate}% Win Rate</div>
                </div>
            </div>
        `;
    }
}

// Call the enhancement function when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    // Wait for the app to initialize
    setTimeout(enhanceDeckGeneration, 1000);
});
