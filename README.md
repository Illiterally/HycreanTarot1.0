Hycrean Tarot is a tactical battle game played with a standard deck, where each side commits cards into lanes and watches them advance, collide, survive, and break through toward the enemy line. In digital form, it plays like an automated lane battler with card-game readability: values matter, lane choice matters, and a single clash can reshape the board. As of commit 22, the game has a solid online desktop-to-desktop baseline and a trustworthy local/desktop source of truth, with the core play loop, room-based multiplayer, and seasonal identity all working well enough to build on. The next cleanup pass is focused and practical: UNDO is currently breaking the game, a phantom Joker sometimes flashes in an opening hand before disappearing, the active Season should be shown more clearly during the match, and board spacing still needs tuning so the large HP totals do not crowd cards and tiles in Normal Lane mode. Mobile is not yet stable, so the plan is to protect desktop truth first and let mobile recovery happen from a cleaner build.

The next feature layer turns the Joker into a seasonal selection system, where each season offers three possible effects and the player chooses one for that match. The current set is below.

Spring
Bloom — all friendly board cards gain +2 value
Duplicate — the Joker becomes a copy of the card in front of it in the lane
Snapfrost — all cards reset to their original printed value
Summer
Heatwave — applies broad heat pressure across the board
Wildfire — immediately clears one lane
Summer Rain — restores all friendly cards to full HP
Autumn
Equalize — sets every card in the lane to 6
Trick — randomizes the value of all cards in the lane
Harvest Hero — the Joker becomes an Ace
Winter
Whiteout — wipes the board clean
Snowed In — locks a lane closed
Iceslick — creates a slippery lane effect, sending cards forward until blocked

The near-term vision is not to bury the game in complexity, but to sharpen what is already strong: stabilize the current desktop build, clarify the interface, then add this seasonal Joker layer as the first real expansion of the game’s strategic identity.
